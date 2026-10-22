/**
 * Markdown -> Outlook-styled HTML for mail bodies.
 *
 * Colour is semantic only. The writer names a meaning -- a [text]{.ok} tone span
 * or a [!KIND] callout -- and this module maps it to the fixed palette below.
 * Raw HTML in the Markdown is shown as text, so the writer cannot inject a colour,
 * a class or a <style> element. Every style string is built from the constants
 * here, none of which contains a double quote.
 */
import { randomUUID } from "node:crypto";
import { Marked } from "marked";
import type { Tokens } from "marked";
import { mentionExtension, type MentionToken } from "../core/mention.ts";

const PANEL = "rgb(246,248,250)";

/** The report theme. */
export const THEME = {
	font: "'Segoe UI',Calibri,Arial,sans-serif",
	size: "14px",
	text: "rgb(31,35,40)",
	link: "rgb(11,92,173)",
	code: { font: "Consolas,monospace", size: "13px", bg: PANEL },
	border: "rgb(208,215,222)",
	shade: PANEL,
} as const;

type Tone = "ok" | "bad" | "warn" | "muted" | "info";

/** Fixed semantic palette (GitHub Primer). Markdown names a meaning, never a hex value. */
export const TONES: Record<Tone, string> = {
	ok: "color:rgb(26,127,55);font-weight:bold",
	bad: "color:rgb(207,34,46);font-weight:bold",
	warn: "color:rgb(154,103,0);font-weight:bold",
	muted: "color:rgb(87,96,106)",
	info: "color:rgb(9,105,218);font-weight:bold",
};

