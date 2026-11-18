/**
 * wayne-agent-report: fake `pi` collecting on() handlers.
 *
 *   node --experimental-strip-types omp-config/tests/wayne-agent-report.test.mjs
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const EXT = new URL("../extensions/wayne-agent-report.ts", import.meta.url).href;
const PANE_ENV = { tern: "TERN_PANE", tmux: "TMUX_PANE", herdr: "HERDR_PANE_ID" };

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
		const t = { fn, ms, cleared: false, unref() { return this; } };
		intervals.push(t);
		return t;
	};
	globalThis.clearInterval = (t) => {
		if (t) t.cleared = true;
	};
	globalThis.setTimeout = (fn, ms) => {
		const t = { fn, ms, cleared: false, unref() { return this; } };
		timeouts.push(t);
		return t;
	};
	globalThis.clearTimeout = (t) => {
		if (t) t.cleared = true;
	};
}

/** The turn ends still waiting out their hold. */
const held = () => timeouts.filter((t) => !t.cleared && !t.fired);
/** The hold runs out. */
function elapse() {
	for (const t of held()) {
		t.fired = true;
		t.fn();
	}
}

function ctx(hasUI = true, session = "S1") {
	return {
		hasUI,
		ui: { notify() {}, setStatus() {} },
		sessionManager: { getSessionId: () => session, getSessionFile: () => `/x/${session}.jsonl` },
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

/** `pane`: `{ tern: "42" }` puts the session in that mux pane; none is a session outside any pane. */
async function load({ watch, result, inbox, pane = {} } = {}) {
	installTimers();
	const dir = inbox || mkdtempSync(path.join(os.tmpdir(), "wayne-agent-report-"));
	if (watch === undefined) delete process.env.WAYNE_AGENT_WATCH;
	else process.env.WAYNE_AGENT_WATCH = watch;
	if (result === undefined) delete process.env.WAYNE_AGENT_RESULT;
	else process.env.WAYNE_AGENT_RESULT = result;
	for (const [mux, key] of Object.entries(PANE_ENV)) {
		if (pane[mux] === undefined) delete process.env[key];
		else process.env[key] = pane[mux];
	}
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
const said = (text) => ({ messages: [{ role: "assistant", content: [{ type: "text", text }] }] });

await check("1. a session outside a pane with no name does not report: no handlers and no file", async () => {
	const { handlers, file } = await load();
	deepStrictEqual(Object.keys(handlers), []);
	ok(!existsSync(file), "no event file");
});

await check("1b. an unnamed session in a mux pane reports, with an empty name and where it runs", async () => {
	for (const [mux, id] of [["tern", "3440268804099"], ["tmux", "%7"], ["herdr", "h-12"]]) {
		const { handlers, file } = await load({ pane: { [mux]: id } });
		handlers.session_start({}, ui);
		handlers.agent_start({}, ui);
		handlers.agent_end(said("hello"), ui);
		elapse();
		const evs = events(file);
		deepStrictEqual(evs.map((e) => e.type), ["started", "working", "idle"], mux);
		for (const e of evs) deepStrictEqual([e.name, e.mux, e.pane, e.session], ["", mux, id, "S1"]);
	}
});

await check("2. the watch env is deleted after load; WAYNE_AGENT_GENERATION is neither read, deleted nor sent", async () => {
	process.env.WAYNE_AGENT_GENERATION = "launch-0001";
	try {
		const { handlers, file } = await load({ watch: "w", result: "/nowhere/RESULT.md" });
		strictEqual(process.env.WAYNE_AGENT_WATCH, undefined);
		strictEqual(process.env.WAYNE_AGENT_RESULT, undefined);
		strictEqual(process.env.WAYNE_AGENT_GENERATION, "launch-0001");
		handlers.session_start({}, ui);
		ok(!("generation" in events(file)[0]));
	} finally {
		delete process.env.WAYNE_AGENT_GENERATION;
	}
});

await check("3. each hook writes the schema: session, sessionFile, cwd, mux and pane on every event", async () => {
	const { handlers, file } = await load({ watch: "w", pane: { tern: "42" } });
	handlers.session_start({}, ui);
	handlers.agent_start({}, ui);
	handlers.tool_execution_start(
		{
			toolName: "ask",
			toolCallId: "call-1",
			args: { questions: [{ question: "yes or no?", options: [{ label: "yes" }, { label: "no" }] }] },
		},
		ui,
	);
	handlers.tool_execution_end({ toolName: "ask" }, ui);
	handlers.agent_end(said("all done"), ui);
	elapse();
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
		strictEqual(e.cwd, process.cwd());
		strictEqual(e.mux, "tern");
		strictEqual(e.pane, "42");
		ok(typeof e.seq === "number");
		if (i > 0) ok(e.seq > evs[i - 1].seq, "seq strictly increasing");
	}
	deepStrictEqual(evs[2].ask, { id: "call-1", question: "yes or no?", options: ["yes", "no"], kind: "ask" });
	strictEqual(evs[2].text, "yes or no?");
	strictEqual(evs[4].text, "all done");
});

await check("3b. a named session outside a pane reports with no mux and no pane", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	const [e] = events(file);
	ok(!("mux" in e) && !("pane" in e), JSON.stringify(e));
});

await check("4. agent_end willContinue:true writes nothing and holds nothing", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.agent_start({}, ui);
	handlers.agent_end({ willContinue: true, awaitingAsyncWork: true, messages: [{ role: "assistant", stopReason: "aborted", content: [] }] }, ui);
	deepStrictEqual(held(), [], "a pause is not a hold");
	deepStrictEqual(
		events(file).map((e) => e.type),
		["started", "working"],
	);
});

