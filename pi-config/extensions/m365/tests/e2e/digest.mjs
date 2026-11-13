#!/usr/bin/env node
/**
 * The teams-digest end to end, against real Teams, read-only: the real runner (`inbox schedule run --job
 * teams-digest`, the runDue path the scheduler takes) runs a real `omp -p` with this checkout's extension, in a
 * temporary inbox. Nothing is posted to Teams and nothing outside the temporary inbox and --out is written.
 *
 *   node tests/e2e/digest.mjs --out DIR [--live-rules ~/.wayne/inbox/rules.yaml] [--only template|legacy]
 *
 * Needs omp on PATH, signed in to Teams (the m365 extension's token), and the network; not in tests/run.mjs.
 * Two inboxes:
 * - template: rules.yaml from inbox/templates/rules.yaml, digest enabled. Run 1 reads the last 23h; run 2 must
 *   start at run 1's last_ok. Then each failure keeps the boundary and names the chat in a do row: a forced
 *   read failure (tests/e2e/fail-read.ts blocks the self-chat read), the agent exiting 3, a 5s timeout.
 * - legacy: a copy of the live rules.yaml (read, never written), migrated by `inbox rules-migrate`. `schedule
 *   finish` without a receipt, DISPATCHED and SKIP must keep last_ok and backfill_since. Then the backfill runs
 *   one day-long window per fire: each verified window moves backfill_since to its end, the last one clears it and
 *   sets last_ok; the next run starts at that last_ok.
 * Every step leaves its rules.yaml before/after, runner output, the agent's prompt and --mode json stream, the
 * ledger and facts.md under --out/<inbox>/<step>/, and --out/summary.json lists every check. Exit 1 if one failed.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "../host.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INBOX = join(ROOT, "bin", "inbox");
const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i < 0 ? fallback : process.argv[i + 1];
};
const OUT = arg("out");
if (!OUT) throw new Error("--out DIR is required");
const LIVE = arg("live-rules", join(homedir(), ".wayne", "inbox", "rules.yaml"));
const ONLY = arg("only");
mkdirSync(OUT, { recursive: true });

const jiti = createJiti(import.meta.url, { interopDefault: true });
const jobs = await jiti.import("../../inbox/cli/jobs.ts");
const { readTsv, stamp } = await jiti.import("../../inbox/cli/ledger.ts");
const { checkDigest } = await jiti.import("../../inbox/cli/digest.ts");

// The agent the runner calls: this checkout's extension only (the installed plugin may be another tree), plus the
// forced-failure extension when asked. It records its prompt and tees its event stream for the evidence.
const bin = mkdtempSync(join(tmpdir(), "digest-e2e-bin-"));
const omp = spawnSync("bash", ["-lc", "command -v omp"], { encoding: "utf8" }).stdout.trim();
if (!omp) throw new Error("omp is not on PATH");
writeFileSync(
	join(bin, "omp"),
	`#!/usr/bin/env bash
set -o pipefail
printf '%s' "\${@: -1}" > "$E2E_PROMPT"
[ -n "$E2E_EXIT" ] && exit "$E2E_EXIT"
extra=()
[ -n "$E2E_FAIL_READ" ] && extra=(-e ${JSON.stringify(join(ROOT, "tests", "e2e", "fail-read.ts"))})
${JSON.stringify(omp)} --no-extensions -e ${JSON.stringify(join(ROOT, "index.ts"))} "\${extra[@]}" "$@" | tee "$E2E_STREAM"
`,
);
chmodSync(join(bin, "omp"), 0o755);

const checks = [];
function check(step, name, pass, detail = "") {
	checks.push({ step, name, pass: Boolean(pass), detail: String(detail).slice(0, 500) });
	console.log(`${pass ? "PASS" : "FAIL"} ${step}: ${name}${pass ? "" : ` -- ${detail}`}`);
}

function inbox(home, args, env = {}) {
	const r = spawnSync(INBOX, args, { encoding: "utf8", env: { ...process.env, WAYNE_INBOX_DIR: home, INBOX_AGENT: join(bin, "omp"), ...env } });
	return { code: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}

function digestJob(home) {
	process.env.WAYNE_INBOX_DIR = home;
	return jobs.readJobs().find((j) => j.name === "teams-digest");
}

function editDigest(home, fn) {
	process.env.WAYNE_INBOX_DIR = home;
	const all = jobs.readJobs();
	fn(all.find((j) => j.name === "teams-digest"), all);
	jobs.writeJobs(all);
}

/** One step: snapshot, act, snapshot; the evidence lands in OUT/<box>/<step>/. */
function step(box, home, name, act) {
	const dir = join(OUT, box, name);
	mkdirSync(dir, { recursive: true });
	copyFileSync(join(home, "rules.yaml"), join(dir, "rules.before.yaml"));
	const before = digestJob(home);
	const env = { E2E_PROMPT: join(dir, "prompt.txt"), E2E_STREAM: join(dir, "stream.jsonl") };
	const t0 = Date.now();
	const result = act(env);
	writeFileSync(join(dir, "run.out"), `${result.out}\nexit ${result.code} after ${Math.round((Date.now() - t0) / 1000)}s\n`);
	copyFileSync(join(home, "rules.yaml"), join(dir, "rules.after.yaml"));
	for (const f of ["ledger.tsv", "facts.md"]) if (existsSync(join(home, f))) copyFileSync(join(home, f), join(dir, f));
	return { dir, before, after: digestJob(home), result, rows: existsSync(join(home, "ledger.tsv")) ? readTsv(join(home, "ledger.tsv")) : [] };
}

