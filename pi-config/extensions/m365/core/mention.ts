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

/** At the start of the source: $1 the name (trimmed by the pattern itself), $2 the address. */
const PERSON =
	/^@\[\s*([^\]\n]*[^\]\s])\s*\]\(\s*(?:mailto:)?([A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\s*\)/;
/** The same opening for an app: $1 the name; the target after `app:` is read by appTarget(). */
const APP_OPEN = /^@\[\s*([^\]\n]*[^\]\s])\s*\]\(\s*[Aa][Pp][Pp]:/;
const GUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/**
 * The target after `app:` at `from`, up to its `)`: the id and where the mention ends, or undefined when no `)` closes
 * it (then it is text, not a mention). The id is read from the line `app:` is on; only whitespace, a line break
 * included, may stand between it and `)`, so the id never runs into the prose after it. It reads no further than that.
 */
function appTarget(src: string, from: number): { id: string; end: number } | undefined {
	let i = from;
	while (i < src.length && src[i] !== ")" && src[i] !== "\n") i++;
	if (src[i] === ")") return { id: src.slice(from, i).trim(), end: i + 1 };
	let j = i;
	while (j < src.length && /\s/.test(src[j])) j++;
	return src[j] === ")" ? { id: src.slice(from, i).trim(), end: j + 1 } : undefined;
}

/** A mention token as the parser produced it: a person by address, or an app by its id. */
export type MentionToken = Tokens.Generic & { type: "mention"; name: string } & ({ address: string; app?: undefined } | { app: string; address?: undefined });

/** The marked extension for the syntax; `render` draws a mention the way the channel needs. */
export function mentionExtension(render: (t: MentionToken) => string): TokenizerAndRendererExtension {
	return {
		name: "mention",
		level: "inline",
		start: (src: string) => src.indexOf("@["),
		tokenizer(src: string) {
			const p = PERSON.exec(src);
			if (p) return { type: "mention", raw: p[0], name: p[1], address: p[2] };
			const a = APP_OPEN.exec(src);
			const target = a && appTarget(src, a[0].length);
			if (!a || !target) return;
			const raw = src.slice(0, target.end);
			// A mistyped app id is refused rather than sent as a link or text.
			if (!GUID.test(target.id)) throw new Error(`${raw}: an app mention needs the app id, a GUID, after app:`);
			return { type: "mention", raw, name: a[1], app: target.id };
		},
		renderer: (t) => render(t as MentionToken),
	};
}
