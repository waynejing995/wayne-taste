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
 * target=self, and the self-chat watch poll.
 */
import type { SelfHistoryPage, SelfMessage } from "./backend.ts";
import { attachedCardText, CARD_CONTENT_TYPE } from "./card.ts";
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
	init: { method?: string; headers: Record<string, string>; body?: string | Uint8Array },
) => Promise<{ status: number; text(): Promise<string> }>;

/** AMS derives a platform id from the User-Agent and rejects one it cannot parse (Bun's own included). */
const AMS_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Teams/24295.605.3225.8804/49";

/** An image already stored in AMS, ready to be referenced from a message. */
export interface AmsImage {
	id: string;
	name: string;
	/** The AMS host that stored it; the `<img>` points there. */
	host: string;
}

export interface RawSkypeMessage {
	id?: string;
	composetime?: string;
	content?: string;
	messagetype?: string;
	/** `cards` is a JSON string: [{cardClientId, contentType, content}], what a Graph card send stores. */
	properties?: { cards?: string };
}

/** The text of the Adaptive Cards a chatsvc message carries, one per line; "" for none or unreadable JSON. */
function cardsText(m: RawSkypeMessage): string {
	if (!m.properties?.cards) return "";
	let cards: { contentType?: string; content?: unknown }[];
	try {
		cards = JSON.parse(m.properties.cards);
	} catch {
		return "";
	}
	return cards
		.filter((c) => c.contentType === CARD_CONTENT_TYPE)
		.map((c) => attachedCardText(c.content))
		.filter(Boolean)
		.join("\n");
}

export class SkypeClient {
	/** The swap is cached: the self-chat watch polls on a timer, and paying for
	  * an authsvc round trip per poll would triple its cost. */
	private auth?: { skypeToken: string; messaging: string; ams?: string };

	constructor(
		/** Supplies an AAD token for the Skype scope (a FOCI swap of ours). */
		private readonly skypeScopedToken: () => Promise<string>,
		private readonly doFetch: Transport = fetch as unknown as Transport,
	) {}

