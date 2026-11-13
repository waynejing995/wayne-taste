/**
 * wayne-agent-report: fake `pi` collecting on() handlers.
 *
 *   node --experimental-strip-types omp-config/tests/wayne-agent-report.test.mjs
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const EXT = new URL("../extensions/wayne-agent-report.ts", import.meta.url).href;

let failed = 0;
function check(label, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => {
			console.log(`PASS ${label}`);
		})
		.catch((e) => {
			failed++;
			console.log(`FAIL ${label}\n${e.message}`);
		});
}

let n = 0;
let intervals = [];
let timeouts = [];

function installTimers() {
	intervals = [];
	timeouts = [];
	globalThis.setInterval = (fn, ms) => {
		const t = {
			fn,
			ms,
			cleared: false,
			unrefd: false,
			unref() {
				this.unrefd = true;
				return this;
			},
		};
		intervals.push(t);
		return t;
	};
	globalThis.clearInterval = (t) => {
		if (t) t.cleared = true;
	};
	globalThis.setTimeout = (fn, ms) => {
		const t = {
			fn,
			ms,
			cleared: false,
			unrefd: false,
			unref() {
				this.unrefd = true;
				return this;
			},
		};
		timeouts.push(t);
		return t;
	};
	globalThis.clearTimeout = (t) => {
		if (t) t.cleared = true;
	};
}

function ctx(hasUI = true) {
	return {
		hasUI,
		ui: { notify() {}, setStatus() {} },
		sessionManager: { getSessionId: () => "S1", getSessionFile: () => "/x/S1.jsonl" },
		isIdle: () => true,
	};
}

function events(file) {
	if (!existsSync(file)) return [];
	const raw = readFileSync(file, "utf8");
	if (!raw) return [];
	return raw
		.replace(/\n$/, "")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function load({ watch, result, inbox, generation } = {}) {
	installTimers();
	const dir = inbox || mkdtempSync(path.join(os.tmpdir(), "wayne-agent-report-"));
	if (watch === undefined) delete process.env.WAYNE_AGENT_WATCH;
	else process.env.WAYNE_AGENT_WATCH = watch;
	if (result === undefined) delete process.env.WAYNE_AGENT_RESULT;
	else process.env.WAYNE_AGENT_RESULT = result;
	if (generation === undefined) delete process.env.WAYNE_AGENT_GENERATION;
	else process.env.WAYNE_AGENT_GENERATION = generation;
	process.env.WAYNE_INBOX_DIR = dir;
	const handlers = {};
	const factory = (await import(EXT + "?" + ++n)).default;
	factory({
		on(name, fn) {
			handlers[name] = fn;
		},
		events: { on() {} },
	});
	return { handlers, dir, file: path.join(dir, "agent-events.jsonl") };
}

const ui = ctx(true);

await check("1. no env: no handlers and no file", async () => {
	const { handlers, file } = await load();
	deepStrictEqual(Object.keys(handlers), []);
	ok(!existsSync(file), "no event file");
});

await check("2. env deleted after load", async () => {
	await load({ watch: "w" });
	strictEqual(process.env.WAYNE_AGENT_WATCH, undefined);
	strictEqual(process.env.WAYNE_AGENT_RESULT, undefined);
});

await check("3. each hook writes the schema", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.agent_start({}, ui);
	handlers.tool_execution_start(
		{
			toolName: "ask",
			args: { questions: [{ question: "yes or no?", options: [{ label: "yes" }, { label: "no" }] }] },
		},
		ui,
	);
	handlers.tool_execution_end({ toolName: "ask" }, ui);
	handlers.agent_end({ messages: [{ role: "assistant", content: [{ type: "text", text: "all done" }] }] }, ui);
	handlers.session_shutdown({}, ui);
	const evs = events(file);
	deepStrictEqual(
		evs.map((e) => e.type),
		["started", "working", "ask", "ask-resolved", "idle", "ended"],
	);
	for (let i = 0; i < evs.length; i++) {
		const e = evs[i];
		strictEqual(e.v, 1);
		strictEqual(e.name, "w");
		strictEqual(e.host, os.hostname());
		strictEqual(e.pid, process.pid);
		strictEqual(e.session, "S1");
		strictEqual(e.sessionFile, "/x/S1.jsonl");
		ok(typeof e.seq === "number");
		if (i > 0) ok(e.seq > evs[i - 1].seq, "seq strictly increasing");
	}
	deepStrictEqual(evs[2].ask, { question: "yes or no?", options: ["yes", "no"], kind: "ask" });
	strictEqual(evs[2].text, "yes or no?");
	strictEqual(evs[4].text, "all done");
});

await check("3b. every event carries the launch's WAYNE_AGENT_GENERATION, which nested runs do not inherit", async () => {
	const { handlers, file } = await load({ watch: "w", generation: "launch-0001" });
	strictEqual(process.env.WAYNE_AGENT_GENERATION, undefined);
	handlers.session_start({}, ui);
	handlers.agent_start({}, ui);
	handlers.agent_end({ messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] }, ui);
	deepStrictEqual(events(file).map((e) => e.generation), ["launch-0001", "launch-0001", "launch-0001"]);
	const legacy = await load({ watch: "w" });
	legacy.handlers.session_start({}, ui);
	ok(!("generation" in events(legacy.file)[0]), "a launch without one stamps none");
});

await check("4. agent_end willContinue:true writes nothing", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.agent_start({}, ui);
	handlers.agent_end(
		{ willContinue: true, messages: [{ role: "assistant", content: [{ type: "text", text: "mid" }] }] },
		ui,
	);
	deepStrictEqual(
		events(file).map((e) => e.type),
		["started", "working"],
	);
});

await check("5. retryable error held", async () => {
	const retryEnd = {
		messages: [{ role: "assistant", stopReason: "error", errorMessage: "429 rate limit" }],
	};

	const a = await load({ watch: "w" });
	a.handlers.session_start({}, ui);
	a.handlers.agent_start({}, ui);
	a.handlers.agent_end(retryEnd, ui);
	deepStrictEqual(
		events(a.file).map((e) => e.type),
		["started", "working"],
		"nothing immediately",
	);
	a.handlers.agent_start({}, ui);
	for (const t of timeouts) if (!t.cleared) t.fn();
	deepStrictEqual(
		events(a.file).map((e) => e.type),
		["started", "working"],
		"agent_start before hold: no idle",
	);

	const b = await load({ watch: "w" });
	b.handlers.session_start({}, ui);
	b.handlers.agent_start({}, ui);
	b.handlers.agent_end(retryEnd, ui);
	const held = timeouts.filter((t) => !t.cleared);
	ok(held.length === 1 && held[0].ms === 2500, "2500 ms hold");
	held[0].fn();
	deepStrictEqual(
		events(b.file).map((e) => e.type),
		["started", "working", "idle"],
	);
});

await check("6. RESULT template vs status", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "wayne-agent-report-"));
	const resultFile = path.join(dir, "RESULT.md");
	writeFileSync(resultFile, "status: done | partial | blocked\n");
	const a = await load({ watch: "w", result: resultFile, inbox: dir });
	a.handlers.session_start({}, ui);
	a.handlers.agent_start({}, ui);
	a.handlers.agent_end({ messages: [{ role: "assistant", content: [{ type: "text", text: "x" }] }] }, ui);
	const idle = events(a.file).filter((e) => e.type === "idle" || e.type === "result");
	deepStrictEqual(
		idle.map((e) => e.type),
		["idle"],
	);

	const dir2 = mkdtempSync(path.join(os.tmpdir(), "wayne-agent-report-"));
	const result2 = path.join(dir2, "RESULT.md");
	writeFileSync(result2, "- **status:** done\n");
	const b = await load({ watch: "w", result: result2, inbox: dir2 });
	b.handlers.session_start({}, ui);
	b.handlers.agent_start({}, ui);
	b.handlers.agent_end({ messages: [{ role: "assistant", content: [{ type: "text", text: "x" }] }] }, ui);
	const done = events(b.file).find((e) => e.type === "result");
	ok(done, "result event");
	deepStrictEqual(done.result, { path: result2, status: "done" });
});

await check("7. session_shutdown appends synchronously", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.session_shutdown({}, ui);
	ok(
		events(file).some((e) => e.type === "ended"),
		"ended is in the file right after the handler returns",
	);
});

await check("8. hasUI false writes nothing", async () => {
	const { handlers, file } = await load({ watch: "w" });
	const headless = ctx(false);
	handlers.session_start({}, headless);
	handlers.agent_start({}, headless);
	handlers.tool_execution_start({ toolName: "ask", args: { questions: [{ question: "q" }] } }, headless);
	handlers.agent_end({ messages: [{ role: "assistant", content: [{ type: "text", text: "x" }] }] }, headless);
	handlers.session_shutdown({}, headless);
	ok(!existsSync(file) || events(file).length === 0, "no events");
});

await check("9. heartbeat interval writes hb", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	const live = intervals.filter((t) => !t.cleared);
	ok(live.length === 1 && live[0].ms === 60_000, "60s interval");
	live[0].fn();
	ok(events(file).some((e) => e.type === "hb"));
});

await check("10. approval ask", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.tool_approval_requested({ toolName: "bash", reason: "rm -rf" }, ui);
	const ask = events(file).find((e) => e.type === "ask");
	deepStrictEqual(ask.ask, { question: "rm -rf", options: [], kind: "approval" });
	strictEqual(ask.text, "rm -rf");
});

await check("11. omp 18.18 ask (one HTML form): question text and option values", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	// The exact args a real omp 18.18.3 session wrote in the 2026-11-09 smoke.
	const html = '<form><p>Proceed? yes or no</p><label><input type="radio" name="proceed" value="yes" checked> yes</label><label><input type="radio" name="proceed" value="no"> no</label></form>';
	handlers.tool_execution_start({ toolName: "ask", args: { i: "Asking proceed confirmation", html } }, ui);
	const ask = events(file).find((e) => e.type === "ask");
	deepStrictEqual(ask.ask, { question: "Proceed? yes or no yes no", options: ["yes", "no"], kind: "ask" });
});

await check("12. a long CJK question and text still make a line under 4 KiB", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.tool_execution_start({ toolName: "ask", args: { questions: [{ question: "部署".repeat(1000), options: [] }] } }, ui);
	const line = readFileSync(file, "utf8").trimEnd().split("\n").at(-1);
	ok(Buffer.byteLength(line) < 4096, `line is ${Buffer.byteLength(line)} bytes`);
	ok(JSON.parse(line).ask.question.startsWith("部署部署"));
});

await check("13. a missing WAYNE_AGENT_RESULT shows on the status row", async () => {
	const { handlers } = await load({ watch: "w" });
	const statuses = [];
	handlers.session_start({}, { ...ctx(true), ui: { notify() {}, setStatus: (key, text) => statuses.push([key, text]) } });
	ok(statuses.some(([key, text]) => key === "wayne-agent-report" && text.includes("WAYNE_AGENT_RESULT not set")), JSON.stringify(statuses));
});

await check("14. working says whether a prompt started the turn", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.input({ text: "follow-up", source: "interactive" }, ui);
	handlers.agent_start({}, ui);
	handlers.agent_end({ messages: [] }, ui);
	// An extension's message (an advisor) starts the next turn: no input event.
	handlers.agent_start({}, ui);
	deepStrictEqual(
		events(file).filter((e) => e.type === "working").map((e) => e.prompted),
		[true, false],
	);
});

process.exit(failed === 0 ? 0 : 1);
