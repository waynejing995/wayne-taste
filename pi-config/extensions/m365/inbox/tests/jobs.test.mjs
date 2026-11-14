/**
 * Scheduled jobs through the TS CLI: register, fire into the ledger, judge, remove. Ported from test_schedule.py.
 *
 *   node inbox/tests/jobs.test.mjs
 */
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../../tests/host.mjs";
import YAML from "yaml";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const jobs = await jiti.import("../cli/jobs.ts");
const { readTsv, stamp } = await jiti.import("../cli/ledger.ts");
const { receiptInstructions } = await jiti.import("../cli/digest.ts");

// A prompt job's agent: prints its prompt, so the job's output is the prompt text.
const bin = mkdtempSync(join(tmpdir(), "inbox-agent-"));
const agent = join(bin, "echo-agent");
writeFileSync(agent, '#!/usr/bin/env bash\nprintf "%s\\n" "${@: -1}"\n');
chmodSync(agent, 0o755);
process.env.INBOX_AGENT = agent;

let failed = 0;
let home;
async function check(label, fn) {
	home = mkdtempSync(join(tmpdir(), "inbox-jobs-"));
	process.env.WAYNE_INBOX_DIR = home;
	writeFileSync(join(home, "rules.yaml"), "github:\n  acme:\n    - when: {review: requested}\n      action: notify\n      tag: pr\n");
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.stack ?? e.message}`);
	}
}

const at = (text) => jobs.parseStamp(text);
const rows = () => readTsv(join(home, "ledger.tsv"));
const run = (...args) => inbox(args);
function dueAt(next) {
	const all = jobs.readJobs();
	all[0].next_fire = next;
	jobs.writeJobs(all);
}

await check("register, list, remove", async () => {
	ok((await run("schedule", "add", "minute", "--every", "1", "--kind", "prompt", "--action", "hello")).startsWith("added minute next "));
	const listed = await run("schedule", "ls");
	ok(listed.includes("minute  every 1m") && listed.includes("last never") && listed.includes("prompt hello"), listed);
	const rules = readFileSync(join(home, "rules.yaml"), "utf8");
	ok(rules.startsWith("github:\n") && rules.includes("acme"), "the schedule block does not disturb the rules above it");
	await run("schedule", "rm", "minute");
	strictEqual((await run("schedule", "ls")).trim(), "(no scheduled jobs)");
});

await check("a shell job writes one ledger row per fire", async () => {
	await run("schedule", "add", "echo", "--every", "1", "--kind", "shell", "--action", '["echo", "pong"]');
	deepStrictEqual(await jobs.runDue({ session: false }, at("2026-11-10 12:00")), [], "not due: the first fire is one interval after registration");
	dueAt("2026-11-10 12:00");
	const lines = await jobs.runDue({ session: false }, at("2026-11-10 12:00"));
	ok(lines[0].startsWith("ok echo 2026-11-10T1200"), lines[0]);
	strictEqual(rows().length, 1);
	strictEqual(rows()[0].key, "schedule:echo:2026-11-10T1200");
	strictEqual(rows()[0].action, "notify");
	ok(rows()[0].note.includes("pong"));
	deepStrictEqual(await jobs.runDue({ session: false }, at("2026-11-10 12:00")), [], "the fire advanced next_fire");
	strictEqual(rows().length, 1);
});

await check("a quiet job writes no row on success and one on failure", async () => {
	await run("schedule", "add", "hush", "--every", "1", "--kind", "shell", "--action", '["echo", "fine"]', "--quiet");
	dueAt("2026-11-10 12:00");
	ok((await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0].startsWith("ok hush"));
	strictEqual(rows().length, 0);
	strictEqual(jobs.readJobs()[0].last_ok, "2026-11-10 12:00");
	const all = jobs.readJobs();
	all[0].action = { kind: "shell", argv: ["false"] };
	all[0].next_fire = "2026-11-10 12:05";
	jobs.writeJobs(all);
	ok((await jobs.runDue({ session: false }, at("2026-11-10 12:05")))[0].startsWith("fail hush"));
	strictEqual(rows().length, 1);
	ok(rows()[0].subject.endsWith("FAILED"));
	strictEqual(jobs.readJobs()[0].last_ok, "2026-11-10 12:00", "a failure does not move last_ok");
});

await check("outside a session a tool job stays due", async () => {
	await run("schedule", "add", "peek", "--every", "1", "--kind", "tool", "--action", '{"name": "teams_read", "args": {"target": "self"}}');
	dueAt("2026-11-10 12:00");
	deepStrictEqual(await jobs.runDue({ session: false }, at("2026-11-10 12:00")), ["skip peek: needs a live omp or pi session"]);
	strictEqual(jobs.readJobs()[0].next_fire, "2026-11-10 12:00");
	ok((await run("schedule", "pending")).startsWith("peek\tsession\t"));
});

await check("in a session a teams_read job calls the tool and records its text", async () => {
	await run("schedule", "add", "peek", "--every", "1", "--kind", "tool", "--action", '{"name": "teams_read", "args": {"target": "self"}}');
	dueAt("2026-11-10 12:00");
	const calls = [];
	const tool = async (name, args) => (calls.push([name, args]), "self-chat — 2 message(s)");
	ok((await jobs.runDue({ session: true, tool }, at("2026-11-10 12:00")))[0].startsWith("ok peek"));
	deepStrictEqual(calls, [["teams_read", { target: "self" }]]);
	ok(rows()[0].note.includes("2 message(s)"));
});

await check("finish records a session's tool result", async () => {
	await run("schedule", "add", "peek", "--every", "1", "--kind", "tool", "--action", '{"name": "teams_read", "args": {"target": "self"}}');
	dueAt(stamp(new Date(Date.now() - 60_000)));
	ok((await run("schedule", "finish", "peek", "--output", "self-chat — 2 message(s)")).startsWith("ok peek "));
	strictEqual(rows()[0].action, "notify");
	ok(rows()[0].note.includes("2 message(s)"));
});

await check("judge SKIP is recorded as log, not pushed", async () => {
	await run("schedule", "add", "triage", "--every", "1", "--kind", "prompt", "--action", "noise", "--judge", "on", "--judge-prompt", "inject only outages");
	dueAt("2026-11-10 12:00");
	deepStrictEqual(await jobs.runDue({ session: false }, at("2026-11-10 12:00")), ["skip triage: needs a live omp or pi session"]);
	const judge = async (prompt, output) => {
		strictEqual(prompt, "inject only outages");
		strictEqual(output, "noise");
		return { verdict: "SKIP", summary: "nothing to report" };
	};
	ok((await jobs.runDue({ session: true, judge }, at("2026-11-10 12:00")))[0].startsWith("skip triage"));
	strictEqual(rows()[0].action, "log");
	strictEqual(jobs.readJobs()[0].last.status, "skip");
	ok((await run("schedule", "widget")).includes("last skip"));
});

await check("judge INJECT can summarize", async () => {
	await run("schedule", "add", "triage", "--every", "1", "--kind", "prompt", "--action", "disk full on host b", "--judge", "on", "--judge-prompt", "inject only outages");
	dueAt("2026-11-10 12:01");
	const judge = async () => ({ verdict: "INJECT", summary: "host b is full" });
	ok((await jobs.runDue({ session: true, judge }, at("2026-11-10 12:01")))[0].startsWith("ok triage"));
	strictEqual(rows()[0].action, "notify");
	ok(rows()[0].note.startsWith("host b is full"));
});

await check("a failed shell records a FAILED row", async () => {
	await run("schedule", "add", "bad", "--every", "1", "--kind", "shell", "--action", '["false"]');
	dueAt("2026-11-10 12:00");
	ok((await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0].startsWith("fail bad"));
	strictEqual(jobs.readJobs()[0].last.status, "fail");
	ok(rows()[0].subject.endsWith("FAILED"));
});

await check("a prompt job runs the agent with {{since}} filled and keeps the owner", async () => {
	await run("schedule", "add", "ping", "--every", "1", "--kind", "prompt", "--action", "since {{since}}", "--owner", "lin");
	const all = jobs.readJobs();
	all[0].next_fire = "2026-11-10 12:00";
	all[0].last_ok = "2026-11-10 11:00";
	jobs.writeJobs(all);
	await jobs.runDue({ session: false }, at("2026-11-10 12:00"));
	strictEqual(rows()[0].owner, "lin");
	strictEqual(rows()[0].action, "notify");
	strictEqual(rows()[0].note, "since 2026-11-10 11:00");
});

// The digest tests run the shipped template prompt through a fake agent that does only what that prompt says
// (fixtures/fake-digest-agent.mjs), so they cannot pass unless the real prompt carries the real contract.
const FAKE_DIGEST = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-digest-agent.mjs");
const TEMPLATE_DIGEST = YAML.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "rules.yaml"), "utf8"), { version: "1.1" }).schedule.find((j) => j.name === "teams-digest");

/** The template digest, enabled and due at `next`, run by the fake agent in `mode`. */
function digestJob(next, extra = {}, mode = "ok") {
	process.env.INBOX_AGENT = FAKE_DIGEST;
	process.env.FAKE_DIGEST_MODE = mode;
	jobs.writeJobs([{ ...structuredClone(TEMPLATE_DIGEST), enabled: true, next_fire: next, last_ok: "2026-11-10 10:00", ...extra }]);
}
const digest = () => jobs.readJobs()[0];
const gapRows = () => rows().filter((r) => r.action === "do" && r.tag === "ask-wayne");
function restoreAgent() {
	process.env.INBOX_AGENT = agent;
	delete process.env.FAKE_DIGEST_MODE;
}

await check("the shipped digest prompt yields a receipt the runner accepts, and the boundary moves", async () => {
	try {
		digestJob("2026-11-10 12:00");
		const line = (await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0];
		ok(line.startsWith("ok teams-digest"), line);
		strictEqual(digest().last_ok, "2026-11-10 12:00");
		ok(readFileSync(join(home, "facts.md"), "utf8").includes("[endpoint:build-server]"));
		strictEqual(gapRows().length, 0);
	} finally {
		restoreAgent();
	}
});

await check("a digest read whose middle omp elided passes once the agent reads the elided lines", async () => {
	try {
		digestJob("2026-11-10 12:00", {}, "elided");
		const line = (await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0];
		ok(line.startsWith("ok teams-digest"), `${line}\n${rows().map((r) => `${r.subject} | ${r.note}`).join("\n")}`);
		strictEqual(digest().last_ok, "2026-11-10 12:00");
	} finally {
		restoreAgent();
	}
});

for (const mode of ["listelided", "factretry", "quoteretry", "helpfirst"])
	await check(`a digest run in mode ${mode} is complete and moves the boundary`, async () => {
		try {
			digestJob("2026-11-10 12:00", {}, mode);
			const line = (await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0];
			ok(line.startsWith("ok teams-digest"), `${line}\n${rows().map((r) => `${r.subject} | ${r.note}`).join("\n")}`);
			strictEqual(digest().last_ok, "2026-11-10 12:00");
		} finally {
			restoreAgent();
		}
	});

for (const [mode, chat, reason] of [
	["readfail", "Ops", /teams_read failed/],
	["lie", "Ops", /never read/],
	["factfail", "Ops", /inbox write failed/],
	["exit", "all chats", /exited 1/],
	["elidedskip", "self-chat", /lines 41-960 .*elided/],
	["listelidedskip", "chat list", /teams_chats output were elided/],
	["tailskip", "self-chat", /lines 1-960 .*elided/],
	["credreject", "Ops", /inbox write failed: .*never its value/],
	["rawone", "self-chat", /lines 41-960 .*elided/],
	["shortread", "self-chat", /lines 41-960 .*elided/],
	["multiwrite", "Ops", /one plain `inbox ask\|fact` per bash call/],
	["quotedmulti", "Ops", /one plain `inbox ask\|fact` per bash call/],
	["askmask", "Ops", /inbox write failed/],
])
	await check(`a digest run in mode ${mode} keeps the old boundary and names ${chat} in a do row`, async () => {
		try {
			digestJob("2026-11-10 12:00", {}, mode);
			const line = (await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0];
			ok(line.startsWith("fail teams-digest"), line);
			strictEqual(digest().last_ok, "2026-11-10 10:00");
			const gap = gapRows().find((r) => r.subject === `Teams digest could not fully read ${chat} since 2026-11-10 10:00`);
			ok(gap && reason.test(gap.note), rows().map((r) => `${r.subject} | ${r.note}`).join("\n"));
		} finally {
			restoreAgent();
		}
	});

await check("a digest prompt without {{receipt}} fails and names the gap", async () => {
	try {
		digestJob("2026-11-10 12:00", { action: { kind: "prompt", text: "Read the watched Teams chats with `limit` 200." } });
		ok((await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0].startsWith("fail teams-digest"));
		strictEqual(digest().last_ok, "2026-11-10 10:00");
		ok(gapRows().some((r) => r.subject.includes("all chats") && r.note.includes("no receipt")));
	} finally {
		restoreAgent();
	}
});

for (const [label, args] of [
	["DISPATCHED", ["--output", "prompt card sent", "--verdict", "DISPATCHED"]],
	["SKIP", ["--output", "nothing new", "--verdict", "SKIP"]],
	["no receipt", ["--output", "teams digest: 0 findings"]],
])
	await check(`schedule finish ${label} on the digest keeps its boundary`, async () => {
		try {
			digestJob(stamp(new Date(Date.now() - 60_000)), { backfill_since: "2026-11-03 10:00" });
			await run("schedule", "finish", "teams-digest", ...args);
			strictEqual(digest().last_ok, "2026-11-10 10:00");
			strictEqual(digest().backfill_since, "2026-11-03 10:00");
		} finally {
			restoreAgent();
		}
	});

await check("schedule finish with the digest's checked event stream moves its boundary", async () => {
	try {
		const old = stamp(new Date(Date.now() - 3600_000));
		digestJob(stamp(new Date(Date.now() - 60_000)), { last_ok: old });
		const prompt = TEMPLATE_DIGEST.action.text.replaceAll("{{since}}", old).replaceAll("{{until}}", stamp(new Date(Date.now() + 120_000))).replaceAll("{{receipt}}", receiptInstructions());
		const stream = execFileSync(FAKE_DIGEST, ["-p", "--mode", "json", prompt], { encoding: "utf8", env: { ...process.env, PATH: `${join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin")}:${process.env.PATH}` } });
		ok((await run("schedule", "finish", "teams-digest", "--output", stream)).startsWith("ok teams-digest"));
		ok(digest().last_ok > old);
	} finally {
		restoreAgent();
	}
});

