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
