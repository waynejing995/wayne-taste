/**
 * The self-chat (48:notes), which is not Microsoft Graph.
 *
 * Graph has no API for the "notes to self" conversation. Teams' own client
 * reaches it through chatsvc: a regional messaging service authenticated with
 * an X-Skypetoken, obtained by
 *
 *   1. a FOCI silent swap of the cached refresh token for an
 *      `api.spaces.skype.com/.default` token, and
 *   2. trading that at `teams.microsoft.com/api/authsvc/v1.0/authz` for
 *      `tokens.skypeToken` and the region's `regionGtms.messagingService`.
 *
 * Ported from fetch_teams.py's `_get_skype_auth` / `fetch_self_chat` /
 * `send_self_chat`, with one deliberate omission: the Python version falls back
 * to the stored password when the silent swap fails. This does not — there is
 * no stored password on this side, and there will not be one. A failed swap
 * says to run `/teams init`.
 *
 * Three surfaces depend on this: teams_send target=self, teams_read
 * target=self, and the /teams remote channel poll.
 */
import type { SelfHistoryPage, SelfMessage } from "./backend.ts";
import { escapeHtml, htmlToText } from "./html.ts";
import { htmlToMarkdown } from "./markdown.ts";
import { fillMentions, type ResolvedMention } from "./mentions.ts";
import { cursorPages } from "./paging.ts";

export const SKYPE_SCOPES = ["https://api.spaces.skype.com/.default"];
const SELF_CONVERSATION = "48:notes";
const AUTHZ_URL = "https://teams.microsoft.com/api/authsvc/v1.0/authz";
/** Only used when authsvc does not name a region. */
const DEFAULT_MESSAGING = "https://amer.ng.msg.teams.microsoft.com/v1";
/** A self-chat walk asks for pages this size; the link chatsvc gives carries the rest. */
const WALK_PAGE = 50;

