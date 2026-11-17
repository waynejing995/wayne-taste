/**
 * Deferred actions (`inbox then`): a trigger makes one `do` card quoting the action, an open fired then is reminded at
 * 10 minutes, 1 hour, 4 hours, then daily, `done` refuses while one is open, and an unfired trigger makes nothing.
 *
 *   node inbox/tests/thens.test.mjs
 */
import { spawn } from "node:child_process";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../../tests/host.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const { checkThens, readThens } = await jiti.import("../cli/thens.ts");
const { sweep } = await jiti.import("../cli/sweep.ts");
const { readAgents, removeAgents, writeAgents } = await jiti.import("../cli/agents.ts");
const { readTsv } = await jiti.import("../cli/ledger.ts");
const { parseStamp } = await jiti.import("../cli/jobs.ts");
const { AgentTailer } = await jiti.import("../agents.ts");

const RULES = `github:
  acme/app:
    - when: { event: merged }
      action: log
agents:
  "*":
    - when: { event: result }
      tag: agent-result
      action: do
`;

let failed = 0;
let home;
async function check(label, fn) {
	home = mkdtempSync(join(tmpdir(), "inbox-thens-"));
	process.env.WAYNE_INBOX_DIR = home;
	writeFileSync(join(home, "rules.yaml"), RULES);
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.stack ?? e.message}`);
	}
}

const rows = () => readTsv(join(home, "ledger.tsv"));
const thenRows = () => rows().filter((r) => r.tag === "then");
/** A live row to hang thens on: what the coordinator was handling when it promised the follow-up. */
const row = async () => (await inbox(["ask", "deploy after the merge", "--key", "deploy"])).split(" ")[1];
const merged = (n) => inbox(["add", "--source", "github", "--place", "acme/app", "--key", `github:acme/app#${n}:merged`, "--subject", `PR ${n}`, "--field", "event=merged"]);
const T0 = parseStamp("2026-11-11 10:00");
const plus = (min) => new Date(T0.getTime() + min * 60_000);

await check("a merged PR fires one do card quoting the action verbatim", async () => {
	const id = await row();
	strictEqual(await inbox(["then", id, "--when", "pr-merged:acme/app#12", "--", "deploy", "app", "to", "staging"]), `then ${id}.1 waits for pr-merged:acme/app#12`);
	await merged(12);
	const lines = await checkThens({ now: T0 });
	strictEqual(lines.length, 1, lines.join("\n"));
	const [card] = thenRows();
	deepStrictEqual([card.action, card.state, card.owner], ["do", "open", "coordinator"]);
	ok(card.note.startsWith("Trigger pr-merged:acme/app#12 happened; you owe: deploy app to staging"), card.note);
	deepStrictEqual(await checkThens({ now: plus(1) }), [], "fired once, not again on the next check");
	strictEqual(thenRows().length, 1);
});

await check("an agent's RESULT row added after the then fires it; an older one does not", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "the registration's own plan"]);
	const [{ generation }] = readAgents();
	const result = (seq) => inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:${generation}:s1:${seq}`, "--subject", "agent fixer", "--note", "RESULT status: done. Last output: ok", "--field", "event=result"]);
	await result(1);
	await checkThens({ now: T0 });
	await inbox(["then", id, "--when", "agent-result:fixer", "--", "verify the fix and report"]);
	deepStrictEqual(await checkThens({ now: T0 }), [], "the RESULT from before the then is not its trigger");
	await result(2);
	await checkThens({ now: T0 });
	ok(thenRows().some((r) => r.note.includes("you owe: verify the fix and report [RESULT")), thenRows().map((r) => r.note).join("\n"));
});

await check("agent add arms its plan on the row: the next RESULT fires it and the row stays open until it is done", async () => {
	await rejects(inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", "999", "--then", "x"]), /no such live id: 999/);
	strictEqual(await inbox(["agent", "ls"]), "", "a bad row registers nothing");
	const id = await row();
	ok((await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "expect PR open; reply Wayne; close row"])).endsWith(`then ${id}.1 waits for agent-result:fixer`));
	const [{ generation }] = readAgents();
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:${generation}:s1:1`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await checkThens({ now: T0 });
	ok(thenRows()[0].note.includes("you owe: expect PR open; reply Wayne; close row"), thenRows()[0].note);
	await rejects(inbox(["done", id]), /open then-actions/);
});

