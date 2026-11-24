/**
 * `@[Display Name](name@domain)`: a mention in the Markdown an agent sends.
 * `@[Display Name](app:<app id>)` mentions a Teams app (a bot).
 *
 * The target must be a bare email address or `app:` and a GUID, so `[text](url)` stays a link.
 * The syntax lives in core/mention.ts, shared with Outlook.
 *
 * Two steps, because a backend only ever sees HTML:
 *
 *   1. renderWithMentions() renders the Markdown with a mention extension, so
 *      a mention is whatever the Markdown parser reads as one: an example in a
 *      code span, a fenced or indented code block, or an escaped `\@[…](…)` is
 *      text and notifies nobody. Each real mention renders as a token.
 *   2. The backend looks each person's address up in the directory (an app needs no lookup: it is named by its id),
 *      then fillMentions() writes that backend's markup over every token. The formats differ (Graph's
 *      <at> and chatsvc's Mention span), so that part lives with each backend.
 */
import { Marked } from "marked";
import { mentionExtension, type MentionToken } from "../core/mention.ts";

/** A person by the address the directory is asked about, as written; or a Teams app by its id. `name` is shown, trimmed. */
export type Mention = { name: string; email: string } | { name: string; app: string };

/** A person's mention with the directory id behind the address. */
export type ResolvedPerson = { name: string; email: string; oid: string };

/** A mention ready to post: a person the directory has answered for, or an app as written. */
export type ResolvedMention = ResolvedPerson | { name: string; app: string };

/** The mention a parsed token names. */
export function mentionOf(t: MentionToken): Mention {
	return t.app !== undefined ? { name: t.name, app: t.app } : { name: t.name, email: t.address };
}

/** The mention written back in the syntax it was read from. */
export function mentionSyntax(m: Mention): string {
	return `@[${m.name}](${"app" in m ? `app:${m.app}` : m.email})`;
}

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
		mentions.push(mentionOf(m));
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


