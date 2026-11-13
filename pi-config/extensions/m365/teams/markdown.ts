/**
 * Teams HTML → Markdown for the chat pane.
 *
 * The Python side (fetch_teams.py's `_TeamsMarkdown`) uses markdownify. This is
 * Turndown, and the two do NOT agree byte for byte: markdownify escapes `-` and
 * `#`, keeps a newline that appears inside text, drops a NBSP at an element's
 * edge, and indents a nested list by two spaces. Turndown does none of those.
 *
 * A bake-off (node-html-markdown, unified/rehype-remark, Turndown) scored 15-16
 * of 30 standard-HTML cases against markdownify's bytes: no Node library
 * implements its model, and reaching it meant a growing stack of regexes over
 * raw HTML. The acceptance criterion was therefore changed, by decision, from
 * byte parity to SEMANTIC equivalence -- the differences that remain are ones
 * Markdown renders identically (a single newline is a space; a doubled space is
 * a space; escaping policy is invisible after rendering).
 *
 * tests/markdown.test.mjs holds the line: it compares against the Python
 * converter's own output through a narrow, documented normaliser, and every
 * remaining divergence is listed there with a reason. A new one fails the suite.
 *
 * Only tags Teams invents are customised here. Standard HTML -- headings,
 * lists, links, blockquotes, <pre>, <hr>, whitespace -- stays library-owned.
 */
import TurndownService from "turndown";
import { attachedCardText, isCardType } from "./card.ts";
import { FORWARD_ATTACHMENT, forwardHeader, forwardParts, quote } from "./forward.ts";
import { htmlToText } from "./html.ts";

interface Attachment {
	id?: string | number;
	contentType?: string;
	name?: string;
	contentUrl?: string;
	content?: string | Record<string, unknown>;
}

/** The sender of a reply, which may be a person or a bot. */
function attSender(d: Record<string, unknown>): string {
	const who = (d.messageSender ?? {}) as Record<string, unknown>;
	const user = (who.user ?? {}) as { displayName?: string };
	const app = (who.application ?? {}) as { displayName?: string };
	// No name rather than a leaked identity type: Graph omits displayName for
	// some senders, and "aadUser" means nothing to a reader.
	return user.displayName || app.displayName || (who.application ? "a bot" : "");
}

/**
 * A Teams <attachment> is rarely a file.
 *
 * In practice it is a reply: contentUrl is empty and the real content sits in
 * `content` as JSON. Rendering only the filename would drop the quoted message
 * entirely, which is why replies used to appear in the pane as context-free
 * one-liners. A forward is an attachment too; htmlToMarkdown quotes it whole
 * (forward.ts) before any attachment rule sees it.
 */