/** Callout kinds, written as [!KIND] at the top of a quote. */
export const CALLOUTS: Record<string, { edge: string; bg: string }> = {
	SUMMARY: { edge: THEME.border, bg: PANEL },
	NOTE: { edge: "rgb(9,105,218)", bg: "rgb(221,244,255)" },
	TIP: { edge: "rgb(26,127,55)", bg: "rgb(218,251,225)" },
	WARNING: { edge: "rgb(154,103,0)", bg: "rgb(255,248,197)" },
	CAUTION: { edge: "rgb(207,34,46)", bg: "rgb(255,235,233)" },
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Prose style: the report font at the given size. */
export const base = (size: string = THEME.size) => `font-family:${THEME.font};font-size:${size};color:${THEME.text}`;
const CODE = `font-family:${THEME.code.font};font-size:${THEME.code.size}`;
const CELL = `border:1px solid ${THEME.border};padding:6px 10px;vertical-align:top;${base()}`;
const ROW = "vertical-align:top";

type Quote = Tokens.Blockquote & { callout?: string };

/**
 * An @mention (core/mention.ts). Outlook recognizes a mention by an anchor whose id is
 * OWAAM, 32 hex digits and Z, pointing at mailto:the address; a new id per mention is fine.
 */
const outlookMention = mentionExtension((t) => {
	const id = `OWAAM${randomUUID().replace(/-/g, "").toUpperCase()}Z`;
	return `<a id="${id}" href="mailto:${esc(t.address)}" style="color:${THEME.link};text-decoration:none">@${esc(t.name)}</a>`;
});

/**
 * Everyone `md` @mentions, once each, in order of first mention. Outlook adds them to To; so do the callers.
 * Read from the same tokens the renderer draws, so an example in code or an escaped `\@[…](…)` names nobody.
 */
export function mentionsIn(md: string): { name: string; address: string }[] {
	const seen = new Map<string, { name: string; address: string }>();
	markdown.walkTokens(markdown.lexer(md), (t) => {
		if (t.type !== "mention") return;
		const { name, address } = t as MentionToken;
		if (!seen.has(address.toLowerCase())) seen.set(address.toLowerCase(), { name, address });
	});
	return [...seen.values()];
}

const markdown = new Marked({ gfm: true });
markdown.use({
	extensions: [
		{
			// Pandoc bracketed span: [text]{.ok}. An unknown tone such as {.pink} is not matched and stays literal.
			name: "tone",
			level: "inline",
			start: (src: string) => src.indexOf("["),
			tokenizer(src: string) {
				const m = /^\[([^\]\n]+)\]\{\.(ok|bad|warn|muted|info)\}/.exec(src);
				if (m) return { type: "tone", raw: m[0], tone: m[2], tokens: this.lexer.inlineTokens(m[1]) };
			},
			renderer(t) {
				return `<span style="${TONES[t.tone as Tone]}">${this.parser.parseInline(t.tokens)}</span>`;
			},
		},
		outlookMention,
	],
	walkTokens(token) {
		if (token.type !== "blockquote") return;
		const quote = token as Quote;
		const para = quote.tokens[0];
		if (para?.type !== "paragraph") return;
		// Upper case only, and only a known kind: [!note] or [!UNKNOWN] stays a plain quote.
		const marker = /^\[!([A-Z]+)\]/.exec(para.text);
		if (!marker || !Object.hasOwn(CALLOUTS, marker[1])) return;
		quote.callout = marker[1];
		const first = para.tokens[0];
		if (first?.type === "text") {
			first.text = first.text.replace(/^\[![A-Z]+\][ \t]*\n?/, "");
			if (first.text === "") {
				para.tokens.shift();
				if (para.tokens[0]?.type === "br") para.tokens.shift();
			}
		}
		if (para.tokens.length === 0) quote.tokens.shift();
	},
	renderer: {
		heading({ tokens, depth }) {
			const size = depth <= 2 ? "16px" : "15px";
			return `<p style="${base(size)};margin:16px 0 6px 0"><b style="font-weight:bold">${this.parser.parseInline(tokens)}</b></p>\n`;
		},
		paragraph({ tokens }) {
			return `<p style="${base()};margin:0 0 10px 0">${this.parser.parseInline(tokens)}</p>\n`;
		},
		list(token) {
			const tag = token.ordered ? "ol" : "ul";
			const start = token.ordered && token.start !== 1 ? ` start="${token.start}"` : "";
			return `<${tag}${start} style="${base()};margin:0 0 10px 0;padding-left:24px">${token.items.map((item) => this.listitem(item)).join("")}</${tag}>\n`;
		},
		listitem(item) {
			const box = item.task ? `${this.checkbox({ checked: !!item.checked })} ` : "";
			// A tight item holds inline text; wrapping it in <p> would add a gap per line.
			return `<li style="${base()};margin:0 0 4px 0">${box}${this.parser.parse(item.tokens, !!item.loose)}</li>\n`;
		},
		codespan({ text }) {
			return `<code style="${CODE};background-color:${THEME.code.bg};padding:1px 4px">${esc(text)}</code>`;
		},
		code({ text }) {
			return `<pre style="${CODE};background-color:${THEME.code.bg};color:${THEME.text};margin:0 0 10px 0;padding:10px 12px;white-space:pre-wrap">${esc(text.replace(/\n$/, ""))}</pre>\n`;
		},
		link({ href, tokens }) {
			return `<a href="${esc(href)}" style="color:${THEME.link}">${this.parser.parseInline(tokens)}</a>`;
		},
		blockquote(token: Quote) {
			const body = this.parser.parse(token.tokens);
			if (token.callout) {
				const { edge, bg } = CALLOUTS[token.callout];
				return `<table style="width:100%;border-collapse:collapse;margin:0 0 10px 0"><tbody style="${ROW}"><tr style="${ROW}"><td style="border-left:4px solid ${edge};background-color:${bg};padding:10px 14px;${base()}">${body}</td></tr></tbody></table>\n`;
			}
			return `<blockquote style="margin:0 0 10px 0;padding:0 0 0 12px;border-left:3px solid ${THEME.border}">${body}</blockquote>\n`;
		},
		table(token) {
			// Headerless two-column table: a key/value sheet, so no header row and the keys are shaded.
			const kv = token.header.length === 2 && token.header.every((c) => !c.text.trim());
			const cellOf = (c: Tokens.TableCell, align: string | null, tag: "th" | "td", extra: string) => {
				const style = [CELL, extra, align ? `text-align:${align}` : ""].filter(Boolean).join(";");
				return `<${tag} style="${style}">${this.parser.parseInline(c.tokens)}</${tag}>`;
			};
			const head = kv
				? ""
				: `<thead style="${ROW}"><tr style="${ROW}">${token.header.map((c, i) => cellOf(c, token.align[i], "th", `background-color:${THEME.shade};font-weight:bold`)).join("")}</tr></thead>`;
			const rows = token.rows
				.map((row) => `<tr style="${ROW}">${row.map((c, i) => (kv && i === 0 ? cellOf(c, null, "td", `background-color:${THEME.shade};font-weight:bold;white-space:nowrap`) : cellOf(c, token.align[i], "td", ""))).join("")}</tr>`)
				.join("");
			return `<table style="border-collapse:collapse;margin:0 0 10px 0">${head}<tbody style="${ROW}">${rows}</tbody></table>\n`;
		},
		hr() {
			return `<hr style="border:0;border-top:1px solid ${THEME.border};margin:12px 0">\n`;
		},
		html({ text, block }) {
			// Raw HTML in the Markdown is shown as text, never parsed into elements.
			return block ? `<p style="${base()};margin:0 0 10px 0">${esc(text.trimEnd())}</p>\n` : esc(text);
		},
	},
});

export function renderMarkdown(md: string): string {
	return `<html><head><meta charset="utf-8"></head><body>${markdown.parse(md) as string}</body></html>`;
}
