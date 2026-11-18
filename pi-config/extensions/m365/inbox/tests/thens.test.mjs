/**
 * Deferred actions (`inbox then`): a trigger makes one `do` card quoting the action, an open fired then gets one
 * reminder per check (10 min, 1 h, 4 h, then daily from its last card), `done` refuses while one is open, and an unfired trigger makes nothing.
 *
 *   node inbox/tests/thens.test.mjs
 */
import { spawn } from "node:child_process";
import { deepStrictEqual, match, ok, rejects, strictEqual } from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../../tests/host.mjs";
import { fakePanes } from "./pane.mjs";

// `inbox agent add` probes its pane: every tmux pane these tests name holds an agent process.
process.env.HOME = mkdtempSync(join(tmpdir(), "inbox-thens-home-"));
fakePanes(process.env.HOME);

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const { checkThens, readThens } = await jiti.import("../cli/thens.ts");
const { sweep } = await jiti.import("../cli/sweep.ts");
const { closeAgent, killGuard, readAgents, writeAgents } = await jiti.import("../cli/agents.ts");
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
	const result = (seq) => inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${String(seq).padStart(16, "0")}`, "--subject", "agent fixer", "--note", "RESULT status: done. Last output: ok", "--field", "event=result"]);
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
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${"1".repeat(16)}`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await checkThens({ now: T0 });
	ok(thenRows()[0].note.includes("you owe: expect PR open; reply Wayne; close row"), thenRows()[0].note);
	await rejects(inbox(["done", id]), /open then-actions/);
});

