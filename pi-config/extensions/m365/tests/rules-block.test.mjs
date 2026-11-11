/**
 * The program-kept lists of the hand-written rules.yaml are rewritten in place: every byte outside the one block
 * (comments, other sections, blank lines, the missing final newline) stays as the user wrote it.
 *
 *   node tests/rules-block.test.mjs
 */
import { strictEqual } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "./host.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { replaceBlock } = await jiti.import("../core/rules-block.ts");
const { inbox } = await jiti.import("../inbox/cli/main.ts");

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

const NEW = "# Scheduled jobs. new header\nschedule:\n  - x\n";
const put = (text) => replaceBlock(text, "schedule", "# Scheduled jobs.", NEW);

await check("a comment above the next section stays with it", () => {
	strictEqual(put("schedule: []\n# Keep agents header\nagents: []\n"), `${NEW}# Keep agents header\nagents: []\n`);
});

await check("a block in the middle is replaced where it is; blank lines and the sections around it stay", () => {
	const text = "github:\n  acme: []\n\n# Scheduled jobs. old header\nschedule:\n  - name: a\n\n  - name: b\n\n\n# Teams\nteams_watch:\n  chats: []";
	strictEqual(put(text), `github:\n  acme: []\n\n${NEW}\n\n# Teams\nteams_watch:\n  chats: []`);
});

await check("column-0 list items belong to the block; the next key ends it", () => {
	strictEqual(put("schedule:\n- name: a\n- name: b\nagents: {}\n"), `${NEW}agents: {}\n`);
});

await check("a missing block is appended after one blank line; a missing final newline is kept elsewhere", () => {
	strictEqual(put("github: {}"), `github: {}\n\n${NEW}`);
	strictEqual(put(""), NEW);
	strictEqual(put("x: 1\nschedule: []"), `x: 1\n${NEW}`);
});

await check("a key that only starts with the name is not the block", () => {
	strictEqual(put("schedule_old: 1\n"), `schedule_old: 1\n\n${NEW}`);
});

await check("inbox schedule add keeps the comment and section that follow the schedule block", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rules-block-"));
	process.env.WAYNE_INBOX_DIR = dir;
	const tail = "# Keep agents header\nagents:\n  \"*\": []\n";
	writeFileSync(join(dir, "rules.yaml"), `# my rules\nschedule: []\n${tail}`);
	await inbox(["schedule", "add", "hello", "--every", "5", "--kind", "shell", "--action", '["true"]']);
	await inbox(["agent", "add", "w1", "--mux", "tmux", "--pane", "s:1"]);
	const text = readFileSync(join(dir, "rules.yaml"), "utf8");
	strictEqual(text.startsWith("# my rules\n# Scheduled jobs."), true, text);
	strictEqual(text.includes(`  next_fire: `) && text.includes(tail), true, text);
	strictEqual(text.indexOf(tail) > text.indexOf("next_fire"), true, "the schedule block stays where it was");
});

process.exit(failed === 0 ? 0 : 1);
