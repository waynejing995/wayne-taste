/**
 * Standing facts: upsert, superseded text, the shared lock, and migration idempotency.
 *
 * Synthetic facts only. No live inbox data.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
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

await check("cred stores a location and rejects a value", async () => {
	await inbox(["fact", "--kind", "cred", "--key", "ci-token", "--", "CI token lives in the release vault"]);
	await rejects(() => inbox(["fact", "--kind", "cred", "--key", "ci-token", "--", "token: abc123secret"]), /never its value/);
	await rejects(() => inbox(["fact", "--kind", "cred", "--key", "ci-token", "--", "the token abc123secret is live"]), /never its value/);
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
	strictEqual(host?.superseded.join("|"), "password: hunter2", "the guard can be wrong; another fact's text is never rewritten");
});

await check("migration refuses a row that may hold a credential and leaves it open, text intact", async () => {
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	const { migrateFacts } = await jiti.import("../cli/facts.ts");
	const { readTsv } = await jiti.import("../cli/ledger.ts");
	const cases = [["3", "password: hunter2", "digest", ""], ["8", "the db login moved", "password: hunter2", ""], ["9", "password: abc", "digest", ""], ["11", "The password is abc for production.", "digest", ""], ["15", "The password is abc in production.", "digest", ""], ["16", "the db login moved", "the token is abc with the CI bot", ""], ["12", "the build dashboard moved", "digest", "https://ci.example.com/board?access_token=abc123x"]];
	for (const [id, subject, source, link] of cases) {
		writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "## [info:db-login]\n\nthe db login lives in the vault\n\nsource: digest\nsince: 2026-11-14\nupdated: 2026-11-14 09:00\n\n");
		rmSync(join(process.env.WAYNE_INBOX_DIR, "archive.tsv"), { force: true });
		writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n${id}\tteams-fact:db-login\t${subject}\t2026-11-13 09:00\t${source}\tteams-fact\tlog\topen\t\tOps Ada\t${link}\n`);
		const result = migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv")));
		strictEqual(result.refused.map((r) => r.id).join(","), id, `row ${id} is refused`);
		const open = readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"))[0];
		strictEqual(`${open?.subject}|${open?.source}|${open?.link}`, `${subject}|${source}|${link}`, `row ${id} stays open with its text`);
		ok(!/hunter2|abc123x|password(: | is )abc/.test(readFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "utf8")), `row ${id}'s value reached facts.md`);
	}
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "");
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n14\tteams-fact:token-owner\tThe Jira token owner is Lin.\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\t\tOps Ada\t\n`);
	strictEqual(migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"))).written, 1, "a pointer fact migrates with its text");
	strictEqual(readFacts()[0]?.text, "The Jira token owner is Lin.");
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

await check("secrets are rejected in every field and scrubbed from history", async () => {
	const accepted = ["CI token lives in the release vault", "the password is in the team vault", "the API key is stored in 1Password under ci-bot", "token rotation is owned by Ops", "password reset goes through the IT portal", "the CI token is expired", "the deploy token was rotated by Ops", "tokens are issued per team", "the pw is kept in the safe", "The Jira token: ask Lin for it", "secret: rotate monthly", "Teams token: Graph delegated via az cli", "token=see 1Password item ci-bot", "token rotation is weekly", "The Jira token owner is Lin.", "Decision: the CI secret store is Vault.", "Wayne decided the token budget is fixed", "The deploy password expiry is 90 days.", "API key quota is high for staging.", "the secretary is Ann", "pass the build: it is green", "the boarding pass is ready", "the build pass rate is 90%"];
	for (const text of accepted) await inbox(["fact", "--kind", "info", "--key", `pointer-${accepted.indexOf(text)}`, "--", text]);
	const rejected = ["the password is hunter2X", "pw is s3cr3t!", "password: hunter2", "token=abc123", "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature", "api key: sk-live-1234567890abcdef", "ghp_1234567890abcdefghij", "xoxb-1234567890-abcdefghij", "pw is X", "password is abc", "password: 7", "the token = a", "the secret was hunter", "PASSWORD IS Sunshine"];
	for (const text of rejected) await rejects(() => inbox(["fact", "--kind", "decision", "--key", "release-window", "--", text]), /never its value/);
	for (const text of ["client_secret=abc123", "access_token=abc123x", "GITHUB_TOKEN: abc123x", "db_password is hunter2", "password: pass_word", "client_secret=abc_def", "the token is my_secret_value today", "The prod DB password for user ci is s3cr3tV4lue", "token for the bot: abc123xyz", "the credentials are hunter2", "creds: hunter2", "passcode is 482913", "The prod DB password for user ci is abc", "The prod DB password for user ci is 7", "token for the bot: hunter", "The password is abc for production.", "token: hunter for the prod bot", "the token for prod is abc today", "The password is abc in production.", "the token is abc with the CI bot", "password: abc by default", "secret was hunter from the vendor", "PGPASSWORD=x", "MYSQL_PWD=x", "DB_PASS=abc123", "pwd: x", "pass: x", "accessToken: x", "clientSecret=x", "aws_secret_access_key=x", "postgres://ci:pw@db.example:5432/app", "Authorization: Basic Y2k6aHVudGVyMg==", "sshpass -p x ssh ci@db", "password - x", 'password "x"', "github_pat_11ABCDEFG0123456789abcdef", "密码: x", "password：x", "口令：hunter2"]) await rejects(() => inbox(["fact", "--kind", "info", "--key", "env-name", "--", text]), /never its value/, text);
	await rejects(() => inbox(["fact", "--kind", "info", "--key", "token-abc123456789", "--", "rotation owner"]), /never its value/);
	await rejects(() => inbox(["fact", "--kind", "info", "--key", "owner", "--source", "password: hunter2", "--", "rotation owner"]), /never its value/);
	await rejects(() => inbox(["fact", "--kind", "info", "--key", "owner", "--source", "The password is abc for production.", "--", "rotation owner"]), /never its value/);
	await rejects(() => inbox(["fact", "--kind", "info", "--key", "owner", "--source", "The password is abc in production.", "--", "rotation owner"]), /never its value/);
	const leaked = "## [info:old-secret]\n\npassword: hunter2\n\nsource: digest\nsince: 2026-11-13\n\n";
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), leaked);
	strictEqual(await inbox(["fact", "--kind", "info", "--key", "safe-note", "--source", "digest", "--", "plain status"]), "added info:safe-note");
	strictEqual(readFacts().find((fact) => fact.key === "old-secret")?.text, "password: hunter2", "a write leaves every other stored fact as it was");
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "## [info:old-secret]\n\nplain status\n\nsource: digest\nsince: 2026-11-13\nsuperseded: token=abc123\n\n");
	await inbox(["fact", "--kind", "info", "--key", "old-secret", "--source", "digest", "--", "plain status"]);
	ok(!readFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "utf8").includes("token=abc123"));
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "## [info:old-secret]\n\nplain status\n\nsource: digest\nsince: 2026-11-13\nsuperseded: password is abc\n\n");
	await inbox(["fact", "--kind", "info", "--key", "old-secret", "--source", "digest", "--", "plain status"]);
	ok(!readFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "utf8").includes("password is abc"), "a short prose value stayed in history");
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "## [info:old-secret]\n\nplain status\n\nsource: digest\nsince: 2026-11-13\nsuperseded: The password is abc in production.\n\n");
	await inbox(["fact", "--kind", "info", "--key", "old-secret", "--source", "digest", "--", "plain status"]);
	ok(!readFileSync(join(process.env.WAYNE_INBOX_DIR, "facts.md"), "utf8").includes("password is abc in"), "a value followed by 'in' stayed in history");
	const header = "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink";
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"), `${header}\n7\tteams-fact:leaked\tthe password is hunter2X\t2026-11-13 09:00\tdigest\tteams-fact\tlog\topen\twayne\t\t\n`);
	const { migrateFacts } = await jiti.import("../cli/facts.ts");
	const { readTsv } = await jiti.import("../cli/ledger.ts");
	strictEqual(migrateFacts(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"))).refused[0]?.id, "7");
	ok(!readFacts().some((fact) => fact.key === "leaked"));
	strictEqual(readTsv(join(process.env.WAYNE_INBOX_DIR, "ledger.tsv"))[0]?.subject, "the password is hunter2X", "a refused row stays open with its text");
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