await check("a verified digest clears backfill_since in rules.yaml; a failed one keeps it", async () => {
	try {
		digestJob("2026-11-10 12:00", { backfill_since: "2026-11-10 08:00" }, "readfail");
		await jobs.runDue({ session: false }, at("2026-11-10 12:00"));
		strictEqual(digest().backfill_since, "2026-11-10 08:00");
		ok(gapRows().some((r) => r.subject.endsWith("since 2026-11-10 08:00")), "the failed run read from the backfill boundary");
		const again = jobs.readJobs();
		again[0].next_fire = "2026-11-10 14:00";
		jobs.writeJobs(again);
		process.env.FAKE_DIGEST_MODE = "ok";
		ok((await jobs.runDue({ session: false }, at("2026-11-10 14:00")))[0].startsWith("ok teams-digest"));
		strictEqual(digest().backfill_since, undefined);
		ok(!readFileSync(join(home, "rules.yaml"), "utf8").includes("backfill_since"));
		strictEqual(digest().last_ok, "2026-11-10 14:00");
	} finally {
		restoreAgent();
	}
});

await check("a first digest run that fails retries from the same start, not a day before the retry", async () => {
	try {
		digestJob("2026-11-10 12:00", { last_ok: undefined }, "readfail");
		ok((await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0].startsWith("fail teams-digest"));
		strictEqual(digest().backfill_since, "2026-11-09 12:00", "the first run's start is written before it runs");
		const again = jobs.readJobs();
		again[0].next_fire = "2026-11-10 14:00";
		jobs.writeJobs(again);
		process.env.FAKE_DIGEST_MODE = "ok";
		ok((await jobs.runDue({ session: false }, at("2026-11-10 14:00")))[0].startsWith("ok teams-digest"));
		strictEqual(digest().backfill_since, "2026-11-10 12:00", "the retry read the original first day, from 2026-11-09 12:00");
	} finally {
		restoreAgent();
	}
});

