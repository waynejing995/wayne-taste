import assert, { deepStrictEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import YAML from "yaml";
import { AgentTailer } from "../agents.ts";
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
			if (!entries.some((entry) => entry.name === name && (!generation || entry.generation === generation))) throw new Error(`not watched: ${name}`);
			writeRules(entries.filter((entry) => !(entry.name === name && (!generation || entry.generation === generation))));
			tailer.entries = entries;
			return "stopped";
		}
		if (failAdd) throw new Error("ledger unavailable");
		const key = args[args.indexOf("--key") + 1];
		if (rows.has(key)) return "seen";
		rows.set(key, [...args]);
		return `do ${rows.size} tag`;
	};
	const opts = { dir, inbox, now: () => clock, deadSec: 300, warn: (message) => warnings.push(message), onChange: () => changes.emit("change"), ...extra };
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
		dir, rules, file, cursor, rows, calls, warnings, changes, watched, event, append, start, restart, writeRules, waitUntil, inbox, clock,
		get tailer() { return tailer; }, set tailer(value) { tailer = value; },
		advance(ms) { clock += ms; },
		/** The `since` `inbox agent add` writes now (Asia/Shanghai, to the second). */
		since() { return new Date(clock + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " "); },
		fail(value) { failAdd = value; },
		saved() { return JSON.parse(fs.readFileSync(cursor, "utf8")); },
		close() { tailer.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
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

await check("ask maps question, options, goal and fields", () => withFixture(async (f) => {
	await f.start([{ ...f.watched(), goal: "ship safely", result: "/result" }]);
	f.append(f.event("ask", 1, { ask: { kind: "ask", question: "Choose?", options: ["yes", "no"] } }));
	await f.tailer.poke();
	const row = [...f.rows.values()][0];
	equal(arg(row, "--key"), "agents:one:session:1");
	equal(arg(row, "--subject"), "agent one");
	equal(arg(row, "--note"), "waiting on ask: Choose? [options: yes | no]. Goal: ship safely");
	equal(arg(row, "--link"), "/result");
	deepStrictEqual(fields(row), ["event=ask", "state=ask", "mux=tern", "host=local"]);
}));

await check("idle and done result map output and remove watch", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("idle", 1, { text: "clipped last text" }));
	f.append(f.event("result", 2, { text: "finished", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	const [idle, result] = [...f.rows.values()];
	equal(arg(idle, "--note"), "turn ended with no RESULT. Last output: clipped last text");
	deepStrictEqual(fields(idle).slice(0, 2), ["event=idle", "state=no-result"]);
	equal(arg(result, "--note"), "RESULT status: done. Last output: finished");
	equal(arg(result, "--link"), "/answer");
	const generation = f.calls.at(-1)?.[4];
	assert.match(generation, /^[0-9a-f-]{36}$/);
	deepStrictEqual(f.calls.at(-1), ["agent", "rm", "one", "--generation", generation]);
	equal(f.saved().names.one.status, "done");
}));

await check("a legacy push registration is removed on completion", () => withFixture(async (f) => {
	const legacy = f.watched();
	delete legacy.generation;
	f.writeRules([legacy]);
	const saved = process.env.WAYNE_INBOX_DIR;
	process.env.WAYNE_INBOX_DIR = f.dir;
	const migrated = readAgents()[0];
	if (saved === undefined) delete process.env.WAYNE_INBOX_DIR; else process.env.WAYNE_INBOX_DIR = saved;
	await f.start([legacy]);
	f.writeRules([migrated]);
	f.tailer.entries = [migrated];
	f.append(f.event("result", 1, { text: "finished", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	ok(f.calls.at(-1)?.[4] === migrated.generation);
	deepStrictEqual(f.tailer.entries, []);
}));
await check("a re-registration survives result cleanup", () => withFixture(async (f) => {
	const first = { ...f.watched(), generation: "old" };
	await f.start([first]);
	let release;
	const held = new Promise((resolve) => { release = resolve; });
	f.tailer.add = async () => held;
	f.append(f.event("result", 1, { text: "finished", result: { status: "done", path: "/answer" } }));
	const running = f.tailer.poke();
	await new Promise((resolve) => setTimeout(resolve, 20));
	const next = { ...f.watched(), generation: "new", since: "2026-11-09 00:01" };
	f.writeRules([next]);
	release();
	await running;

	equal(f.saved().names.one.generation, "new");
	equal(f.saved().names.one.removed, undefined);
	equal(f.saved().names.one.state, "registered");
	equal(f.saved().names.one.session, undefined);
	equal(f.saved().names.one.status, undefined);
}));

await check("an unchanged status makes no second card; a changed one does", () => withFixture(async (f) => {
	await f.start();
	const partial = (seq, open, text) => f.event("result", seq, { text, result: { status: "partial", path: "/r", open } });
	f.append(partial(1, "confirm TRACE_PUBLIC_URL in prod .env", "waiting"));
	f.append(partial(2, "confirm TRACE_PUBLIC_URL in prod .env", "still waiting, other words"));
	await f.tailer.poke();
	equal(f.rows.size, 1);
	match(arg([...f.rows.values()][0], "--note"), /Open: confirm TRACE_PUBLIC_URL in prod \.env\./);
	f.append(partial(3, "decide the #830 rollout switch", "new blocker"));
	f.append(f.event("ask", 4, { ask: { kind: "ask", question: "Go?", options: ["yes", "no"] } }));
	f.append(f.event("ask", 5, { ask: { kind: "ask", question: "Go?", options: ["yes", "no"] } }));
	f.append(f.event("ended", 6));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:session:1", "agents:one:session:3", "agents:one:session:4", "agents:one:session:6"]);
	ok(f.warnings.some((w) => w.includes("seq 2 repeats")), "the skipped card is logged");
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

await check("duplicate sequence is deduplicated", () => withFixture(async (f) => {
	await f.start();
	const event = f.event("idle", 7, { text: "same" });
	f.append(event); f.append(event);
	await f.tailer.poke();
	equal(f.rows.size, 1);
	equal(f.calls.filter((call) => call[0] === "add").length, 1);
}));

await check("heartbeat and activity events do not add rows", () => withFixture(async (f) => {
	await f.start();
	for (const [i, type] of ["hb", "working", "started", "ask-resolved"].entries()) f.append(f.event(type, i));
	await f.tailer.poke();
	equal(f.rows.size, 0);
	equal(f.saved().names.one.state, "ask-resolved");
}));

await check("partial UTF-8 line waits for its newline", () => withFixture(async (f) => {
	await f.start();
	const bytes = Buffer.from(`${JSON.stringify(f.event("idle", 1, { text: "你好" }))}\n`);
	const split = bytes.indexOf(Buffer.from("你好")) + 1;
	f.append(bytes.subarray(0, split));
	await f.tailer.poke();
	equal(f.rows.size, 0);
	equal(f.saved().hosts.local.offset, 0);
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
	equal(f.saved().hosts.local.offset, 0);
	match(f.tailer.status(), /ledger unavailable/);
	f.fail(false);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:session:1", "agents:one:session:2"]);
	equal(f.saved().hosts.local.offset, fs.statSync(f.file).size);
}));

await check("heartbeat expiry emits exactly one dead row", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("working", 1));
	await f.tailer.poke();
	f.advance(301_000);
	await f.tailer.tick();
	await f.tailer.tick();
	equal(f.rows.size, 1);
	const row = [...f.rows.values()][0];
	deepStrictEqual(fields(row).slice(0, 2), ["event=dead", "state=no-heartbeat"]);
	match(arg(row, "--note"), /^no heartbeat for 301 s \(last event working at /);
}));

await check("link down suppresses remote death", () => withFixture(async (f) => {
	await f.start([f.watched("one", "fakehost")]);
	await f.waitUntil(() => f.tailer.status().includes("fakehost link down"));
	f.advance(900_000);
	await f.tailer.tick();
	equal(f.rows.size, 0);
	match(f.tailer.describe(), /exit 1: disconnected/);
}, { spawn: () => {
	const child = new EventEmitter();
	child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
	process.nextTick(() => { child.stderr.write("disconnected\n"); child.emit("close", 1, null); });
	return child;
} }));

await check("never-started registration produces a diagnostic", () => withFixture(async (f) => {
	await f.start();
	f.advance(301_000);
	await f.tailer.tick();
	const row = [...f.rows.values()][0];
	deepStrictEqual(fields(row).slice(0, 2), ["event=dead", "state=never-started"]);
	match(arg(row, "--note"), /reporter never started .*not linked on local/);
}));

await check("heartbeat keeps a running reporter alive", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("working", 1));
	await f.tailer.poke();
	f.advance(290_000);
	f.append(f.event("hb", 2));
	await f.tailer.poke();
	f.advance(20_000);
	await f.tailer.tick();
	equal(f.rows.size, 0);
}));

await check("events before registration survive restart and replay", () => withFixture(async (f) => {
	await f.start([f.watched("other")]);
	f.append(f.event("idle", 1, { text: "early" }));
	await f.tailer.poke();
	equal(f.rows.size, 0);
	equal(f.saved().names.one.pending.length, 1);
	await f.restart();
	f.writeRules([f.watched("other"), f.watched("one")]);
	await f.tailer.poke();
	equal(f.rows.size, 1);
	match(arg([...f.rows.values()][0], "--note"), /early/);
	equal(f.saved().names.one.pending, undefined);
}));

await check("a pending done result replayed on registration retires the session cleanly", () => withFixture(async (f) => {
	await f.start([f.watched("other")]);
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	f.append(f.event("idle", 2, { text: "after" }));
	await f.tailer.poke();
	equal(f.rows.size, 0);
	f.writeRules([f.watched("other"), f.watched("one")]);
	await f.tailer.poke();
	equal(f.rows.size, 1);
	deepStrictEqual(f.calls.at(-1), ["agent", "rm", "one", "--generation", "11111111-1111-4111-8111-111111111111"]);
	equal(f.saved().names.one.removed, true);
	equal(f.saved().names.one.pending, undefined);
	equal(f.tailer.status().includes("pending"), false);
	deepStrictEqual(f.warnings, ["one: idle seq 2 belongs to the round that retired the name at seq 1; not added"]);
}));

await check("a finished session is not recorded again after rm; re-registration starts clean", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	equal(f.rows.size, 1);
	deepStrictEqual(f.calls.at(-1), ["agent", "rm", "one", "--generation", "11111111-1111-4111-8111-111111111111"]);
	// The finished run settling again (a late agent_end, then its exit) is not a follow-up: no turn started.
	f.append(f.event("result", 2, { text: "late", result: { status: "done", path: "/answer" } }));
	f.append(f.event("ended", 3));
	await f.tailer.poke();
	equal(f.rows.size, 1);
	equal(f.saved().names.one.removed, true);
	equal(f.saved().names.one.pending, undefined);
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	equal(f.rows.size, 1);
	equal(f.saved().names.one.removed, undefined);
	f.append(f.event("started", 4, { session: "new" }));
	f.append(f.event("ask", 5, { session: "new", ask: { kind: "ask", question: "Again?" } }));
	await f.tailer.poke();
	equal(f.rows.size, 2);
	equal(arg([...f.rows.values()][1], "--key"), "agents:one:new:5");
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
	equal(f.rows.size, 1);
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	equal(f.rows.size, 2);
	const row = [...f.rows.values()][1];
	equal(arg(row, "--key"), "agents:one:session:3");
	match(arg(row, "--note"), /Which branch\?/);
	f.append(f.event("result", 5, { text: "again", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	equal(f.rows.size, 3);
	deepStrictEqual(f.calls.at(-1), ["agent", "rm", "one", "--generation", "11111111-1111-4111-8111-111111111111"]);
}));

await check("done, follow-up turn and its ask read in one batch: the ask waits for re-registration", () => withFixture(async (f) => {
	await f.start();
	// One append, one poke: `entries` is not re-read between these lines, so the name is still in memory after `agent rm`.
	f.append(
		`${JSON.stringify(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }))}\n` +
		`${JSON.stringify(f.event("working", 2))}\n` +
		`${JSON.stringify(f.event("ask", 3, { ask: { kind: "ask", question: "Which branch?" } }))}\n`,
	);
	await f.tailer.poke();
	equal(f.rows.size, 1);
	deepStrictEqual(f.calls.at(-1), ["agent", "rm", "one", "--generation", "11111111-1111-4111-8111-111111111111"]);
	equal(f.saved().hosts.local.offset, fs.statSync(f.file).size);
	await f.tailer.poke();
	equal(f.saved().names.one.pending.length, 2, "the follow-up survives the poke that sees the entry gone");
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	equal(f.rows.size, 2);
	const row = [...f.rows.values()][1];
	equal(arg(row, "--key"), "agents:one:session:3");
	match(arg(row, "--note"), /Which branch\?/);
}));

await check("an old run's exit read after a new launch and re-registration makes no row for the new run", () => withFixture(async (f) => {
	// Smoke 2026-11-09: the retired child's `ended` was in the file, unread, when a new child started under the same name.
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	f.tailer.stop();
	f.append(f.event("ended", 2));
	f.append(f.event("started", 3, { session: "new" }));
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	f.tailer.start();
	await f.tailer.poke();
	equal(f.rows.size, 1);
	f.append(f.event("ended", 4, { session: "new" }));
	await f.tailer.poke();
	equal(f.rows.size, 2);
	equal(arg([...f.rows.values()][1], "--key"), "agents:one:new:4");
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
	deepStrictEqual([...f.rows.values()].map((row) => fields(row)[0]), ["event=result", "event=ask", "event=result"]);
}));

await check("agent-push-smart, reporters with `prompted`: an agent-started continuation after done is not a round; the follow-up's result is", () => withFixture(async (f) => {
	// The sequence of session 01a1c313 as a reporter that marks `working` writes it: 073 was started by an advisor
	// message, not a prompt; 245 by the coordinator's follow-up, typed into the session.
	const name = "agent-push-smart";
	const session = "01a1c313-0982-718e-b686-6bf23cddede2";
	const ev = (type, seq, ts, extra = {}) => f.event(type, 1794274167959000 + seq, { name, session, ts, pid: 4059262, ...extra });
	const done = (seq, ts, text) => ev("result", seq, ts, { text, result: { status: "done", path: "/runs/agent-push-smart/RESULT.md" } });
	await f.start([f.watched(name, "local", "2026-11-10 09:29:20")]);
	f.append(done(72, "2026-11-10T02:35:33.557Z", "round 1 done"));
	await f.tailer.poke();
	f.append(ev("working", 73, "2026-11-10T02:35:51.384Z", { prompted: false }));
	f.append(done(75, "2026-11-10T02:37:18.461Z", "round 1 done, again"));
	await f.tailer.poke();
	f.writeRules([f.watched(name, "local", "2026-11-10 13:26:19")]);
	await f.tailer.poke();
	equal(f.calls.filter((call) => call[0] === "agent").length, 1, "075 does not retire the name again");
	f.append(ev("working", 245, "2026-11-10T05:26:22.799Z", { prompted: true }));
	f.append(done(247, "2026-11-10T05:26:52.523Z", "retro done"));
	f.append(ev("working", 248, "2026-11-10T05:27:11.014Z", { prompted: false }));
	f.append(done(249, "2026-11-10T05:27:26.268Z", "retro done, again"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [`agents:${name}:${session}:1794274167959072`, `agents:${name}:${session}:1794274167959247`]);
	equal(f.calls.filter((call) => call[0] === "agent").length, 2, "247 retires the name");
	equal(f.saved().names[name].pending, undefined);
	for (const seq of [1794274167959075, 1794274167959249]) ok(f.warnings.some((w) => w.includes(`seq ${seq}`)), `the dropped ${seq} is logged`);
}));

await check("agent-push-smart 2026-11-10, the stream as written (no `prompted`): 075 is dropped loudly and 247 makes its card", () => withFixture(async (f) => {
	// The non-heartbeat events of session 01a1c313 from ~/.wayne/inbox/agent-events.jsonl, unchanged but for `text` and
	// `sessionFile` (left out: no rule reads them). Before the fix, 075 became card #394 on re-registration and retired
	// the name, and 247 was held forever with no card and no warning.
	const name = "agent-push-smart";
	const session = "00000000-0000-4000-8000-000000000001";
	const result = { path: "/tmp/demo/RESULT.md", status: "done" };
	const real = (seq, type, ts) => ({ v: 1, ts, name, host: "example-host", pid: 1001, session, seq: 1794274167959000 + seq, type, ...(type === "result" ? { result } : {}) });
	const key = (seq) => `agents:${name}:${session}:${1794274167959000 + seq}`;
	await f.start([f.watched(name, "local", "2026-11-10 09:29:20")]);
	f.append(real(62, "working", "2026-11-10T02:26:58.181Z"));
	f.append(real(72, "result", "2026-11-10T02:35:33.557Z"));
	await f.tailer.poke();
	f.append(real(73, "working", "2026-11-10T02:35:51.384Z"));
	f.append(real(75, "result", "2026-11-10T02:37:18.461Z"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72)]);
	// The coordinator registers the name again for its follow-up (05:26:19Z), before the follow-up's first event.
	f.writeRules([f.watched(name, "local", "2026-11-10 13:26:19")]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72)], "075 makes no card");
	equal(f.calls.filter((call) => call[0] === "agent").length, 1, "075 does not retire the name again");
	ok(f.warnings.some((w) => w.includes(`seq ${1794274167959075}`)), "the dropped 075 is logged");
	f.append(real(245, "working", "2026-11-10T05:26:22.799Z"));
	f.append(real(247, "result", "2026-11-10T05:26:52.523Z"));
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72), key(247)], "247 makes its card");
	equal(f.calls.filter((call) => call[0] === "agent").length, 2, "247 retires the name");
	f.append(real(248, "working", "2026-11-10T05:27:11.014Z"));
	f.append(real(249, "result", "2026-11-10T05:27:26.268Z"));
	await f.tailer.poke();
	// 249 is held like 075 was: a registration would drop it with a warning, as above.
	deepStrictEqual([...f.rows.keys()], [key(72), key(247)]);
	f.advance(1000);
	f.writeRules([f.watched(name, "local", f.since())]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], [key(72), key(247)], "249 makes no card");
	ok(f.warnings.some((w) => w.includes(`seq ${1794274167959249}`)), "the dropped 249 is logged");
	equal(f.saved().names[name].pending, undefined);
}));