await check("5. every turn end waits the 2.5 s hold, and an agent_start inside it cancels it", async () => {
	const ends = [
		said("plain end"),
		{ messages: [{ role: "assistant", stopReason: "aborted", content: [] }] },
		{ messages: [{ role: "assistant", stopReason: "error", errorMessage: "429 rate limit" }] },
	];
	for (const end of ends) {
		const a = await load({ watch: "w" });
		a.handlers.session_start({}, ui);
		a.handlers.agent_start({}, ui);
		a.handlers.agent_end(end, ui);
		deepStrictEqual(events(a.file).map((e) => e.type), ["started", "working"], "nothing immediately");
		deepStrictEqual(held().map((t) => t.ms), [2500], "one 2500 ms hold");
		a.handlers.agent_start({}, ui);
		deepStrictEqual(held(), [], "agent_start cancels the hold");
		deepStrictEqual(events(a.file).map((e) => e.type), ["started", "working"], "the turn went on: no idle, no second working");

		const b = await load({ watch: "w" });
		b.handlers.session_start({}, ui);
		b.handlers.agent_start({}, ui);
		b.handlers.agent_end(end, ui);
		// A duplicate end inside the hold settles nothing more.
		b.handlers.agent_end(end, ui);
		elapse();
		deepStrictEqual(events(b.file).map((e) => e.type), ["started", "working", "idle"]);
	}
});

await check("5b. a session switched or shut down inside the hold still tells its turn end, under the session that ended it", async () => {
	const a = await load({ watch: "w" });
	a.handlers.session_start({}, ui);
	a.handlers.agent_start({}, ui);
	a.handlers.agent_end(said("round one"), ui);
	a.handlers.session_switch({}, ctx(true, "S2"));
	deepStrictEqual(events(a.file).map((e) => [e.type, e.session]), [["started", "S1"], ["working", "S1"], ["idle", "S1"], ["started", "S2"]]);
	deepStrictEqual(held(), []);

	const b = await load({ watch: "w" });
	b.handlers.session_start({}, ui);
	b.handlers.agent_start({}, ui);
	b.handlers.agent_end(said("last words"), ui);
	b.handlers.session_shutdown({}, ui);
	deepStrictEqual(events(b.file).map((e) => e.type), ["started", "working", "idle", "ended"]);
});

await check("6. a turn end carries the newest RESULT*.md beside WAYNE_AGENT_RESULT: path, status, open and version", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "wayne-agent-report-"));
	const resultFile = path.join(dir, "RESULT.md");
	writeFileSync(resultFile, "status: done | partial | blocked\n");
	const a = await load({ watch: "w", result: resultFile, inbox: dir });
	a.handlers.session_start({}, ui);
	a.handlers.agent_start({}, ui);
	a.handlers.agent_end(said("x"), ui);
	elapse();
	deepStrictEqual(
		events(a.file).filter((e) => e.type === "idle" || e.type === "result").map((e) => e.type),
		["idle"],
		"the template line is no status",
	);

	const dir2 = mkdtempSync(path.join(os.tmpdir(), "wayne-agent-report-"));
	const result2 = path.join(dir2, "RESULT.md");
	const body = "- **status:** partial\n- **open:** confirm the rollout switch\n";
	writeFileSync(result2, body);
	const b = await load({ watch: "w", result: result2, inbox: dir2 });
	b.handlers.session_start({}, ui);
	b.handlers.agent_start({}, ui);
	b.handlers.agent_end(said("x"), ui);
	elapse();
	const version = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
	deepStrictEqual(events(b.file).find((e) => e.type === "result").result, { path: result2, status: "partial", open: "confirm the rollout switch", version: version(body) });

	// The follow-up round writes a new file in the same run directory: that one is the RESULT now.
	const round2 = path.join(dir2, "RESULT-topic-r2.md");
	writeFileSync(round2, "status: done\n");
	const later = Date.now() / 1000 + 60;
	utimesSync(round2, later, later);
	b.handlers.agent_start({}, ui);
	b.handlers.agent_end(said("y"), ui);
	elapse();
	deepStrictEqual(events(b.file).filter((e) => e.type === "result").at(-1).result, { path: round2, status: "done", version: version("status: done\n") });
});

