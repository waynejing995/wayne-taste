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
 *
 * A forward of a card carries no card: Teams stores the original's content as a "Card - access it on
 * go.skype.com/cards.unsupported" stub, and a bot sender comes with no name. Both shapes keep where the original lives
 * (conversation and message id), so the backend reads the original (`Original`) and the forward shows its card and
 * its sender from there.
 */
import { formatLocal } from "../core/time.ts";
import { attachedCardText, isCardType } from "./card.ts";
import { escapeHtml, htmlToText } from "./html.ts";

export const FORWARD_ATTACHMENT = "forwardedMessageReference";

export interface FwdAttachment {
	id?: string | number;
	contentType?: string;
	content?: unknown;
}

export interface Forward {
	/** The sender's name when the forward carries one, else "" and `senderId` is looked up. */
	sender: string;
	/** The sender's directory object id, "" when unknown. */
	senderId: string;
	/** A bot sender's app id, "" for a person: the name is only on the original. */
	appId: string;
	/** The original's time, ISO; "" when unknown. */
	at: string;
	/** The original message's HTML. */
	html: string;
	/** Where the original lives, "" when the forward does not say. */
	conversationId: string;
	messageId: string;
	/** The original's own attachments (its card), read from the original. */
	attachments: FwdAttachment[];
}

/** An original message a forward points at, as the backend read it. */
export interface Original {
	sender: string;
	html: string;
	attachments: FwdAttachment[];
}

const NO_ORIGINALS: ReadonlyMap<string, Original> = new Map();

/** The key of an original in the map forwardParts takes (ForwardContext.originalsFor). */
export const originalKey = (conversationId: string, messageId: string): string => `${conversationId}/${messageId}`;

/**
 * What rendering forwards needs from outside them: people's names by directory id, and the originals by
 * `originalKey` that a message from `forwarder` may show. A forward reference is written by whoever sent the forward,
 * so an original is only ever offered to the forwarder the backend checked it for (see GraphBackend.lookupForwards).
 */
export interface ForwardContext {
	names: ReadonlyMap<string, string>;
	originalsFor(forwarder: string): ReadonlyMap<string, Original>;
}

export const NO_FORWARD_CONTEXT: ForwardContext = { names: new Map(), originalsFor: () => NO_ORIGINALS };

/** An original a forward points at, and who sent the message carrying the forward (a user id; "" when not a person). */
export interface ForwardRef {
	forwarder: string;
	conversationId: string;
	messageId: string;
}

/** What the forwards on a page leave to be read: senders known only by id, and originals. */
export interface ForwardNeed {
	senderIds: string[];
	originals: ForwardRef[];
}

/** Reads what forwards need (the backend supplies it): one call for a page of messages. */
export type ForwardLookup = (need: ForwardNeed) => Promise<ForwardContext>;

export const NO_LOOKUP: ForwardLookup = async () => NO_FORWARD_CONTEXT;

/** What the forwards in a page's messages need read; `forwarder` is who sent each message. */
export function forwardNeed(messages: readonly { parts: readonly Part[]; forwarder: string }[]): ForwardNeed {
	const senderIds: string[] = [];
	const originals: ForwardRef[] = [];
	for (const { parts, forwarder } of messages) {
		for (const p of parts) {
			if (!("forward" in p)) continue;
			const f = p.forward;
			if (!f.sender && f.senderId) senderIds.push(f.senderId);
			if (needsOriginal(f)) originals.push({ forwarder, conversationId: f.conversationId, messageId: f.messageId });
		}
	}
	return { senderIds, originals };
}

export type Part = { html: string } | { forward: Forward };

/** A chatsvc `properties.originalMessageContext`: `originalSender` is `8:orgid:<oid>`, or `28:<app id>` for a bot. */
interface ChatsvcContext {
	originalSender?: unknown;
	originalSentTime?: unknown;
	originalThreadId?: unknown;
	messageId?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

const UNREADABLE: Forward = { sender: "", senderId: "", appId: "", at: "", html: "<p>[unreadable attachment]</p>", conversationId: "", messageId: "", attachments: [] };

/** The stub Teams stores as the content of a forwarded card. */
const CARD_STUB = /go\.skype\.com\/cards\.unsupported/;

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
		appId: str(app.id),
		at: str(d.originalSentDateTime),
		html: str(d.originalMessageContent),
		conversationId: str(d.originalConversationId),
		messageId: str(d.originalMessageId),
		attachments: [],
	};
}

function fromContext(ctx: unknown, html: string): Forward {
	const c: ChatsvcContext = isObject(ctx) ? ctx : {};
	const sender = str(c.originalSender);
	return {
		sender: "",
		senderId: sender.startsWith("8:orgid:") ? sender.slice("8:orgid:".length) : "",
		appId: sender.startsWith("28:") ? sender.slice(3) : "",
		at: str(c.originalSentTime),
		html,
		conversationId: str(c.originalThreadId),
		messageId: str(c.messageId),
		attachments: [],
	};
}

/** Whether a forward shows only what its original holds: a card (the content is a stub) or a bot's name. */
function needsOriginal(f: Forward): boolean {
	return Boolean(f.conversationId && f.messageId) && (CARD_STUB.test(f.html) || !f.html.trim() || (!f.sender && Boolean(f.appId)));
}

/** The forward with what its original gives: the sender's name, and for a card stub the card and its body. */
function withOriginal(f: Forward, originals: ReadonlyMap<string, Original>): Forward {
	const o = needsOriginal(f) ? originals.get(originalKey(f.conversationId, f.messageId)) : undefined;
	if (!o) return f;
	const stub = CARD_STUB.test(f.html) || !f.html.trim();
	return { ...f, sender: f.sender || o.sender, ...(stub ? { html: o.html, attachments: o.attachments } : {}) };
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
 * describes the message's one forward. `originals` fills in what a forward leaves out (see withOriginal).
 */
export function forwardParts(html: string, attachments: readonly FwdAttachment[] = [], context?: unknown, originals: ReadonlyMap<string, Original> = NO_ORIGINALS): Part[] {
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
		out.push({ forward: withOriginal(forward, originals) });
		start = end;
		re.lastIndex = end;
	}
	if (start < html.length) out.push({ html: html.slice(start) });
	// A forward the body never points at is still the message's content: it goes after the text.
	for (const [id, att] of fwd) if (!used.has(id)) out.push({ forward: withOriginal(fromAttachment(att), originals) });
	return out;
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
 * the original's own attachments are looked in first. Attachments outside the forwards are left to the caller.
 */
export function partsText(parts: readonly Part[], names: ReadonlyMap<string, string>, cardText: (id: string) => string | undefined = () => undefined): string {
	return parts
		.map((p) => {
			if (!("forward" in p)) return htmlToText(p.html);
			const own = (id: string) => {
				const a = p.forward.attachments.find((x) => String(x.id) === id && isCardType(x.contentType));
				return a ? attachedCardText(a.content, String(a.contentType)) : cardText(id);
			};
			const inner = p.forward.html.replace(/<attachment\b[^>]*\bid="([^"]*)"[^>]*>\s*<\/attachment>/gi, (tag, id: string) => {
				const card = own(id);
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