await check("after a re-add with a new plan, the next RESULT fires the new plan only", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "old plan"]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "new plan"]);
	deepStrictEqual(readThens().map((t) => [t.action, t.note]), [["old plan", "replaced by a new plan"], ["new plan", undefined]]);
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${"2".repeat(16)}`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await checkThens({ now: T0 });
	deepStrictEqual(thenRows().length, 1);
	ok(thenRows()[0].note.includes("you owe: new plan [RESULT status: done (row #"), thenRows()[0].note);
});

await check("agent add without a plan is a watch with no then; --row and --then go together; a re-add without one leaves the plan armed", async () => {
	const id = await row();
	await rejects(inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id]), /--row and --then go together/);
	await rejects(inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--then", "plan"]), /--row and --then go together/);
	deepStrictEqual([readAgents(), readThens()], [[], []], "a refusal writes nothing");
	ok((await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1"])).endsWith("\nno plan armed"));
	deepStrictEqual([readAgents().map((a) => a.name), readThens()], [["fixer"], []]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "the plan"]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2"]);
	deepStrictEqual([readAgents().map((a) => a.pane), readThens().filter((t) => !t.done).map((t) => t.action)], [["s:2"], ["the plan"]]);
});

await check("the watched session's RESULT event fires the plan and leaves the watch; another session under the name fires nothing", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "the plan"]);
	const tailer = new AgentTailer({ dir: home, inbox, warn: () => {} });
	const event = (session, pid, seq) => JSON.stringify({ v: 1, ts: new Date(Date.now() + 5000 + seq).toISOString(), name: "fixer", pid, session, seq, type: "result", text: "done", result: { status: "done", path: "/r", version: String(seq).padStart(16, "0") } });
	// `agent add` bound the watch to the pane's agent process (this one): its event binds the session.
	writeFileSync(join(home, "agent-events.jsonl"), `${event("mine", process.pid, 1)}\n${event("another", 2, 2)}\n`);
	tailer.start();
	await tailer.poke();
	tailer.stop();
	deepStrictEqual(rows().filter((r) => r.source === "agents").map((r) => r.key), [`agents:fixer:result:${"1".padStart(16, "0")}`]);
	await checkThens({ now: T0 });
	ok(thenRows()[0].note.includes("you owe: the plan [RESULT"), thenRows()[0].note);
	deepStrictEqual(readAgents().map((a) => a.name), ["fixer"], "a done RESULT leaves the watch");
});

await check("adding the same agent again cancels its previous unfired plan", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "first"]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "second"]);
	const listed = await inbox(["ls"]);
	ok(listed.includes("second") && !/then .* waits for .* first/.test(listed));
});

/** A probe result for `closeAgent`: an omp pane whose turn ended five minutes ago, no RESULT. */
const pane = (o = {}) => async () => ({ alive: true, agent: "omp", state: "", session: "/s.jsonl", smtime: 1000, waiting: true, text: "", rmtime: 0, rfile: "", rhash: "", rstatus: "", ropen_text: "", rverified: "", now: 1300, ...o });
const HASH = "a".repeat(16);
const withResult = { rfile: "/runs/RESULT-r2.md", rhash: HASH, rstatus: "done", ropen_text: "none", rverified: "tests pass" };
const watchFixer = async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "report it"]);
	return id;
};
const message = (promise) => promise.then((out) => `succeeded: ${out}`, (e) => e.message);

await check("agent close without --ack refuses and prints liveness, phase, RESULT, version and open thens", async () => {
	const id = await watchFixer();
	const said = await message(closeAgent("fixer", {}, pane(withResult)));
	strictEqual(said, [
		"fixer: alive, phase idle, idle 5 min, tmux pane s:1 on local",
		`RESULT /runs/RESULT-r2.md, version ${HASH}`,
		"  status: done",
		"  open: none",
		"  verified: tests pass",
		`open thens: ${id}.1 waits for agent-result:fixer: report it`,
		`Not closed. Read the RESULT at its source, then: inbox agent close fixer --ack ${HASH} --note <what you verified>`,
	].join("\n"));
	deepStrictEqual(readAgents().map((a) => [a.name, a.closing]), [["fixer", undefined]]);
	ok(readThens().every((t) => !t.done), "the plan stays armed");
});

await check("agent close of a session with no RESULT reports none and an unknown idle time", async () => {
	await watchFixer();
	const said = await message(closeAgent("fixer", {}, pane({ alive: false, session: "", smtime: 0, waiting: false })));
	ok(said.startsWith("fixer: gone, phase gone, idle ? min, tmux pane s:1 on local\nRESULT none, version none\n  status: -\n  open: -\n  verified: -\n"), said);
	ok(said.endsWith("inbox agent close fixer --ack none --note <what you verified>"), said);
});

await check("agent close of an unwatched name is refused through the CLI", async () => {
	await rejects(() => inbox(["agent", "close", "missing"]), /not watched: missing/);
});

await check("agent close --ack needs --note", async () => {
	await watchFixer();
	match(await message(closeAgent("fixer", { ack: "none" }, pane())), /--ack needs --note/);
	strictEqual(readAgents()[0].closing, undefined);
});

await check("agent close --ack with a stale version refuses", async () => {
	await watchFixer();
	const said = await message(closeAgent("fixer", { ack: "b".repeat(16), note: "read it" }, pane(withResult)));
	ok(said.startsWith(`--ack ${"b".repeat(16)} is not the current RESULT version ${HASH}`), said);
	ok(said.includes("  status: done"), said);
	match(await message(closeAgent("fixer", { ack: "none", note: "read it" }, pane(withResult))), /^--ack none is not the current RESULT version/);
	deepStrictEqual(readAgents().map((a) => [a.name, a.closing]), [["fixer", undefined]]);
});

await check("agent close --ack refuses a working and an asking session", async () => {
	await watchFixer();
	match(await message(closeAgent("fixer", { ack: "none", note: "n" }, pane({ waiting: false }))), /^fixer is working/);
	match(await message(closeAgent("fixer", { ack: "none", note: "n" }, pane({ state: "blocked" }))), /^fixer is asking/);
	deepStrictEqual(readAgents().map((a) => [a.name, a.closing]), [["fixer", undefined]]);
	ok(readThens().every((t) => !t.done), "the plan stays armed");
});

await check("agent close --ack refuses while a fired then of the watch is open", async () => {
	const id = await watchFixer();
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${HASH}`, "--subject", "agent fixer", "--note", "RESULT status: done.", "--field", "event=result"]);
	await checkThens({ now: T0 });
	const said = await message(closeAgent("fixer", { ack: HASH, note: "read it" }, pane(withResult)));
	ok(said.startsWith(`then ${id}.1 fired and is open`), said);
	ok(said.includes(`open thens: ${id}.1 FIRED `), said);
	deepStrictEqual(readAgents().map((a) => [a.name, a.closing]), [["fixer", undefined]]);
});