const run = (home) => (env) => inbox(home, ["schedule", "run", "--job", "teams-digest"], env);

/** The window the agent was given: the times after "`active_since`" and "`until`" in its prompt. */
function window(dir) {
	const prompt = existsSync(join(dir, "prompt.txt")) ? readFileSync(join(dir, "prompt.txt"), "utf8") : "";
	return { prompt, since: /`active_since` (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(prompt)?.[1], until: /`until` (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(prompt)?.[1] };
}

/**
 * A successful run: the runner accepts it, the stream meets the contract for its window and facts.md exists. A
 * window that reached the fire moves last_ok and clears backfill_since; an earlier one moves backfill_since to its end.
 */
function success(box, home, name, wantSince) {
	const s = step(box, home, name, run(home));
	const start = s.before.backfill_since ?? s.before.last_ok;
	if (wantSince) check(name, `the run starts at ${wantSince}`, start === wantSince, start);
	const w = window(s.dir);
	check(name, "the agent's prompt carries the window", w.since === start && w.until, w.prompt.slice(0, 300));
	check(name, "the runner accepts the run", s.result.out.startsWith("ok teams-digest"), s.result.out);
	try {
		const verdict = checkDigest(readFileSync(join(s.dir, "stream.jsonl"), "utf8"), w.since, w.until);
		check(name, "the agent's stream satisfies the receipt contract", verdict.failed.length === 0, JSON.stringify(verdict.failed));
	} catch (e) {
		check(name, "the agent's stream satisfies the receipt contract", false, e.message);
	}
	check(name, "facts.md is written", existsSync(join(home, "facts.md")), "no facts.md");
	if (s.after.backfill_since !== undefined) {
		check(name, "backfill_since moves to the window's end", s.after.backfill_since === w.until, `${s.before.backfill_since} -> ${s.after.backfill_since}`);
		check(name, "last_ok waits for the last window", s.after.last_ok === s.before.last_ok, `${s.before.last_ok} -> ${s.after.last_ok}`);
	} else {
		check(name, "last_ok advances", s.after.last_ok && s.after.last_ok !== s.before.last_ok, `${s.before.last_ok} -> ${s.after.last_ok}`);
		check(name, "backfill_since is cleared", true);
	}
	return s.after;
}

/** A failure: the boundary and backfill stay; `chat`, when given, is named in a do row for the old boundary. */
function failure(box, home, name, act, chat) {
	const s = step(box, home, name, act);
	check(name, "the fire is not ok", !s.result.out.startsWith("ok "), s.result.out);
	check(name, "last_ok is kept", s.after.last_ok === s.before.last_ok, `${s.before.last_ok} -> ${s.after.last_ok}`);
	check(name, "backfill_since is kept", s.after.backfill_since === s.before.backfill_since, `${s.before.backfill_since} -> ${s.after.backfill_since}`);
	if (chat) {
		const since = s.before.backfill_since ?? s.before.last_ok;
		const subject = `Teams digest could not fully read ${chat} since ${since}`;
		check(name, `a do row names ${chat}`, s.rows.some((r) => r.action === "do" && r.subject === subject), s.rows.map((r) => r.subject).join(" | "));
	}
}

function makeDue(home) {
	editDigest(home, (job) => (job.next_fire = stamp(new Date(Date.now() - 60_000))));
}
const finish = (home, ...args) => () => (makeDue(home), inbox(home, ["schedule", "finish", "teams-digest", ...args]));

function onlyDigest(home) {
	editDigest(home, (digest, all) => {
		for (const j of all) j.enabled = j === digest;
	});
}

if (ONLY !== "legacy") {
	const home = mkdtempSync(join(tmpdir(), "digest-e2e-template-"));
	copyFileSync(join(ROOT, "inbox", "templates", "rules.yaml"), join(home, "rules.yaml"));
	onlyDigest(home);
	// 23h back: inside one day-long window, so run 1 reads to the fire and sets last_ok.
	editDigest(home, (job) => (job.last_ok = stamp(new Date(Date.now() - 23 * 3600_000))));
	const first = success("template", home, "1-first-run").last_ok;
	const second = success("template", home, "2-incremental", first).last_ok;
	failure("template", home, "3-forced-read-failure", (env) => run(home)({ ...env, E2E_FAIL_READ: "1" }), "self-chat");
	failure("template", home, "4-agent-exits", (env) => run(home)({ ...env, E2E_EXIT: "3" }), "all chats");
	editDigest(home, (job) => (job.timeout = 5));
	failure("template", home, "5-agent-times-out", run(home), "all chats");
	editDigest(home, (job) => (job.timeout = 900));
	check("template", "the failures left the boundary at run 2", digestJob(home).last_ok === second, digestJob(home).last_ok);
}

if (ONLY !== "template") {
	const home = mkdtempSync(join(tmpdir(), "digest-e2e-legacy-"));
	copyFileSync(LIVE, join(home, "rules.yaml"));
	mkdirSync(join(OUT, "legacy"), { recursive: true });
	copyFileSync(LIVE, join(OUT, "legacy", "rules.live-copy.yaml"));
	const migrated = inbox(home, ["rules-migrate"]);
	writeFileSync(join(OUT, "legacy", "rules-migrate.out"), `${migrated.out}\n`);
	copyFileSync(join(home, "rules.yaml"), join(OUT, "legacy", "rules.migrated.yaml"));
	check("legacy", "rules-migrate migrates the live prompt", migrated.code === 0 && migrated.out.startsWith("migrated teams-digest"), migrated.out);
	check("legacy", "the migrated prompt carries the receipt", digestJob(home).action.text.includes("{{receipt}}"));
	check("legacy", "the migration sets backfill_since", Boolean(digestJob(home).backfill_since), JSON.stringify(digestJob(home)));
	onlyDigest(home);
	failure("legacy", home, "1-finish-without-receipt", finish(home, "--output", "teams digest: 3 findings since then"), "all chats");
	failure("legacy", home, "2-finish-dispatched", finish(home, "--output", "prompt card sent", "--verdict", "DISPATCHED"));
	failure("legacy", home, "3-finish-skip", finish(home, "--output", "nothing new", "--verdict", "SKIP"));
	let start = digestJob(home).backfill_since;
	let after;
	for (let i = 1; i <= 10; i++) {
		after = success("legacy", home, `4-backfill-window-${i}`, start);
		if (after.backfill_since === undefined || checks.some((c) => !c.pass)) break;
		start = after.backfill_since;
	}
	check("legacy", "the backfill finished", after.backfill_since === undefined, after.backfill_since);
	if (after.backfill_since === undefined) success("legacy", home, "5-incremental", after.last_ok);
}

writeFileSync(join(OUT, "summary.json"), `${JSON.stringify({ at: new Date().toISOString(), checks }, null, 2)}\n`);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
