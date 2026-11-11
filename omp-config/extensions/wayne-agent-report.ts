// Push-watch reporter for dispatched omp sessions.
//
// A coordinator tails agent-events.jsonl under WAYNE_INBOX_DIR (else ~/.wayne/inbox).
// This extension runs inside the child omp and appends one JSON line per state
// change so the coordinator does not have to poll the pane. Nested omp -p /
// bash children must not inherit the watch env, so WAYNE_AGENT_WATCH and
// WAYNE_AGENT_RESULT are deleted at load. Only the root UI session reports:
// -p and subagents have hasUI === false.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const retryableErrorPattern =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

// Same as the m365 plugin's `inbox agent probe` (inbox/cli/probe.sh): last matching line; a `|` is the template, never a status.
const STATUS_RE =
	/^ *(?:[-*] )?(?:\*\*status(?:\*\*:?|:\*\*)|`status`:|`status:`|status:) *([a-z_][a-z_]*)/;
const OPEN_RE = /^ *(?:[-*] )?(?:\*\*open(?:\*\*:?|:\*\*)|`open`:|`open:`|open:) *(.*)$/;

const name = process.env.WAYNE_AGENT_WATCH ?? "";
const resultPath = process.env.WAYNE_AGENT_RESULT;
delete process.env.WAYNE_AGENT_WATCH;
delete process.env.WAYNE_AGENT_RESULT;

const eventFile = path.join(
	process.env.WAYNE_INBOX_DIR || path.join(os.homedir(), ".wayne", "inbox"),
	"agent-events.jsonl",
);

let seq = Date.now() * 1000;

type Ctx = {
	hasUI?: boolean;
	ui?: { notify(message: string, type?: string): void; setStatus(key: string, text: string): void };
	sessionManager?: { getSessionId?: () => string; getSessionFile?: () => string };
};

function clip(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + "…";
}

function lastAssistant(messages: unknown): Record<string, unknown> | undefined {
	if (!Array.isArray(messages)) return;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg && typeof msg === "object" && "role" in msg && msg.role === "assistant") {
			return msg as Record<string, unknown>;
		}
	}
}

function lastAssistantText(messages: unknown): string | undefined {
	const content = lastAssistant(messages)?.content;
	if (!Array.isArray(content)) return;
	const parts: string[] = [];
	for (const item of content) {
		if (!item || typeof item !== "object" || !("type" in item) || !("text" in item)) continue;
		if (item.type === "text" && typeof item.text === "string" && item.text.length > 0) parts.push(item.text);
	}
	if (parts.length) return parts.join(" ");
}

function retryableErrorMessage(event: { messages?: unknown }): string | undefined {
	const assistant = lastAssistant(event?.messages);
	if (assistant?.stopReason !== "error") return;
	const errorMessage = String(assistant.errorMessage ?? "");
	if (!retryableErrorPattern.test(errorMessage)) return;
	return errorMessage || "retryable provider error";
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

// The RESULT block's last `status:` and `open:` lines (shared task-prompt contract); a `|` line is the template.
function resultFields(): { status?: string; open?: string } {
	if (!resultPath) return {};
	try {
		if (!fs.existsSync(resultPath)) return {};
		let status: string | undefined;
		let open: string | undefined;
		for (const line of fs.readFileSync(resultPath, "utf8").split("\n")) {
			if (line.includes("|")) continue;
			const m = STATUS_RE.exec(line);
			if (m) status = m[1];
			const o = OPEN_RE.exec(line);
			if (o) open = clip(o[1].trim(), 500);
		}
		return { status, open };
	} catch (err) {
		console.warn(`wayne-agent-report: ${err instanceof Error ? err.message : String(err)}`);
		return {};
	}
}

export default function (pi: ExtensionAPI) {
	if (!name) return;

	let rootSession = false;
	let agentActive = false;
	let working = false;
	/** A prompt was submitted since the last `working`: the next turn is a new round, not an extension's continuation. */
	let prompted = false;
	let session = "";
	let sessionFile = "";
	let lastCtx: Ctx | undefined;
	let hbTimer: ReturnType<typeof setInterval> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;

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

	function emit(type: string, extra: Record<string, unknown> = {}) {
		const rec: Record<string, unknown> = {
			v: 1,
			ts: new Date().toISOString(),
			name,
			host: os.hostname(),
			pid: process.pid,
			session,
			sessionFile,
			seq: seq++,
			type,
			...extra,
		};
		if (typeof rec.text === "string") rec.text = clip(rec.text, 1500);
		if (rec.ask && typeof rec.ask === "object") {
			const ask = rec.ask as { question?: unknown; options?: unknown; kind?: unknown };
			const opts = Array.isArray(ask.options) ? ask.options : [];
			rec.ask = {
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

	function clearRetry() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = undefined;
		}
	}

	function settle(event: { messages?: unknown }) {
		working = false;
		const text = lastAssistantText(event?.messages);
		const { status, open } = resultFields();
		if (status && resultPath) emit("result", { text, result: { path: resultPath, status, open } });
		else emit("idle", { text });
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
			if (!resultPath) {
				warnWrite("WAYNE_AGENT_RESULT not set; results will arrive as idle");
				ctx.ui?.notify?.("wayne-agent-report: WAYNE_AGENT_RESULT not set; results will arrive as idle", "warning");
			}
			if (!hbTimer) {
				hbTimer = setInterval(() => emit("hb"), 60_000);
				hbTimer.unref?.();
			}
			emit("started");
		}),
	);

	pi.on(
		"session_switch",
		safe((_event, ctx: Ctx) => {
			if (!activate(ctx)) return;
			clearRetry();
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
			clearRetry();
			agentActive = true;
			if (working) return;
			working = true;
			emit("working", { prompted });
			prompted = false;
		}),
	);

	pi.on(
		"tool_execution_start",
		safe((event: { toolName?: string; args?: unknown }, ctx: Ctx) => {
			if (!rootSession || event?.toolName !== "ask") return;
			touch(ctx);
			working = false;
			const ask = askFromArgs(event.args);
			emit("ask", { text: ask.question, ask });
		}),
	);

	pi.on(
		"tool_approval_requested",
		safe((event: { toolName?: string; reason?: string }, ctx: Ctx) => {
			if (!rootSession) return;
			touch(ctx);
			working = false;
			const question = event?.reason || `${event?.toolName} approval`;
			emit("ask", { text: question, ask: { question, options: [], kind: "approval" } });
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
			// Duplicate/late end while a retry hold is already in flight must not settle.
			if (!agentActive) return;
			if (event?.willContinue === true) return;
			agentActive = false;
			if (retryableErrorMessage(event)) {
				clearRetry();
				retryTimer = setTimeout(() => {
					retryTimer = undefined;
					if (agentActive) return;
					settle(event);
				}, 2500);
				retryTimer.unref?.();
				return;
			}
			settle(event);
		}),
	);

	pi.on(
		"session_shutdown",
		safe((_event, ctx: Ctx) => {
			if (!rootSession) return;
			touch(ctx);
			clearRetry();
			if (hbTimer) {
				clearInterval(hbTimer);
				hbTimer = undefined;
			}
			emit("ended");
		}),
	);
}
