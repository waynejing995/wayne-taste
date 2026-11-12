/**
 * `@[Display Name](name@domain)`: a mention in the Markdown an agent sends.
 *
 * The target must be a bare email address, so `[text](url)` stays a link. The
 * Outlook extension parses the same syntax; keep the two in step.
 *
 * Two steps, because a backend only ever sees HTML:
 *
 *   1. renderWithMentions() renders the Markdown with a mention extension, so
 *      a mention is whatever the Markdown parser reads as one: an example in a
 *      code span, a fenced or indented code block, or an escaped `\@[…](…)` is
 *      text and notifies nobody. Each real mention renders as a token.
 *   2. The backend looks each address up in the directory, then fillMentions()
 *      writes that backend's markup over every token. The formats differ (Graph's
 *      <at> and chatsvc's Mention span), so that part lives with each backend.
 */
import { Marked } from "marked";
import { mentionExtension, type MentionToken } from "../core/mention.ts";

export interface Mention {
	/** Shown in the message. Trimmed. */
	name: string;
	/** The address the directory is asked about, as written. */
	email: string;
}

/** A mention whose address the directory has answered for. */
export type ResolvedMention = Mention & { oid: string };

const token = (i: number): string => `ZZTEAMSMENTIONZZ${i}ZZ`;
const TOKEN_RE = /ZZTEAMSMENTIONZZ(\d+)ZZ/g;

/** The token the renderer writes for mention `index`, numbered in walk order. */
type Numbered = MentionToken & { index: number };

/**
 * The Markdown as Teams HTML (the options mdToHtml uses: gfm, and breaks because a
 * chat message is not a document), each real mention a token, and the mentions in order.
 */
export function renderWithMentions(markdown: string): { html: string; mentions: Mention[] } {
	const mentions: Mention[] = [];
	const md = new Marked({ gfm: true, breaks: true, async: false });
	md.use({ extensions: [mentionExtension((t) => token((t as Numbered).index))] });
	const tokens = md.lexer(markdown);
	md.walkTokens(tokens, (t) => {
		if (t.type !== "mention") return;
		const m = t as Numbered;
		m.index = mentions.length;
		mentions.push({ name: m.name, email: m.address });
	});
	return { html: md.parser(tokens), mentions };
}

/**
 * Writes each token's markup. Refuses when tokens and mentions disagree: a
 * token that went missing would leave a mention the text never shows, and a
 * stray one would post a mention nobody wrote.
 */
export function fillMentions<T extends Mention>(
	html: string,
	mentions: readonly T[],
	render: (m: T, index: number) => string,
): string {
	if (mentions.length === 0) return html;
	const found = html.match(TOKEN_RE)?.length ?? 0;
	if (found !== mentions.length)
		throw new Error(`mentions do not line up: ${found} in the message, ${mentions.length} to send`);
	return html.replace(TOKEN_RE, (_t: string, digits: string) => {
		const i = Number(digits);
		const m = mentions[i];
		if (m === undefined) throw new Error(`mention ${i} in the message has no address`);
		return render(m, i);
	});
}

/**
 * The local pictures a Markdown message shows, cut out of it: `![alt](/path/shot.png)` is a file to send inline, not
 * a link Teams could follow. Web (`http:`, `https:`) and `data:` images stay as written, and so does anything the
 * Markdown parser reads as code. Paths are returned in order, as written; the send reads and checks the files.
 */
export function localImages(markdown: string): { markdown: string; paths: string[] } {
	const md = new Marked({ gfm: true, breaks: true, async: false });
	const cuts: { at: number; raw: string; href: string }[] = [];
	// Walked in document order. A code token moves the cursor past itself, so an image written inside code is never
	// matched by a later search; an image whose raw text is not found (quoted, its ">" stripped) is left as it is.
	let cursor = 0;
	md.walkTokens(md.lexer(markdown), (t) => {
		if (t.type !== "image" && t.type !== "code" && t.type !== "codespan") return;
		const at = markdown.indexOf(t.raw, cursor);
		if (at < 0) return;
		cursor = at + t.raw.length;
		const href = t.type === "image" ? (t as { href: string }).href : "";
		if (href && !/^(https?|data):/i.test(href)) cuts.push({ at, raw: t.raw, href });
	});
	let out = markdown;
	for (const c of cuts.toReversed()) out = out.slice(0, c.at) + out.slice(c.at + c.raw.length);
	return { markdown: out, paths: cuts.map((c) => c.href) };
}

