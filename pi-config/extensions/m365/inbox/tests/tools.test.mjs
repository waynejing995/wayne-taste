/**
 * The inbox_* tools as omp registers them (inbox/index.ts), against a temp inbox: ledger rows, then-actions and agent
 * sessions round trip through bin/inbox, and a call waiting on the ledger lock leaves omp's event loop free.
 *
 *   node inbox/tests/tools.test.mjs
 */
import { deepStrictEqual, match, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti, PI } from "../../tests/host.mjs";

const tmp = mkdtempSync(join(tmpdir(), "inbox-tools-"));
process.env.WAYNE_INBOX_DIR = join(tmp, "inbox");
mkdirSync(process.env.WAYNE_INBOX_DIR);
globalThis.fetch = async (url) => {
	throw new Error(`a test reached the network: ${url}`);
};

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${PI}/dist/index.js`,
		"@earendil-works/pi-ai": `${PI}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${PI}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${PI}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const extension = await jiti.import("../index.ts", { default: true });
const tools = new Map();
extension({ registerTool: (t) => tools.set(t.name, t), registerCommand: () => {}, on: () => {} });

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
const call = async (name, params, signal) => (await tools.get(name).execute("t", params, signal, undefined, {})).content[0].text;
const fails = (name, params) => call(name, params).then((t) => `succeeded: ${t}`, (e) => e.message);
const { readAgents } = await jiti.import("../cli/agents.ts");
const { readTsv, inboxFile } = await jiti.import("../cli/ledger.ts");
const ledger = () => readTsv(inboxFile("ledger.tsv")).map((r) => [r.id, r.state, r.owner]);
const names = () => readAgents().map((a) => a.name).sort();

await check("omp registers every inbox tool", () =>
	deepStrictEqual([...tools.keys()].sort(), [
		"inbox_agent_add", "inbox_agent_ls", "inbox_agent_rm", "inbox_ask", "inbox_done", "inbox_fact", "inbox_facts",
		"inbox_ls", "inbox_set", "inbox_then", "inbox_then_done",
	]),
);

await check("ask, set and ls round trip a row", async () => {
	deepStrictEqual(await call("inbox_ask", { text: "Ship it?", key: "t1" }), "notify 1 ask-wayne");
	await call("inbox_set", { ids: ["1"], state: "claimed", owner: "me" });
	const row = (await call("inbox_ls", { state: ["claimed"] })).split("\n")[1].split("\t");
	deepStrictEqual([row[0], row[2], row[7], row[8]], ["1", "Ship it?", "claimed", "me"]);
});

await check("then and then-done attach and close a deferred action", async () => {
	deepStrictEqual(await call("inbox_then", { row: "1", when: "at:2099-01-01 00:00", action: "--tell the user" }), "then 1.1 waits for at:2099-01-01 00:00");
	match(await call("inbox_ls", {}), /# then 1\.1 .*--tell the user/);
	match(await call("inbox_then_done", { row: "1", n: "1", note: "not needed" }), /^then-done 1\.1 \(cancelled before it fired\)$/);
});

await check("a bad trigger is the CLI's own error", async () => {
	const err = await call("inbox_then", { row: "1", when: "tomorrow", action: "x" }).catch((e) => e.message);
	match(err, /^inbox then: Error: bad trigger 'tomorrow'/);
});

await check("agent add, ls and rm register and drop a session", async () => {
	match(await call("inbox_agent_add", { name: "r7", mux: "tern", pane: "42", row: "1", then: "reply in self-chat", result: "/tmp/RESULT-r7-r1.md", push: true }), /r7/);
	const line = (await call("inbox_agent_ls", {})).split("\t");
	deepStrictEqual([line[0], line[1], line[2], line[3], line[4], line.at(-1)], ["r7", "tern", "local", "42", "/tmp/RESULT-r7-r1.md", "push"]);
	await call("inbox_agent_rm", { names: ["r7"] });
	deepStrictEqual(await call("inbox_agent_ls", {}), "(no output)");
});

await check("agent add carries the reuse rule in its description", () => {
	const d = tools.get("inbox_agent_add").description;
	for (const re of [/run inbox_agent_ls first/, /register it again under the same name/, /NEW result file \(RESULT-<topic>-rN\.md\)/, /topic is unrelated or the old pane is gone/]) match(d, re);
});

await check("a call waiting on the ledger lock leaves the event loop free", async () => {
	const lock = join(process.env.WAYNE_INBOX_DIR, "ledger.tsv.lock");
	writeFileSync(lock, "");
	let settled = false;
	const asked = call("inbox_ask", { text: "Locked?", key: "t2" }).finally(() => (settled = true));
	const ticks = [];
	const timer = setInterval(() => ticks.push(settled), 50);
	await new Promise((r) => setTimeout(r, 600));
	rmSync(lock);
	deepStrictEqual(await asked, "notify 2 ask-wayne");
	clearInterval(timer);
	ok(ticks.length >= 8, `timer fired ${ticks.length} times`);
	ok(ticks.slice(0, 8).every((s) => s === false), "the timer fired while the call still waited");
});

// A value that looks like a flag is data: options go first, positionals after `--` (r7b review).
await check("agent add with the name --help registers a session called --help", async () => {
	await call("inbox_agent_add", { name: "--help", mux: "tern", pane: "1", row: "1", then: "t" });
	deepStrictEqual(names(), ["--help"]);
});

await check("agent ls keeps the trailing empty fields of its last row", async () => {
	deepStrictEqual((await call("inbox_agent_ls", {})).split("\t").length, 8);
});

await check("agent rm with names r7 and --help removes both", async () => {
	await call("inbox_agent_add", { name: "r7", mux: "tern", pane: "2", row: "1", then: "t" });
	deepStrictEqual(names(), ["--help", "r7"]);
	await call("inbox_agent_rm", { names: ["r7", "--help"] });
	deepStrictEqual(names(), []);
});

await check("set and done with the id --help are errors and change no row", async () => {
	const before = ledger();
	match(await fails("inbox_set", { ids: ["--help"], state: "open" }), /^inbox set: Error: no such id: --help$/);
	match(await fails("inbox_done", { ids: ["--help"], note: "x" }), /^inbox done: Error: no such live id: --help$/);
	deepStrictEqual(ledger(), before);
});

await check("ask and then take text that looks like a flag as text", async () => {
	deepStrictEqual(await call("inbox_ask", { text: "--help", key: "t3" }), "notify 3 ask-wayne");
	deepStrictEqual(readTsv(inboxFile("ledger.tsv")).find((r) => r.id === "3")?.subject, "--help");
	match(await call("inbox_then", { row: "3", when: "at:2099-01-01 00:00", action: "--help" }), /^then 3\.1 waits/);
});

await check("a cancelled call kills its child: the row is never recorded", async () => {
	const lock = join(process.env.WAYNE_INBOX_DIR, "ledger.tsv.lock");
	writeFileSync(lock, "");
	const abort = new AbortController();
	const asked = call("inbox_ask", { text: "Cancelled?", key: "t4" }, abort.signal).then(() => "finished", (e) => e.message);
	await new Promise((r) => setTimeout(r, 300));
	abort.abort();
	match(await asked, /^inbox ask: .*abort/i);
	rmSync(lock);
	await new Promise((r) => setTimeout(r, 300));
	ok(!readTsv(inboxFile("ledger.tsv")).some((r) => r.key === "ask-wayne:t4"), "the killed child wrote no row");
});

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nall green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