await check("an agent's plan fires only on a RESULT of its own registration", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "old plan"]);
	const [{ generation: old }] = readAgents();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "new plan"]);
	const [{ generation: current }] = readAgents();
	const result = (gen, seq) => inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:${gen}:s1:${seq}`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await result(old, 1);
	deepStrictEqual(await checkThens({ now: T0 }), [], "the replaced registration's late RESULT does not fire the new plan");
	await result(current, 2);
	await checkThens({ now: T0 });
	ok(thenRows()[0].note.includes("you owe: new plan [RESULT status: done (row #"), thenRows()[0].note);
});

await check("agent add --generation records the launch's id, and a re-add of that launch replaces its own plan", async () => {
	const id = await row();
	await rejects(inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan", "--generation", "-oProxy"]), /--generation must be/);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan one", "--generation", "launch-0001"]);
	deepStrictEqual(readAgents().map((a) => [a.generation, a.stamped]), [["launch-0001", true]]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan two", "--generation", "launch-0001"]);
	deepStrictEqual(readThens().filter((t) => !t.done).map((t) => [t.action, t.generation]), [["plan two", "launch-0001"]]);
});

await check("a replaced launch's late RESULT fires nothing; its own RESULT fires the plan and leaves the watch", async () => {
	const id = await row();
	const add = (generation, plan) => inbox(["agent", "add", "fixer", "--push", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", plan, "--generation", generation]);
	await add("launch-old-01", "old plan");
	await add("launch-new-01", "new plan");
	const warnings = [];
	const tailer = new AgentTailer({ dir: home, inbox, warn: (w) => warnings.push(w) });
	const event = (generation, seq) => JSON.stringify({ v: 1, ts: new Date().toISOString(), name: "fixer", generation, pid: 1, session: "s", seq, type: "result", text: "done", result: { status: "done", path: "/r" } });
	writeFileSync(join(home, "agent-events.jsonl"), `${event("launch-old-01", 1)}\n`);
	tailer.start();
	await tailer.poke();
	deepStrictEqual(await checkThens({ now: T0 }), [], "the old launch's RESULT fires nothing");
	deepStrictEqual(readAgents().map((a) => a.generation), ["launch-new-01"], "and removes nothing");
	writeFileSync(join(home, "agent-events.jsonl"), `${event("launch-old-01", 1)}\n${event("launch-new-01", 2)}\n`);
	await tailer.poke();
	tailer.stop();
	await checkThens({ now: T0 });
	ok(thenRows()[0].note.includes("you owe: new plan [RESULT"), thenRows()[0].note);
	deepStrictEqual(readAgents().map((a) => a.generation), ["launch-new-01"], "a done RESULT leaves the watch");
});

await check("adding the same agent again cancels its previous unfired plan", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "first"]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "second"]);
	const listed = await inbox(["ls"]);
	ok(listed.includes("second") && !/then .* waits for .* first/.test(listed));
});

await check("agent rm removes the registration by name", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "first"]);
	ok((await inbox(["agent", "ls"])).startsWith("fixer\t"));
	await inbox(["agent", "rm", "fixer"]);
	strictEqual(await inbox(["agent", "ls"]), "");
});

await check("agent rm rejects a missing name without removing others", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "first"]);
	await rejects(() => inbox(["agent", "rm", "fixer", "missing"]), /not watched: missing/);
	ok((await inbox(["agent", "ls"])).startsWith("fixer\t"));
});

await check("completion cleanup removes only its generation", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "first"]);
	const old = readAgents()[0];
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "second"]);
	removeAgents([{ name: old.name, generation: old.generation }]);
	const current = readAgents();
	strictEqual(current.length, 1);
	ok(current[0].generation !== old.generation);
});

await check("completion cleanup without a generation does not remove a re-registration", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "first"]);
	const current = readAgents();
	removeAgents([{ name: "fixer" }]);
	deepStrictEqual(readAgents(), current);
});

await check("a legacy registration is migrated during add and rm", async () => {
	const id = await row();
	await inbox(["agent", "add", "legacy", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "old"]);
	const old = readAgents()[0];
	delete old.generation;
	writeAgents([old]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "new"]);
	ok(readAgents().every((entry) => entry.generation));
	await inbox(["agent", "rm", "legacy"]);
	deepStrictEqual(readAgents().map((entry) => entry.name), ["fixer"]);
});

await check("adding the same agent on another row cancels its old unfired plan", async () => {
	const first = await row();
	const second = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", first, "--then", "first plan"]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", second, "--then", "second plan"]);
	const listed = await inbox(["ls"]);
	ok(listed.includes("second plan") && !listed.includes("first plan"), listed);
});

await check("at: fires at its minute; gh-run asks gh and fires when the run completed", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:30", "--", "ping Bob"]);
	const bin = mkdtempSync(join(tmpdir(), "inbox-gh-"));
	writeFileSync(join(bin, "gh"), '#!/usr/bin/env bash\necho \'{"status":"completed","conclusion":"failure"}\'\n');
	chmodSync(join(bin, "gh"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${bin}:${path}`;
	try {
		await inbox(["then", id, "--when", "gh-run:acme/app:991", "--", "rerun the flaky job"]);
		deepStrictEqual(await checkThens({ now: plus(29) }), [], "gh-run is only asked on the minute tick (gh: true); at: not yet due");
		const lines = await checkThens({ now: plus(30), gh: true });
		strictEqual(lines.length, 2, lines.join("\n"));
	} finally {
		process.env.PATH = path;
	}
	const notes = thenRows().map((r) => r.note);
	ok(notes.some((n) => n.startsWith("Trigger at:2026-11-11 10:30 happened; you owe: ping Bob")), notes.join("\n"));
	ok(notes.some((n) => n.includes("you owe: rerun the flaky job [conclusion failure")), notes.join("\n"));
});