	private async authorize(): Promise<{ skypeToken: string; messaging: string; ams?: string }> {
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
			regionGtms?: { messagingService?: string; ams?: string };
		};
		const skypeToken = body.tokens?.skypeToken ?? body.skypeToken;
		// Returning "" here would send an unauthenticated request that fails
		// later with a message about the conversation, not about the token.
		if (!skypeToken) throw new Error("Teams authsvc returned no skypeToken");
		this.auth = {
			skypeToken,
			messaging: body.regionGtms?.messagingService ?? DEFAULT_MESSAGING,
			ams: body.regionGtms?.ams,
		};
		return this.auth;
	}

	/**
	 * A chatsvc request with the cached skype token. The token expires (about a day) and nothing
	 * tells us when, so a 401 drops the cache, swaps for a fresh one and tries exactly once more.
	 * Without this a long-lived session (a self-chat watch) went 401 forever until restarted.
	 */
	private async skypeFetch(
		build: (auth: { skypeToken: string; messaging: string; ams?: string }) => {
			url: string;
			init: { method?: string; headers: Record<string, string>; body?: string | Uint8Array };
		},
	): Promise<{ status: number; text(): Promise<string> }> {
		const once = async () => {
			const { url, init } = build(await this.authorize());
			return this.doFetch(url, init);
		};
		const r = await once();
		if (r.status !== 401) return r;
		this.auth = undefined;
		return once();
	}

	private conversationUrl(messaging: string, suffix = "", conversation = SELF_CONVERSATION): string {
		return `${messaging.replace(/\/$/, "")}/users/ME/conversations/${encodeURIComponent(conversation)}/messages${suffix}`;
	}

	/**
	 * One page of the self-chat as chatsvc sends it: newest first, with the link to the page before it.
	 *
	 * The link is `_metadata.backwardLink`. Checked against the live service: it sits on the messaging host, and its
	 * query carries startTime, syncState, pageSize and view. A page with no messages ends the history, whatever link it
	 * carries. The link is followed with the skype token, so only on the host that issued it.
	 */
	private async fetchPage(pageSize: number, cursor?: string): Promise<{ raw: RawSkypeMessage[]; older?: string }> {
		const r = await this.skypeFetch(({ skypeToken, messaging }) => {
			let url: string;
			if (cursor === undefined) {
				url = this.conversationUrl(messaging, `?pageSize=${pageSize}&view=msnp24Equivalent|supportsMessageProperties`);
			} else {
				if (new URL(cursor).origin !== new URL(messaging).origin) {
					throw new Error("chatsvc named an older page on another host; refusing to send the token there");
				}
				url = cursor;
			}
			return {
				url,
				init: {
					headers: {
						"X-Skypetoken": skypeToken,
						Accept: "application/json",
						"User-Agent": "Mozilla/5.0 TeamsPrototype/1.0",
					},
				},
			};
		});
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) throw new Error(`chatsvc ${r.status}: ${text.slice(0, 200)}`);
		const body = JSON.parse(text) as { messages?: RawSkypeMessage[]; _metadata?: { backwardLink?: string } };
		const raw = body.messages ?? [];
		return { raw, older: raw.length > 0 ? body._metadata?.backwardLink || undefined : undefined };
	}

	/**
	 * Newest messages of any chatsvc conversation (such as a `19:meeting_...@thread.v2` thread).
	 *
	 * Meeting recording and transcript cards (`RichText/Media_CallRecording`) are posted as
	 * chatsvc control messages that Graph's `/chats/{id}/messages` does not expose with their
	 * OneDrive/SharePoint transcript metadata.
	 */
	async conversationMessages(conversationId: string, pageSize = 200): Promise<RawSkypeMessage[]> {
		const r = await this.skypeFetch(({ skypeToken, messaging }) => ({
			url: this.conversationUrl(
				messaging,
				`?pageSize=${pageSize}&view=msnp24Equivalent|supportsMessageProperties`,
				conversationId,
			),
			init: {
				headers: {
					"X-Skypetoken": skypeToken,
					Accept: "application/json",
					"User-Agent": "Mozilla/5.0 TeamsPrototype/1.0",
				},
			},
		}));
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) throw new Error(`chatsvc ${r.status}: ${text.slice(0, 200)}`);
		const body = JSON.parse(text) as { messages?: RawSkypeMessage[] };
		return body.messages ?? [];
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
			// A card's content is an empty span pointing at it: the card is the text.
			const card = cardsText(m);
			const flat = [htmlToText(html), card].filter(Boolean).join("\n");
			if (!flat) continue;
			// The self-chat used to skip Markdown conversion entirely, so code
			// blocks I sent myself came back flat while every other chat rendered.
			out.push({ id, at: m.composetime ?? "", text: flat, md: [htmlToMarkdown(html), card].filter(Boolean).join("\n\n") });
		}
		out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
		return out;
	}

	/**
	 * Messages, oldest first.
	 *
	 * With `sinceId` (the self-chat watch's cursor) this is one page of what is newer. chatsvc ids are monotonic
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
	 *
	 * An image is an AMS object (see uploadImage), shown by an AMSImage `<img>` appended
	 * after the text and listed in `amsreferences`, the same shape Teams itself posts.
	 */
	async send(
		content: string,
		html: boolean,
		mentions: readonly ResolvedMention[] = [],
		images: readonly AmsImage[] = [],
	): Promise<void> {
		if (images.length > 0 && !html) throw new Error("an image can only be sent as html");
		if (images.length > 0) content += images.map((img) => amsImageTag(img)).join("");
		const payload =
			mentions.length === 0
				? { content, messagetype: html ? "RichText/Html" : "Text", ...(images.length > 0 ? { amsreferences: images.map((i) => i.id) } : {}) }
				: {
						content: fillMentions(
							content,
							mentions,
							(m, i) => `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${i}">${escapeHtml(m.name)}</span>`,
						),
						messagetype: "RichText/Html",
						...(images.length > 0 ? { amsreferences: images.map((i) => i.id) } : {}),
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
		const r = await this.skypeFetch(({ skypeToken, messaging }) => ({
			url: this.conversationUrl(messaging),
			init: {
				method: "POST",
				headers: {
					"X-Skypetoken": skypeToken,
					Accept: "application/json",
					"Content-Type": "application/json",
					"User-Agent": "Mozilla/5.0 TeamsPrototype/1.0",
				},
				body: JSON.stringify(payload),
			},
		}));
		if (r.status < 200 || r.status >= 300) throw new Error(`chatsvc send ${r.status}: ${(await r.text()).slice(0, 200)}`);
	}

	/**
	 * Store an image in AMS so a self-chat message can show it: create the object
	 * (readable by the self-chat only), then upload the bytes. Nothing is posted.
	 */
	async uploadImage(bytes: Uint8Array, name: string): Promise<AmsImage> {
		const ams = async () => {
			const a = await this.authorize();
			if (!a.ams) throw new Error("Teams authsvc named no AMS host; images cannot be uploaded");
			return a.ams.replace(/\/$/, "");
		};
		const headers = (skypeToken: string, type: string) => ({
			Authorization: `skype_token ${skypeToken}`,
			"Content-Type": type,
			"User-Agent": AMS_USER_AGENT,
		});
		const host = await ams();
		const created = await this.skypeFetch(({ skypeToken }) => ({
			url: `${host}/v1/objects`,
			init: {
				method: "POST",
				headers: headers(skypeToken, "application/json"),
				body: JSON.stringify({ type: "pish/image", permissions: { [SELF_CONVERSATION]: ["read"] }, filename: name }),
			},
		}));
		const text = await created.text();
		if (created.status < 200 || created.status >= 300) throw new Error(`AMS create ${created.status}: ${text.slice(0, 200)}`);
		const id = (JSON.parse(text) as { id?: string }).id;
		if (!id) throw new Error(`AMS create returned no id: ${text.slice(0, 200)}`);
		const put = await this.skypeFetch(({ skypeToken }) => ({
			url: `${host}/v1/objects/${encodeURIComponent(id)}/content/imgpsh`,
			init: { method: "PUT", headers: headers(skypeToken, "application/octet-stream"), body: bytes },
		}));
		if (put.status < 200 || put.status >= 300) throw new Error(`AMS upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
		return { id, name, host };
	}
}

function amsImageTag(img: AmsImage): string {
	const id = escapeHtml(img.id);
	return `<p><img src="${escapeHtml(img.host)}/v1/objects/${id}/views/imgo" itemtype="http://schema.skype.com/AMSImage" itemscope="png" alt="${escapeHtml(img.name)}" id="x_${id}" itemid="${id}"></p>`;
}