await check("schedule exec runs a first digest from a day back and writes nothing to rules.yaml", async () => {
	try {
		digestJob("2026-11-10 12:00", { last_ok: undefined });
		const before = readFileSync(join(home, "rules.yaml"), "utf8");
		await jobs.execAction("teams-digest");
		strictEqual(readFileSync(join(home, "rules.yaml"), "utf8"), before);
	} finally {
		restoreAgent();
	}
});

await check("a digest more than a day behind reads one day per run and catches up", async () => {
	try {
		digestJob("2026-11-10 12:00", { last_ok: "2026-11-08 10:00" });
		ok((await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0].startsWith("ok teams-digest"));
		strictEqual(digest().last_ok, "2026-11-08 10:00", "a window that ends before now is not the present");
		strictEqual(digest().backfill_since, "2026-11-09 10:00");
		strictEqual(digest().next_fire, "2026-11-10 12:01", "the next window runs at the next tick");
		ok((await jobs.runDue({ session: false }, at("2026-11-10 12:01")))[0].startsWith("ok teams-digest"));
		strictEqual(digest().backfill_since, "2026-11-10 10:00");
		ok((await jobs.runDue({ session: false }, at("2026-11-10 12:02")))[0].startsWith("ok teams-digest"));
		strictEqual(digest().backfill_since, undefined);
		strictEqual(digest().last_ok, "2026-11-10 12:02");
		strictEqual(digest().next_fire, "2026-11-10 14:02");
	} finally {
		restoreAgent();
	}
});