await check("agent close --ack of an idle session marks it closing, keeps it listed and closes its unfired plan", async () => {
	await watchFixer();
	strictEqual(await closeAgent("fixer", { ack: HASH, note: "read RESULT-r2, tests pass" }, pane(withResult)),
		"closing fixer: acknowledged; kill the pane now, the probe removes the watch when it is gone");
	const [entry] = readAgents();
	deepStrictEqual([entry.name, entry.closing.ack, entry.closing.note], ["fixer", HASH, "read RESULT-r2, tests pass"]);
	ok((await inbox(["agent", "ls"])).startsWith("fixer\t"));
	deepStrictEqual(readThens().map((t) => [!!t.done, t.note]), [[true, "watch closed: read RESULT-r2, tests pass"]]);
});

await check("agent close --ack of a gone session removes the watch", async () => {
	await watchFixer();
	await inbox(["agent", "add", "other", "--mux", "tmux", "--pane", "o:1", "--row", await row(), "--then", "t"]);
	strictEqual(await closeAgent("fixer", { ack: "none", note: "pane exited, nothing written" }, pane({ alive: false, session: "", smtime: 0, waiting: false })), "closed fixer");
	deepStrictEqual(readAgents().map((a) => a.name), ["other"]);
});

await check("killGuard blocks tern, tmux and herdr kills of a watched pane by id and by name, also inside ssh", () => {
	const watched = [
		{ name: "fixer", mux: "tern", host: "box", pane: "42" },
		{ name: "builder", mux: "tmux", host: "local", pane: "work:1.0" },
		{ name: "herd", mux: "herdr", host: "local", pane: "h-7" },
	];
	for (const [command, name] of [
		["tern kill 42", "fixer"],
		["tern close fixer", "fixer"],
		["ssh box 'tern kill 42'", "fixer"],
		["cd /tmp && ssh box \"tern close fixer\" && echo ok", "fixer"],
		["tmux kill-pane -t work:1.0", "builder"],
		["tmux kill-session -t work", "builder"],
		["tmux kill-window -t builder", "builder"],
		["tmux kill-server", "builder"],
		["herdr pane close h-7", "herd"],
	]) {
		const reason = killGuard(command, watched);
		ok(reason?.includes(`inbox agent close ${name}`), `${command} -> ${reason}`);
	}
});

await check("killGuard lets an acknowledged, an unwatched and another mux's pane through", () => {
	const watched = [
		{ name: "fixer", mux: "tern", host: "box", pane: "42", closing: { at: "2026-11-18 10:00", ack: "none", note: "n" } },
		{ name: "builder", mux: "tmux", host: "local", pane: "work:1.0" },
	];
	for (const command of ["tern kill 42", "ssh box 'tern close fixer'", "tern kill 43", "tmux kill-session -t other", "tern kill work:1.0", "tern kill 43; echo builder", "echo tern kill 4 2", "tern list"])
		strictEqual(killGuard(command, watched), undefined, command);
	strictEqual(killGuard("tmux kill-server", [watched[0]]), undefined);
});

