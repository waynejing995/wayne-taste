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
import type { SelfMessage } from "./backend.ts";
import { htmlToText } from "./html.ts";
import { htmlToMarkdown } from "./markdown.ts";

export const SKYPE_SCOPES = ["https://api.spaces.skype.com/.default"];
const SELF_CONVERSATION = "48:notes";
const AUTHZ_URL = "https://teams.microsoft.com/api/authsvc/v1.0/authz";
/** Only used when authsvc does not name a region. */
const DEFAULT_MESSAGING = "https://amer.ng.msg.teams.microsoft.com/v1";

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
	 * Messages, oldest-first.
	 *
	 * `sinceId` is the remote channel's cursor. chatsvc ids are monotonic
	 * millisecond timestamps, which is what makes them usable as one; ignoring
	 * it would re-execute a command that already ran.
	 */
	async selfMessages(sinceId: string, top = 20): Promise<SelfMessage[]> {
		const { skypeToken, messaging } = await this.authorize();
		const url = this.conversationUrl(messaging, `?pageSize=${top}&view=msnp24Equivalent|supportsMessageProperties`);
		const r = await this.doFetch(url, {
			headers: {
				"X-Skypetoken": skypeToken,
				Accept: "application/json",
				"User-Agent": "Mozilla/5.0 TeamsPrototype/1.0",
			},
		});
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) throw new Error(`chatsvc ${r.status}: ${text.slice(0, 200)}`);
		const raw = (JSON.parse(text) as { messages?: RawSkypeMessage[] }).messages ?? [];

		const out: SelfMessage[] = [];
		for (const m of raw) {
			const id = String(m.id ?? "");
			if (/^\d+$/.test(sinceId) && /^\d+$/.test(id) && Number(id) <= Number(sinceId)) continue;
			// Typing indicators and other control frames are not messages.
			if ((m.messagetype ?? "").startsWith("Control/")) continue;
			const html = m.content ?? "";
			const text2 = htmlToText(html);
			if (!text2) continue;
			// The self-chat used to skip Markdown conversion entirely, so code
			// blocks I sent myself came back flat while every other chat rendered.
			out.push({ id, at: m.composetime ?? "", text: text2, md: htmlToMarkdown(html) });
		}
		out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
		return out;
	}

	/**
	 * Post to the self-chat.
	 *
	 * `messagetype` follows the content type. It used to be RichText/Html
	 * unconditionally, so plain text containing "<" was parsed as markup:
	 * `Foo<T>` vanished and newlines collapsed.
	 */
	async send(content: string, html: boolean): Promise<void> {
		const { skypeToken, messaging } = await this.authorize();
		const r = await this.doFetch(this.conversationUrl(messaging), {
			method: "POST",
			headers: {
				"X-Skypetoken": skypeToken,
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "Mozilla/5.0 TeamsPrototype/1.0",
			},
			body: JSON.stringify({ content, messagetype: html ? "RichText/Html" : "Text" }),
		});
		if (r.status < 200 || r.status >= 300) throw new Error(`chatsvc send ${r.status}: ${(await r.text()).slice(0, 200)}`);
	}
}
