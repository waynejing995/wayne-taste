/**
 * Mail HTML -> Markdown: the reading direction of render.ts.
 *
 * A palette colour comes back as its {.tone} span and a callout table as its
 * > [!KIND] quote, so what the reader gets is Markdown the writer accepts.
 * Outlook's layout tables are unwrapped and the sensitivity banner is dropped;
 * everything else is Turndown's own reading.
 */
import TurndownService from "turndown";
import { CALLOUTS, TONES } from "./render.ts";

/** The slice of a DOM node these rules read. Turndown hands its rules untyped nodes. */
interface El {
	nodeName: string;
	nodeType: number;
	textContent: string | null;
	innerHTML?: string;
	parentNode: El | null;
	previousSibling: El | null;
	childNodes: ArrayLike<El>;
	getAttribute(name: string): string | null;
	querySelector(selector: string): El | null;
}

/** Outlook's sensitivity label. Dropped only where it leads the message. */
const BANNER = "AMD General";

/** An rgb(), rgba() or hex colour. */
const COLOR = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)|#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i;

/** A font face that marks a paragraph as code. */
const CONSOLAS = /font-family\s*:[^;]*consolas/i;

/** NBSP is how Outlook spaces code and cells; it must read back as a plain space. */
const plain = (text: string | null) => (text ?? "").replace(/\u00a0/g, " ");

/** A block of Markdown, set off from its neighbours by a blank line either side. */
const block = (text: string) => `\n\n${text}\n\n`;

/** The first colour in a CSS value, as rgb(r,g,b) with no spaces, so the spellings compare equal. */
function colorOf(value: string | null | undefined): string | null {
	const m = COLOR.exec(value ?? "");
	if (!m) return null;
	if (m[1] !== undefined) return `rgb(${Number(m[1])},${Number(m[2])},${Number(m[3])})`;
	const hex = m[4].length === 3 ? [...m[4]].map((c) => c + c).join("") : m[4];
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return `rgb(${r},${g},${b})`;
}

/** The value of one property in an inline style, or null. */
function declared(style: string | null, prop: string): string | null {
	const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(style ?? "");
	return m ? m[1] : null;
}

/** The tone a node's own colour names: its style colour, or a font colour attribute. */
function toneOf(node: El): string | undefined {
	const color = colorOf(declared(node.getAttribute("style"), "color") ?? node.getAttribute("color"));
	if (color === null) return undefined;
	return Object.entries(TONES).find(([, style]) => colorOf(style) === color)?.[0];
}