await check("agent add leaves the other entries as an older build wrote them, and a re-add of a name keeps their old fields out", async () => {
	const id = await row();
	await inbox(["agent", "add", "legacy", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "old"]);
	const old = { ...readAgents()[0], generation: "launch-0001", stamped: true, instance: "first-add", migratedGeneration: "legacy", push: true };
	writeAgents([old]);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:2", "--row", id, "--then", "new", "--goal", "g"]);
	deepStrictEqual(readAgents()[0], old, "an entry this add did not create is written back whole");
	deepStrictEqual(Object.keys(readAgents()[1]), ["name", "mux", "host", "pane", "goal", "since"]);
	strictEqual(await inbox(["agent", "ls"]).then((out) => out.split("\n").length), 2);
	deepStrictEqual(readAgents()[0], old, "`agent ls` rewrites nothing");
	await inbox(["agent", "add", "legacy", "--mux", "tmux", "--pane", "s:3"]);
	deepStrictEqual(readAgents().map((a) => [a.name, Object.keys(a)]), [["fixer", ["name", "mux", "host", "pane", "goal", "since"]], ["legacy", ["name", "mux", "host", "pane", "since"]]]);
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

await check("a fired then is reminded at 10 minutes, 1 hour and 4 hours, then daily, each gap from the last card", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "send the summary"]);
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "close the ticket"]);
	await checkThens({ now: T0 });
	await inbox(["then-done", id, "2"]);
	let n = 0;
	for (const at of [10, 60, 240, 240 + 1440]) {
		deepStrictEqual(await checkThens({ now: plus(at - 1) }), [], `no reminder before ${at} minutes`);
		const lines = await checkThens({ now: plus(at) });
		strictEqual(lines.length, 1, lines.join("\n"));
		ok(lines[0].startsWith(`reminded ${id}.1`), lines[0]);
		const reminders = thenRows().filter((r) => r.note.startsWith("Reminder "));
		strictEqual(reminders.length, 1, "one live card; the earlier one was archived");
		ok(reminders[0].note.startsWith(`Reminder ${++n}:`) && reminders[0].note.includes("you still owe: send the summary"), reminders[0].note);
	}
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

await check("a plain agent-result then needs the watch and is closed when a new plan replaces it", async () => {
	const id = await row();
	await rejects(() => inbox(["then", id, "--when", "agent-result:fixer", "--", "verify the fix by hand"]), /not watched: fixer/);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "plan one"]);
	await inbox(["then", id, "--when", "agent-result:fixer", "--", "verify the fix by hand"]);
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

await check("sweep reports an overdue then, once", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "check the answer"]);
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${"9".repeat(16)}`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await checkThens({ now: T0 });
	const overdue = await sweep(false, plus(25 * 60));
	ok(overdue.includes(`would sweep:then-overdue:${id}.1:2026-11-12`), overdue);
	const applied = await sweep(true, plus(25 * 60));
	ok(applied.includes("sweep"), applied);
	strictEqual(await sweep(true, plus(25 * 60)), `seen sweep:then-overdue:${id}.1:2026-11-12`);
	await inbox(["then-done", id, "1"]);
	strictEqual(readAgents().length, 1, "closing the then leaves the watch");
	// An unfired then of a name that is no longer watched is no finding: `agent close` closes a watch's thens itself.
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "check again"]);
	writeAgents([]);
	strictEqual(await sweep(false, T0), "");
});

await check("closing the last open then of a watch leaves the watch in rules.yaml", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "round 1 plan"]);
	await inbox(["then", id, "--when", "agent-result:fixer", "--", "round 2 plan"]);
	await inbox(["then-done", id, "1"]);
	strictEqual(readAgents().length, 1, "another open then of the watch keeps it");
	strictEqual(await inbox(["then-done", id, "2"]), `then-done ${id}.2 (cancelled before it fired); watch fixer stays`);
	strictEqual(readAgents().length, 1, "the last open then does not remove the watch");
	strictEqual(readAgents()[0].name, "fixer");
});
await check("reminders: one per check after a long gap, and the previous card is archived", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "send the summary"]);
	await checkThens({ now: T0 });
	const [fired] = thenRows();
	const gap = await checkThens({ now: plus(10 + 50 + 180 + 1440) });
	strictEqual(gap.length, 1, gap.join("\n"));
	ok(gap[0].startsWith(`reminded ${id}.1`), gap[0]);
	const live = thenRows();
	strictEqual(live.length, 1, "one live card per then");
	ok(live[0].note.startsWith("Reminder 1:"), live[0].note);
	const archive = readTsv(join(home, "archive.tsv"));
	ok(archive.some((r) => r.id === fired.id && r.note.includes(`superseded by #${live[0].id}`)), archive.map((r) => r.note).join("\n"));
	const next = await checkThens({ now: plus(10 + 50 + 180 + 1440 + 9) });
	deepStrictEqual(next, [], "the next reminder waits a full gap from the last card");
});

