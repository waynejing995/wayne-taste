/**
 * `inbox rules-migrate` rewrites the real legacy teams-digest and leaves the rest of rules.yaml alone.
 *
 *   node inbox/tests/migrate.test.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../../tests/host.mjs";
import YAML from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const { stamp } = await jiti.import("../cli/ledger.ts");

const LEGACY = readFileSync(join(HERE, "fixtures", "legacy-rules.yaml"), "utf8");
const TEMPLATE = readFileSync(join(HERE, "..", "templates", "rules.yaml"), "utf8");
const templateJob = YAML.parse(TEMPLATE, { version: "1.1" }).schedule.find((job) => job.name === "teams-digest");

let failed = 0;
let home;
async function check(label, fn) {
	home = mkdtempSync(join(tmpdir(), "inbox-migrate-"));
	process.env.WAYNE_INBOX_DIR = home;
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.stack ?? e.message}`);
	}
}
const run = (...args) => inbox(args);

function outside(text) {
	const start = text.indexOf("schedule:");
	const end = text.indexOf("\n# Teams watches");
	return text.slice(0, start) + text.slice(end);
}

await check("the live legacy digest migrates and a second run is a no-op", async () => {
	const file = join(home, "rules.yaml");
	writeFileSync(file, LEGACY);
	const before = new Date();
	const out = await run("rules-migrate");
	const after = new Date();
	const text = readFileSync(file, "utf8");
	const job = YAML.parse(text, { version: "1.1" }).schedule.find((item) => item.name === "teams-digest");
	if (job.action.text !== templateJob.action.text) throw new Error(`action text differs from the template`);
	if (job.action.kind !== "digest") throw new Error(`kind ${job.action.kind}: a build from before the receipt contract would run it as a plain prompt`);
	if (JSON.stringify(job.tools) !== JSON.stringify(templateJob.tools)) throw new Error(`tools ${JSON.stringify(job.tools)}`);
	if (job.enabled !== true || job.last_ok !== "2026-11-13 15:53" || job.fires !== 21) throw new Error(`config not kept: ${JSON.stringify({ enabled: job.enabled, last_ok: job.last_ok, fires: job.fires })}`);
	const want = [stamp(new Date(before.getTime() - 7 * 86400_000)), stamp(new Date(after.getTime() - 7 * 86400_000))];
	if (!want.includes(job.backfill_since)) throw new Error(`backfill_since ${job.backfill_since}, want one of ${want.join(" | ")}`);
	if (!out.includes(`backfill_since ${job.backfill_since}`)) throw new Error(`output ${JSON.stringify(out)}`);
	if (outside(text) !== outside(LEGACY)) throw new Error(`bytes outside the schedule block changed`);
	const second = await run("rules-migrate");
	if (second !== "rules.yaml already current") throw new Error(`second run: ${JSON.stringify(second)}`);
	if (readFileSync(file, "utf8") !== text) throw new Error("second run rewrote the file");
});

await check("an active_since digest without a receipt migrates and gets no backfill", async () => {
	const file = join(home, "rules.yaml");
	const text = LEGACY
		.replace("You read the watched Teams chats", "You read the Teams chats")
		.replace("The chats are the `teams_watch.chats` list (chat name, chat_id) in\n        rules.yaml in the current directory, plus the self-chat (`target: self`).", "Read the self-chat (`target: self`).")
		.replace("with `limit` 200", "with `since` {{since}}");
	writeFileSync(file, text);
	const out = await run("rules-migrate");
	const job = YAML.parse(readFileSync(file, "utf8"), { version: "1.1" }).schedule.find((item) => item.name === "teams-digest");
	if (job.action.text !== templateJob.action.text) throw new Error("action text differs from the template");
	if (job.backfill_since !== undefined) throw new Error(`backfill added: ${job.backfill_since}`);
	if (out !== "migrated teams-digest") throw new Error(`output ${JSON.stringify(out)}`);
});

await check("a receipt prompt from before the digest kind becomes a digest job without a backfill", async () => {
	const file = join(home, "rules.yaml");
	const text = LEGACY.replace("You read the watched Teams chats", "You read the Teams chats and then the {{receipt}}");
	writeFileSync(file, text);
	const out = await run("rules-migrate");
	const job = YAML.parse(readFileSync(file, "utf8"), { version: "1.1" }).schedule.find((item) => item.name === "teams-digest");
	if (out !== "migrated teams-digest" || job.action.kind !== "digest" || job.backfill_since !== undefined) throw new Error(`output ${JSON.stringify(out)} kind ${job.action.kind} backfill ${job.backfill_since}`);
	if ((await run("rules-migrate")) !== "rules.yaml already current") throw new Error("second run migrated again");
});

await check("running migrate-rules.ts directly never claims a migration it did not write", () => {
	const file = join(home, "rules.yaml");
	writeFileSync(file, "schedule:\n  - name: teams-digest\n    action:\n      kind: prompt\n      text: Read watched chats with limit 200.\n");
	const before = readFileSync(file, "utf8");
	const result = spawnSync("node", ["--no-warnings", "--import", join(ROOT, "bin", "strip-types.mjs"), "inbox/cli/migrate-rules.ts", "--file", file], {
		cwd: ROOT,
		encoding: "utf8",
		env: { ...process.env, HOME: home, WAYNE_INBOX_DIR: home },
	});
	const printed = `${result.stdout}${result.stderr}`;
	if (printed.includes("migrated") && readFileSync(file, "utf8") === before) throw new Error(`printed a migration and wrote nothing:\n${printed}`);
});


process.exitCode = failed ? 1 : 0;