type Transport = (
	url: string,
	init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

interface RawSkypeMessage {
	id?: string;
	composetime?: string;
	content?: string;
	messagetype?: string;
}

export class SkypeClient {
	/** The swap is cached: the remote channel polls on a timer, and paying for
	  * an authsvc round trip per poll would triple its cost. */
	private auth?: { skypeToken: string; messaging: string };

	constructor(
		/** Supplies an AAD token for the Skype scope (a FOCI swap of ours). */
		private readonly skypeScopedToken: () => Promise<string>,
		private readonly doFetch: Transport = fetch as unknown as Transport,
	) {}

	private async authorize(): Promise<{ skypeToken: string; messaging: string }> {
		if (this.auth) return this.auth;
		const r = await this.doFetch(AUTHZ_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${await this.skypeScopedToken()}`,
				"Content-Type": "application/json",
				Accept: "application/json",
				"x-ms-client-type": "web",
			},
			body: "{}",
		});
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) throw new Error(`Teams authsvc ${r.status}: ${text.slice(0, 200)}`);
		const body = JSON.parse(text) as {
			tokens?: { skypeToken?: string };
			skypeToken?: string;
			regionGtms?: { messagingService?: string };
		};
		const skypeToken = body.tokens?.skypeToken ?? body.skypeToken;
		// Returning "" here would send an unauthenticated request that fails
		// later with a message about the conversation, not about the token.
		if (!skypeToken) throw new Error("Teams authsvc returned no skypeToken");
		this.auth = { skypeToken, messaging: body.regionGtms?.messagingService ?? DEFAULT_MESSAGING };
		return this.auth;
	}

	private conversationUrl(messaging: string, suffix = ""): string {
		return `${messaging.replace(/\/$/, "")}/users/ME/conversations/${encodeURIComponent(SELF_CONVERSATION)}/messages${suffix}`;
	}

	/**
	 * One page of the self-chat as chatsvc sends it: newest first, with the link to the page before it.
	 *
	 * The link is `_metadata.backwardLink`. Checked against the live service: it sits on the messaging host, and its
	 * query carries startTime, syncState, pageSize and view. A page with no messages ends the history, whatever link it
	 * carries. The link is followed with the skype token, so only on the host that issued it.
	 */
	private async fetchPage(pageSize: number, cursor?: string): Promise<{ raw: RawSkypeMessage[]; older?: string }> {
		const { skypeToken, messaging } = await this.authorize();
		let url: string;
		if (cursor === undefined) {
			url = this.conversationUrl(messaging, `?pageSize=${pageSize}&view=msnp24Equivalent|supportsMessageProperties`);
		} else {
			if (new URL(cursor).origin !== new URL(messaging).origin) {
				throw new Error("chatsvc named an older page on another host; refusing to send the token there");
			}
			url = cursor;
		}
		const r = await this.doFetch(url, {
			headers: {
				"X-Skypetoken": skypeToken,
				Accept: "application/json",
				"User-Agent": "Mozilla/5.0 TeamsPrototype/1.0",
			},
		});
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) throw new Error(`chatsvc ${r.status}: ${text.slice(0, 200)}`);
		const body = JSON.parse(text) as { messages?: RawSkypeMessage[]; _metadata?: { backwardLink?: string } };
		const raw = body.messages ?? [];
		return { raw, older: raw.length > 0 ? body._metadata?.backwardLink || undefined : undefined };
	}

	/** Messages as the pane shows them: control frames and empties dropped, newer than `sinceId` when given, oldest first. */
	private project(raw: RawSkypeMessage[], sinceId: string): SelfMessage[] {
		const out: SelfMessage[] = [];
		for (const m of raw) {
			const id = String(m.id ?? "");
			if (/^\d+$/.test(sinceId) && /^\d+$/.test(id) && Number(id) <= Number(sinceId)) continue;
			// Typing indicators and other control frames are not messages.
			if ((m.messagetype ?? "").startsWith("Control/")) continue;
			const html = m.content ?? "";
			const flat = htmlToText(html);
			if (!flat) continue;
			// The self-chat used to skip Markdown conversion entirely, so code
			// blocks I sent myself came back flat while every other chat rendered.
			out.push({ id, at: m.composetime ?? "", text: flat, md: htmlToMarkdown(html) });
		}
		out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
		return out;
	}

	/**
	 * Messages, oldest first.
	 *
	 * With `sinceId` (the remote channel's cursor) this is one page of what is newer. chatsvc ids are monotonic
	 * millisecond timestamps, which is what makes them usable as one; ignoring it would re-execute a command that
	 * already ran.
	 *
	 * Without one it is the newest `top`: older pages are read until `top` raw messages are in hand, the newest `top`
	 * kept, and only then are control frames and empties dropped -- the same order the Graph path uses.
	 */
	async selfMessages(sinceId: string, top = 20): Promise<SelfMessage[]> {
		if (sinceId) return this.project((await this.fetchPage(top)).raw, sinceId);
		const size = Math.min(top, WALK_PAGE);
		const raw: RawSkypeMessage[] = [];
		const first = await this.fetchPage(size);
		for await (const page of cursorPages(first, (p) => p.older, (c) => this.fetchPage(size, c))) {
			raw.push(...page.raw);
			if (raw.length >= top) break;
		}
		raw.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
		return this.project(raw.slice(0, top), "");
	}

	/**
	 * One page of the self-chat for the pane: the newest with no cursor, the page before `cursor` otherwise.
	 *
	 * A page of control frames alone is passed over, and the walk reads on through as many of them as there are, so a
	 * page never comes back empty while older messages exist.
	 */
	async selfPage(cursor: string | undefined, pageSize: number): Promise<SelfHistoryPage> {
		let messages: SelfMessage[] = [];
		let older: string | undefined;
		const first = await this.fetchPage(pageSize, cursor);
		for await (const page of cursorPages(first, (p) => p.older, (c) => this.fetchPage(pageSize, c))) {
			messages = this.project(page.raw, "");
			older = page.older;
			if (messages.length > 0) break;
		}
		return { messages, older };
	}

	/**
	 * Post to the self-chat.
	 *
	 * `messagetype` follows the content type. It used to be RichText/Html
	 * unconditionally, so plain text containing "<" was parsed as markup:
	 * `Foo<T>` vanished and newlines collapsed.
	 *
	 * A mention is chatsvc's own markup: a Mention span in the content, and
	 * `properties.mentions`, a JSON string that names each person by `8:orgid:<oid>`.
	 */
	async send(content: string, html: boolean, mentions: readonly ResolvedMention[] = []): Promise<void> {
		const payload =
			mentions.length === 0
				? { content, messagetype: html ? "RichText/Html" : "Text" }
				: {
						content: fillMentions(
							content,
							mentions,
							(m, i) => `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${i}">${escapeHtml(m.name)}</span>`,
						),
						messagetype: "RichText/Html",
						properties: {
							mentions: JSON.stringify(
								mentions.map((m, i) => ({
									"@type": "http://schema.skype.com/Mention",
									itemid: String(i),
									mri: `8:orgid:${m.oid}`,
									mentionType: "person",
									displayName: m.name,
								})),
							),
						},
					};
		const { skypeToken, messaging } = await this.authorize();
		const r = await this.doFetch(this.conversationUrl(messaging), {
			method: "POST",
			headers: {
				"X-Skypetoken": skypeToken,
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "Mozilla/5.0 TeamsPrototype/1.0",
			},
			body: JSON.stringify(payload),
		});
		if (r.status < 200 || r.status >= 300) throw new Error(`chatsvc send ${r.status}: ${(await r.text()).slice(0, 200)}`);
	}
}