/** Block markers at a line's start: indentation, quote, list and heading markers. They stay outside the brackets. */
const BLOCK_MARKERS = /^(?:\s*(?:>|-|\d+\.|#{1,6})(?=\s|$))*\s*/;

/** A line as its block markers, its text, and the spaces that trail the text. */
function splitLine(line: string): [string, string, string] {
	const lead = BLOCK_MARKERS.exec(line)?.[0] ?? "";
	const body = line.slice(lead.length);
	const core = body.trimEnd();
	return [lead, core, body.slice(core.length)];
}

/** One line as [text]{.tone}, with its block markers and edge spaces outside the brackets. */
function wrapLine(line: string, tone: string): string {
	const [lead, core, trail] = splitLine(line);
	return core === "" ? line : `${lead}[${core}]{.${tone}}${trail}`;
}

/**
 * A toned span or block, one line at a time: the writer reads a tone within one line.
 * Blank lines, table rows, callout headers and code stay as written.
 */
function wrapTone(text: string, tone: string): string {
	if (!text.includes("\n")) return wrapLine(text, tone);
	let fence: { ticks: number; container: string } | null = null; // the code block still open, if any
	return text
		.split("\n")
		.map((line) => {
			if (fence) {
				// Code keeps its markers: only the block's own container prefix and a fence at least as long as the opener close it.
				const rest = line.startsWith(fence.container) ? line.slice(fence.container.length) : "";
				const run = /^ {0,3}(`+)\s*$/.exec(rest);
				if (run && run[1].length >= fence.ticks) fence = null;
				return line;
			}
			const [lead, core] = splitLine(line);
			const opening = /^(`{3,})[^`]*$/.exec(core);
			if (opening) {
				// Later lines of a list item indent four spaces where its marker was; a quote keeps its marker.
				fence = { ticks: opening[1].length, container: lead.replace(/(?:-|\d+\.)\s*/g, "    ") };
				return line;
			}
			return /^(\|.*\||\[![A-Z]+\])$/.test(core) ? line : wrapLine(line, tone);
		})
		.join("\n");
}

/** The callout a one-cell table is: its left edge and its background, matched against CALLOUTS. */
function calloutOf(cell: El): string | undefined {
	const style = cell.getAttribute("style");
	const edge = colorOf(declared(style, "border-left"));
	const background = colorOf(declared(style, "background-color") ?? declared(style, "background"));
	return Object.keys(CALLOUTS).find(
		(kind) => colorOf(CALLOUTS[kind].edge) === edge && colorOf(CALLOUTS[kind].bg) === background,
	);
}

/** Shaded: a background in the inline style, or a bgcolor attribute. */
function isShaded(cell: El): boolean {
	const style = cell.getAttribute("style");
	const background = declared(style, "background") ?? declared(style, "background-color");
	return background !== null || cell.getAttribute("bgcolor") !== null;
}

/** The element children of a node, in order. */
function elements(node: El): El[] {
	return Array.from(node.childNodes).filter((child) => child.nodeType === 1);
}

/** A node's text with each <br> as a newline: textContent drops the line breaks that mail writes inside code. */
function textWithBreaks(node: El): string {
	return Array.from(node.childNodes)
		.map((child) => {
			if (child.nodeName === "BR") return "\n";
			if (child.nodeType === 1) return textWithBreaks(child);
			return child.nodeType === 3 ? (child.textContent ?? "") : "";
		})
		.join("");
}

/** A table's rows, each its cells. Rows in thead, tbody and tfoot count; nested tables are not entered. */
function rowsOf(table: El): El[][] {
	const rows: El[][] = [];
	const walk = (node: El) => {
		for (const child of elements(node)) {
			if (child.nodeName === "TR") {
				rows.push(elements(child).filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH"));
			} else if (["THEAD", "TBODY", "TFOOT"].includes(child.nodeName)) {
				walk(child);
			}
		}
	};
	walk(table);
	return rows;
}

/** Whether text comes before node in document order: an earlier sibling's, or an ancestor's. */
function textBefore(node: El): boolean {
	for (let n: El | null = node; n?.parentNode; n = n.parentNode) {
		for (let s = n.previousSibling; s; s = s.previousSibling) {
			if ((s.textContent ?? "").trim() !== "") return true;
		}
	}
	return false;
}

/** A paragraph or div set in Consolas: one line of code, as Outlook writes it. */
function isCodeLine(node: El): boolean {
	return (node.nodeName === "P" || node.nodeName === "DIV") && CONSOLAS.test(node.getAttribute("style") ?? "");
}

/** The run of code lines that node belongs to, in document order. */
function codeRun(node: El): El[] {
	const siblings = elements(node.parentNode as El);
	let lo = siblings.indexOf(node);
	let hi = lo;
	while (lo > 0 && isCodeLine(siblings[lo - 1])) lo--;
	while (hi < siblings.length - 1 && isCodeLine(siblings[hi + 1])) hi++;
	return siblings.slice(lo, hi + 1);
}

/** A cell as one pipe-table segment: its Markdown on one line, its tone applied, its pipes escaped. */
function cellText(td: TurndownService, cell: El | undefined): string {
	if (!cell) return "";
	const text = plain(td.turndown(cell.innerHTML ?? "")).replace(/\s*\n\s*/g, " ").trim();
	const tone = toneOf(cell);
	return (tone ? wrapTone(text, tone) : text).replace(/\|/g, "\\|");
}

/** A fenced code block, its fence longer than any backtick run at a line start that could close it early. */
function fence(code: string, lang: string): string {
	const longest = Math.max(0, ...[...code.matchAll(/^ {0,3}(`+)/gm)].map((run) => run[1].length));
	const ticks = "`".repeat(Math.max(3, longest + 1));
	return `${ticks}${lang}\n${code}\n${ticks}`;
}

/** The file name an image's src names. Inline (data:) and content-id (cid:) images name nothing. */
function fileName(src: string | null): string {
	if (!src || /^(data|cid):/i.test(src)) return "";
	return src.split(/[?#]/)[0].split("/").pop() ?? "";
}

/**
 * A table as the Markdown the writer reads back: a callout's quote, a layout's content,
 * a key/value sheet, or a GFM table whose first row is the header.
 */
function tableBlock(td: TurndownService, table: El, content: string): string {
	const rows = rowsOf(table);
	const only = rows.length === 1 && rows[0].length === 1 ? rows[0][0] : undefined;
	const callout = only ? calloutOf(only) : undefined;
	if (only && callout) {
		const lines = [`[!${callout}]`, ...td.turndown(only.innerHTML ?? "").split("\n")];
		return block(lines.map((line) => (line ? `> ${line}` : ">")).join("\n"));
	}
	if (rows.length === 0 || only || table.getAttribute("role") === "presentation") return block(content);
	const width = Math.max(...rows.map((row) => row.length));
	const line = (row: El[]) => `| ${Array.from({ length: width }, (_, i) => cellText(td, row[i])).join(" | ")} |`;
	const keyValue = rows.every((row) => row.length === 2 && row.every((c) => c.nodeName === "TD") && isShaded(row[0]));
	if (keyValue) return block(["|  |  |", "|---|---|", ...rows.map(line)].join("\n"));
	return block([line(rows[0]), `|${"---|".repeat(width)}`, ...rows.slice(1).map(line)].join("\n"));
}

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

td.addRule("table", {
	filter: "table",
	replacement: (content: string, node: unknown) => tableBlock(td, node as El, content),
});

td.addRule("tone", {
	filter: (node: unknown) => ["SPAN", "FONT", "TD"].includes((node as El).nodeName) && toneOf(node as El) !== undefined,
	replacement: (content: string, node: unknown) => {
		const tone = toneOf(node as El);
		return tone ? wrapTone(content, tone) : content;
	},
});

/** cid (lowercased) → the label its image reads as, for the htmlToMarkdown call in progress. turndown runs synchronously. */
let cidLabels: Map<string, string> = new Map();

td.addRule("image", {
	filter: "img",
	replacement: (_content: string, node: unknown) => {
		const img = node as El;
		const src = img.getAttribute("src");
		const cid = /^cid:(.+)$/i.exec(src ?? "")?.[1].toLowerCase();
		const label = cid === undefined ? undefined : cidLabels.get(cid);
		if (label) return `[${label}]`;
		const alt = (img.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim();
		const name = fileName(src);
		if (alt) return `[image: ${alt}]`;
		return name ? `[image: ${name}]` : "[image]";
	},
});

// An Outlook @mention (an anchor whose id starts OWAAM) reads back in the syntax the tools write it in.
td.addRule("mention", {
	filter: (node: unknown) => {
		const a = node as El;
		return a.nodeName === "A" && /^OWAAM/i.test(a.getAttribute("id") ?? "") && /^mailto:/i.test(a.getAttribute("href") ?? "");
	},
	replacement: (content: string, node: unknown) => {
		const address = ((node as El).getAttribute("href") ?? "").replace(/^mailto:/i, "");
		return `@[${content.replace(/^@/, "").trim()}](${address})`;
	},
});

td.addRule("pre", {
	filter: "pre",
	replacement: (_content: string, node: unknown) => {
		const pre = node as El;
		const lang = /language-(\S+)/.exec(pre.querySelector("code")?.getAttribute("class") ?? "")?.[1] ?? "";
		return block(fence(plain(textWithBreaks(pre)).replace(/\n$/, ""), lang));
	},
});

// A run of Consolas paragraphs is one code block: the first line with text owns it, the rest say nothing.
// A <br> starts a new line within a paragraph; a trailing one ends its line and adds none.
td.addRule("codeLines", {
	filter: (node: unknown) => isCodeLine(node as El),
	replacement: (_content: string, node: unknown) => {
		const self = node as El;
		const run = codeRun(self);
		const owner = run.findIndex((line) => plain(line.textContent).trim() !== "");
		if (run[owner] !== self) return "";
		const lines = run.slice(owner).map((line) => plain(textWithBreaks(line)).replace(/\n$/, ""));
		while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
		return block(fence(lines.join("\n"), ""));
	},
});

td.addRule("banner", {
	filter: (node: unknown) => {
		const div = node as El;
		return div.nodeName === "DIV" && (div.textContent ?? "").replace(/\s+/g, " ").trim() === BANNER && !textBefore(div);
	},
	replacement: () => "",
});

/**
 * Mail HTML as Markdown. Head, style, Word's conditional blocks and o:p markers never show, so they go first.
 * `images` maps a cid (any case) to the label its <img> reads as, e.g. "image 1: chart.png".
 */
export function htmlToMarkdown(html: string, images: Map<string, string> = new Map()): string {
	const body = html
		.replace(/<head\b[\s\S]*?<\/head>/gi, "")
		.replace(/<style\b[\s\S]*?<\/style>/gi, "")
		.replace(/<!--\[if\b[\s\S]*?<!\[endif\]-->/gi, "")
		.replace(/<\/?o:p\b[^>]*>/gi, "");
	cidLabels = new Map([...images].map(([cid, label]) => [cid.toLowerCase(), label]));
	try {
		return td.turndown(body);
	} finally {
		cidLabels = new Map();
	}
}