await check("a digest read that stops before the window's end is a gap", async () => {
	try {
		digestJob("2026-11-10 12:00", { last_ok: "2026-11-08 10:00" }, "shortwindow");
		ok((await jobs.runDue({ session: false }, at("2026-11-10 12:00")))[0].startsWith("fail teams-digest"));
		strictEqual(digest().last_ok, "2026-11-08 10:00");
		strictEqual(digest().backfill_since, undefined);
		ok(gapRows().some((r) => r.subject === "Teams digest could not fully read Ops since 2026-11-08 10:00" && r.note.includes("until 2026-11-09 10:00")), rows().map((r) => `${r.subject} | ${r.note}`).join("\n"));
	} finally {
		restoreAgent();
	}
});

await check("a job still running is left out of the next call, which runs the other due jobs", async () => {
	await run("schedule", "add", "slow", "--every", "1", "--kind", "shell", "--timeout", "30", "--action", '["sleep", "3"]', "--quiet");
	await run("schedule", "add", "fast", "--every", "1", "--kind", "shell", "--action", '["echo", "fast"]');
	const all = jobs.readJobs();
	for (const j of all) j.next_fire = "2026-11-10 12:00";
	jobs.writeJobs(all);
	let slowDone = false;
	const first = jobs.runDue({ session: false }, at("2026-11-10 12:00")).then((lines) => ((slowDone = true), lines));
	await new Promise((r) => setTimeout(r, 300));
	const t0 = Date.now();
	const second = await jobs.runDue({ session: false }, at("2026-11-10 12:01"));
	ok(Date.now() - t0 < 2000 && !slowDone, "the second call did not wait for the slow job");
	deepStrictEqual(second.map((l) => l.split(" ").slice(0, 2).join(" ")), ["ok fast"]);
	const lines = await first;
	deepStrictEqual(lines.map((l) => l.split(" ").slice(0, 2).join(" ")).sort(), ["ok fast", "ok slow"]);
	strictEqual(rows().filter((r) => r.note === "fast").length, 2, "fast fired at 12:00 and at 12:01 while slow ran");
});

