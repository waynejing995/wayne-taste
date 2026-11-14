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
const call = async (name, params) => (await tools.get(name).execute("t", params, undefined, undefined, {})).content[0].text;

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

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nall green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
