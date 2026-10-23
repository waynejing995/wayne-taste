/**
 * MIME (.eml) for the mail tools: a Markdown draft in, a message out; a raw
 * message in, the fields the tools and the overlay read.
 *
 * buildEml gives both alternatives the same body: the new Markdown, then an
 * Outlook-style separator and the original. parseEml normalizes postal-mime's
 * output. respondDefaults decides who a reply or forward goes to; the caller
 * may override any field before buildEml sends it.
 */
import MailComposer from "nodemailer/lib/mail-composer";
import PostalMime, { type Address as PostalAddress } from "postal-mime";
import { formatLocal } from "../core/time.ts";
import { htmlToMarkdown } from "./convert.ts";
import { base, esc, mentionsIn, renderMarkdown, THEME } from "./render.ts";

/** One sender or recipient. `name` is absent when the header gave only an address. */
export type Address = { name?: string; address: string };

/** An attachment or an inline image. `contentId` has no angle brackets; `size` is `content.byteLength`. */
export type MailAttachment = {
	filename: string;
	mimeType: string;
	disposition: "attachment" | "inline";
	contentId?: string;
	size: number;
	content: Buffer;
};

/** A message as the tools read it. */
export type ParsedMail = {
	messageId?: string;
	references: string[];
	subject: string;
	from?: Address;
	to: Address[];
	cc: Address[];
	date?: string;
	text?: string;
	html?: string;
	attachments: MailAttachment[];
};

/** A draft the tools and the overlay edit before buildEml. `quote` is the original of a reply or forward. */
export type ComposeDraft = {
	kind: "new" | "reply" | "replyAll" | "forward";
	id?: string;
	to: Address[];
	cc: Address[];
	subject: string;
	quote?: ParsedMail;
	inReplyTo?: string;
	references: string[];
	attachments: MailAttachment[];
};

const PREFIX: Record<"RE" | "FW", RegExp> = { RE: /^\s*re:/i, FW: /^\s*(fw|fwd):/i };

/** `RE: ` or `FW: ` in front of `subject`, unless the subject already carries that prefix. */
export function prefixSubject(kind: "RE" | "FW", subject: string): string {
	return PREFIX[kind].test(subject) ? subject : `${kind}: ${subject}`;
}

/** The line agent-sent mail ends with. Whether a message gets one is the caller's choice. */
export const AGENT_FOOTER = "\n\n---\n\n*sent by omp agent*";

/** Mailboxes from postal-mime's addresses: a group (`Team: a, b;`) becomes its members. */
const mailboxes = (list: PostalAddress[]): Address[] =>
	list
		.flatMap((a) => ("group" in a ? a.group : [a]))
		.map((m) => (m.name ? { name: m.name, address: m.address } : { address: m.address }));

/** "Name <address>" for each address, joined for a header line. */
const listed = (list: Address[]): string => list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join("; ");

/** The inner HTML of a page's <body>, or the whole fragment when there is no <body>. */
const bodyOf = (html: string): string => /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1] ?? html;

/**
 * The header lines Outlook puts above a quoted original: From, Sent (local time), To, Cc, Subject.
 * Cc is left out when the original had none, as Outlook does. Shared by the MIME and the compose overlay.
 */
export function quoteFields(q: ParsedMail): [string, string][] {
	const fields: [string, string][] = [
		["From", listed(q.from ? [q.from] : [])],
		["Sent", formatLocal(q.date ?? "")],
		["To", listed(q.to)],
	];
	if (q.cc.length > 0) fields.push(["Cc", listed(q.cc)]);
	fields.push(["Subject", q.subject]);
	return fields;
}

/**
 * The quoted original as the HTML and text of a reply or forward: an Outlook-style
 * separator (quoteFields), then the original, each line `> ` in text.
 */
function quoteOf(q: ParsedMail): { html: string; text: string } {
	const fields = quoteFields(q);
	const style = base();
	const separator =
		`<hr style="border:0;border-top:1px solid ${THEME.border};margin:12px 0">` +
		`<div style="${style}">${fields.map(([k, v]) => `<b>${k}:</b> ${esc(v)}`).join("<br>")}</div>`;
	const original = q.html ? bodyOf(q.html) : `<div style="white-space:pre-wrap;${style}">${esc(q.text ?? "")}</div>`;
	const body = (q.text || (q.html ? htmlToMarkdown(q.html) : "")).trimEnd();
	const quoted = body ? body.split("\n").map((line) => `> ${line}`).join("\n") : "";
	const rule = `---\n\n${fields.map(([k, v]) => `**${k}:** ${v}`).join("  \n")}`;
	return { html: separator + original, text: [rule, quoted].filter(Boolean).join("\n\n") };
}

