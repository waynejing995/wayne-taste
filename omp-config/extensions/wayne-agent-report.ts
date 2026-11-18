// Session reporter for omp sessions a coordinator may watch.
//
// A coordinator tails agent-events.jsonl under WAYNE_INBOX_DIR (else ~/.wayne/inbox).
// This extension runs inside the omp session and appends one JSON line per state
// change so the coordinator does not have to poll the pane. It reports for every
// root UI session that runs in a mux pane (TERN_PANE, TMUX_PANE or HERDR_PANE_ID)
// or was launched with WAYNE_AGENT_WATCH: a watch is its session (host + session
// id), and the pane in each event says where that session is now. Nested omp -p /
// bash children must not inherit the watch env, so WAYNE_AGENT_WATCH and
// WAYNE_AGENT_RESULT are deleted at load. Only the root UI session reports:
// -p and subagents have hasUI === false.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// Same as the m365 plugin's `inbox agent probe` (inbox/cli/probe.sh): last matching line; a `|` is the template, never a status.
const STATUS_RE =
	/^ *(?:[-*] )?(?:\*\*status(?:\*\*:?|:\*\*)|`status`:|`status:`|status:) *([a-z_][a-z_]*)/;
const OPEN_RE = /^ *(?:[-*] )?(?:\*\*open(?:\*\*:?|:\*\*)|`open`:|`open:`|open:) *(.*)$/;

const name = process.env.WAYNE_AGENT_WATCH ?? "";
const resultPath = process.env.WAYNE_AGENT_RESULT;
delete process.env.WAYNE_AGENT_WATCH;
delete process.env.WAYNE_AGENT_RESULT;

// Where the session runs. Kept in the environment: the pane's other children are in that pane too.
const [mux, pane] = (
	[
		["tern", process.env.TERN_PANE],
		["tmux", process.env.TMUX_PANE],
		["herdr", process.env.HERDR_PANE_ID],
	] as const
).find(([, id]) => id) ?? ["", ""];

const eventFile = path.join(
	process.env.WAYNE_INBOX_DIR || path.join(os.homedir(), ".wayne", "inbox"),
	"agent-events.jsonl",
);

/** A turn end settles this long after agent_end, unless an agent_start (a retry, a new prompt) comes first. */
const SETTLE_MS = 2500;

let seq = Date.now() * 1000;

type Ctx = {
	hasUI?: boolean;
	ui?: { notify(message: string, type?: string): void; setStatus(key: string, text: string): void };
	sessionManager?: { getSessionId?: () => string; getSessionFile?: () => string };
};

function clip(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + "…";
}

function lastAssistantText(messages: unknown): string | undefined {
	if (!Array.isArray(messages)) return;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || typeof msg !== "object" || !("role" in msg) || msg.role !== "assistant") continue;
		const content = (msg as Record<string, unknown>).content;
		if (!Array.isArray(content)) return;
		const parts: string[] = [];
		for (const item of content) {
			if (!item || typeof item !== "object" || !("type" in item) || !("text" in item)) continue;
			if (item.type === "text" && typeof item.text === "string" && item.text.length > 0) parts.push(item.text);
		}
		return parts.length ? parts.join(" ") : undefined;
	}
}

function decodeEntities(s: string): string {
	return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e] ?? "");
}