await check("a fired then is reminded at 10 minutes, 1 hour and 4 hours; then-done stops the ladder", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "send the summary"]);
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "close the ticket"]);
	await checkThens({ now: T0 });
	await inbox(["then-done", id, "2"]);
	deepStrictEqual(await checkThens({ now: plus(9) }), [], "no reminder before 10 minutes");
	const first = await checkThens({ now: plus(10) });
	strictEqual(first.length, 1, first.join("\n"));
	ok(first[0].startsWith(`reminded ${id}.1`), first[0]);
	deepStrictEqual(await checkThens({ now: plus(59) }), [], "the next rung is 1 hour from the fire");
	const second = await checkThens({ now: plus(60) });
	strictEqual(second.length, 1);
	const third = await checkThens({ now: plus(240) });
	strictEqual(third.length, 1);
	deepStrictEqual(await checkThens({ now: plus(240 + 23 * 60) }), [], "then every 24 hours from the previous rung");
	const fourth = await checkThens({ now: plus(240 + 24 * 60) });
	strictEqual(fourth.length, 1);
	const reminders = thenRows().filter((r) => r.note.startsWith("Reminder "));
	strictEqual(reminders.length, 4);
	ok(reminders[0].note.includes("you still owe: send the summary"), reminders[0].note);
});