// Field report 11-18 (layerfs-impl): a session that stopped mid-work, its RESULT files unchanged, sent `result`
// again, which made a result card and fired the plan for nothing new.
await check("6b. a turn end on an unchanged RESULT is idle; a changed RESULT is a result again", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "wayne-agent-report-"));
	const resultFile = path.join(dir, "RESULT.md");
	writeFileSync(resultFile, "status: partial\n");
	const { handlers, file } = await load({ watch: "w", result: resultFile, inbox: dir });
	handlers.session_start({}, ui);
	const turn = (text) => {
		handlers.agent_start({}, ui);
		handlers.agent_end(said(text), ui);
		elapse();
	};
	turn("wrote the result");
	turn("waiting on my subagents");
	turn("still waiting");
	const ends = () => events(file).filter((e) => e.type === "idle" || e.type === "result");
	deepStrictEqual(ends().map((e) => [e.type, e.text, "result" in e]), [["result", "wrote the result", true], ["idle", "waiting on my subagents", false], ["idle", "still waiting", false]]);
	writeFileSync(resultFile, "status: done\n");
	turn("finished");
	turn("anything else?");
	deepStrictEqual(ends().slice(3).map((e) => [e.type, e.result?.status]), [["result", "done"], ["idle", undefined]]);
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
	const { handlers, file } = await load({ watch: "w", pane: { tern: "42" } });
	const headless = ctx(false);
	handlers.session_start({}, headless);
	handlers.agent_start({}, headless);
	handlers.tool_execution_start({ toolName: "ask", args: { questions: [{ question: "q" }] } }, headless);
	handlers.agent_end(said("x"), headless);
	elapse();
	handlers.session_shutdown({}, headless);
	ok(!existsSync(file) || events(file).length === 0, "no events");
});

await check("9. no heartbeat: no interval is set and no hb is written", async () => {
	const { handlers, file } = await load({ watch: "w", pane: { tern: "42" } });
	handlers.session_start({}, ui);
	handlers.agent_start({}, ui);
	handlers.agent_end(said("x"), ui);
	elapse();
	deepStrictEqual(intervals, []);
	ok(!events(file).some((e) => e.type === "hb"));
});

await check("10. approval ask carries the tool call id when the event has one", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.tool_approval_requested({ toolName: "bash", reason: "rm -rf" }, ui);
	handlers.tool_approval_requested({ toolName: "bash", toolCallId: "call-9", reason: "rm -rf" }, ui);
	const asks = events(file).filter((e) => e.type === "ask");
	deepStrictEqual(asks.map((e) => e.ask), [{ question: "rm -rf", options: [], kind: "approval" }, { id: "call-9", question: "rm -rf", options: [], kind: "approval" }]);
	strictEqual(asks[0].text, "rm -rf");
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
	const { handlers, file } = await load({ watch: "w", pane: { tern: "42" } });
	handlers.session_start({}, ui);
	handlers.tool_execution_start({ toolName: "ask", args: { questions: [{ question: "部署".repeat(1000), options: [] }] } }, ui);
	const line = readFileSync(file, "utf8").trimEnd().split("\n").at(-1);
	ok(Buffer.byteLength(line) < 4096, `line is ${Buffer.byteLength(line)} bytes`);
	ok(JSON.parse(line).ask.question.startsWith("部署部署"));
});

await check("13. a named session with no WAYNE_AGENT_RESULT says so on the status row; an unnamed one does not", async () => {
	const statuses = [];
	const shown = { ...ctx(true), ui: { notify() {}, setStatus: (key, text) => statuses.push([key, text]) } };
	(await load({ pane: { tern: "42" } })).handlers.session_start({}, shown);
	deepStrictEqual(statuses, []);
	(await load({ watch: "w" })).handlers.session_start({}, shown);
	ok(statuses.some(([key, text]) => key === "wayne-agent-report" && text.includes("WAYNE_AGENT_RESULT not set")), JSON.stringify(statuses));
});

await check("14. working says whether a prompt started the turn", async () => {
	const { handlers, file } = await load({ watch: "w" });
	handlers.session_start({}, ui);
	handlers.input({ text: "follow-up", source: "interactive" }, ui);
	handlers.agent_start({}, ui);
	handlers.agent_end({ messages: [] }, ui);
	elapse();
	// An extension's message (an advisor) starts the next turn: no input event.
	handlers.agent_start({}, ui);
	deepStrictEqual(
		events(file).filter((e) => e.type === "working").map((e) => e.prompted),
		[true, false],
	);
});

process.exit(failed === 0 ? 0 : 1);