/** A raw message as the tools read it: postal-mime's output, normalized. */
export async function parseEml(raw: Buffer): Promise<ParsedMail> {
	const mail = await PostalMime.parse(raw);
	const cited = new Set([...(mail.html ?? "").matchAll(/cid:([^"'\s<>()]+)/gi)].map((m) => m[1].toLowerCase()));
	return {
		messageId: mail.messageId,
		references: mail.references ? mail.references.split(/\s+/).filter(Boolean) : [],
		subject: mail.subject ?? "",
		from: mail.from ? mailboxes([mail.from])[0] : undefined,
		to: mailboxes(mail.to ?? []),
		cc: mailboxes(mail.cc ?? []),
		date: mail.date,
		text: mail.text,
		html: mail.html,
		attachments: mail.attachments.map((a, i): MailAttachment => {
			const contentId = a.contentId?.replace(/^<|>$/g, "");
			// A part the HTML cites by cid is inline whatever its disposition: Exchange labels its inline images
			// "attachment" inside multipart/related. Without a disposition, being in multipart/related is enough too.
			const isCited = contentId !== undefined && cited.has(contentId.toLowerCase());
			const inline = a.disposition === "inline" || isCited || (a.disposition === null && a.related === true);
			const content = Buffer.from(a.content as ArrayBuffer | Uint8Array);
			return {
				filename: a.filename ?? `attachment-${i + 1}`,
				mimeType: a.mimeType,
				disposition: inline ? "inline" : "attachment",
				contentId,
				size: content.byteLength,
				content,
			};
		}),
	};
}

/**
 * Who a reply, reply-all or forward of `orig` goes to, its subject and threading,
 * and the attachments it carries. `self` is the user's own addresses, never
 * recipients. A Reply-To header is not consulted; the caller may edit any field.
 */
export function respondDefaults(kind: "reply" | "replyAll" | "forward", orig: ParsedMail, self: string[]): ComposeDraft {
	// Seeded with the user's own addresses, so self is dropped by the same check that drops a repeat.
	const seen = new Set(self.map((s) => s.toLowerCase()));
	// To is taken before Cc, so an address in both lists stays in To.
	const take = (list: Address[]): Address[] => {
		const out: Address[] = [];
		for (const a of list) {
			const key = a.address.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(a);
		}
		return out;
	};
	const sender = orig.from ? [orig.from] : [];
	const addressed: Address[] = kind === "forward" ? [] : take(kind === "reply" ? sender : [...sender, ...orig.to]);
	// Mail from the user leaves no recipient once self is dropped; a reply then goes back to that sender.
	const to = kind !== "forward" && addressed.length === 0 ? sender : addressed;
	return {
		kind,
		to,
		cc: kind === "replyAll" ? take(orig.cc) : [],
		subject: prefixSubject(kind === "forward" ? "FW" : "RE", orig.subject),
		quote: orig,
		inReplyTo: orig.messageId,
		references: [...orig.references, ...(orig.messageId ? [orig.messageId] : [])],
		attachments: kind === "forward" ? [...orig.attachments] : orig.attachments.filter((a) => a.disposition === "inline"),
	};
}

/** The draft with everyone `markdown` @mentions added to To, unless already in To or Cc: what Outlook does on a mention. */
export function withMentioned(d: ComposeDraft, markdown: string): ComposeDraft {
	const have = new Set([...d.to, ...d.cc].map((a) => a.address.toLowerCase()));
	const added = mentionsIn(markdown).filter((m) => !have.has(m.address.toLowerCase()));
	return added.length === 0 ? d : { ...d, to: [...d.to, ...added] };
}

/**
 * The pictures of a mail as a reader sees them: the images the HTML shows, in the order it cites them,
 * then the image files attached to it.
 */
export function mailImages(mail: ParsedMail): MailAttachment[] {
	const images = mail.attachments.filter((a) => a.mimeType.startsWith("image/"));
	const byCid = new Map(images.filter((a) => a.contentId).map((a) => [a.contentId?.toLowerCase(), a]));
	const shown = new Set<MailAttachment>();
	for (const m of (mail.html ?? "").matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']?cid:([^"'\s>]+)/gi)) {
		const a = byCid.get(m[1].toLowerCase());
		if (a) shown.add(a);
	}
	return [...shown, ...images.filter((a) => !shown.has(a))];
}

/** MailComposer's names for attachments; `cid` makes it build multipart/related for an inline part. */
export function toComposerAttachments(list: MailAttachment[]) {
	return list.map((a) => ({
		filename: a.filename,
		content: a.content,
		contentType: a.mimeType,
		contentDisposition: a.disposition,
		cid: a.contentId,
	}));
}

/** What buildEml takes: the draft, the sender, its Markdown body, and the optional signature and footer. */
export type BuildInput = ComposeDraft & { from: Address; markdown: string; signature?: string; footer?: string };

/**
 * The MIME bytes of a draft. `to`, `cc` and `subject` go out exactly as given, so
 * an edited value wins. `signature` (Markdown) follows the body; `footer` follows the
 * signature; the quoted original comes last, as in Outlook. The footer belongs to the new
 * message, so it never lands under someone else's quoted mail. `footer` is literal text in
 * the text part and Markdown in the HTML part.
 */
export async function buildEml(d: BuildInput): Promise<Buffer> {
	const quote = d.quote ? quoteOf(d.quote) : { html: "", text: "" };
	const signature = d.signature?.trim() ?? "";
	// A signature is laid out by line ("Best,\nAlex"), so each newline is a hard break rather than Markdown's space.
	const signatureHtml = signature ? bodyOf(renderMarkdown(signature.split("\n").join("  \n"))) : "";
	const footerHtml = d.footer ? bodyOf(renderMarkdown(d.footer)) : "";
	const html =
		`<html><head><meta charset="utf-8"></head><body>${bodyOf(renderMarkdown(d.markdown))}` +
		`${signatureHtml}${footerHtml}${quote.html}</body></html>`;
	const text = [[d.markdown, signature].filter(Boolean).join("\n\n") + (d.footer ?? ""), quote.text].filter(Boolean).join("\n\n");
	return new MailComposer({
		from: d.from,
		to: d.to,
		cc: d.cc,
		subject: d.subject,
		text,
		html,
		inReplyTo: d.inReplyTo,
		references: d.references.length > 0 ? d.references : undefined,
		attachments: toComposerAttachments(d.attachments),
	})
		.compile()
		.build();
}