await check("done refuses while a fired then is open; --force needs a note and closes it", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "tell the team"]);
	await checkThens({ now: T0 });
	await rejects(() => inbox(["done", id]), /open then-actions: .*tell the team/);
	await rejects(() => inbox(["done", id, "--force"]), /--force needs --note/);
	strictEqual(await inbox(["done", id, "--force", "--note", "team already knew"]), `done ${id}`);
	ok(readThens()[0].note === "forced: team already knew" && readThens()[0].done);
});

await check("an unfired trigger makes no card, and done of its row is allowed (the then stays armed)", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "pr-merged:acme/app#77", "--", "tag the release"]);
	await merged(78);
	deepStrictEqual(await checkThens({ now: T0 }), []);
	strictEqual(thenRows().length, 0);
	ok((await inbox(["ls"])).includes(`# then ${id}.1 waits for pr-merged:acme/app#77: tag the release`));
	strictEqual(await inbox(["done", id]), `done ${id}`);
	await merged(77);
	strictEqual((await checkThens({ now: T0 })).length, 1, "fires after the row is done");
});

await check("then rejects a bad trigger and a row that is not live", async () => {
	const id = await row();
	await rejects(() => inbox(["then", id, "--when", "merged:acme/app#1", "--", "x"]), /bad trigger 'merged:acme\/app#1'/);
	await rejects(() => inbox(["then", id, "--when", "at:2026-13-45 99:00", "--", "x"]), /bad time in/);
	await rejects(() => inbox(["then", "999", "--when", "at:2026-11-11 10:00", "--", "x"]), /no such live id: 999/);
});

await check("a busy rules lock fails agent add before its plan is armed", async () => {
	const id = await row();
	writeFileSync(join(home, "rules.yaml.lock"), "");
	await rejects(() => inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan"]), /held by another writer/);
	deepStrictEqual(readThens(), [], "no plan armed for a registration that was not written");
});

await check("a plain agent-result then needs the registration and is cancelled when that registration is replaced", async () => {
	const id = await row();
	await rejects(() => inbox(["then", id, "--when", "agent-result:fixer", "--", "verify the fix by hand"]), /not watched: fixer/);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan one"]);
	const [{ generation }] = readAgents();
	await inbox(["then", id, "--when", "agent-result:fixer", "--", "verify the fix by hand"]);
	ok(readThens().find((t) => t.action === "verify the fix by hand").generation === generation);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan two"]);
	const open = readThens().filter((t) => !t.done).map((t) => t.action);
	deepStrictEqual(open, ["plan two"]);
});

await check("a failed rules write rolls the plan back: the old watch keeps its plan", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan one"]);
	const before = readThens();
	const watched = readAgents();
	mkdirSync(join(home, `rules.yaml.${process.pid}.tmp`));
	await rejects(() => inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "plan two"]));
	rmSync(join(home, `rules.yaml.${process.pid}.tmp`), { recursive: true });
	deepStrictEqual(readAgents(), watched, "the old registration stays");
	deepStrictEqual(readThens(), before, "its plan is still armed and no new plan was left behind");
});

await check("a failed plan save puts the old registration back", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan one"]);
	const before = readThens();
	const watched = readAgents();
	mkdirSync(join(home, "thens.json.tmp"));
	await rejects(() => inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "plan two"]));
	rmSync(join(home, "thens.json.tmp"), { recursive: true });
	deepStrictEqual(readAgents(), watched, "the old registration is back");
	deepStrictEqual(readThens(), before, "the plans are unchanged");
});

