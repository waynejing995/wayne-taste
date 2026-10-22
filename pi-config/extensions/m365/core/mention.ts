/**
 * The @mention syntax both Teams and Outlook take: `@[Display Name](name@domain)`.
 *
 * One definition, used as a Markdown (marked) extension, so a mention is exactly what
 * the Markdown parser reads as one: an example in a code span, a fenced or indented
 * code block, or an escaped `\@[…](…)` is text and names nobody. The target must be a
 * bare address (a `mailto:` prefix is accepted), so `[text](url)` stays a link.
 */
import type { TokenizerAndRendererExtension, Tokens } from "marked";

/** At the start of the source: $1 the name (trimmed by the pattern itself), $2 the address. */
const MENTION =
	/^@\[\s*([^\]\n]*[^\]\s])\s*\]\(\s*(?:mailto:)?([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\s*\)/;

/** A mention token as the parser produced it. */
export type MentionToken = Tokens.Generic & { type: "mention"; name: string; address: string };

/** The marked extension for the syntax; `render` draws a mention the way the channel needs. */
export function mentionExtension(render: (t: MentionToken) => string): TokenizerAndRendererExtension {
	return {
		name: "mention",
		level: "inline",
		start: (src: string) => src.indexOf("@["),
		tokenizer(src: string) {
			const m = MENTION.exec(src);
			if (m) return { type: "mention", raw: m[0], name: m[1], address: m[2] };
		},
		renderer: (t) => render(t as MentionToken),
	};
}
