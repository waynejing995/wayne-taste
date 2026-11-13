/**
 * Standing facts: upsert, superseded text, the shared lock, and migration idempotency.
 *
 * Synthetic facts only. No live inbox data.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, strictEqual, rejects } from "node:assert/strict";
import { createJiti } from "../../tests/host.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const { readFacts } = await jiti.import("../cli/facts.ts");
const { readTsv, withLock } = await jiti.import("../cli/ledger.ts");

let failed = 0;
async function check(label, fn) {
	process.env.WAYNE_INBOX_DIR = mkdtempSync(join(tmpdir(), "inbox-facts-"));
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (error) {
		failed++;
		console.log(`FAIL ${label}\n${error.stack ?? error.message}`);
	}
}

await check("upsert replaces one key and keeps superseded text", async () => {
	strictEqual(await inbox(["fact", "--kind", "decision", "--key", "deploy-window", "--note", "Ops Ada 11-13 09:00", "--", "Deploy after 18:00"]), "added decision:deploy-window");
	strictEqual(await inbox(["fact", "--kind", "decision", "--key", "deploy-window", "--note", "Ops Ada 11-13 10:00", "--", "Deploy after 19:00"]), "updated decision:deploy-window");
	const [fact] = readFacts();
	strictEqual(fact.text, "Deploy after 19:00");
	strictEqual(fact.superseded.join("|"), "Deploy after 18:00");
	strictEqual(fact.since, new Date().toISOString().slice(0, 10));
});

await check("cred stores a location and rejects a value", async () => {
	await inbox(["fact", "--kind", "cred", "--key", "ci-token", "--", "CI token lives in the release vault"]);
	await rejects(() => inbox(["fact", "--kind", "cred", "--key", "ci-token", "--", "token: abc123secret"]), /never its value/);
	await rejects(() => inbox(["fact", "--kind", "cred", "--key", "ci-token", "--", "the token abc123secret is live"]), /never its value/);
});

await check("fact writes use the ledger lock", async () => {
	const lock = join(process.env.WAYNE_INBOX_DIR, "ledger.tsv.lock");
	const { spawnSync } = await import("node:child_process");
	const started = spawnSync(process.execPath, ["--experimental-strip-types", "-e", "import('node:fs').then(fs=>fs.mkdirSync(process.argv[1])).then(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200))", lock], { timeout: 100 });
	await rejects(() => inbox(["fact", "--kind", "info", "--key", "locked", "--", "waiting"]), /held by another writer/);
	strictEqual(started.error?.code, "ETIMEDOUT");
});

await check("migration is idempotent and keeps the newest repeated key", async () => {
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	const rows = [
		"1\tteams-fact:release-window\tRelease window is 18:00\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t",
		"2\tteams-fact:release-window\tRelease window is 19:00\t2026-11-13 10:00\tdigest\tteams-fact\tlog\topen\t\tOps Bo\t",
	];
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n${rows.join("\n")}\n`);
	const script = join(process.env.WAYNE_INBOX_DIR, "..", "migrate.mjs");
	const { spawnSync } = await import("node:child_process");
	const root = new URL("../cli/migrate-facts.ts", import.meta.url);
	const once = spawnSync(process.execPath, ["--experimental-strip-types", root.pathname, "--dir", process.env.WAYNE_INBOX_DIR], { encoding: "utf8" });
	strictEqual(once.status, 0, once.stderr);
	const twice = spawnSync(process.execPath, ["--experimental-strip-types", root.pathname, "--dir", process.env.WAYNE_INBOX_DIR], { encoding: "utf8" });
	strictEqual(twice.status, 0, twice.stderr);
	const facts = readFacts();
	strictEqual(facts.length, 1);
	strictEqual(facts[0].text, "Release window is 19:00");
	strictEqual(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")).length, 0);
	strictEqual(readTsv(join(process.env.WAYNE_INBOX_DIR, "archive.tsv")).every((row) => row.note === "moved to facts.md"), true);
	void script;
});

await check("migration refuses the default live directory", async () => {
	const { spawnSync } = await import("node:child_process");
	const script = new URL("../cli/migrate-facts.ts", import.meta.url);
	const result = spawnSync(process.execPath, ["--experimental-strip-types", script.pathname, "--dry-run"], { encoding: "utf8" });
	ok(result.status !== 0 && result.stderr.includes("--dir is required"), result.stderr);
});

if (failed) process.exit(1);
