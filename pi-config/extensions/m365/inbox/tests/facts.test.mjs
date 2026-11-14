/**
 * Standing facts: upsert, superseded text, the shared lock, and migration idempotency.
 *
 * Synthetic facts only. No live inbox data.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, strictEqual, rejects } from "node:assert/strict";
import { createJiti } from "../../tests/host.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { inbox } = await jiti.import("../cli/main.ts");
const { readFacts } = await jiti.import("../cli/facts.ts");
const { readTsv, stamp, withLock } = await jiti.import("../cli/ledger.ts");

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
	strictEqual(fact.since, stamp().slice(0, 10));
});

await check("cred stores where a credential lives", async () => {
	strictEqual(await inbox(["fact", "--kind", "cred", "--key", "ci-token", "--", "CI token lives in the release vault"]), "added cred:ci-token");
});

await check("fact writes use the ledger lock", async () => {
	const lock = join(process.env.WAYNE_INBOX_DIR, "ledger.tsv.lock");
	const { spawn } = await import("node:child_process");
	const { mkdirSync, existsSync } = await import("node:fs");
	mkdirSync(lock);
	const holder = spawn(process.execPath, ["-e", "setTimeout(()=>require('node:fs').rmSync(process.argv[1],{recursive:true,force:true}),1500)", lock]);
	strictEqual(await inbox(["fact", "--kind", "info", "--key", "locked", "--", "waiting"]), "added info:locked", "a fact write waits as long as a ledger writer");
	await new Promise((resolve) => holder.on("exit", resolve));
	ok(!existsSync(lock));
	mkdirSync(lock);
	process.env.INBOX_LOCK_WAIT_MS = "30";
	const began = Date.now();
	await rejects(() => inbox(["fact", "--kind", "info", "--key", "locked", "--", "waiting again"]), /held by another writer/);
	ok(Date.now() - began < 500);
	delete process.env.INBOX_LOCK_WAIT_MS;
	rmSync(lock, { recursive: true, force: true });
});

await check("a malformed facts file is rejected before a write", async () => {
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "## [info:broken]\nmissing metadata\n");
	await rejects(() => inbox(["fact", "--kind", "info", "--key", "new", "--", "valid"]), /lacks source or since/);
	strictEqual(readFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "utf8"), "## [info:broken]\nmissing metadata\n");
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

await check("migration does not replace a newer existing fact", async () => {
	await inbox(["fact", "--kind", "decision", "--key", "release-window", "--note", "Ops Cee 2026-11-13 12:00", "--", "Release window is 20:00"]);
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n1\tteams-fact:release-window\tRelease window is 18:00\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n`);
	const { migrateFacts } = await jiti.import("../cli/facts.ts");
	const { readTsv } = await jiti.import("../cli/ledger.ts");
	migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")));
	strictEqual(readFacts().find((fact) => fact.key === "release-window").text, "Release window is 20:00");
});

await check("migration leaves a fact it does not write as stored", async () => {
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "## [info:build-host]\n\nrelease host is build-01\n\nsource: digest\nsince: 2026-11-13\nsuperseded: password: hunter2\n\n");
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n1\tteams-fact:other\tdeploys need a ticket\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n`);
	const { migrateFacts } = await jiti.import("../cli/facts.ts");
	const { readTsv } = await jiti.import("../cli/ledger.ts");
	migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")));
	const host = readFacts().find((fact) => fact.key === "build-host");
	strictEqual(host?.text, "release host is build-01");
	strictEqual(host?.superseded.join("|"), "password: hunter2", "another fact's text is never rewritten");
});


await check("migration refuses a row it cannot store and leaves it open", async () => {
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "");
	rmSync(join(process.env.WAYNE_INBOX_DIR, "archive.tsv"), { force: true });
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n4\tteams-fact:release]host\trelease host is build-01\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n5\tteams-fact:meta-text\tsource: the vendor docs\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n6\tteams-fact:good-one\tdeploys need a ticket\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n`);
	const { migrateFacts } = await jiti.import("../cli/facts.ts");
	const { readTsv } = await jiti.import("../cli/ledger.ts");
	const result = migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")));
	strictEqual(readFacts().map((fact) => fact.key).join(","), "good-one", "facts.md stays readable and holds only the good row");
	const open = readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")).map((row) => row.id).sort().join(",");
	strictEqual(open, "4,5", "rows it could not store stay open");
	strictEqual(result.refused.map((r) => r.id).sort().join(","), "4,5");
});

await check("migration keeps a recorded legacy kind", async () => {
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n1\tteams-fact:release-host\t[endpoint:release-host] release host\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n`);
	const { migrateFacts } = await jiti.import("../cli/facts.ts");
	const { readTsv } = await jiti.import("../cli/ledger.ts");
	migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")));
	strictEqual(readFacts()[0].kind, "endpoint");
	strictEqual(readFacts()[0].source, "digest Ops Ada 2026-11-13 09:00");

});

await check("migration refuses the default live directory", async () => {
	const { spawnSync } = await import("node:child_process");
	const script = new URL("../cli/migrate-facts.ts", import.meta.url);
	const result = spawnSync(process.execPath, ["--experimental-strip-types", script.pathname, "--dry-run"], { encoding: "utf8" });
	ok(result.status !== 0 && result.stderr.includes("--dir is required"), result.stderr);
});

await check("migrate-facts --dry-run reports the refusals and counts a real run gets", async () => {
	const { spawnSync } = await import("node:child_process");
	const script = new URL("../cli/migrate-facts.ts", import.meta.url);
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "");
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n1\tteams-fact:host\trelease host is build-01\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n2\tteams-fact:db\tsource: the vendor docs\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n3\tteams-fact:old\tgone\t2026-11-13 09:00\tdigest\tteams-fact\tlog\tdone\t\tOps Ada\t\n`);
	const run = (...extra) => spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script.pathname, "--dir", process.env.WAYNE_INBOX_DIR, ...extra], { encoding: "utf8" });
	const dry = run("--dry-run");
	strictEqual(dry.stdout.trim(), "would write 1 facts and close 1 rows");
	ok(dry.status === 1 && /would refuse row 2, left open: its text would read back as facts.md metadata/.test(dry.stderr), dry.stderr);
	strictEqual(readFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "utf8"), "", "a dry run writes nothing");
	const real = run();
	strictEqual(real.stdout.trim(), "wrote 1 facts and closed 1 rows");
	ok(real.status === 1 && /refused row 2, left open/.test(real.stderr), real.stderr);
});

await check("malformed keys and metadata-shaped text are rejected or round-trip", async () => {
	const mulberry32 = (seed) => () => {
		seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
		seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
		return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
	};
	const random = mulberry32(0x5eed);
	const pieces = ["a", "release", "a]b", "[kind", "## ", "source: ", "since: ", "superseded: ", "updated: ", "token:", "\u4e2d\u6587", "tab\there", "line\nbreak", "colon:inside", "dot.name", "under_score"];
	const pick = () => pieces[Math.floor(random() * pieces.length)];
	const value = () => Array.from({ length: 1 + Math.floor(random() * 3) }, pick).join(" ");
	const kinds = ["endpoint", "cred", "decision", "owed", "info"];
	for (let i = 0; i < 80; i++) {
		const kind = kinds[i % kinds.length];
		const key = value();
		const text = value();
		const source = value();
		let failed = false;
		try {
			await inbox(["fact", "--kind", kind, "--key", key, "--source", source, "--", text]);
		} catch (error) {
			ok(error instanceof Error && /must be (one plain line|lowercase words)|never its value/.test(error.message), `${error}`);
			failed = true;
		}
		if (failed) continue;
		const stored = readFacts().find((fact) => fact.kind === kind && fact.key === key);
		ok(stored && stored.text === text.replace(/[\t\r\n]+/g, " ").trim() && stored.source === source.replace(/[\t\r\n]+/g, " ").trim(), `${kind}:${key} did not round-trip`);
		readFacts();
	}
});


await check("an identical fact refreshes its source without history", async () => {
	await inbox(["fact", "--kind", "decision", "--key", "deploy-window", "--source", "Ops Ada", "--", "Deploy after 18:00"]);
	strictEqual(await inbox(["fact", "--kind", "decision", "--key", "deploy-window", "--source", "Ops Bo", "--", "Deploy after 18:00"]), "unchanged decision:deploy-window");
	const [fact] = readFacts();
	strictEqual(fact.source, "Ops Bo");
	strictEqual(fact.superseded.length, 0);
});

await check("migration keeps a newer same-day fact and one kind", async () => {
	const { mkdirSync, writeFileSync: writeText } = await import("node:fs");
	await inbox(["fact", "--kind", "decision", "--key", "release-window", "--source", "digest", "--", "Release after 19:00"]);
	const facts = join(process.env.WAYNE_INBOX_DIR, "facts.md");
	writeText(facts, readFileSync(facts, "utf8").replace(/since: [^\n]+/, "since: 2026-11-13\nupdated: 2026-11-13 12:00"));
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	const row = "8\tteams-fact:release-window\tRelease after 09:00\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\twayne\t\t";
	writeText(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n${row}\n`);
	const { migrateFacts } = await jiti.import("../cli/facts.ts");
	const { readTsv } = await jiti.import("../cli/ledger.ts");
	migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")));
	strictEqual(readFacts()[0].text, "Release after 19:00");
	strictEqual(readFacts()[0].superseded.length, 0);
	writeText(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n${row}\n9\tteams-fact:release-window\t[info:release-window] older mapping\t2026-11-13 08:00\tdigest\tteams-fact\tlog\topen\twayne\t\t\n`);
	migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")));
	strictEqual(readFacts().map((fact) => `${fact.kind}:${fact.key}`).join(","), "decision:release-window");
	const before = readFileSync(facts, "utf8");
	const lock = join(process.env.WAYNE_INBOX_DIR, "ledger.tsv.lock");
	mkdirSync(lock);
	utimesSync(lock, new Date(), new Date());
	process.env.INBOX_LOCK_WAIT_MS = "0";
	try { migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"))); ok(false, "migration ignored the held lock"); }
	catch (error) { ok(error instanceof Error && /held by another writer/.test(error.message), error instanceof Error ? error.message : error); }
	finally { delete process.env.INBOX_LOCK_WAIT_MS; }
	rmSync(lock, { recursive: true });
	strictEqual(readFileSync(facts, "utf8"), before);
});

if (failed) process.exit(1);