await check("no `prompted`: a follow-up whose result repeats the retiring one still makes its card when it asked first", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	f.append(f.event("working", 2));
	f.append(f.event("ask", 3, { ask: { kind: "ask", question: "Which branch?" } }));
	f.append(f.event("result", 4, { text: "again", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:session:1", "agents:one:session:3", "agents:one:session:4"]);
	equal(f.warnings.length, 0);
}));

await check("events held for a registration that never comes are dropped with a warning", () => withFixture(async (f) => {
	await f.start([f.watched("other")]);
	f.append(f.event("ask", 1, { ask: { kind: "ask", question: "Anyone?" } }));
	await f.tailer.poke();
	equal(f.saved().names.one.pending.length, 1);
	f.advance(25 * 3600_000);
	f.append(f.event("hb", 2, { name: "other" }));
	await f.tailer.poke();
	await f.tailer.tick();
	ok(f.warnings.some((w) => w.includes("one: dropped 1 events held") && w.includes("seq 1")), JSON.stringify(f.warnings));
}));

await check("a prompted follow-up that finishes before re-registration still makes its cards", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("result", 1, { text: "done", result: { status: "done", path: "/answer" } }));
	await f.tailer.poke();
	// The same shape as 073-075 above, but the coordinator's prompt started it: [working, ask, result done], all before `agent add`.
	f.append(f.event("working", 2, { prompted: true }));
	f.append(f.event("ask", 3, { ask: { kind: "ask", question: "Which branch?" } }));
	f.append(f.event("result", 4, { text: "again", result: { status: "done", path: "/answer", open: "none" } }));
	await f.tailer.poke();
	equal(f.rows.size, 1);
	f.advance(1000);
	f.writeRules([f.watched("one", "local", f.since())]);
	await f.tailer.poke();
	deepStrictEqual([...f.rows.keys()], ["agents:one:session:1", "agents:one:session:3", "agents:one:session:4"]);
	equal(f.calls.filter((call) => call[0] === "agent").length, 2);
	equal(f.warnings.length, 0);
}));

await check("a heartbeat after re-registration means a later silence is a death, not never-started", () => withFixture(async (f) => {
	await f.start();
	f.append(f.event("hb", 1));
	await f.tailer.poke();
	f.advance(301_000);
	await f.tailer.tick();
	deepStrictEqual(fields([...f.rows.values()][0]).slice(0, 2), ["event=dead", "state=no-heartbeat"]);
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
		f.tailer = new AgentTailer({ dir: f.dir, inbox: f.inbox, now: () => f.clock, deadSec: 300, backoffMs: 25, warn: (message) => f.warnings.push(message), onChange: () => f.changes.emit("change") });
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

process.exit(failed === 0 ? 0 : 1);
