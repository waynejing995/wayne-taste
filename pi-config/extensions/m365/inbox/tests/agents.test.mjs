import assert, { deepStrictEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import YAML from "yaml";
import { AgentTailer, readEntries } from "../agents.ts";
import { readAgents } from "../cli/agents.ts";


let failed = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.stack}`);
	}
}

function fixture(extra = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-agents-"));
	const rules = path.join(dir, "rules.yaml");
	const file = path.join(dir, "agent-events.jsonl");
	const cursor = path.join(dir, "cursors", "agent-events.json");
	const rows = new Map();
	const calls = [];
	const warnings = [];
	let changeCount = 0;
	const changes = new EventEmitter();
	let clock = Date.parse("2026-11-09T00:00:00.000Z");
	let stamp = Date.now() / 1000;
	let failAdd = false;
	let entries = [];
	const writeRules = (value) => {
		entries = value;
		fs.writeFileSync(rules, YAML.stringify({ agent_watch: entries }));
		stamp += 2;
		fs.utimesSync(rules, stamp, stamp);
	};
	const inbox = async (args) => {
		calls.push([...args]);
		if (failAdd) throw new Error("ledger unavailable");
		const key = args[args.indexOf("--key") + 1];
		if (rows.has(key)) return "seen";
		rows.set(key, [...args]);
		return `do ${rows.size} tag`;
	};
	const opts = { dir, inbox, now: () => clock, warn: (message) => warnings.push(message), onChange: () => { changeCount += 1; changes.emit("change"); }, ...extra };
	let tailer = new AgentTailer(opts);
	const watched = (name = "one", host = "local", since = "2026-11-09 00:00") => ({ name, host, since, mux: "tern", pane: name });
	const event = (type, seq, overrides = {}) => ({ v: 1, ts: new Date(clock).toISOString(), name: "one", host: "localhost", pid: 17, session: "session", seq, type, ...overrides });
	const append = (value) => fs.appendFileSync(file, typeof value === "string" || Buffer.isBuffer(value) ? value : `${JSON.stringify(value)}\n`);
	const start = async (list = [watched()]) => { writeRules(list); tailer.start(); await tailer.poke(); };
	const restart = async () => { tailer.stop(); tailer = new AgentTailer(opts); tailer.start(); await tailer.poke(); };
	const waitUntil = async (predicate) => {
		const { promise, resolve, reject } = Promise.withResolvers();
		const cleanup = () => { clearTimeout(timer); changes.off("change", inspect); };
		const inspect = () => { if (predicate()) { cleanup(); resolve(); } };
		const timer = setTimeout(() => { cleanup(); reject(new Error("timed out waiting for tailer change")); }, 4000);
		changes.on("change", inspect);
		inspect();
		return promise;
	};
	return {
		dir, rules, file, cursor, rows, calls, warnings, changes, watched, event, append, start, restart, writeRules, waitUntil, inbox, clock, opts,
		get tailer() { return tailer; }, set tailer(value) { tailer = value; },
		advance(ms) { clock += ms; },
		/** The `since` `inbox agent add` writes now (Asia/Shanghai, to the second). */
		since() { return new Date(clock + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " "); },
		fail(value) { failAdd = value; },
		saved() { return JSON.parse(fs.readFileSync(cursor, "utf8")); },
		/** The local byte cursor. No cursor file yet is a fresh start, at 0. */
		offset() { return fs.existsSync(cursor) ? JSON.parse(fs.readFileSync(cursor, "utf8")).hosts.local.offset : 0; },
		/** The watches' records (cursors/agents.json): the state the tailer shares with the probe. */
		observed() {
			const file = path.join(dir, "cursors", "agents.json");
			return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).watches : {};
		},
		close() { tailer.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
		changeCount() { return changeCount; },
	};
}

async function withFixture(fn, extra) {
	const f = fixture(extra);
	const saved = process.env.WAYNE_INBOX_DIR;
	process.env.WAYNE_INBOX_DIR = f.dir;
	try { await fn(f); } finally { if (saved === undefined) delete process.env.WAYNE_INBOX_DIR; else process.env.WAYNE_INBOX_DIR = saved; f.close(); }
}
const arg = (row, key) => row[row.indexOf(key) + 1];
const fields = (row) => row.flatMap((item, index) => item === "--field" ? [row[index + 1]] : []);

await check("unchanged rules do not refresh again", () => withFixture(async (f) => {
	await f.start();
	const before = f.changeCount();
	f.append(f.event("idle", 1, { text: "one" }));
	f.append(f.event("idle", 2, { text: "two" }));
	await f.tailer.poke();
	equal(f.changeCount(), before);
}));

await check("ask maps question, options, goal and fields", () => withFixture(async (f) => {
	await f.start([{ ...f.watched(), goal: "ship safely", result: "/result" }]);
	f.append(f.event("ask", 1, { ask: { kind: "ask", question: "Choose?", options: ["yes", "no"] } }));
	await f.tailer.poke();
	const row = [...f.rows.values()][0];
	equal(arg(row, "--key"), "agents:one:ask:session:1");
	equal(arg(row, "--subject"), "agent one");
	equal(arg(row, "--note"), "waiting on ask: Choose? [options: yes | no]. Goal: ship safely");
	equal(arg(row, "--link"), "/result");
	deepStrictEqual(fields(row), ["event=ask", "state=ask", "mux=tern", "host=local"]);
}));

await check("idle and done result map output and keep the watch", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("idle", 1, { text: "clipped last text" }));
	f.append(f.event("result", 2, { text: "finished", result: { status: "done", path: "/answer", version: "abc123" } }));
	await f.tailer.poke();
	const [idle, result] = [...f.rows.values()];
	equal(arg(idle, "--note"), "turn ended with no new RESULT. Last output: clipped last text");
	deepStrictEqual(fields(idle).slice(0, 2), ["event=idle", "state=no-result"]);
	equal(arg(result, "--key"), "agents:one:result:abc123");
	equal(arg(result, "--note"), "RESULT status: done. Last output: finished");
	equal(arg(result, "--link"), "/answer");
	deepStrictEqual(f.calls.filter((c) => c[0] === "agent" && c[1] === "rm"), [], "a done RESULT does not remove the watch");
	equal(f.observed().one.phase, "idle");
}));

await check("an old entry with generation, stamped, instance and push is read as it is and works; nothing rewrites the list", () => withFixture(async (f) => {
	const text = YAML.stringify({ agent_watch: [
		{ ...f.watched(), generation: "launch-0001", stamped: true, instance: "first-add", migratedGeneration: "legacy", push: true },
		{ name: "bare", host: "local", mux: "tern", pane: "2" },
	] });
	fs.writeFileSync(f.rules, text);
	f.tailer.start();
	await f.tailer.poke();
	deepStrictEqual(readAgents().map((a) => [a.name, a.generation, a.stamped, a.push]), [["one", "launch-0001", true, true], ["bare", undefined, undefined, undefined]]);
	// A reporter of an older clone still stamps a launch id on its events: it is not read.
	f.append(f.event("result", 1, { generation: "another-launch", text: "finished", result: { status: "done", path: "/answer", version: "0000000000000001" } }));
	f.append(f.event("idle", 2, { generation: "another-launch", text: "and again" }));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:session:idle:2"]);
	equal(fs.readFileSync(f.rules, "utf8"), text, "the list is as it was written");
}));

await check("a session resumed into another pane keeps its watch, and the entry follows it", () => withFixture(async (f) => {
	await f.start([{ ...f.watched(), pane: "100", goal: "ship safely", generation: "launch-0001", push: true }, f.watched("other")]);
	f.append(f.event("started", 1, { mux: "tern", pane: "100" }));
	f.append(f.event("working", 2, { mux: "tern", pane: "100" }));
	await f.tailer.poke();
	equal(YAML.parse(fs.readFileSync(f.rules, "utf8")).agent_watch[0].pane, "100", "the same pane rewrites nothing");
	// `omp --resume` in a new tern block: another process, another pane, the same session.
	f.append(f.event("started", 3, { pid: 99, mux: "tern", pane: "200" }));
	f.append(f.event("idle", 4, { pid: 99, mux: "tern", pane: "200", text: "resumed and done" }));
	await f.tailer.poke();
	const list = YAML.parse(fs.readFileSync(f.rules, "utf8")).agent_watch;
	deepStrictEqual(list.map((a) => [a.name, a.mux, a.pane]), [["one", "tern", "200"], ["other", "tern", "other"]]);
	deepStrictEqual([list[0].goal, list[0].generation, list[0].push, list[0].since], ["ship safely", "launch-0001", true, "2026-11-09 00:00"], "every other field of the entry stays");
	deepStrictEqual([...f.rows.keys()], ["agents:one:session:idle:4"], "the watch went on: its turn end is its row");
	deepStrictEqual([f.observed().one.agent.pid, f.observed().one.agent.session], [99, "session"]);
	ok(f.warnings.some((w) => /one: session session is in tern pane 200 now \(was 100\)/.test(w)), f.warnings.join("\n"));
	await f.tailer.poke();
	equal(f.tailer.entries[0].pane, "200", "the tailer reads the entry it moved");
}));

await check("an entry written as a tmux target, and an event that names another mux, move nothing", () => withFixture(async (f) => {
	const text = YAML.stringify({ agent_watch: [{ ...f.watched(), mux: "tmux", pane: "work:1.0" }, { ...f.watched("two"), mux: "tmux", pane: "%4" }] });
	fs.writeFileSync(f.rules, text);
	f.tailer.start();
	await f.tailer.poke();
	// The reporter names a tmux pane by its id; the entry was typed as a target, which the probe and the kill guard read.
	f.append(f.event("working", 1, { mux: "tmux", pane: "%3" }));
	// A session inside tmux inside a tern block: the reporter names the outer block.
	f.append(f.event("working", 2, { name: "two", session: "s2", pid: 18, mux: "tern", pane: "3440268804099" }));
	await f.tailer.poke();
	equal(fs.readFileSync(f.rules, "utf8"), text);
	deepStrictEqual([f.observed().one.phase, f.observed().two.phase], ["working", "working"], "both events still reached their watch");
	f.append(f.event("working", 3, { name: "two", session: "s2", pid: 18, mux: "tmux", pane: "%9" }));
	await f.tailer.poke();
	deepStrictEqual(YAML.parse(fs.readFileSync(f.rules, "utf8")).agent_watch.map((a) => a.pane), ["work:1.0", "%9"], "a tmux pane id follows the session");
}));

await check("an event of another session under the same name does not reach a live watch; a gone watch's name takes it", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("working", 1));
	await f.tailer.poke();
	// A second launch with WAYNE_AGENT_WATCH=one: another process, another session.
	const other = { pid: 99, session: "other" };
	f.append(f.event("started", 2, other));
	f.append(f.event("ask", 3, { ...other, ask: { kind: "ask", question: "Not yours?" } }));
	f.append(f.event("result", 4, { ...other, text: "not this watch's", result: { status: "done", path: "/x", version: "9".repeat(16) } }));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [], "no row, so no plan of the watch fires");
	deepStrictEqual([f.observed().one.phase, f.observed().one.agent], ["working", { pid: 17, session: "session", sessionFile: "", cwd: "" }]);
	equal(f.offset(), fs.statSync(f.file).size, "dropped, nothing held");
	deepStrictEqual(f.warnings, []);
	// The probe saw no agent left in the pane: the name is free for the session that reports under it next.
	const records = path.join(f.dir, "cursors", "agents.json");
	const state = JSON.parse(fs.readFileSync(records, "utf8"));
	state.watches.one.phase = "gone";
	fs.writeFileSync(records, JSON.stringify(state));
	f.append(f.event("idle", 5, { ...other, text: "relaunched" }));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:other:idle:5"]);
	deepStrictEqual([f.observed().one.phase, f.observed().one.agent.session], ["idle", "other"]);
	f.append(f.event("idle", 6, { text: "the first session, late" }));
	await f.tailer.poke();
	equal(f.rows.size, 1, "the first session is not the watch's any more");
}));

await check("a watch reaches its session whatever name the session reports under", () => withFixture(async (f) => {
	await f.start();
	// `inbox agent add` bound the watch to the session it found in the pane; that session was started with no name.
	fs.mkdirSync(path.join(f.dir, "cursors"), { recursive: true });
	fs.writeFileSync(path.join(f.dir, "cursors", "agents.json"), JSON.stringify({ watches: { one: { phase: "working", at: 0, by: "probe", agent: { pid: 17, session: "session", sessionFile: "/s.jsonl", cwd: "/w" } } } }));
	f.append(f.event("idle", 1, { name: "", text: "unnamed session" }));
	f.append(f.event("idle", 2, { name: "", session: "elsewhere", pid: 5, text: "an unwatched pane session" }));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:session:idle:1"]);
	deepStrictEqual(f.observed().one.agent, { pid: 17, session: "session", sessionFile: "/s.jsonl", cwd: "/w" }, "what the probe knew of the session is kept");
}));

// Field report 11-18 (engai-hld-research #1514, artifact-viewers #1517): --host watches on trace-srdc, whose reporter
// clone is an older one (no pane, no launch id), sent heartbeats from launch on and were still reported as never started.
await check("an old reporter's events (no pane, no launch id) reach a --host watch by its name", () => {
	let stdout;
	return withFixture(async (f) => {
		await f.start([{ ...f.watched("one", "wayne@trace-srdc"), generation: "hld-1", stamped: true }]);
		const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
		stdout.write("#start 0 1\n");
		await settle();
		for (let i = 1; i <= 12; i++) {
			f.advance(60_000);
			stdout.write(`${JSON.stringify(f.event(i === 1 ? "started" : "hb", i))}\n`);
			await settle();
			await f.tailer.tick();
		}
		deepStrictEqual([...f.rows.values()].filter((row) => fields(row).includes("event=dead")), []);
		equal(f.observed().one?.by, "event", "the remote stream's events reach the watch of their name");
		deepStrictEqual(f.observed().one.agent, { pid: 17, session: "session", sessionFile: "", cwd: "" }, "and bind it to their session");
	}, { spawn: () => {
		const child = new EventEmitter();
		child.stdout = stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
		return child;
	} });
});

await check("each RESULT version makes its row; the same version again does not; an exit makes no row", () => withFixture(async (f) => {
	await f.start();
	const partial = (seq, open, text) => f.event("result", seq, { text, result: { status: "partial", path: "/r", open, version: String(seq === 2 ? 1 : seq).padStart(16, "0") } });
	f.append(partial(1, "confirm TRACE_PUBLIC_URL in prod .env", "waiting"));
	f.append(partial(2, "confirm TRACE_PUBLIC_URL in prod .env", "still waiting, other words"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:session:idle:2"], "the same version again is a no-result row");
	match(arg([...f.rows.values()][0], "--note"), /Open: confirm TRACE_PUBLIC_URL in prod \.env\./);
	equal(arg([...f.rows.values()][1], "--note"), "turn ended with no new RESULT. Last output: still waiting, other words");
	f.append(partial(3, "decide the #830 rollout switch", "new blocker"));
	f.append(f.event("ask", 4, { ask: { kind: "ask", question: "Go?", options: ["yes", "no"] } }));
	f.append(f.event("ask", 5, { ask: { kind: "ask", question: "Go?", options: ["yes", "no"] } }));
	f.append(f.event("ended", 6));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:session:idle:2", "agents:one:result:0000000000000003", "agents:one:ask:session:4", "agents:one:ask:session:5"]);
}));

await check("ssh gets a validated host after -- and rejects an option-shaped host", () => {
	const calls = [];
	return withFixture(async (f) => {
		f.writeRules([{ name: "one", host: "user@host-a", mux: "tern", pane: "one", since: "2026-11-12 00:00" }]);
		f.tailer.start();
		await f.tailer.poke();
		ok(calls[0][1].includes("--") && calls[0][1].at(-2) === "user@host-a");
		f.writeRules([{ name: "bad", host: "-oProxyCommand=evil", mux: "tern", pane: "bad" }]);
		await f.tailer.poke();
		ok(f.warnings.some((w) => /bad ssh host/.test(w)));
	}, { spawn: (cmd, args) => { calls.push([cmd, args]); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; return child; } });
});

await check("a repeated turn end of the same RESULT version is one result row and one no-result row", () => withFixture(async (f) => {
	await f.start();
	const event = f.event("result", 7, { text: "same", result: { status: "done", path: "/r", version: "0000000000000007" } });
	f.append(event); f.append({ ...event, seq: 8 });
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000007", "agents:one:session:idle:8"]);
	deepStrictEqual(fields([...f.rows.values()][1]).slice(0, 2), ["event=idle", "state=no-result"]);
	equal(f.calls.filter((call) => call[0] === "add").length, 3, "the second turn end: the version is seen, then exactly one no-result add");
}));

// Field report 11-18 (layerfs-impl #1543/#1545): srdc's old reporter sent `result` events, with no version, mid-turn
// while every RESULT*.md was unchanged since 11-16; each made a result card and fired the plan.
let unchanged = true;
await check("an old reporter's result event with an unchanged RESULT makes no second result row", () => withFixture(async (f) => {
	await f.start();
	const old = (seq) => f.event("result", seq, { generation: undefined, text: "", result: { status: "done", path: "/r/RESULT.md" } });
	f.append(old(1));
	f.append(old(2));
	f.append(old(3));
	await f.tailer.poke();
	const results = [...f.rows.values()].filter((row) => fields(row).includes("event=result"));
	deepStrictEqual(results.map((row) => arg(row, "--key")), ["agents:one:result:5c0c42e3ea1fedce"], "one row for the one version, however many result events");
	f.append(old(4));
	unchanged = false;
	await f.tailer.poke();
	deepStrictEqual([...f.rows.values()].filter((row) => fields(row).includes("event=result")).map((row) => arg(row, "--key")).at(-1), "agents:one:result:00000000000000aa", "a changed file is a new result");
}, { result: async () => ({ version: unchanged ? "5c0c42e3ea1fedce" : "00000000000000aa", status: "done", open: "", mtime: 0 }) }));

await check("heartbeat and activity events add no row; activity moves the record", () => withFixture(async (f) => {
	await f.start();
	for (const [i, type] of ["hb", "working", "started", "ask-resolved"].entries()) f.append(f.event(type, i));
	await f.tailer.poke();
	equal(f.rows.size, 0);
	const seen = f.observed().one;
	deepStrictEqual([seen.phase, seen.by, seen.agent], ["working", "event", { pid: 17, session: "session", sessionFile: "", cwd: "" }]);
}));

await check("partial UTF-8 line waits for its newline", () => withFixture(async (f) => {
	await f.start();
	const bytes = Buffer.from(`${JSON.stringify(f.event("idle", 1, { text: "你好" }))}\n`);
	const split = bytes.indexOf(Buffer.from("你好")) + 1;
	f.append(bytes.subarray(0, split));
	await f.tailer.poke();
	equal(f.rows.size, 0);
	equal(f.offset(), 0);
	f.append(bytes.subarray(split));
	await f.tailer.poke();
	equal(f.rows.size, 1);
	match(arg([...f.rows.values()][0], "--note"), /你好/);
	equal(f.saved().hosts.local.offset, bytes.length);
}));

await check("restart resumes from the persisted byte offset", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("idle", 1, { text: "first" }));
	await f.tailer.poke();
	const offset = f.saved().hosts.local.offset;
	await f.restart();
	equal(f.calls.filter((call) => call[0] === "add").length, 1);
	equal(f.saved().hosts.local.offset, offset);
	f.append(f.event("idle", 2, { text: "second" }));
	await f.tailer.poke();
	equal(f.rows.size, 2);
}));

await check("truncation resets the cursor", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("idle", 1, { text: "x".repeat(500) }));
	await f.tailer.poke();
	fs.writeFileSync(f.file, `${JSON.stringify(f.event("idle", 2, { text: "new" }))}\n`);
	await f.tailer.poke();
	equal(f.rows.size, 2);
	equal(f.saved().hosts.local.offset, fs.statSync(f.file).size);
	ok(f.warnings.some((warning) => warning.includes("truncated")));
}));

await check("failed add leaves the cursor and retries in order", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("idle", 1, { text: "first" }));
	f.append(f.event("idle", 2, { text: "second" }));
	f.fail(true);
	await f.tailer.poke();
	equal(f.rows.size, 0);
	equal(f.offset(), 0);
	match(f.tailer.status(), /ledger unavailable/);
	f.fail(false);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:session:idle:1", "agents:one:session:idle:2"]);
	equal(f.saved().hosts.local.offset, fs.statSync(f.file).size);
}));

await check("a dropped remote stream shows as link down, with ssh's last error, and makes no row", () => withFixture(async (f) => {
	await f.start([f.watched("one", "fakehost")]);
	await f.waitUntil(() => f.tailer.status().includes("fakehost link down"));
	await f.tailer.tick();
	equal(f.rows.size, 0);
	match(f.tailer.describe(), /exit 1: disconnected/);
}, { spawn: () => {
	const child = new EventEmitter();
	child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
	process.nextTick(() => { child.stderr.write("disconnected\n"); child.emit("close", 1, null); });
	return child;
} }));

await check("an event of a name that is not watched is dropped: a later registration gets no row for it", () => withFixture(async (f) => {
	await f.start([f.watched("other")]);
	f.append(f.event("idle", 1, { text: "early" }));
	await f.tailer.poke();
	equal(f.rows.size, 0);
	equal(f.offset(), fs.statSync(f.file).size, "the cursor moves past it");
	await f.restart();
	f.writeRules([f.watched("other"), f.watched("one")]);
	await f.tailer.poke();
	equal(f.rows.size, 0);
	deepStrictEqual(f.observed(), {}, "and no record: the probe is what looks at a session added later");
	deepStrictEqual(f.warnings, []);
}));

await check("unchanged rules are not reread", () => withFixture(async (f) => {
	await f.start();
	let reads = 0;
	const readRules = fs.readFileSync;
	f.tailer.setRulesReader((...args) => { reads += 1; return readRules(...args); });
	await f.tailer.poke();
	await f.tailer.poke();
	equal(reads, 0);
	f.advance(1_000);
	f.writeRules([f.watched("one", "local", "2026-11-09 00:01")]);
	const later = Date.now() / 1000 + 5;
	fs.utimesSync(path.join(f.dir, "rules.yaml"), later, later);
	await f.tailer.poke();
	equal(reads, 1);
}));

await check("the same RESULT version again is a no-result row, not a second result card; an exit makes no row", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer", version: "0000000000000001" } }));
	await f.tailer.poke();
	equal(f.rows.size, 1);
	f.append(f.event("result", 2, { text: "late", result: { status: "done", path: "/answer", version: "0000000000000001" } }));
	f.append(f.event("ended", 3));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:session:idle:2"], "the same version is seen; the exit is no row");
	equal(f.observed().one.phase, "idle", "an exit says no phase: only the probe sees that no agent is left in the pane");
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	equal(f.rows.size, 2, "re-registration does not add a card for events already recorded");
	f.append(f.event("started", 4, { session: "new" }));
	f.append(f.event("ask", 5, { session: "new", ask: { kind: "ask", question: "Again?" } }));
	await f.tailer.poke();
	equal(f.rows.size, 3, "the new session's ask is recorded");
	equal(arg([...f.rows.values()][2], "--key"), "agents:one:ask:new:5");
	equal(f.observed().one.agent.session, "new", "`started` binds the record to the new session");
}));

await check("follow-up sent before re-registration (delegate skill order): its ask arrives on registration", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	// The coordinator sends the follow-up into the same session, which starts a turn and asks, before `agent add`.
	f.append(f.event("working", 2));
	f.append(f.event("ask", 3, { ask: { kind: "ask", question: "Which branch?" } }));
	f.append(f.event("hb", 4));
	await f.tailer.poke();
	equal(f.rows.size, 2, "the follow-up ask is recorded without a re-registration");
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	equal(f.rows.size, 2);
	const row = [...f.rows.values()][1];
	equal(arg(row, "--key"), "agents:one:ask:session:3");
	match(arg(row, "--note"), /Which branch\?/);
	f.append(f.event("result", 5, { text: "again", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	equal(f.rows.size, 3);
	deepStrictEqual(f.calls.filter((c) => c[0] === "agent"), []);
}));

await check("done, follow-up turn and its ask read in one batch: the ask is recorded in that batch", () => withFixture(async (f) => {
	await f.start();
	// One append, one poke: `entries` is not re-read between these lines, so the name is still in memory after `agent close`.
	f.append(
		`${JSON.stringify(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }))}\n` +
		`${JSON.stringify(f.event("working", 2))}\n` +
		`${JSON.stringify(f.event("ask", 3, { ask: { kind: "ask", question: "Which branch?" } }))}\n`,
	);
	await f.tailer.poke();
	equal(f.rows.size, 2, "the ask is recorded in the same batch");
	deepStrictEqual(f.calls.filter((c) => c[0] === "agent"), []);
	equal(f.saved().hosts.local.offset, fs.statSync(f.file).size);
	await f.tailer.poke();
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	equal(f.rows.size, 2);
	const row = [...f.rows.values()][1];
	equal(arg(row, "--key"), "agents:one:ask:session:3");
	match(arg(row, "--note"), /Which branch\?/);
}));

await check("an old run's exit and a new launch under the same name, read after a restart, make no row", () => withFixture(async (f) => {
	// Smoke 2026-11-09: the retired child's `ended` was in the file, unread, when a new child started under the same name.
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	f.tailer.stop();
	f.append(f.event("ended", 2));
	f.advance(1000);
	f.append(f.event("started", 3, { session: "new" }));
	f.writeRules([f.watched("one", "local", f.since())]);
	f.tailer.start();
	await f.tailer.poke();
	equal(f.rows.size, 1, "neither the exit nor the new start is a row");
	equal(f.observed().one.agent.session, "new", "the record is bound to the new session");
	f.append(f.event("ended", 4, { session: "new" }));
	await f.tailer.poke();
	equal(f.rows.size, 1, "an exit is the probe's to report: no agent process in the pane");
}));

await check("a retired name registered again while the coordinator is down: the follow-up's events arrive after restart", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	f.tailer.stop();
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	f.advance(60_000);
	f.append(f.event("working", 2));
	f.append(f.event("ask", 3, { ask: { kind: "ask", question: "Follow-up?" } }));
	f.append(f.event("result", 4, { text: "again", result: { status: "done", path: "/answer" } }));
	f.advance(60_000);
	await f.restart();
	equal(f.rows.size, 3);
	deepStrictEqual([...f.rows.values()].map((row) => fields(row)[0]), ["event=idle", "event=ask", "event=idle"]);
}));

await check("agent-push-smart, reporters with `prompted`: an agent-started continuation after done is not a round; the follow-up's result is", () => withFixture(async (f) => {
	// The sequence of session 01a1c313 as a reporter that marks `working` writes it: 073 was started by an advisor
	// message, not a prompt; 245 by the coordinator's follow-up, typed into the session.
	const name = "agent-push-smart";
	const session = "01a1c313-0982-718e-b686-6bf23cddede2";
	const ev = (type, seq, ts, extra = {}) => f.event(type, 1794274167959000 + seq, { name, session, ts, pid: 4059262, ...extra });
	const done = (seq, ts, text) => ev("result", seq, ts, { text, result: { status: "done", path: "/runs/agent-push-smart/RESULT.md", version: String(seq).padStart(16, "0") } });
	await f.start([f.watched(name, "local", "2026-11-10 09:29:20")]);
	f.append(done(72, "2026-11-10T02:35:33.557Z", "round 1 done"));
	await f.tailer.poke();
	f.append(ev("working", 73, "2026-11-10T02:35:51.384Z", { prompted: false }));
	f.append(done(75, "2026-11-10T02:37:18.461Z", "round 1 done, again"));
	await f.tailer.poke();
	f.writeRules([f.watched(name, "local", "2026-11-10 13:26:19")]);
	await f.tailer.poke();
	equal(f.calls.filter((call) => call[0] === "agent").length, 0, "075 does not remove the watch");
	f.append(ev("working", 245, "2026-11-10T05:26:22.799Z", { prompted: true }));
	f.append(done(247, "2026-11-10T05:26:52.523Z", "retro done"));
	f.append(ev("working", 248, "2026-11-10T05:27:11.014Z", { prompted: false }));
	f.append(done(249, "2026-11-10T05:27:26.268Z", "retro done, again"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [`agents:${name}:result:${"72".padStart(16, "0")}`, `agents:${name}:result:${"75".padStart(16, "0")}`, `agents:${name}:result:${"247".padStart(16, "0")}`, `agents:${name}:result:${"249".padStart(16, "0")}`]);
	equal(f.calls.filter((call) => call[0] === "agent").length, 0, "247 does not remove the watch");
	ok(!f.warnings.some((w) => /seq (1794274167959075|1794274167959249)/.test(w)), "a new version is a row, not a dropped card");
}));

await check("agent-push-smart 2026-11-10, the stream as written (no `prompted`): 075 is dropped loudly and 247 makes its card", () => withFixture(async (f) => {
	// The non-heartbeat events of session 01a1c313 from ~/.wayne/inbox/agent-events.jsonl, unchanged but for `text` and
	// `sessionFile` (left out: no rule reads them). Before the fix, 075 became card #394 on re-registration and retired
	// the name, and 247 was held forever with no card and no warning.
	const name = "agent-push-smart";
	const session = "00000000-0000-4000-8000-000000000001";
	const result = (seq) => ({ path: "/tmp/demo/RESULT.md", status: "done", version: String(seq).padStart(16, "0") });
	const real = (seq, type, ts) => ({ v: 1, ts, name, host: "example-host", pid: 1001, session, seq: 1794274167959000 + seq, type, ...(type === "result" ? { result: result(seq) } : {}) });
	const key = (seq) => `agents:${name}:result:${String(seq).padStart(16, "0")}`;
	await f.start([f.watched(name, "local", "2026-11-10 09:29:20")]);
	f.append(real(62, "working", "2026-11-10T02:26:58.181Z"));
	f.append(real(72, "result", "2026-11-10T02:35:33.557Z"));
	await f.tailer.poke();
	f.append(real(73, "working", "2026-11-10T02:35:51.384Z"));
	f.append(real(75, "result", "2026-11-10T02:37:18.461Z"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72), key(75)], "an unprompted working starts a new round");
	// The coordinator registers the name again for its follow-up (05:26:19Z), before the follow-up's first event.
	f.writeRules([f.watched(name, "local", "2026-11-10 13:26:19")]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72), key(75)], "075 stays a card; the re-registration does not drop it");
	equal(f.calls.filter((call) => call[0] === "agent").length, 0, "075 does not remove the watch");
	ok(!f.warnings.some((w) => w.includes(`seq ${1794274167959075}`)), "075 is a card, not a drop");
	f.append(real(245, "working", "2026-11-10T05:26:22.799Z"));
	f.append(real(247, "result", "2026-11-10T05:26:52.523Z"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72), key(75), key(247)], "247 makes its card");
	equal(f.calls.filter((call) => call[0] === "agent").length, 0, "247 does not remove the watch");
	f.append(real(248, "working", "2026-11-10T05:27:11.014Z"));
	f.append(real(249, "result", "2026-11-10T05:27:26.268Z"));
	await f.tailer.poke();
	// 249 is held like 075 was: a registration would drop it with a warning, as above.
	deepStrictEqual([...f.rows.keys()], [key(72), key(75), key(247), key(249)], "249 is the follow-up's second result, so it is a card");
	f.advance(1000);
	f.writeRules([f.watched(name, "local", f.since())]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72), key(75), key(247), key(249)], "249 is a card");
	ok(!f.warnings.some((w) => w.includes(`seq ${1794274167959249}`)), "249 is a card, not a drop");
}));

await check("no `prompted`: a follow-up whose result repeats the retiring one still makes its card when it asked first", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer", version: "0000000000000001" } }));
	await f.tailer.poke();
	f.append(f.event("working", 2));
	f.append(f.event("ask", 3, { ask: { kind: "ask", question: "Which branch?" } }));
	f.append(f.event("result", 4, { text: "again", result: { status: "done", path: "/answer", version: "0000000000000004" } }));
	await f.tailer.poke();
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:ask:session:3", "agents:one:result:0000000000000004"]);
	equal(f.warnings.length, 0);
}));

await check("a prompted follow-up that finishes before re-registration still makes its cards", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer", version: "0000000000000001" } }));
	await f.tailer.poke();
	// The same shape as 073-075 above, but the coordinator's prompt started it: [working, ask, result done], all before `agent add`.
	f.append(f.event("working", 2, { prompted: true }));
	f.append(f.event("ask", 3, { ask: { kind: "ask", question: "Which branch?" } }));
	f.append(f.event("result", 4, { text: "again", result: { status: "done", path: "/answer", open: "none", version: "0000000000000004" } }));
	await f.tailer.poke();
	equal(f.rows.size, 3, "the follow-up is recorded as it happens");
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:ask:session:3", "agents:one:result:0000000000000004"]);
	equal(f.calls.filter((call) => call[0] === "agent").length, 0);
	equal(f.warnings.length, 0);
}));

await check("invalid lines advance but corrupt cursors fail startup", () => withFixture(async (f) => {
	await f.start();
	f.append("bad json\n");
	f.append({ v: 2, name: "one" });
	f.append(f.event("idle", 1));
	await f.tailer.poke();
	equal(f.rows.size, 1);
	equal(f.saved().hosts.local.offset, fs.statSync(f.file).size);
	equal(f.warnings.length, 2);
	f.tailer.stop();
	fs.writeFileSync(f.cursor, "not JSON");
	throws(() => f.tailer.start(), SyntaxError);
}));

await check("real ssh child reconnects from the advanced byte offset", () => withFixture(async (f) => {
	const oldPath = process.env.PATH;
	const oldFixture = process.env.AGENT_TEST_FIXTURE;
	const oldLog = process.env.AGENT_TEST_LOG;
	try {
		const bin = path.join(f.dir, "bin");
		const log = path.join(f.dir, "ssh.log");
		const data = path.join(f.dir, "remote.jsonl");
		fs.mkdirSync(bin);
		fs.writeFileSync(path.join(bin, "ssh"), '#!/bin/sh\nfor arg do cmd=$arg; done\no=${cmd#*" o="}; o=${o%%;*}\nprintf "%s\\n" "$o" >> "$AGENT_TEST_LOG"\nprintf "#start %s 1\\n" "$o"\ntail -c "+$((o+1))" "$AGENT_TEST_FIXTURE"\n', { mode: 0o755 });
		const line = `${JSON.stringify(f.event("idle", 9, { text: "remote \u4e2d\u6587" }))}\n`;
		fs.writeFileSync(data, line);
		process.env.PATH = `${bin}:${oldPath}`;
		process.env.AGENT_TEST_FIXTURE = data;
		process.env.AGENT_TEST_LOG = log;
		f.tailer.stop();
		f.tailer = new AgentTailer({ dir: f.dir, inbox: f.inbox, now: () => f.clock, backoffMs: 25, warn: (message) => f.warnings.push(message), onChange: () => f.changes.emit("change") });
		await f.start([f.watched("one", "fakehost")]);
		await f.waitUntil(() => fs.existsSync(log) && fs.readFileSync(log, "utf8").trim().split("\n").length >= 2 && f.tailer.status().includes("link down"));
		const offsets = fs.readFileSync(log, "utf8").trim().split("\n").map(Number);
		deepStrictEqual(offsets.slice(0, 2), [0, Buffer.byteLength(line)]);
		equal(f.rows.size, 1);
	} finally {
		if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
		if (oldFixture === undefined) delete process.env.AGENT_TEST_FIXTURE; else process.env.AGENT_TEST_FIXTURE = oldFixture;
		if (oldLog === undefined) delete process.env.AGENT_TEST_LOG; else process.env.AGENT_TEST_LOG = oldLog;
	}
}, { backoffMs: 25 }));

await check("readEntries reads the supplied rules text and no file; an entry with no host is local", () => {
	const text = YAML.stringify({ agent_watch: [{ name: "one", mux: "tern", pane: "1", host: "", push: true, generation: "one" }] });
	deepStrictEqual(readEntries(text).map((entry) => [entry.name, entry.host]), [["one", "local"]]);
	deepStrictEqual(readEntries(""), []);
});

process.exit(failed === 0 ? 0 : 1);