await check("verdict FAIL records a row and advances", async () => {
	await run("schedule", "add", "boom", "--every", "1", "--kind", "tool", "--action", '{"name": "teams_read", "args": {"target": "self"}}');
	const due = stamp(new Date(Date.now() - 60_000));
	dueAt(due);
	ok((await run("schedule", "finish", "boom", "--output", "teams down", "--verdict", "FAIL", "--summary", "teams down")).startsWith("fail boom"));
	strictEqual(jobs.readJobs()[0].last.status, "fail");
	ok(jobs.readJobs()[0].next_fire !== due);
	strictEqual(rows()[0].action, "notify");
	strictEqual(rows()[0].note, "teams down");
});

await check("a quiet job's FAIL verdict writes a notify row and keeps last_ok", async () => {
	await run("schedule", "add", "hushfail", "--every", "1", "--kind", "tool", "--action", '{"name": "teams_read", "args": {"target": "self"}}', "--quiet");
	const all = jobs.readJobs();
	all[0].last_ok = "2026-11-10 08:00";
	jobs.writeJobs(all);
	dueAt(stamp(new Date(Date.now() - 60_000)));
	ok((await run("schedule", "finish", "hushfail", "--output", "teams down", "--verdict", "FAIL")).startsWith("fail hushfail"));
	strictEqual(jobs.readJobs()[0].last_ok, "2026-11-10 08:00", "a failed fire must not move {{since}} past its window");
	strictEqual(rows().length, 1);
	strictEqual(rows()[0].action, "notify");
	ok(rows()[0].subject.endsWith("FAILED"));
});

