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
		if (args[0] === "agent") {
			const generation = args.includes("--generation") ? args[args.indexOf("--generation") + 1] : undefined;
			const name = args[2];
			if (!tailer.entries.some((entry) => entry.name === name && (!generation || entry.generation === generation))) throw new Error(`not watched: ${name}`);
			const next = tailer.entries.filter((entry) => !(entry.name === name && (!generation || entry.generation === generation)));
			writeRules(next);
			tailer.entries = next;
			return "stopped";
		}
		if (failAdd) throw new Error("ledger unavailable");
		const key = args[args.indexOf("--key") + 1];
		if (rows.has(key)) return "seen";
		rows.set(key, [...args]);
		return `do ${rows.size} tag`;
	};
	const opts = { dir, inbox, now: () => clock, warn: (message) => warnings.push(message), onChange: () => { changeCount += 1; changes.emit("change"); }, ...extra };
	let tailer = new AgentTailer(opts);
	const watched = (name = "one", host = "local", since = "2026-11-09 00:00", generation = "11111111-1111-4111-8111-111111111111") => ({ name, host, since, generation, mux: "tern", pane: name, push: true });
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

await check("a legacy push registration migrates on first start and stays after a done result", () => withFixture(async (f) => {
	const legacy = f.watched();
	delete legacy.generation;
	fs.writeFileSync(f.rules, YAML.stringify({ agent_watch: [legacy] }));
	f.tailer.start();
	await f.tailer.poke();
	ok(f.tailer.entries[0].generation);
	f.append(f.event("result", 1, { text: "finished", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	ok(f.tailer.entries.length === 1, "a done RESULT leaves the migrated registration");
}));

await check("an old session's first result after a re-registration keeps the replacement", () => withFixture(async (f) => {
	await f.start([{ ...f.watched(), generation: "old" }]);
	f.append(f.event("working", 1));
	await f.tailer.poke();
	f.writeRules([{ ...f.watched(), generation: "new", since: "2026-11-09 00:01" }]);
	await f.tailer.poke();
	f.append(f.event("result", 2, { text: "old round", result: { status: "done", path: "/old" } }));
	await f.tailer.poke();
	deepStrictEqual(f.tailer.entries.map((e) => e.generation), ["new"]);
	deepStrictEqual(f.calls.filter((c) => c[0] === "agent" && c[1] === "rm"), []);
}));

await check("a follow-up prompt to the old session after a re-registration belongs to the replacement", () => withFixture(async (f) => {
	await f.start([{ ...f.watched(), generation: "old" }]);
	f.append(f.event("working", 1));
	await f.tailer.poke();
	f.writeRules([{ ...f.watched(), generation: "new", since: "2026-11-09 00:01" }]);
	await f.tailer.poke();
	f.append(f.event("working", 2, { prompted: true }));
	f.append(f.event("result", 3, { text: "follow-up", result: { status: "done", path: "/new" } }));
	await f.tailer.poke();
	deepStrictEqual(f.calls.filter((c) => c[0] === "agent" && c[1] === "rm"), [], "the follow-up is recorded without removing the replacement");
}));

await check("a late result from a replaced launch neither records a row nor removes the replacement", () => withFixture(async (f) => {
	// The inbox never saw the old launch report before it was replaced: only the event's own generation says whose it is.
	await f.start([{ ...f.watched(), generation: "launch-new" }]);
	f.append(f.event("result", 1, { generation: "launch-old", text: "old round", result: { status: "done", path: "/old" } }));
	await f.tailer.poke();
	deepStrictEqual(f.tailer.entries.map((e) => e.generation), ["launch-new"]);
	deepStrictEqual(f.calls.filter((c) => c[0] === "agent"), [], "the replacement is not removed");
	deepStrictEqual([...f.rows.keys()], [], "no row, so no plan of the replacement fires");
}));

await check("a stamped registration takes events with no generation and its own, never another launch's", () => withFixture(async (f) => {
	await f.start([{ ...f.watched(), generation: "launch-new", stamped: true }]);
	f.append(f.event("result", 1, { text: "unstamping reporter", result: { status: "done", path: "/old" } }));
	f.append(f.event("result", 2, { generation: "launch-new", text: "mine", result: { status: "done", path: "/new" } }));
	f.append(f.event("result", 3, { generation: "launch-old", text: "replaced launch", result: { status: "done", path: "/x" } }));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:launch-new:session:1", "agents:one:launch-new:session:2"]);
}));

// Field report 11-18 (engai-hld-research #1514, artifact-viewers #1517): stamped --host registrations on trace-srdc,
// whose reporter clone predates generations, sent heartbeats from launch on and were still reported as never started.
await check("a stamped --host registration whose first event arrives after registration is never reported as never started", () => {
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
		equal(f.observed().one?.by, "event", "the remote stream's unstamped events reach the stamped watch");
	}, { spawn: () => {
		const child = new EventEmitter();
		child.stdout = stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
		return child;
	} });
});

await check("a launch removed after its RESULT and added again in the same second is watched again", () => withFixture(async (f) => {
	// Same name, same --generation, same second: only the registration's own instance id tells the two adds apart.
	const entry = { ...f.watched(), generation: "launch-0001", stamped: true, instance: "first-add" };
	await f.start([entry]);
	f.append(f.event("result", 1, { generation: "launch-0001", text: "round one", result: { status: "done", path: "/r" } }));
	await f.tailer.poke();
	deepStrictEqual(f.tailer.entries.map((e) => e.instance), ["first-add"], "round one's done leaves the registration");
	f.writeRules([{ ...entry, instance: "second-add" }]);
	await f.tailer.poke();
	// The follow-up prompt starts round two in the same session.
	f.append(f.event("working", 2, { generation: "launch-0001", prompted: true }));
	f.append(f.event("result", 3, { generation: "launch-0001", text: "round two", result: { status: "done", path: "/r" } }));
	await f.tailer.poke();
	ok(f.rows.has("agents:one:launch-0001:session:3"), [...f.rows.keys()].join(" "));
	equal(f.calls.filter((c) => c[0] === "agent").length, 0, "neither round removes the registration");
}));

await check("a late result from the session that retired the old registration keeps the re-registration", () => withFixture(async (f) => {
	const first = { ...f.watched(), generation: "old" };
	await f.start([first]);
	let release;
	const held = new Promise((resolve) => { release = resolve; });
	const add = f.tailer.add.bind(f.tailer);
	f.tailer.add = async (...args) => { await held; return add(...args); };
	f.append(f.event("result", 1, { text: "finished", result: { status: "done", path: "/answer" } }));
	const running = f.tailer.poke();
	await new Promise((resolve) => setTimeout(resolve, 20));
	f.writeRules([{ ...f.watched(), generation: "new", since: "2026-11-09 00:01" }]);
	release();
	await running;
	f.tailer.add = add;
	f.append(f.event("result", 2, { text: "late", result: { status: "done", path: "/late" } }));
	await f.tailer.poke();
	deepStrictEqual(f.tailer.entries.map((e) => e.generation), ["new"]);
	deepStrictEqual(f.calls.filter((c) => c[0] === "agent" && c[1] === "rm"), []);
}));

await check("each RESULT version makes its row; the same version again does not; an exit makes no row", () => withFixture(async (f) => {
	await f.start();
	const partial = (seq, open, text) => f.event("result", seq, { text, result: { status: "partial", path: "/r", open, version: String(seq === 2 ? 1 : seq).padStart(16, "0") } });
	f.append(partial(1, "confirm TRACE_PUBLIC_URL in prod .env", "waiting"));
	f.append(partial(2, "confirm TRACE_PUBLIC_URL in prod .env", "still waiting, other words"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:11111111-1111-4111-8111-111111111111:session:2"], "the same version again is a no-result row");
	match(arg([...f.rows.values()][0], "--note"), /Open: confirm TRACE_PUBLIC_URL in prod \.env\./);
	equal(arg([...f.rows.values()][1], "--note"), "turn ended with no new RESULT. Last output: still waiting, other words");
	f.append(partial(3, "decide the #830 rollout switch", "new blocker"));
	f.append(f.event("ask", 4, { ask: { kind: "ask", question: "Go?", options: ["yes", "no"] } }));
	f.append(f.event("ask", 5, { ask: { kind: "ask", question: "Go?", options: ["yes", "no"] } }));
	f.append(f.event("ended", 6));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:11111111-1111-4111-8111-111111111111:session:2", "agents:one:result:0000000000000003", "agents:one:ask:session:4", "agents:one:ask:session:5"]);
}));

await check("ssh gets a validated host after -- and rejects an option-shaped host", () => {
	const calls = [];
	return withFixture(async (f) => {
		f.writeRules([{ name: "one", host: "user@host-a", mux: "tern", pane: "one", push: true, since: "2026-11-12 00:00" }]);
		f.tailer.start();
		await f.tailer.poke();
		ok(calls[0][1].includes("--") && calls[0][1].at(-2) === "user@host-a");
		f.writeRules([{ name: "bad", host: "-oProxyCommand=evil", mux: "tern", pane: "bad", push: true }]);
		await f.tailer.poke();
		ok(f.warnings.some((w) => /bad ssh host/.test(w)));
	}, { spawn: (cmd, args) => { calls.push([cmd, args]); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; return child; } });
});

await check("a repeated turn end of the same RESULT version is one result row and one no-result row", () => withFixture(async (f) => {
	await f.start();
	const event = f.event("result", 7, { text: "same", result: { status: "done", path: "/r", version: "0000000000000007" } });
	f.append(event); f.append({ ...event, seq: 8 });
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000007", "agents:one:11111111-1111-4111-8111-111111111111:session:8"]);
	deepStrictEqual(fields([...f.rows.values()][1]).slice(0, 2), ["event=idle", "state=no-result"]);
	equal(f.calls.filter((call) => call[0] === "add").length, 3, "the second turn end: the version is seen, then exactly one no-result add");
}));

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
	deepStrictEqual([...f.rows.keys()], ["agents:one:11111111-1111-4111-8111-111111111111:session:1", "agents:one:11111111-1111-4111-8111-111111111111:session:2"]);
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
	deepStrictEqual([...f.rows.keys()], ["agents:one:result:0000000000000001", "agents:one:11111111-1111-4111-8111-111111111111:session:2"], "the same version is seen; the exit is no row");
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

await check("readEntries uses the supplied rules text and directory", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-read-entries-"));
	const saved = process.env.WAYNE_INBOX_DIR;
	process.env.WAYNE_INBOX_DIR = dir;
	try {
		fs.writeFileSync(path.join(dir, "rules.yaml"), YAML.stringify({ agent_watch: [{ name: "other", mux: "tern", pane: "1", host: "local", push: true, generation: "other" }] }));
		const text = YAML.stringify({ agent_watch: [{ name: "one", mux: "tern", pane: "1", host: "", push: true, generation: "one" }] });
		deepStrictEqual(readEntries(text, dir).map((entry) => entry.name), ["one"]);
		equal(readEntries(text, dir)[0].host, "local");
	} finally {
		if (saved === undefined) delete process.env.WAYNE_INBOX_DIR; else process.env.WAYNE_INBOX_DIR = saved;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

process.exit(failed === 0 ? 0 : 1);
