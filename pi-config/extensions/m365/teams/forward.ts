/**
 * Forwarded messages.
 *
 * Teams stores a forward in one of two shapes, and which one a reader gets depends on the path, not the message:
 *
 *   - Graph, for a forward the Teams client made: the body holds `<attachment id="X">` and attachment X is a
 *     "forwardedMessageReference" whose JSON content carries the original's HTML, sender (an id; Graph leaves its
 *     displayName null) and time.
 *   - chatsvc (the self-chat), and Graph when chatsvc kept no context: the original's HTML sits in the body inside
 *     `<blockquote itemtype="http://schema.skype.com/Forward">`; chatsvc puts the sender and time in
 *     `properties.originalMessageContext`.
 *
 * Both are cut into the same parts here, so the text, the Markdown and the image list all see one forward: a quoted
 * block headed "Forwarded from <sender> · <time>", then the original with its pictures and cards.
 */
import { formatLocal } from "../core/time.ts";
import { escapeHtml, htmlToText } from "./html.ts";

export const FORWARD_ATTACHMENT = "forwardedMessageReference";

export interface FwdAttachment {
	id?: string | number;
	contentType?: string;
	content?: unknown;
}

export interface Forward {
	/** The sender's name when the forward carries one (a bot's), else "" and `senderId` is looked up. */
	sender: string;
	/** The sender's directory object id, "" when unknown. */
	senderId: string;
	/** The original's time, ISO; "" when unknown. */
	at: string;
	/** The original message's HTML. */
	html: string;
}

export type Part = { html: string } | { forward: Forward };

/** A chatsvc `properties.originalMessageContext`: `originalSender` is `8:orgid:<oid>`. */
interface ChatsvcContext {
	originalSender?: unknown;
	originalSentTime?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const UNREADABLE: Forward = { sender: "", senderId: "", at: "", html: "<p>[unreadable attachment]</p>" };

/** A forwardedMessageReference attachment's content as a forward. Malformed JSON marks only this forward. */
function fromAttachment(att: FwdAttachment): Forward {
	let d: unknown;
	try {
		d = typeof att.content === "string" ? JSON.parse(att.content) : att.content;
	} catch {
		return UNREADABLE;
	}
	if (!isObject(d)) return UNREADABLE;
	const who = isObject(d.originalMessageSender) ? d.originalMessageSender : {};
	const user = isObject(who.user) ? who.user : {};
	const app = isObject(who.application) ? who.application : {};
	return {
		sender: str(user.displayName) || (str(app.displayName) ? `${str(app.displayName)} (app)` : ""),
		senderId: str(user.id),
		at: str(d.originalSentDateTime),
		html: str(d.originalMessageContent),
	};
}

function fromContext(ctx: unknown, html: string): Forward {
	const c: ChatsvcContext = isObject(ctx) ? ctx : {};
	return { sender: "", senderId: str(c.originalSender).replace(/^8:orgid:/, ""), at: str(c.originalSentTime), html };
}

const TOKEN = /<attachment\b[^>]*\bid="([^"]*)"[^>]*?(?:\/>|>\s*<\/attachment>)|<blockquote\b[^>]*\bitemtype="http:\/\/schema\.skype\.com\/Forward"[^>]*>/gi;

/** Where the blockquote opened before `from` closes: nested quotes (a reply inside the forward) are counted. */
function closeOf(html: string, from: number): { inner: number; end: number } {
	const re = /<blockquote\b[^>]*>|<\/blockquote\s*>/gi;
	re.lastIndex = from;
	let depth = 1;
	for (let m = re.exec(html); m; m = re.exec(html)) {
		depth += m[0][1] === "/" ? -1 : 1;
		if (depth === 0) return { inner: m.index, end: m.index + m[0].length };
	}
	return { inner: html.length, end: html.length };
}

/**
 * A message body cut into its own HTML and its forwards, in order. `context` is chatsvc's originalMessageContext; it
 * describes the message's one forward.
 */
