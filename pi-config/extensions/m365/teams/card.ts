/**
 * Adaptive Cards for teams_send: one builder, four layouts chosen by which fields are given.
 *
 *   message   title + Markdown text                       (always)
 *   status    + facts, each value optionally coloured     (`facts`)
 *   decision  + a question with options, one recommended  (`decision`)
 *   progress  + one row per agent, needs-you first        (`agents`)
 *
 * Links become buttons, `details` a collapsed section, a fact's `detail` a panel its row opens. The model fills fields, never card JSON: a free-form card is
 * a second rendering language to get wrong, and these four cover "tell", "report", "ask" and "agent digest".
 *
 * Every card opens with the agent badge and ends with the agentFooterText() line. The footer is the echo guard: a
 * card read back (cardText) ends with it, the same as a text send's footer, so the self-chat watch skips its own cards.
 */
import { Marked } from "marked";
import { mentionExtension, type MentionToken } from "../core/mention.ts";
import { escapeHtml, htmlToText } from "./html.ts";
import type { Mention } from "./mentions.ts";

export const CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";

/**
 * Marks a message the agent sent rather than one the user typed: `sent by <harness> agent`, one value per process,
 * set by the harness when it starts (omp: "omp"; the MCP server: the client's name). Text sends end with it as an
 * italic footer, cards with it as their last line. The self-chat watch skips notes ending in it (isAgentSend), so a
 * reply to a card or note never comes back as a new one.
 */
let footerText = footerTextFor(undefined);