// omp up to 18.15 takes `questions: [{question, options}]`; 18.18 takes one HTML `<form>` in `html`.
function askFromArgs(args: unknown): { question: string; options: string[]; kind: "ask" } {
	const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	if (typeof a.html === "string") {
		const html = a.html;
		const options = [...html.matchAll(/<input\b[^>]*\btype=["']?(?:radio|checkbox)["']?[^>]*>/gi)]
			.map((m) => /\bvalue=["']([^"']*)["']/i.exec(m[0])?.[1])
			.concat([...html.matchAll(/<option\b[^>]*>([^<]*)/gi)].map((m) => m[1].trim()))
			.filter((o): o is string => !!o)
			.map(decodeEntities);
		const question = decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
		return { question: question || "waiting for user input", options, kind: "ask" };
	}
	const questions = Array.isArray(a.questions) ? a.questions : [];
	const first = questions.find(
		(q) => q && typeof q === "object" && "question" in q && typeof q.question === "string",
	) as { question: string; options?: unknown[] } | undefined;
	const options: string[] = [];
	if (Array.isArray(first?.options)) {
		for (const o of first.options) {
			if (typeof o === "string") options.push(o);
			else if (o && typeof o === "object" && "label" in o) options.push(String(o.label));
		}
	}
	return { question: first?.question || "waiting for user input", options, kind: "ask" };
}

/**
 * The newest `RESULT*.md` beside WAYNE_AGENT_RESULT, as probe.sh reads it: a follow-up round writes a new file in
 * the same run directory. `version` is the first 16 hex of its sha256; `status` and `open` are the last such lines
 * (shared task-prompt contract; a `|` line is the template). Undefined when there is none.
 */
function newestResult(): { path: string; status?: string; open?: string; version: string } | undefined {
	if (!resultPath) return;
	try {
		const dir = path.dirname(resultPath);
		if (!fs.existsSync(dir)) return;
		let newest: { file: string; mtime: number } | undefined;
		for (const base of fs.readdirSync(dir).sort()) {
			if (!/^RESULT.*\.md$/.test(base)) continue;
			const file = path.join(dir, base);
			const mtime = fs.statSync(file).mtimeMs;
			if (!newest || mtime > newest.mtime) newest = { file, mtime };
		}
		if (!newest) return;
		const bytes = fs.readFileSync(newest.file);
		let status: string | undefined;
		let open: string | undefined;
		for (const line of bytes.toString("utf8").split("\n")) {
			if (line.includes("|")) continue;
			const m = STATUS_RE.exec(line);
			if (m) status = m[1];
			const o = OPEN_RE.exec(line);
			if (o) open = clip(o[1].trim(), 500);
		}
		return { path: newest.file, status, open, version: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
	} catch (err) {
		console.warn(`wayne-agent-report: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}
}

export default function (pi: ExtensionAPI) {
	if (!name && !pane) return;

	let rootSession = false;
	let agentActive = false;
	let working = false;
	/** A prompt was submitted since the last `working`: the next turn is a new round, not an extension's continuation. */
	let prompted = false;
	let session = "";
	let sessionFile = "";
	let lastCtx: Ctx | undefined;
	/** The turn end waiting out its hold: the timer, and what it settles. */
	let held: { timer: ReturnType<typeof setTimeout>; event: { messages?: unknown } } | undefined;
	/** The RESULT version of the last `result` event: a turn that ends on the same file has no new result. */
	let reported = "";

	// Called only from inside safe(): a throwing session manager is warned about there, not swallowed here.
	function touch(ctx?: Ctx) {
		if (!ctx) return;
		const id = ctx.sessionManager?.getSessionId?.();
		if (typeof id === "string") session = id;
		const file = ctx.sessionManager?.getSessionFile?.();
		sessionFile = typeof file === "string" ? file : "";
		if (ctx.hasUI === true) lastCtx = ctx;
	}

	function warnWrite(msg: string) {
		console.warn(`wayne-agent-report: ${msg}`);
		try {
			lastCtx?.ui?.setStatus?.("wayne-agent-report", `⚠ agent-report: ${msg}`);
		} catch (err) {
			console.warn(`wayne-agent-report: status row not set: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// `v` stays 1: every field added since is optional, and an older tailer drops a line with any other `v`.
	function emit(type: string, extra: Record<string, unknown> = {}) {
		const rec: Record<string, unknown> = {
			v: 1,
			ts: new Date().toISOString(),
			name,
			host: os.hostname(),
			pid: process.pid,
			session,
			sessionFile,
			cwd: process.cwd(),
			...(pane ? { mux, pane } : {}),
			seq: seq++,
			type,
			...extra,
		};
		if (typeof rec.text === "string") rec.text = clip(rec.text, 1500);
		if (rec.ask && typeof rec.ask === "object") {
			const ask = rec.ask as { id?: unknown; question?: unknown; options?: unknown; kind?: unknown };
			const opts = Array.isArray(ask.options) ? ask.options : [];
			rec.ask = {
				...(typeof ask.id === "string" && ask.id ? { id: ask.id } : {}),
				question: clip(String(ask.question ?? ""), 1500),
				options: opts.slice(0, 10).map((o) => clip(String(o), 100)),
				kind: ask.kind,
			};
		}
		// Under 4 KiB, so concurrent appends from several sessions do not interleave: shorten text first, then the question.
		let line = JSON.stringify(rec);
		for (const field of ["text", "question"] as const) {
			const holder = (field === "text" ? rec : rec.ask) as Record<string, unknown> | undefined;
			while (Buffer.byteLength(line) >= 4096 && typeof holder?.[field] === "string" && holder[field]) {
				const t = holder[field] as string;
				const core = t.endsWith("…") ? t.slice(0, -1) : t;
				holder[field] = core.length > 64 ? `${core.slice(0, core.length - 64)}…` : "";
				line = JSON.stringify(rec);
			}
		}
		try {
			fs.mkdirSync(path.dirname(eventFile), { recursive: true });
			fs.appendFileSync(eventFile, line + "\n");
		} catch (err) {
			warnWrite(err instanceof Error ? err.message : String(err));
		}
	}

	function activate(ctx?: Ctx): boolean {
		if (ctx?.hasUI !== true) return false;
		rootSession = true;
		touch(ctx);
		return true;
	}

	function settle(event: { messages?: unknown }) {
		working = false;
		const text = lastAssistantText(event?.messages);
		const result = newestResult();
		// A turn end is a `result` only when the RESULT changed since the last one told: a session that stops while
		// its subagents run, with the old file still there, has said nothing new.
		if (result?.status && result.version !== reported) {
			reported = result.version;
			emit("result", { text, result });
		} else emit("idle", { text });
	}

	/** An agent_start within the hold: the turn goes on (a provider retry, or a new prompt that aborted it). */
	function cancelHeld() {
		if (!held) return;
		clearTimeout(held.timer);
		held = undefined;
	}

	/** The session is switched or shut down inside the hold: its turn did end, so it is told now. */
	function flushHeld() {
		if (!held) return;
		const { event } = held;
		cancelHeld();
		settle(event);
	}

	function safe<E, C>(fn: (event: E, ctx: C) => void): (event: E, ctx: C) => void {
		return (event, ctx) => {
			try {
				fn(event, ctx);
			} catch (err) {
				warnWrite(err instanceof Error ? err.message : String(err));
			}
		};
	}

	pi.on(
		"session_start",
		safe((_event, ctx: Ctx) => {
			if (!activate(ctx)) return;
			if (name && !resultPath) {
				warnWrite("WAYNE_AGENT_RESULT not set; results will arrive as idle");
				ctx.ui?.notify?.("wayne-agent-report: WAYNE_AGENT_RESULT not set; results will arrive as idle", "warning");
			}
			emit("started");
		}),
	);

	pi.on(
		"session_switch",
		safe((_event, ctx: Ctx) => {
			// Before the session id changes: the held turn end is the previous session's.
			if (rootSession) flushHeld();
			if (!activate(ctx)) return;
			agentActive = false;
			working = false;
			emit("started");
		}),
	);

	// Fires only for a prompt submitted to the editor (a person, or a coordinator typing through tern), never for an
	// extension's message that starts a turn (an advisor): that is how the coordinator tells a follow-up round from
	// the finished round going on.
	pi.on(
		"input",
		safe((_event, ctx: Ctx) => {
			if (!rootSession) return;
			touch(ctx);
			prompted = true;
		}),
	);

	pi.on(
		"agent_start",
		safe((_event, ctx: Ctx) => {
			if (!rootSession && !activate(ctx)) return;
			touch(ctx);
			cancelHeld();
			agentActive = true;
			if (working) return;
			working = true;
			emit("working", { prompted });
			prompted = false;
		}),
	);

	pi.on(
		"tool_execution_start",
		safe((event: { toolName?: string; toolCallId?: string; args?: unknown }, ctx: Ctx) => {
			if (!rootSession || event?.toolName !== "ask") return;
			touch(ctx);
			working = false;
			const ask = askFromArgs(event.args);
			emit("ask", { text: ask.question, ask: { ...ask, id: event.toolCallId } });
		}),
	);

	pi.on(
		"tool_approval_requested",
		safe((event: { toolName?: string; toolCallId?: string; reason?: string }, ctx: Ctx) => {
			if (!rootSession) return;
			touch(ctx);
			working = false;
			const question = event?.reason || `${event?.toolName} approval`;
			emit("ask", { text: question, ask: { id: event?.toolCallId, question, options: [], kind: "approval" } });
		}),
	);

	pi.on(
		"tool_execution_end",
		safe((event: { toolName?: string }, ctx: Ctx) => {
			if (!rootSession || event?.toolName !== "ask") return;
			touch(ctx);
			emit("ask-resolved");
		}),
	);

	pi.on(
		"tool_approval_resolved",
		safe((_event, ctx: Ctx) => {
			if (!rootSession) return;
			touch(ctx);
			emit("ask-resolved");
		}),
	);

	pi.on(
		"agent_end",
		safe((event: { willContinue?: boolean; messages?: unknown }, ctx: Ctx) => {
			if (!rootSession) return;
			touch(ctx);
			// A duplicate or late end while a hold is already in flight must not settle twice.
			if (!agentActive) return;
			if (event?.willContinue === true) return;
			agentActive = false;
			cancelHeld();
			const timer = setTimeout(() => {
				held = undefined;
				if (agentActive) return;
				settle(event);
			}, SETTLE_MS);
			timer.unref?.();
			held = { timer, event };
		}),
	);

	pi.on(
		"session_shutdown",
		safe((_event, ctx: Ctx) => {
			if (!rootSession) return;
			touch(ctx);
			flushHeld();
			emit("ended");
		}),
	);
}