export function forwardParts(html: string, attachments: readonly FwdAttachment[] = [], context?: unknown): Part[] {
	const fwd = new Map(attachments.filter((a) => a.contentType === FORWARD_ATTACHMENT).map((a) => [String(a.id), a]));
	const out: Part[] = [];
	let start = 0;
	let ctx = context;
	const used = new Set<string>();
	const re = new RegExp(TOKEN.source, "gi");
	for (let m = re.exec(html); m; m = re.exec(html)) {
		let forward: Forward;
		let end: number;
		if (m[1] !== undefined) {
			const att = fwd.get(m[1]);
			if (!att) continue;
			used.add(m[1]);
			forward = fromAttachment(att);
			end = m.index + m[0].length;
		} else {
			const close = closeOf(html, m.index + m[0].length);
			forward = fromContext(ctx, html.slice(m.index + m[0].length, close.inner));
			ctx = undefined;
			end = close.end;
		}
		if (m.index > start) out.push({ html: html.slice(start, m.index) });
		out.push({ forward });
		start = end;
		re.lastIndex = end;
	}
	if (start < html.length) out.push({ html: html.slice(start) });
	// A forward the body never points at is still the message's content: it goes after the text.
	for (const [id, att] of fwd) if (!used.has(id)) out.push({ forward: fromAttachment(att) });
	return out;
}

/** The ids whose names the forwards in `parts` need. */
export function forwardSenderIds(parts: readonly Part[]): string[] {
	return parts.flatMap((p) => ("forward" in p && !p.forward.sender && p.forward.senderId ? [p.forward.senderId] : []));
}

/** "Forwarded from <sender> · <time>", either part left out when unknown. `bold` marks the name up for Markdown. */
export function forwardHeader(f: Forward, names: ReadonlyMap<string, string>, bold = false): string {
	const name = f.sender || names.get(f.senderId) || "";
	const who = name ? `Forwarded from ${bold ? `**${name}**` : name}` : "Forwarded message";
	return f.at ? `${who} · ${formatLocal(f.at)}` : who;
}

export function quote(s: string): string {
	return s
		.split("\n")
		.map((l) => (l ? `> ${l}` : ">"))
		.join("\n");
}

/** Every `<img src>` in the parts, in reading order: the forward's pictures in the place its quote shows them. */
export function partImages(parts: readonly Part[]): string[] {
	return parts.flatMap((p) => [...("forward" in p ? p.forward.html : p.html).matchAll(/<img[^>]+src="([^"]+)"/g)].map((x) => x[1]));
}

/**
 * The flat text with each forward quoted. `cardText` gives the text of an attachment a forward points at (a card);
 * attachments outside the forwards are left to the caller, as before.
 */
export function partsText(parts: readonly Part[], names: ReadonlyMap<string, string>, cardText: (id: string) => string | undefined = () => undefined): string {
	return parts
		.map((p) => {
			if (!("forward" in p)) return htmlToText(p.html);
			const inner = p.forward.html.replace(/<attachment\b[^>]*\bid="([^"]*)"[^>]*>\s*<\/attachment>/gi, (tag, id: string) => {
				const card = cardText(id);
				return card === undefined ? tag : `<p>${escapeHtml(card).replace(/\n/g, "<br>")}</p>`;
			});
			return quote([forwardHeader(p.forward, names), htmlToText(inner)].filter(Boolean).join("\n"));
		})
		.filter(Boolean)
		.join("\n");
}

/** The attachment ids the forwards in `parts` point at: shown inside the quote, so not again after the message. */
export function forwardedAttachmentIds(parts: readonly Part[]): Set<string> {
	const ids = new Set<string>();
	for (const p of parts) {
		if (!("forward" in p)) continue;
		for (const m of p.forward.html.matchAll(/<attachment\b[^>]*\bid="([^"]*)"/gi)) ids.add(m[1]);
	}
	return ids;
}
