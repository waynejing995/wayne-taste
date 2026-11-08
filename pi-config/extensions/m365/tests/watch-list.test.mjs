/**
 * The Teams watch resume list (teams/watch-list.ts, the teams_watch section of rules.yaml): a failed save is a
 * warning, never a thrown error; two sessions editing it at once both land; the hand-written rules stay as written.
 *
 *   node --experimental-strip-types tests/watch-list.test.mjs
 */
import { deepStrictEqual, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const LIST_TS = join(dirname(dirname(fileURLToPath(import.meta.url))), "teams", "watch-list.ts");
const root = mkdtempSync(join(tmpdir(), "watch-list-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

let failed = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.message}`);
	}
}

/** The module, loaded fresh against its own inbox directory. */
async function listIn(dir) {
	process.env.WAYNE_INBOX_DIR = dir;
	return import(`${LIST_TS}?${dir}`);
}

await check("a bad file is a warning: the save returns it instead of throwing, and the file is left as it was", async () => {
	const dir = join(root, "bad");
	mkdirSync(dir);
	const m = await listIn(dir);
	writeFileSync(m.WATCH_LIST, "teams_watch:\n  chats: 5\n");
	const warn = m.rememberWatch({ chat: "a", chat_id: "1", policy: "" });
	ok(warn.startsWith(" Warning: not saved"), warn);
	deepStrictEqual(readFileSync(m.WATCH_LIST, "utf8"), "teams_watch:\n  chats: 5\n");
});

await check("two processes adding different chats at once: both chats are in the file", async () => {
	const dir = join(root, "race");
	mkdirSync(dir);
	const writer = (ids) =>
		new Promise((resolve, reject) => {
			const code = `const m = await import(${JSON.stringify(LIST_TS)}); const w = []; for (const id of ${JSON.stringify(ids)}) w.push(m.rememberWatch({ chat: id, chat_id: id, policy: "" })); if (w.join("")) { console.error(w.join("")); process.exit(1); }`;
			const p = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], { env: { ...process.env, WAYNE_INBOX_DIR: dir }, stdio: ["ignore", "ignore", "pipe"] });
			let err = "";
			p.stderr.on("data", (d) => (err += d));
			p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(err))));
		});
	const a = Array.from({ length: 30 }, (_, i) => `a${i}`);
	const b = Array.from({ length: 30 }, (_, i) => `b${i}`);
	await Promise.all([writer(a), writer(b)]);
	const saved = YAML.parse(readFileSync(join(dir, "rules.yaml"), "utf8")).teams_watch.chats.map((c) => c.chat_id).sort();
	deepStrictEqual(saved, [...a, ...b].sort());
});

await check("the rules before the section stay byte for byte, and the section is replaced, not repeated", async () => {
	const dir = join(root, "keep");
	mkdirSync(dir);
	const m = await listIn(dir);
	const rules = "# mine\ngithub: # repos\n  o/r:\n    - when: { number: [\"1\"], event: merged }\n      action: log\n";
	writeFileSync(m.WATCH_LIST, rules);
	m.rememberWatch({ chat: "a", chat_id: "1", policy: "omp: then reply" });
	m.rememberInterval(12);
	m.forgetWatch("1");
	m.rememberWatch({ chat: "b", chat_id: "2", policy: "" });
	const text = readFileSync(m.WATCH_LIST, "utf8");
	ok(text.startsWith(`${rules}\n# Teams watches`), text);
	deepStrictEqual(text.match(/^teams_watch:/gm).length, 1);
	deepStrictEqual(YAML.parse(text).teams_watch, { interval_sec: 12, chats: [{ chat: "b", chat_id: "2", policy: "" }] });
});

await check("a hand-edited section with no final newline is replaced whole, not left half behind", async () => {
	const dir = join(root, "eof");
	mkdirSync(dir);
	const m = await listIn(dir);
	writeFileSync(m.WATCH_LIST, "github: {}\n\nteams_watch:\n  chats: []");
	deepStrictEqual(m.rememberInterval(12), "");
	const text = readFileSync(m.WATCH_LIST, "utf8");
	ok(text.startsWith("github: {}\n\n# Teams watches"), text);
	deepStrictEqual(YAML.parse(text), { github: {}, teams_watch: { chats: [], interval_sec: 12 } });
});

console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed ? 1 : 0);