await check("re-adding a legacy registration keeps and reports its unmarked plans, automatic or by hand", async () => {
	const id = await row();
	const thensFile = join(home, "thens.json");
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "old plan"]);
	await inbox(["then", id, "--when", "agent-result:fixer", "--", "verify by hand"]);
	// What an older inbox wrote: no generation on the registration or on the plan it armed, the same minute as the hand then.
	const [old] = readAgents();
	delete old.generation;
	writeAgents([old]);
	const minute = old.since.slice(0, 16);
	writeFileSync(thensFile, JSON.stringify(readThens().map(({ generation, ...t }) => ({ ...t, added: minute }))));
	const out = await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "new plan"]);
	deepStrictEqual(readThens().filter((t) => !t.done).map((t) => t.action), ["old plan", "verify by hand", "new plan"]);
	ok(/kept \(ambiguous legacy\): .*: old plan; .*: verify by hand/.test(out), out);
	strictEqual(readAgents()[0].pane, "s:2");
	const again = await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:3", "--row", id, "--then", "newer plan"]);
	ok(!again.includes("ambiguous"), again);
	deepStrictEqual(readThens().filter((t) => !t.done).map((t) => t.action), ["old plan", "verify by hand", "newer plan"]);
});

await check("sweep reports an overdue then, a dead generation, a dead watch and held events, once", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "check the answer"]);
	const [{ generation }] = readAgents();
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:${generation}:s1:1`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await checkThens({ now: T0 });
	const overdue = await sweep(false, plus(25 * 60));
	ok(overdue.includes(`would sweep:then-overdue:${id}.1:2026-11-12`), overdue);
	const applied = await sweep(true, plus(25 * 60));
	ok(applied.includes("sweep"), applied);
	strictEqual(await sweep(true, plus(25 * 60)), `seen sweep:then-overdue:${id}.1:2026-11-12`);
	await inbox(["then-done", id, "1"]);
	strictEqual(readAgents().length, 0, "the last open then of the generation removes the watch");
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "check again"]);
	const [{ generation: next }] = readAgents();
	writeAgents([]);
	const dead = await sweep(false, T0);
	ok(dead.includes(`would sweep:then-dead:${id}.2`), dead);
	mkdirSync(join(home, "cursors"), { recursive: true });
	writeFileSync(join(home, "cursors", "agent-events.json"), JSON.stringify({
		names: { fixer: { state: "dead", generation: next, pending: [{ event: { session: "s9" } }] }, other: { pending: [{ event: { session: "s8" } }] } },
	}));
	const both = await sweep(false, T0);
	ok(both.includes(`would sweep:watch-dead:fixer:${next}`), both);
	ok(both.includes("would sweep:held:other:s8"), both);
	ok(both.includes("would sweep:held:fixer:s9"), both);
});

await check("5. then-done of the last open then of a generation removes the watch; with another open then it stays", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "round 1 plan"]);
	await inbox(["then", id, "--when", "agent-result:fixer", "--", "round 2 plan"]);
	await inbox(["then-done", id, "1"]);
	strictEqual(readAgents().length, 1, "another open then of the generation keeps the watch");
	await inbox(["then-done", id, "2"]);
	strictEqual(readAgents().length, 0, "the last one removes it");
	await rejects(inbox(["then", id, "--when", "agent-result:fixer", "--", "x"]), /not watched: fixer/);
});

await check("concurrent agent add and then-done in two processes: neither times out, state stays consistent", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan"]);
	const bin = join(import.meta.dirname, "..", "..", "bin", "inbox");
	const run = (args) => new Promise((resolve) => {
		const child = spawn(bin, args, { env: { ...process.env, WAYNE_INBOX_DIR: home }, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		child.on("close", (code) => resolve({ code, out }));
	});
	for (let i = 0; i < 5; i++) {
		const n = String(i + 1);
		const [add, done] = await Promise.all([
			run(["agent", "add", `other${i}`, "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "other plan"]),
			run(["then-done", id, n]),
		]);
		strictEqual(add.code, 0, add.out);
		ok(done.code === 0 || /already done|no then/.test(done.out), done.out);
	}
	const open = readThens().filter((t) => !t.done).map((t) => t.when);
	const watched = readAgents().map((a) => a.name).sort();
	deepStrictEqual(watched, [...new Set(open.map((w) => w.slice("agent-result:".length)))].sort(), "every watch has an open then and every open then a watch");
});

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
