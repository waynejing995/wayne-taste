/**
 * The @mention syntax both Teams and Outlook take: `@[Display Name](name@domain)` for a person, and
 * `@[Display Name](app:<app id>)` for a Teams app (a bot), which has no address.
 *
 * One definition, used as a Markdown (marked) extension, so a mention is exactly what
 * the Markdown parser reads as one: an example in a code span, a fenced or indented
 * code block, or an escaped `\@[…](…)` is text and names nobody. The target must be a
 * bare address (a `mailto:` prefix is accepted) or `app:` and a GUID, so `[text](url)` stays a link.
 */
import type { TokenizerAndRendererExtension, Tokens } from "marked";

/**
 * At the start of the source: $1 the name (trimmed by the pattern itself), then $2 the address, or $3 everything up
 * to `)` after `app:` (checked below, so a mistyped app id is refused rather than sent as a link or text).
 */
const MENTION =
	/^@\[\s*([^\]\n]*[^\]\s])\s*\]\(\s*(?:(?:mailto:)?([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\s*|[Aa][Pp][Pp]:([^)]*))\)/;
const GUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** A mention token as the parser produced it: a person by address, or an app by its id. */
export type MentionToken = Tokens.Generic & { type: "mention"; name: string } & ({ address: string; app?: undefined } | { app: string; address?: undefined });

/** The marked extension for the syntax; `render` draws a mention the way the channel needs. */
export function mentionExtension(render: (t: MentionToken) => string): TokenizerAndRendererExtension {
	return {
		name: "mention",
		level: "inline",
		start: (src: string) => src.indexOf("@["),
		tokenizer(src: string) {
			const m = MENTION.exec(src);
			if (!m) return;
			if (m[2] !== undefined) return { type: "mention", raw: m[0], name: m[1], address: m[2] };
			const app = m[3].trim();
			if (!GUID.test(app)) throw new Error(`${m[0]}: an app mention needs the app id, a GUID, after app:`);
			return { type: "mention", raw: m[0], name: m[1], app };
		},
		renderer: (t) => render(t as MentionToken),
	};
}