await check("a foreign tool becomes one `do` row and advances", async () => {
	await run("schedule", "add", "reader", "--every", "1", "--kind", "tool", "--action", '{"name": "read", "args": {"path": "/etc/hostname"}}');
	dueAt("2026-11-11 01:14");
	ok((await jobs.runDue({ session: true }, at("2026-11-11 01:14")))[0].startsWith("dispatched reader"));
	ok(jobs.readJobs()[0].next_fire !== "2026-11-11 01:14");
	strictEqual(rows().length, 1);
	strictEqual(rows()[0].action, "do");
	strictEqual(rows()[0].note, 'call the tool read with {"path":"/etc/hostname"}');
});

await check("a judged foreign tool is rejected", async () => {
	await rejects(() => run("schedule", "add", "reader", "--every", "1", "--kind", "tool", "--action", '{"name": "read", "args": {}}', "--judge", "on", "--judge-prompt", "rule"), /cannot be judged/);
});

await check("a disabled job never fires; enable gives it a next fire", async () => {
	strictEqual(await run("schedule", "add", "later", "--every", "5", "--kind", "shell", "--action", '["true"]', "--disabled"), "added later (disabled)");
	deepStrictEqual(await jobs.runDue({ session: true }, at("2030-01-01 00:00")), []);
	ok((await run("schedule", "enable", "later")).length > 0);
	ok(jobs.readJobs()[0].next_fire);
});

