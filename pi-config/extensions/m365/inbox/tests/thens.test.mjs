/**
 * Deferred actions (`inbox then`): a trigger makes one `do` card quoting the action, an open fired then gets one
 * reminder after 10 minutes, `done` refuses while one is open, and an unfired trigger makes nothing.
 *
 *   node inbox/tests/thens.test.mjs
 */
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../../tests/host.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const { checkThens, readThens } = await jiti.import("../cli/thens.ts");
const { readAgents, removeAgents, writeAgents } = await jiti.import("../cli/agents.ts");
const { readTsv } = await jiti.import("../cli/ledger.ts");
const { parseStamp } = await jiti.import("../cli/jobs.ts");

const RULES = `github:
  acme/app:
    - when: { event: merged }
      action: log
agents:
  "*":
    - when: { event: result }
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
	const result = (seq) => inbox(["add", "--source", "agents", "--place", "fixer", "--key", `agents:fixer:s1:${seq}`, "--subject", "agent fixer", "--note", "RESULT status: done. Last output: ok", "--field", "event=result"]);
	await result(1);
	await inbox(["then", id, "--when", "agent-result:fixer", "--", "verify the fix and report"]);
	deepStrictEqual(await checkThens({ now: T0 }), [], "the RESULT from before the then is not its trigger");
	await result(2);
	await checkThens({ now: T0 });
	ok(thenRows()[0].note.includes("you owe: verify the fix and report [RESULT status: done"), thenRows()[0].note);
});

await check("agent add arms its plan on the row: the next RESULT fires it and the row stays open until it is done", async () => {
	await rejects(inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", "999", "--then", "x"]), /no such live id: 999/);
	strictEqual(await inbox(["agent", "ls"]), "", "a bad row registers nothing");
	const id = await row();
	ok((await inbox(["agent", "add", "fixer", "--mux", "tmux", "--pane", "s:1", "--row", id, "--then", "expect PR open; reply Wayne; close row"])).endsWith(`then ${id}.1 waits for agent-result:fixer`));
	await inbox(["add", "--source", "agents", "--place", "fixer", "--key", "agents:fixer:s1:1", "--subject", "agent fixer", "--note", "RESULT status: done", "--field", "event=result"]);
	await checkThens({ now: T0 });
	ok(thenRows()[0].note.includes("you owe: expect PR open; reply Wayne; close row"), thenRows()[0].note);
	await rejects(inbox(["done", id]), /open then-actions/);
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

await check("a fired then left open gets exactly one reminder after 10 minutes; then-done stops it", async () => {
	const id = await row();
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "send the summary"]);
	await inbox(["then", id, "--when", "at:2026-11-11 10:00", "--", "close the ticket"]);
	await checkThens({ now: T0 });
	await inbox(["then-done", id, "2"]);
	deepStrictEqual(await checkThens({ now: plus(9) }), [], "no reminder before 10 minutes");
	const lines = await checkThens({ now: plus(10) });
	strictEqual(lines.length, 1, lines.join("\n"));
	ok(lines[0].startsWith(`reminded ${id}.1`), lines[0]);
	deepStrictEqual(await checkThens({ now: plus(30) }), [], "one reminder only");
	const reminders = thenRows().filter((r) => r.note.startsWith("Reminder:"));
	strictEqual(reminders.length, 1);
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

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
