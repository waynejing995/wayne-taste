/**
 * The verdict gate: a session that stopped without a new RESULT (idle, ask, blocked row) is closed only with a
 * verdict and a note, `waiting-user` turns the row into Wayne's question, and every other row closes as before.
 *
 *   node inbox/tests/verdict.test.mjs
 */
import { deepStrictEqual, match, ok, rejects, strictEqual } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "../../tests/host.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const { recordAgentRow } = await jiti.import("../cli/agents.ts");
const { needsVerdict, readTsv } = await jiti.import("../cli/ledger.ts");

const RULES = `agents:
  "*":
    - when: { event: result }
      tag: agent-result
      action: do
    - when: { event: idle }
      tag: agent-no-result
      action: do
    - when: { event: ask }
      tag: agent-ask
      action: do
    - when: { event: blocked }
      tag: agent-trouble
      action: notify
    - when: { event: custom }
      tag: my-own-tag
      action: do
`;

let failed = 0;
let home;
async function check(label, fn) {
	home = mkdtempSync(join(tmpdir(), "inbox-verdict-"));
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

const live = () => readTsv(join(home, "ledger.tsv"));
const archived = () => readTsv(join(home, "archive.tsv"));
/** One agent row as the probe or the tailer records it; returns its id. */
const agentRow = (event, key, note = "last said: which branch?") =>
	recordAgentRow({ source: "agents", place: "n", key, subject: `n ${event}`, fields: [`event=${event}`], note }).split(" ")[1];
const REFUSAL = /stopped without a new RESULT\. Read what the session last said \(the row note\), record what it waits on, then: inbox done <id> --verdict advanced --note "<what you sent into the session>" \| --verdict waiting-user --note "<the question for Wayne>" \| --verdict nothing-pending --note "<why nothing is owed>"$/;

for (const [label, event, key, tag] of [
	["an agent-no-result row", "idle", "agents:n:g1:idle:1", "agent-no-result"],
	["an agent-ask row", "ask", "agents:n:g1:s1:7", "agent-ask"],
	["a probe blocked row", "blocked", "agents:n:g1:blocked:1", "agent-trouble"],
]) {
	await check(`done on ${label} without --verdict is refused and the row stays`, async () => {
		const id = agentRow(event, key);
		strictEqual(live()[0].tag, tag);
		await rejects(inbox(["done", id, "--note", "handled"]), (e) => e.message.startsWith(`#${id} stopped`) && REFUSAL.test(e.message));
		deepStrictEqual([live().map((r) => [r.id, r.state, r.note]), archived()], [[[id, "open", "last said: which branch?"]], []]);
	});
}

await check("a user's own tag on an idle key needs a verdict; a result row and an ask-wayne row do not", () => {
	deepStrictEqual(
		[
			{ source: "agents", tag: "my-own-tag", key: "agents:n:g1:idle:2" },
			{ source: "agents", tag: "my-own-tag", key: "agents:n:ask:3" },
			{ source: "agents", tag: "agent-result", key: "agents:n:v:abc" },
			{ source: "agents", tag: "ask-wayne", key: "agents:n:g1:idle:2" },
			{ source: "github", tag: "agent-ask", key: "agents:n:g1:idle:2" },
		].map(needsVerdict),
		[true, true, false, false, false],
	);
});

await check("--force without --verdict is still refused and closes no then", async () => {
	const id = agentRow("idle", "agents:n:g1:idle:1");
	await rejects(inbox(["done", id, "--force", "--note", "drop it"]), REFUSAL);
	strictEqual(live().length, 1);
});

await check("--verdict without a note is refused; a value outside the three is the choices error", async () => {
	const id = agentRow("idle", "agents:n:g1:idle:1");
	await rejects(inbox(["done", id, "--verdict", "advanced"]), /--verdict needs --note/);
	await rejects(inbox(["done", id, "--verdict", "advanced", "--note", "  "]), /--verdict needs --note/);
	await rejects(inbox(["done", id, "--verdict", "later", "--note", "x"]), /Invalid value for '--verdict': 'later' is not one of 'advanced', 'waiting-user', 'nothing-pending'\./);
	strictEqual(live().length, 1);
});

for (const verdict of ["advanced", "nothing-pending"]) {
	await check(`${verdict} archives the row with the verdict in the note`, async () => {
		const id = agentRow("idle", "agents:n:g1:idle:1");
		strictEqual(await inbox(["done", id, "--verdict", verdict, "--note", "told it to\tuse main"]), `done ${id}`);
		deepStrictEqual([live(), archived().map((r) => [r.id, r.state, r.note])], [[], [[id, "done", `[${verdict}] told it to use main`]]]);
	});
}

await check("waiting-user keeps the row live as ask-wayne; a later plain done archives it", async () => {
	const id = agentRow("ask", "agents:n:g1:s1:7");
	const out = await inbox(["done", id, "--verdict", "waiting-user", "--note", "merge to main or to release?"]);
	match(out, new RegExp(`^waiting-user ${id}\\b`));
	const [row] = live();
	deepStrictEqual(
		[row.id, row.tag, row.action, row.owner, row.state, row.note, archived()],
		[id, "ask-wayne", "notify", "wayne", "open", "[waiting-user] merge to main or to release? | was: last said: which branch?", []],
	);
	strictEqual(await inbox(["done", id, "--note", "Wayne: main"]), `done ${id}`);
	deepStrictEqual([live(), archived().map((r) => [r.id, r.tag, r.note])], [[], [[id, "ask-wayne", "Wayne: main"]]]);
});

await check("the session's next row does not supersede Wayne's question", async () => {
	const id = agentRow("idle", "agents:n:g1:idle:1");
	await inbox(["done", id, "--verdict", "waiting-user", "--note", "ship it?"]);
	const next = agentRow("idle", "agents:n:g1:idle:2");
	deepStrictEqual(live().map((r) => [r.id, r.tag]), [[id, "ask-wayne"], [next, "agent-no-result"]]);
});

await check("a non-agent row closes without a verdict, also beside one that needs it", async () => {
	const plain = (await inbox(["ask", "Ship it?", "--key", "t1"])).split(" ")[1];
	strictEqual(await inbox(["done", plain, "--note", "yes"]), `done ${plain}`);
	const other = (await inbox(["ask", "Again?", "--key", "t2"])).split(" ")[1];
	const idle = agentRow("idle", "agents:n:g1:idle:1");
	await rejects(inbox(["done", other, idle, "--note", "x"]), (e) => e.message.startsWith(`#${idle} stopped`));
	strictEqual(live().length, 2, "a refusal changes nothing");
	const out = await inbox(["done", other, idle, "--verdict", "waiting-user", "--note", "which?"]);
	strictEqual(out, `done ${other}\nwaiting-user ${idle} (now ask-wayne, still live)`);
	deepStrictEqual([live().map((r) => r.id), archived().find((r) => r.id === other).note], [[idle], "which?"]);
});

const idleRow = (key, said, goal = "") =>
	recordAgentRow({ source: "agents", place: "n", key, subject: "n idle", fields: ["event=idle", "state=no-result"], note: `turn ended with no new RESULT. Last output: ${said}${goal ? `. Goal: ${goal}` : ""}` });

await check("two turn ends with the same last output make one no-result row, also after nothing-pending closed it", async () => {
	const first = idleRow("agents:n:s1:idle:100", "waiting on I5", "wave 4");
	match(first, /^do \d+ agent-no-result$/);
	match(idleRow("agents:n:s1:idle:200", "waiting on  I5", "wave 4"), /^skip repeat/);
	strictEqual(live().length, 1);
	await inbox(["done", first.split(" ")[1], "--verdict", "nothing-pending", "--note", "waits on its subagents"]);
	match(idleRow("agents:n:s1:idle:300", "waiting on I5", "wave 4"), /^skip repeat/);
	deepStrictEqual([live().length, archived().length], [0, 1]);
});

await check("new last output, another session, or a non-idle row is recorded as before", async () => {
	idleRow("agents:n:s1:idle:100", "waiting on I5");
	match(idleRow("agents:n:s1:idle:200", "I5 is back; simplify next"), /^do \d+ agent-no-result$/);
	match(idleRow("agents:n:s2:idle:300", "I5 is back; simplify next"), /^do \d+ agent-no-result$/);
	match(agentRow("ask", "agents:n:s2:s:9", "Last output: I5 is back; simplify next"), /^\d+$/);
});

await check("across a deploy the same last output is still one row: an older tailer's key, and what an older build kept", async () => {
	// A coordinator that has not restarted sends `agents:<name>:<launch id>:<session>:<seq>`; the probe of this build
	// sends `agents:<name>:<session>:idle:<n>`. Both name session s1.
	match(idleRow("agents:n:launch-0001:s1:7", "waiting on I5"), /^do \d+ agent-no-result$/);
	match(idleRow("agents:n:s1:idle:200", "waiting on I5"), /^skip repeat/);
	// cursors/agent-said.json as the older build wrote it: the launch id, no session.
	const file = join(home, "cursors", "agent-said.json");
	const { said } = JSON.parse(readFileSync(file, "utf8")).n;
	writeFileSync(file, JSON.stringify({ n: { generation: "launch-0001", said } }));
	match(idleRow("agents:n:s1:idle:300", "waiting on I5"), /^skip repeat/);
	match(idleRow("agents:n:s1:idle:400", "I5 is back"), /^do \d+ agent-no-result$/);
	deepStrictEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).n), ["session", "said"]);
});

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