await check("done on a then card is refused and names then-done", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "tell the team"]);
	await checkThens({ now: T0 });
	const [card] = thenRows();
	await rejects(() => inbox(["done", card.id]), new RegExp("#" + card.id + " is the card of then " + id + "\\.1: close it with `inbox then-done " + id + " 1`"));
	await rejects(() => inbox(["done", card.id, "--force", "--note", "skip it"]), new RegExp("#" + card.id + " is the card of then " + id + "\\.1"));
	ok(thenRows().some((r) => r.id === card.id), "the card stays live");
});

await check("then-done archives its card", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "tell the team"]);
	await checkThens({ now: T0 });
	const [card] = thenRows();
	strictEqual(await inbox(["then-done", id, "1", "--note", "told them"]), `then-done ${id}.1`);
	const archive = readTsv(join(home, "archive.tsv"));
	ok(archive.some((r) => r.id === card.id && r.note.includes("[then-done]") && r.note.includes("told them")), archive.map((r) => `${r.id} ${r.note}`).join("\n"));
	ok(!thenRows().some((r) => r.id === card.id));
});

await check("an agents row that is the parent row of a fired, open then is not superseded", async () => {
	const result = async (n) => (await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${String(n).repeat(16)}`, "--subject", "agent fixer", "--note", "RESULT status: partial", "--field", "event=result"])).split(" ")[1];
	const parent = await result(1);
	await inbox(["then", parent, "--when", "at:2026-11-11 10:00", "--", "answer the open question"]);
	await checkThens({ now: T0 });
	const plain = await result(2);
	const newest = await result(3);
	deepStrictEqual(rows().filter((r) => r.source === "agents").map((r) => r.id), [parent, newest], "the parent of the fired then stays; the plain row is superseded");
	ok(readTsv(join(home, "archive.tsv")).some((r) => r.id === plain && r.note.includes(`superseded by #${newest}`)));
});

await check("a then armed on an existing RESULT does not fire on that version and fires on the next", async () => {
	const id = await row();
	const baseline = "e".repeat(16);
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "the next result", "--result", "/tmp/RESULT.md"]);
	const stored = readThens();
	stored.find((t) => t.action === "the next result").baseline = { version: baseline };
	writeFileSync(join(home, "thens.json"), `${JSON.stringify(stored, null, 2)}\n`);
	const same = () => inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${baseline}`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await same();
	deepStrictEqual(await checkThens({ now: T0 }), [], "the version it was armed on is not the trigger");
	const next = "f".repeat(16);
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${next}`, "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await checkThens({ now: T0 });
	ok(thenRows().some((r) => r.note.includes("you owe: the next result")), thenRows().map((r) => r.note).join("\n"));
});

await check("an old then with generation and a stat-format baseline fires on a new version row, and keeps its generation", async () => {
	const id = await row();
	await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "old plan"]);
	const stored = readThens();
	Object.assign(stored[0], { generation: "launch-0001", baseline: { version: "1793973600.000000000 1793973600.000000000", said: "done:" } });
	writeFileSync(join(home, "thens.json"), `${JSON.stringify(stored, null, 2)}\n`);
	deepStrictEqual(await checkThens({ now: T0 }), [], "nothing reported yet");
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:result:${"1".repeat(16)}`, "--subject", "agent fixer", "--note", "RESULT status: partial", "--field", "event=result"]);
	await checkThens({ now: T0 });
	ok(thenRows().some((r) => r.note.includes("you owe: old plan")), thenRows().map((r) => r.note).join("\n"));
	strictEqual(readThens()[0].generation, "launch-0001", "a rewrite of thens.json keeps the field it does not read");
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
	ok(open.every((w) => watched.includes(w.slice("agent-result:".length))), "every open then has a watch");
	ok(watched.includes("fixer"), "closing the then leaves fixer watched");
});

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