export function attachmentMarkdown(att: Attachment): string {
	// One attachment that cannot be read is marked where it sits; the message's
	// text, sender and other attachments still come through.
	try {
		return renderAttachment(att);
	} catch {
		return "[unreadable attachment]";
	}
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === "object" && !Array.isArray(v);

function renderAttachment(att: Attachment): string {
	const ctype = att.contentType ?? "";
	// A bot's card is the message: every block of it, each its own paragraph.
	// One with nothing to read keeps the attachment marker below, so it is not invisible.
	const card = isCardType(ctype) ? attachedCardText(att.content, ctype, "\n\n") : "";
	if (card) return card;
	if (ctype !== "messageReference") {
		if (att.contentUrl) return `\u{1f4ce} [${att.name || "attachment"}](${att.contentUrl})`;
		return `\u{1f4ce} [${att.name || ctype || "attachment"}]`;
	}
	// A reply is its JSON content. Malformed JSON throws to attachmentMarkdown's marker;
	// JSON "null", a number or a list is not a reply either.
	const parsed: unknown = typeof att.content === "string" ? JSON.parse(att.content) : att.content;
	if (!isPlainObject(parsed)) return "[unreadable attachment]";
	const quoted = htmlToText(String(parsed.messagePreview ?? "")).trim();
	const who = attSender(parsed);
	const head = who ? `> \u21a9 replying to **${who}**` : "> \u21a9 replying to an earlier message";
	return head + (quoted ? `: ${quoted}` : "");
}

/**
 * Teams' proprietary tags, rewritten to the standard HTML they mean.
 *
 * This is the only pre-pass, and it is not whitespace fighting: it tells the
 * converter what the markup IS.
 *
 *   <codeblock language="x">  is a <pre><code class="language-x">. Turndown
 *     only treats <pre> as preformatted -- inside any other element it collapses
 *     newlines, so a shell script arrived as a single line.
 *   <emoji alt="👍">  is the character in its alt. It is also an EMPTY element,
 *     which Turndown short-circuits before any rule runs and then eats the
 *     following space ("nice 👍job"). As text neither problem exists.
 */
function standardiseTeamsTags(html: string): string {
	return html
		.replace(/<codeblock\b([^>]*)>([\s\S]*?)<\/codeblock>/gi, (_m, attrs: string, body: string) => {
			let lang = (attrs.match(/language\s*=\s*"([^"]*)"/i) ?? attrs.match(/language\s*=\s*'([^']*)'/i))?.[1] ?? "";
			if (lang.toLowerCase() === "plaintext") lang = "";
			return `<pre><code class="language-${lang}">${body}</code></pre>`;
		})
		.replace(/<emoji\b([^>]*?)\s*(?:\/>|>\s*<\/emoji>)/gi, (_m, attrs: string) => {
			const at = (n: string) => (attrs.match(new RegExp(`${n}\\s*=\\s*"([^"]*)"`, "i")) ?? [])[1] ?? "";
			return at("alt") || at("title") || `:${at("id") || "emoji"}:`;
		});
}

interface DomLike {
	nodeName: string;
	childNodes?: ArrayLike<DomLike>;
	textContent: string;
}

/** Rows, walked by hand: domino's querySelectorAll result is not spreadable. */
function collectRows(node: DomLike, out: DomLike[][] = []): DomLike[][] {
	for (const child of Array.prototype.slice.call(node.childNodes ?? []) as DomLike[]) {
		if (child.nodeName.toLowerCase() === "tr") {
			out.push(
				(Array.prototype.slice.call(child.childNodes ?? []) as DomLike[]).filter((c) =>
					["td", "th"].includes(c.nodeName.toLowerCase()),
				),
			);
		} else {
			collectRows(child, out);
		}
	}
	return out;
}

/**
 * A table cell, CONVERTED rather than flattened.
 *
 * textContent was losing every inline mark inside a cell: live parity found a
 * table where `**302.1s**` and `` `5014c9e` `` came out as bare text, which in a
 * table of measurements is exactly where the emphasis was carrying meaning.
 *
 * Newlines are collapsed because a pipe table row cannot contain one.
 */
function cellMarkdown(td: TurndownService, cell: { innerHTML?: string; textContent: string }): string {
	const html = cell.innerHTML ?? "";
	const md = html ? td.turndown(html) : cell.textContent;
	return md.replace(/\u00a0/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

function build(attachments: Attachment[]): TurndownService {
	const byId = new Map(attachments.map((a) => [String(a.id), a]));
	const td = new TurndownService({
		headingStyle: "atx",
		bulletListMarker: "-",
		codeBlockStyle: "fenced",
		emDelimiter: "*",
		strongDelimiter: "**",
		hr: "---",
		br: "  ",
		/**
		 * Turndown short-circuits EMPTY elements before any rule runs, and both
		 * remaining Teams tags are empty. Passed at construction on purpose:
		 * Rules captures this function once, so assigning it afterwards is a
		 * silent no-op.
		 */
		blankReplacement: (content: string, node: unknown) => {
			// Turndown's node is a DOM element (domino); only these members are read.
			type Node = { nodeName: string; getAttribute(n: string): string | null; isBlock?: boolean; getElementsByTagName(n: string): ArrayLike<Node> };
			const el = node as Node;
			const name = el.nodeName.toLowerCase();
			if (name === "img") {
				const alt = (el.getAttribute("alt") ?? "").trim();
				return alt ? `[${alt}]` : "[image]";
			}
			// An attachment, or a block holding only attachments (a link preview's card sits in `<p><attachment></p>`):
			// blank to Turndown, and the card would go with it.
			const tags = name === "attachment" ? [el] : Array.from(el.getElementsByTagName("attachment"));
			const shown = tags.flatMap((t) => {
				const att = byId.get(String(t.getAttribute("id")));
				return att ? [attachmentMarkdown(att)] : [];
			});
			if (shown.length) return `\n\n${shown.join("\n\n")}\n\n`;
			return el.isBlock ? "\n\n" : "";
		},
	});

	// Bold so the pane can find a mention of me and colour it.
	td.addRule("at", { filter: ["at"] as never, replacement: (content) => `**@${content.trim()}**` });

	// Not a Markdown image: the URL needs a bearer token, and the pane replaces
	// this marker with a model-written description.
	td.addRule("img", {
		filter: "img",
		replacement: (_c, node) => {
			const alt = ((node as unknown as { getAttribute(n: string): string | null }).getAttribute("alt") ?? "").trim();
			return alt ? `[${alt}]` : "[image]";
		},
	});

	td.addRule("attachment", {
		filter: ["attachment"] as never,
		replacement: (_c, node) => {
			const id = String((node as unknown as { getAttribute(n: string): string | null }).getAttribute("id"));
			const att = byId.get(id);
			return att ? `\n\n${attachmentMarkdown(att)}\n\n` : "";
		},
	});

	// Keep the language so the pane can syntax-highlight. Turndown emits a bare
	// fence; the hint lives on the inner <code class="language-x">.
	td.addRule("pre", {
		filter: "pre",
		replacement: (_c, node) => {
			const el = node as unknown as {
				querySelector(s: string): { getAttribute(n: string): string | null } | null;
				textContent: string;
			};
			const code = el.querySelector("code");
			let lang = "";
			for (const cls of (code?.getAttribute("class") ?? "").split(/\s+/)) {
				if (cls.startsWith("language-")) {
					lang = cls.slice("language-".length);
					break;
				}
			}
			const body = el.textContent.replace(/\u00a0/g, " ").replace(/^\n+|\n+$/g, "");
			return body.trim() ? `\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n` : "";
		},
	});

	/**
	 * Turndown ships no table support: without this a table is flattened to its
	 * cell text and the reader cannot tell there were columns. markdownify emits
	 * an empty header row when the first row is data, because a pipe table with
	 * no header is not a table to most renderers.
	 */
	td.addRule("table", {
		filter: "table",
		replacement: (_c, node) => {
			const rows = collectRows(node as unknown as DomLike);
			if (rows.length === 0) return "";
			const line = (cells: { textContent: string }[]) => `| ${cells.map((c) => cellMarkdown(td, c)).join(" | ")} |`;
			const width = rows[0].length;
			const sep = `| ${Array(width).fill("---").join(" | ")} |`;
			const first = rows[0];
			const headerIsData = first.every((c) => c.nodeName.toLowerCase() !== "th");
			const out: string[] = [];
			if (headerIsData) out.push(`| ${Array(width).fill("").join(" | ")} |`, sep);
			else out.push(line(first), sep);
			for (const r of rows.slice(headerIsData ? 0 : 1)) out.push(line(r));
			return `\n\n${out.join("\n")}\n\n`;
		},
	});

	td.addRule("systemEventMessage", { filter: ["systemeventmessage"] as never, replacement: (c) => c });

	return td;
}

/**
 * Teams message HTML as Markdown, for pi's Markdown renderer.
 *
 * Separate from htmlToText(): that one flattens for digests and tools, this one
 * keeps the structure a chat pane can show.
 *
 * A forward (forward.ts) is a quoted block: its header, then the original converted like any message. `names` maps
 * a forward's sender id to the name it is shown with; `context` is chatsvc's originalMessageContext.
 */
export function htmlToMarkdown(html: string, attachments: Attachment[] = [], names: ReadonlyMap<string, string> = new Map(), context?: unknown): string {
	if (!html) return "";
	return forwardParts(html, attachments, context)
		.map((p) => {
			if (!("forward" in p)) return convert(p.html, attachments);
			// The original's own attachments (a card it carried) render inside the quote; the forwards do not nest.
			const body = htmlToMarkdown(p.forward.html, attachments.filter((x) => x.contentType !== FORWARD_ATTACHMENT), names);
			return quote([forwardHeader(p.forward, names, true), body].filter(Boolean).join("\n\n"));
		})
		.filter(Boolean)
		.join("\n\n");
}

function convert(html: string, attachments: Attachment[]): string {
	let md = build(attachments).turndown(standardiseTeamsTags(html));
	md = md.replace(/\u00a0/g, " ");
	md = md.replace(/^[ \t]+$/gm, "");
	md = md.replace(/\n{3,}/g, "\n\n");
	return md.trim();
}
