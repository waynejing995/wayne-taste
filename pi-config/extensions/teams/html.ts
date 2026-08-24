/**
 * Teams HTML → plain text.
 *
 * A port of fetch_teams.py's html_to_text, kept behaviour-for-behaviour rather
 * than rewritten, because each rule here was a visible bug once:
 *
 *   - <emoji> is an element with no text content. A naive strip drops it and
 *     "👍" becomes an empty message.
 *   - An image-only message strips to "" and then looks exactly like a join
 *     notice, so it was being discarded entirely. It leaves a marker instead.
 *
 * No DOM library: the input is Teams' own generated markup, not arbitrary web
 * HTML, and one regex pass is easier to keep identical to the Python than a
 * second HTML parser's idea of tag soup would be.
 */

const ENTITIES: Record<string, string> = {
	// A real NBSP, not a space: html_to_text keeps it (only the Markdown path
	// folds it), and "a\u00a0\u00a0b" vs "a  b" is a golden mismatch.
	"&nbsp;": "\u00a0",
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&apos;": "'",
};

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => ENTITIES[m])
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
}

/** Value of one attribute on a tag, if present. */
function attr(tag: string, name: string): string {
	const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
	return m ? m[1] : "";
}

export function htmlToText(html: string): string {
	if (!html) return "";
	let s = html;

	// The emoji character lives in the alt attribute, not in the element body.
	s = s.replace(/<emoji\b([^>]*)>\s*<\/emoji>|<emoji\b([^>]*)\/?>/gi, (_m, a = "", b = "") => {
		const tag = a || b;
		return attr(tag, "alt") || attr(tag, "title") || `:${attr(tag, "id") || "emoji"}:`;
	});

	// An image is content. Dropping it makes an image-only message empty, and an
	// empty message is discarded downstream as a system event.
	s = s.replace(/<img\b([^>]*)>/gi, (_m, a) => {
		const alt = attr(a, "alt").trim();
		return alt ? `[${alt}]` : "[image]";
	});

	s = s.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
	s = s.replace(/<(br|p|div|li|tr)\b[^>]*>/gi, "\n");
	s = s.replace(/<\/(p|div|li|tr)>/gi, "\n");
	s = s.replace(/<[^>]+>/g, "");
	s = decodeEntities(s);

	return s
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "")
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