/** The footer for a harness name, cut to [a-z0-9-]; no usable name gives "sent by agent". */
export function footerTextFor(harness: string | undefined): string {
	const name = (harness ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
	return name ? `sent by ${name} agent` : "sent by agent";
}

/** Name the harness this process runs in; called once, when the harness starts. */
export function setAgentHarness(harness: string | undefined): void {
	footerText = footerTextFor(harness);
}

/** This process's footer line. */
export function agentFooterText(): string {
	return footerText;
}
const AGENT_BADGE = "🤖 pi agent";

export type Tone = "good" | "warning" | "attention";
export interface Fact {
	name: string;
	value: string;
	tone?: Tone;
	/** Markdown behind the row: tapping the row (marked ▸) opens it in its own panel. */
	detail?: string;
}
export interface DecisionOption {
	label: string;
	/** What happens if this option is taken. */
	consequence?: string;
}
export interface Decision {
	question: string;
	/** What the readers need to know to choose: the situation, constraints, what is already known. */
	context?: string;
	options: DecisionOption[];
	/** Index into `options`. */
	recommended?: number;
	/** Why the recommended option. */
	reason?: string;
}
export interface Link {
	title: string;
	url: string;
}
export const AGENT_STATUSES = ["waiting on question", "probe failed", "idle", "done", "working"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export interface AgentRow {
	name: string;
	host: string;
	/** Minutes since the agent's last activity. */
	idle_min: number;
	status: AgentStatus;
	/** Its newest output; collapsed until the row is tapped. */
	tail?: string;
}
export interface CardSpec {
	title?: string;
	/** Markdown. Teams cards render bold, italic, links and lists; not headings, tables or code. */
	text: string;
	facts?: Fact[];
	decision?: Decision;
	links?: Link[];
	details?: string;
	agents?: AgentRow[];
}

type El = Record<string, unknown>;

const STATUS_ICON: Record<AgentStatus, string> = {
	"waiting on question": "❓",
	"probe failed": "⚠️",
	idle: "💤",
	done: "✅",
	working: "⏳",
};
const TONE_COLOR: Record<Tone, string> = { good: "Good", warning: "Warning", attention: "Attention" };
const TONE_STYLE: Record<Tone, string> = { good: "good", warning: "warning", attention: "attention" };

const text = (t: string, extra: El = {}): El => ({ type: "TextBlock", text: t, wrap: true, ...extra });

/** `idle 7 min`, `idle 2 h 05 min`: a timer, coloured by how long the agent has been quiet. */
export function idleLabel(min: number): { label: string; tone: Tone } {
	const m = Math.max(0, Math.floor(min));
	const label = m < 60 ? `idle ${m} min` : `idle ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
	return { label, tone: m < 10 ? "good" : m < 30 ? "warning" : "attention" };
}

/** Rows that need the user first (a question, a broken probe), then idle, finished, working; longest idle first within each. */
export function sortAgents(rows: readonly AgentRow[]): AgentRow[] {
	const rank = (s: AgentStatus) => AGENT_STATUSES.indexOf(s);
	return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || b.idle_min - a.idle_min);
}

function agentRow(row: AgentRow, i: number): El {
	// A working agent that produced output in the last 10 min is just working; "idle 0 min" reads as stuck.
	const idle = row.status === "working" && row.idle_min < 10 ? { label: "working", tone: "good" as Tone } : idleLabel(row.idle_min);
	const tailId = `tail-${i}`;
	return {
		type: "Container",
		separator: i > 0,
		spacing: "Small",
		...(row.tail ? { selectAction: { type: "Action.ToggleVisibility", targetElements: [tailId] } } : {}),
		items: [
			{
				type: "ColumnSet",
				columns: [
					{ type: "Column", width: "auto", items: [text(STATUS_ICON[row.status])] },
					{
						type: "Column",
						width: "stretch",
						items: [text(row.name, { weight: "Bolder" }), text(`${row.host}${idle.label === row.status ? "" : ` · ${row.status}`}${row.tail ? " · tap for tail" : ""}`, { isSubtle: true, size: "Small", spacing: "None" })],
					},
					{ type: "Column", width: "auto", verticalContentAlignment: "Center", items: [text(idle.label, { color: TONE_COLOR[idle.tone], weight: "Bolder" })] },
				],
			},
			...(row.tail ? [text(row.tail, { id: tailId, isVisible: false, size: "Small", isSubtle: true })] : []),
		],
	};
}

function decisionBlock(d: Decision): El {
	const option = (o: DecisionOption, i: number, picked: boolean): El[] => [
		text(picked ? `**${i + 1}. ${o.label}**` : `**${i + 1}.** ${o.label}`),
		...(o.consequence ? [text(`→ ${o.consequence}`, { size: "Small", isSubtle: !picked, spacing: "None" })] : []),
	];
	return {
		type: "Container",
		style: "emphasis",
		spacing: "Medium",
		items: [
			text("Decision needed", { weight: "Bolder", color: "Accent" }),
			text(d.question, { size: "Medium", weight: "Bolder", spacing: "Small" }),
			...(d.context ? [text(d.context, { spacing: "Small" })] : []),
			...d.options.map((o, i) =>
				i === d.recommended
					? {
							type: "Container",
							style: "good",
							spacing: "Small",
							items: [...option(o, i, true), text(`★ Recommended${d.reason ? `: ${d.reason}` : ""}`, { size: "Small", weight: "Bolder", spacing: "Small" })],
						}
					: { type: "Container", spacing: "Small", items: option(o, i, false) },
			),
		],
	};
}

/** A fact's detail: hidden until its row is tapped, a bar in the fact's tone beside a bold header and the Markdown. */
function factDetail(f: Fact, id: string): El {
	const color = f.tone ? { color: TONE_COLOR[f.tone] } : {};
	return {
		type: "Container",
		id,
		isVisible: false,
		style: "emphasis",
		spacing: "Small",
		items: [
			{
				type: "ColumnSet",
				columns: [
					{ type: "Column", width: "4px", style: f.tone ? TONE_STYLE[f.tone] : "accent", items: [] },
					{
						type: "Column",
						width: "stretch",
						items: [text(`${f.name}: ${f.value}`, { weight: "Bolder", size: "Medium", ...color }), text(f.detail!, { spacing: "Small" })],
					},
				],
			},
		],
	};
}

function factRows(facts: readonly Fact[]): El {
	return {
		type: "Container",
		spacing: "Medium",
		items: facts.flatMap((f, i) => {
			const id = `fact-detail-${i}`;
			const row: El = {
				type: "ColumnSet",
				spacing: "Small",
				...(f.detail ? { selectAction: { type: "Action.ToggleVisibility", targetElements: [id] } } : {}),
				columns: [
					{ type: "Column", width: "auto", items: [text(f.name, { isSubtle: true })] },
					{ type: "Column", width: "stretch", items: [text(f.value, { weight: "Bolder", ...(f.tone ? { color: TONE_COLOR[f.tone] } : {}) })] },
					...(f.detail ? [{ type: "Column", width: "auto", verticalContentAlignment: "Center", items: [text("▸", { weight: "Bolder" })] }] : []),
				],
			};
			return f.detail ? [row, factDetail(f, id)] : [row];
		}),
	};
}

/** Refuses what would render wrong or not at all, before anything is posted. */
function check(spec: CardSpec): void {
	const d = spec.decision;
	if (d) {
		if (d.options.length < 2) throw new Error("decision needs at least 2 options");
		if (d.recommended !== undefined && !(Number.isInteger(d.recommended) && d.recommended >= 0 && d.recommended < d.options.length))
			throw new Error(`decision.recommended is ${d.recommended}; it must index options (0..${d.options.length - 1})`);
	}
	for (const f of spec.facts ?? []) if (f.detail !== undefined && !f.detail.trim()) throw new Error(`fact "${f.name}" has an empty detail`);
	for (const l of spec.links ?? []) if (!/^https:\/\//.test(l.url)) throw new Error(`link "${l.title}" must be an https URL, got ${l.url}`);
	for (const a of spec.agents ?? []) if (!AGENT_STATUSES.includes(a.status)) throw new Error(`agent "${a.name}" has unknown status "${a.status}"`);
}

/** The card: badge and title, the text, then whichever of facts, decision, agents and details were given, then the footer. */
export function buildCard(spec: CardSpec): El {
	check(spec);
	const agents = spec.agents ? sortAgents(spec.agents) : [];
	const needYou = agents.filter((a) => a.status === "waiting on question" || a.status === "probe failed").length;
	const body: El[] = [
		{
			type: "Container",
			style: "accent",
			bleed: true,
			items: [
				text(AGENT_BADGE, { size: "Small", weight: "Bolder", isSubtle: true }),
				...(spec.title ? [text(spec.title, { size: "Large", weight: "Bolder", spacing: "None" })] : []),
			],
		},
	];
	if (spec.text.trim()) body.push(text(spec.text, { spacing: "Medium" }));
	if (spec.facts?.length) body.push(factRows(spec.facts));
	if (spec.decision) body.push(decisionBlock(spec.decision));
	if (agents.length) {
		body.push(text(`${needYou} need you · ${agents.length - needYou} other`, { weight: "Bolder", color: needYou ? "Attention" : "Good", spacing: "Medium" }));
		body.push({ type: "Container", spacing: "Small", items: agents.map(agentRow) });
	}
	if (spec.details)
		body.push({
			type: "Container",
			id: "details",
			isVisible: false,
			separator: true,
			spacing: "Medium",
			items: [text("Details", { weight: "Bolder", isSubtle: true }), text(spec.details, { spacing: "Small" })],
		});
	body.push(text(agentFooterText(), { size: "Small", isSubtle: true, separator: true }));
	const actions: El[] = [
		...(spec.links ?? []).map((l) => ({ type: "Action.OpenUrl", title: l.title, url: l.url })),
		...(spec.details ? [{ type: "Action.ToggleVisibility", title: "Details", targetElements: ["details"] }] : []),
	];
	return {
		type: "AdaptiveCard",
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		version: "1.5",
		msteams: { width: "Full" },
		body,
		...(actions.length ? { actions } : {}),
	};
}

/** Hero and thumbnail cards: Bot Framework's older cards, a title, text, pictures and buttons, no element tree. */
const HERO_CONTENT_TYPES = new Set(["application/vnd.microsoft.card.hero", "application/vnd.microsoft.card.thumbnail"]);

/** An attachment whose content is a card this module can read. */
export function isCardType(contentType: unknown): boolean {
	return contentType === CARD_CONTENT_TYPE || HERO_CONTENT_TYPES.has(String(contentType));
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A button: a link when it opens one (Adaptive "Action.OpenUrl", Bot Framework "openUrl"), else its title in brackets. */
function button(a: El): string {
	const title = str(a.title);
	const url = a.type === "Action.OpenUrl" ? str(a.url) : a.type === "openUrl" ? str(a.value) : "";
	if (url) return `[${title || url}](${url})`;
	return title ? `[${title}]` : "";
}

/**
 * A card's text, block by block, in body order. Everything a reader could see is here: hidden parts (what a
 * ToggleVisibility opens) and the card behind each Action.ShowCard, which are the collapsed details; inputs with
 * their choices; buttons, links with their URL.
 */
function adaptiveBlocks(card: El): string[] {
	const out: string[] = [];
	const actions = (list: unknown): void => {
		if (!Array.isArray(list)) return;
		// ToggleVisibility has no content of its own: what it opens is in the body, walked in place.
		const row = (list as El[]).filter((a) => a?.type !== "Action.ToggleVisibility" && a?.type !== "Action.ShowCard").map(button).filter(Boolean);
		if (row.length) out.push(row.join(" · "));
		for (const a of list as El[]) {
			if (a?.type !== "Action.ShowCard") continue;
			if (a.title) out.push(`▸ ${a.title}`);
			walk(a.card);
		}
	};
	const walk = (el: unknown): void => {
		if (Array.isArray(el)) return el.forEach(walk);
		if (!el || typeof el !== "object") return;
		const e = el as El;
		const select = e.selectAction as El | undefined;
		const link = select?.type === "Action.OpenUrl" ? str(select.url) : "";
		switch (e.type) {
			case "TextBlock":
				if (typeof e.text === "string") out.push(link ? `[${e.text}](${link})` : e.text);
				return;
			case "RichTextBlock": {
				const runs = Array.isArray(e.inlines) ? (e.inlines as unknown[]) : [];
				const line = runs
					.map((r) => {
						if (typeof r === "string") return r;
						const run = r as El;
						const url = (run.selectAction as El | undefined)?.type === "Action.OpenUrl" ? str((run.selectAction as El).url) : "";
						return url ? `[${str(run.text)}](${url})` : str(run.text);
					})
					.join("");
				if (line.trim()) out.push(line);
				return;
			}
			case "FactSet":
				// Teams' own FactSet names a fact `title`; buildCard's Fact calls it `name`.
				for (const f of Array.isArray(e.facts) ? (e.facts as El[]) : []) out.push(`${str(f.title) || str(f.name)}: ${str(f.value)}`);
				return;
			case "Image": {
				const alt = str(e.altText);
				if (link) out.push(`[${alt || "image"}](${link})`);
				else if (alt) out.push(`[${alt}]`);
				return;
			}
			case "Input.ChoiceSet":
				if (e.label) out.push(str(e.label));
				for (const c of Array.isArray(e.choices) ? (e.choices as El[]) : []) out.push(`○ ${str(c.title)}`);
				return;
			case "Input.Toggle":
				out.push(`☐ ${str(e.title) || str(e.label)}`);
				return;
			case "Input.Text":
			case "Input.Number":
			case "Input.Date":
			case "Input.Time":
				if (e.label || e.placeholder) out.push(`${str(e.label) || str(e.placeholder)}: ___`);
				return;
			case "ActionSet":
				actions(e.actions);
				return;
		}
		// Containers: Container, ColumnSet and Column, Table rows and cells, ImageSet; the card itself.
		for (const key of ["body", "items", "columns", "rows", "cells", "images"]) walk(e[key]);
		if (link) out.push(`[${link}](${link})`);
	};
	walk(card.body);
	// The card's own buttons come before the footer, so a card the agent sent still ends with it.
	const footer = out.at(-1) === agentFooterText() ? out.pop() : undefined;
	actions(card.actions);
	if (footer) out.push(footer);
	return out;
}

/** Bot Framework HTML (a hero or thumbnail title and text): links kept as Markdown links, the rest flattened. */
function heroHtml(html: string): string {
	return htmlToText(
		html.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, url: string, inner: string) => {
			const label = htmlToText(inner);
			return !label || label === url ? url : `[${escapeHtml(label)}](${url})`;
		}),
	);
}

function heroBlocks(card: El): string[] {
	const tap = card.tap as El | undefined;
	const url = tap?.type === "openUrl" ? str(tap.value) : "";
	const title = heroHtml(str(card.title));
	const out = [url && title ? `[${title}](${url})` : title, heroHtml(str(card.subtitle)), heroHtml(str(card.text))];
	for (const img of Array.isArray(card.images) ? (card.images as El[]) : []) if (img.alt) out.push(`[${str(img.alt)}]`);
	const buttons = (Array.isArray(card.buttons) ? (card.buttons as El[]) : []).map(button).filter(Boolean);
	if (buttons.length) out.push(buttons.join(" · "));
	if (url && !title) out.push(url);
	return out.filter(Boolean);
}

/**
 * A card as plain text, in body order, hidden parts included: how a card reads back in teams_read and the watch.
 * Teams stores the card, not a rendering, so this is the only text a card message has. `sep` joins the blocks:
 * "\n" for flat text, "\n\n" for Markdown, where each block is its own paragraph.
 */
export function cardText(card: unknown, contentType: string = CARD_CONTENT_TYPE, sep = "\n"): string {
	if (!card || typeof card !== "object") return "";
	const blocks = HERO_CONTENT_TYPES.has(contentType) ? heroBlocks(card as El) : adaptiveBlocks(card as El);
	return blocks.join(sep).trim();
}

/** The card text of a Graph attachment or chatsvc card entry, whose content may be a JSON string or an object. */
export function attachedCardText(content: unknown, contentType: string = CARD_CONTENT_TYPE, sep = "\n"): string {
	if (typeof content !== "string") return cardText(content, contentType, sep);
	try {
		return cardText(JSON.parse(content), contentType, sep);
	} catch {
		return "[unreadable attachment]";
	}
}

/**
 * The agent's own send, read back as text: this process's footer as a text send's last line or a card's, not quoted.
 * Images a send carries come after the footer and read back as "[name]", and the footer is italic, so both are cut
 * before the check. Only this process's footer counts: another harness's footer is someone else's send.
 */
export function isAgentSend(text: string): boolean {
	const end = text.trim().replace(/(\s*\[[^\]\n]*\])+$/, "").replace(/\*+$/, "");
	// A forward of the agent's send ends in its footer too, quoted ("> sent by omp agent"): that one a person sent.
	return end.endsWith(agentFooterText()) && !/^>/.test(end.slice(end.lastIndexOf("\n") + 1));
}

/**
 * The Markdown for a card: each real mention (as mentions.ts reads one) shown as the bold name, and the mentions in
 * order. A card cannot notify; the mentions go into the message body next to the card, where Graph's <at> does.
 */
export function cardMentions(markdown: string): { text: string; mentions: Mention[] } {
	const mentions: (Mention & { raw: string })[] = [];
	const md = new Marked({ gfm: true });
	md.use({ extensions: [mentionExtension(() => "")] });
	md.walkTokens(md.lexer(markdown), (t) => {
		if (t.type !== "mention") return;
		const m = t as MentionToken;
		mentions.push({ name: m.name, email: m.address, raw: m.raw });
	});
	let out = markdown;
	for (const m of mentions) out = out.replace(m.raw, `**${m.name}**`);
	return { text: out, mentions: mentions.map(({ name, email }) => ({ name, email })) };
}