await check("cron steps and ranges", async () => {
	ok(jobs.cronMatches("*/15 * * * *", at("2026-11-10 12:45")));
	ok(!jobs.cronMatches("*/15 * * * *", at("2026-11-10 12:46")));
	ok(jobs.cronMatches("0 9 * * 1-5", at("2026-11-09 09:00")));
	ok(!jobs.cronMatches("0 9 * * 1-5", at("2026-11-08 09:00")));
	strictEqual(stamp(jobs.nextFire({ cron: "0 9 * * 1" }, at("2026-11-10 12:00"))), "2026-11-16 09:00");
});

await check("day fields are OR only when both are restricted (cronie)", async () => {
	ok(jobs.cronMatches("0 9 1 * 1", at("2026-12-01 09:00")));
	ok(jobs.cronMatches("0 9 1 * 1", at("2026-11-16 09:00")));
	ok(!jobs.cronMatches("0 9 1 * 1", at("2026-11-17 09:00")));
	ok(jobs.cronMatches("0 9 * * 1", at("2026-11-16 09:00")));
	ok(!jobs.cronMatches("0 9 * * 1", at("2026-12-01 09:00")));
	ok(jobs.cronMatches("0 9 */1 * 1", at("2026-11-16 09:00")));
	ok(!jobs.cronMatches("0 9 */1 * 1", at("2026-11-17 09:00")));
	ok(jobs.cronMatches("0 9 1 * */1", at("2026-12-01 09:00")));
	ok(!jobs.cronMatches("0 9 1 * */1", at("2026-11-17 09:00")));
});

await check("bad input is an error", async () => {
	await rejects(() => run("schedule", "add", "Bad", "--every", "1", "--kind", "prompt", "--action", "x"), /job name/);
	await rejects(() => run("schedule", "add", "both", "--every", "1", "--cron", "* * * * *", "--kind", "prompt", "--action", "x"), /exactly one/);
	await rejects(() => run("schedule", "add", "nope", "--every", "1", "--kind", "tool", "--action", "nope"));
});

await check("show round-trips the tool spec", async () => {
	await run("schedule", "add", "peek", "--cron", "*/5 * * * *", "--kind", "tool", "--action", '{"name": "teams_read", "args": {"target": "self", "limit": 5}}', "--owner", "wayne");
	const spec = JSON.parse(await run("schedule", "show", "peek"));
	deepStrictEqual(spec.action, { kind: "tool", name: "teams_read", args: { target: "self", limit: 5 } });
	strictEqual(spec.owner, "wayne");
	strictEqual(YAML.parse(readFileSync(join(home, "rules.yaml"), "utf8")).schedule[0].name, "peek");
});

await check("setup fills an empty inbox from the template and keeps an existing rules.yaml", async () => {
	const before = readFileSync(join(home, "rules.yaml"), "utf8");
	await run("setup");
	strictEqual(readFileSync(join(home, "rules.yaml"), "utf8"), before);
	home = mkdtempSync(join(tmpdir(), "inbox-fresh-"));
	process.env.WAYNE_INBOX_DIR = home;
	const out = await run("setup");
	ok(out.includes("created") && out.includes("tools: ok"), out);
	const names = jobs.readJobs().map((j) => `${j.name}:${j.enabled === false ? "off" : j.next_fire ? "due" : "?"}`);
	deepStrictEqual(names, ["agent-probe:due", "github-prs:off", "teams-digest:off"]);
	strictEqual(readFileSync(join(home, "cursors", "session-push.id"), "utf8"), "0\n");
});

await check("setup fails loud naming a missing tool", async () => {
	await run("schedule", "add", "ghost", "--every", "1", "--kind", "shell", "--action", '["no-such-program-xyz"]');
	await rejects(() => run("setup"), /ghost: no-such-program-xyz is not on PATH/);
});

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
