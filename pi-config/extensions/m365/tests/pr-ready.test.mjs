import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const bin = join(root, "..", "bin");
const readyScript = join(bin, "pr-ready.sh");
const watchScript = join(bin, "watch-prs.sh");
const autoReviewScript = join(bin, "auto-review.sh");
const HEAD = "853b384b0b3cdb59b5adec6053d756aae5064fa2";
const CLEAN = `Multi-source auto-review @ ${HEAD.slice(0, 8)} (diff \`base...${HEAD.slice(0, 8)}\`): no critical issues found.`;
const GREEN = [
	{ __typename: "CheckRun", name: "Backend unit tests", status: "COMPLETED", conclusion: "SUCCESS" },
	{ __typename: "CheckRun", name: "Docs", status: "COMPLETED", conclusion: "SKIPPED" },
];

let failed = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.stack ?? e.message}`);
	}
}

function pr(comments, checks = GREEN, mergeable = "MERGEABLE") {
	return {
		headRefOid: HEAD,
		mergeable,
		reviews: [],
		statusCheckRollup: checks,
		comments: comments.map(([createdAt, body]) => ({ createdAt, body })),
	};
}

function withFakeGh(fixture, fn) {
	const dir = mkdtempSync(join(tmpdir(), "m365-pr-ready-"));
	const fixturePath = join(dir, "gh.json");
	const ghPath = join(dir, "gh");
	writeFileSync(fixturePath, JSON.stringify(fixture));
	writeFileSync(ghPath, '#!/bin/sh\ncat "$GH_FIXTURE"\n');
	chmodSync(ghPath, 0o755);
	const env = {
		...process.env,
		PATH: `${dir}:${process.env.PATH ?? ""}`,
		GH_FIXTURE: fixturePath,
	};
	try {
		return fn(dir, env);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function run(command, args, options) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	return result;
}

function runReady(fixture) {
	return withFakeGh(fixture, (_dir, env) => run(readyScript, ["o/r", "1"], { env }));
}

function gate(out, name) {
	const line = out.split("\n").find((item) => item.startsWith(`${name} `));
	if (!line) throw new Error(`missing ${name} gate in output:\n${out}`);
	return line.trim().split(/\s+/)[1];
}

function verdict(body) {
	const result = run("bash", ["-c", 'source "$AUTO_REVIEW"; jq -r --arg auto "$AUTO" "$AUTO_JQ"'], {
		input: JSON.stringify({ body }),
		env: { ...process.env, AUTO_REVIEW: autoReviewScript },
	});
	if (result.status !== 0) throw new Error(result.stderr || `verdict command exited ${result.status}`);
	return result.stdout.split("\n")[0];
}

await check("ready when latest review is clean on head and checks pass", () => {
	const result = runReady(pr([["2026-11-10T09:00:00Z", CLEAN]]));
	equal(result.status, 0, result.stdout + result.stderr);
	deepStrictEqual(["review-head", "review-clean", "ci", "mergeable"].map((name) => gate(result.stdout, name)), ["ok", "ok", "ok", "ok"]);
	equal(result.stdout.trim().split("\n").at(-1), "READY");
});

await check("review of an older commit blocks even when an earlier one matched", () => {
	const stale = "Multi-source auto-review of 2e80d336b (frozen three-dot diff `00913b76c...2e80d336b`): no critical issue.";
	const result = runReady(pr([["2026-11-10T10:00:00Z", stale], ["2026-11-10T09:00:00Z", CLEAN]]));
	equal(result.status, 1);
	equal(gate(result.stdout, "review-head"), "FAIL");
	match(result.stdout, /2e80d336b/);
	equal(result.stdout.trim().split("\n").at(-1), "NOT READY: review-head");
});

await check("critical review on head blocks on review-clean", () => {
	const critical = `## Multi-source auto-review: PR #1 @ ${HEAD.slice(0, 7)}\n\n### CRITICAL (1, posted inline)\n| # | x |`;
	const result = runReady(pr([["2026-11-10T09:00:00Z", critical]]));
	equal(result.status, 1);
	equal(gate(result.stdout, "review-head"), "ok");
	equal(gate(result.stdout, "review-clean"), "FAIL");
	equal(result.stdout.trim().split("\n").at(-1), "NOT READY: review-clean");
});

// Body shapes of real TRACE auto-reviews (#849 @ 2e80d336b, #833 @ 4d6a8d9, #859, #842), on this fixture's head.
const NO_NEW = `Multi-source auto-review of ${HEAD.slice(0, 9)} (frozen three-dot diff \`00913b76c...${HEAD.slice(0, 9)}\`).\n\n` +
	"Since f572cd7f1, the only change is `captain-pi/src/pg-storage.ts:216`.\n\n" +
	"**No new CRITICAL issues.** All four sources checked that `max: 1` cannot deadlock:\n" +
	"- `close()` drains admitted operations before calling `pool.end()`.\n";
const STILL_OPEN_849 = NO_NEW + "\n**Still open, already posted inline, not re-posted, and not declined by the author:**\n" +
	"- `dispatch.py:104`\n- `app.py:2418`\n\nNot approving while these remain open.\n";
const PRIOR_PRESENT_833 = NO_NEW + "\n**6 prior CRITICALs are still present.** Each has a reply on its existing thread: " +
	"adopt.py:300, reproduce.py:3746.\n";

const verdictCases = [
	{ id: "no-new", body: NO_NEW, want: "clean" },
	{ id: "849-still-open", body: STILL_OPEN_849, want: "critical" },
	{ id: "833-prior-present", body: PRIOR_PRESENT_833, want: "critical" },
	{ id: "new-criticals", body: NO_NEW + "\n**2 new CRITICALs, posted inline:**\n- adopt.py:662\n", want: "critical" },
	{ id: "critical-still-open", body: NO_NEW + "\n**CRITICAL (1, still open):** `activities.py:1395`.\n", want: "critical" },
	{ id: "candidate-downgraded", body: NO_NEW + "\n### CRITICAL candidate downgraded after checking\n| Finding | Voice 2 (CRITICAL 10) |\n", want: "clean" },
	{ id: "raised-as-downgraded", body: NO_NEW + "\n### Raised as CRITICAL, downgraded after checking\n- x\n", want: "clean" },
	{ id: "critical-heading", body: NO_NEW + "\n### CRITICAL\nNone. Voice 2 marked six items CRITICAL.\n", want: "critical" },
	{ id: "earlier-still-fixed", body: NO_NEW + "\nAll earlier criticals (`_do_resync` race) are still fixed at this head.\n", want: "clean" },
	{ id: "no-remaining", body: NO_NEW + "\nNo remaining critical issues.\n", want: "clean" },
	{ id: "none-remain-open", body: NO_NEW + "\nNo critical issues remain open.\n", want: "clean" },
	{ id: "no-new-then-prior-present", body: NO_NEW + "\nNo new criticals; 6 prior CRITICALs are still present.\n", want: "critical" },
	{ id: "no-new-but-remain-open", body: NO_NEW + "\nNo new critical issue, but the earlier critical threads remain open.\n", want: "critical" },
	{ id: "silent", body: "Multi-source auto-review @ abc1234: two findings, see inline.", want: "critical" },
];
for (const { id, body, want } of verdictCases) {
	await check(`verdict rule: ${id}`, () => equal(verdict(body), `verdict=${want}`));
}

await check("no new critical on head is ready but old criticals still open are not", () => {
	equal(runReady(pr([["2026-11-10T09:00:00Z", NO_NEW]])).stdout.trim().split("\n").at(-1), "READY");
	const result = runReady(pr([["2026-11-10T09:00:00Z", STILL_OPEN_849]]));
	equal(result.status, 1);
	equal(gate(result.stdout, "review-head"), "ok");
	equal(gate(result.stdout, "review-clean"), "FAIL");
	equal(result.stdout.trim().split("\n").at(-1), "NOT READY: review-clean");
});

await check("running check leaves CI pending", () => {
	const running = [...GREEN, { __typename: "CheckRun", name: "Repository contracts", status: "IN_PROGRESS", conclusion: "" }];
	const result = runReady(pr([["2026-11-10T09:00:00Z", CLEAN]], running));
	equal(result.status, 1);
	equal(gate(result.stdout, "ci"), "pending");
	match(result.stdout, /Repository contracts IN_PROGRESS/);
	equal(result.stdout.trim().split("\n").at(-1), "NOT READY: ci");
});

const failedChecks = [
	{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
	{ __typename: "StatusContext", context: "ci/legacy", state: "ERROR" },
];
for (const checkFixture of failedChecks) {
	await check(`failed ${checkFixture.__typename} check fails CI while others still run`, () => {
		const running = { __typename: "CheckRun", name: "slow", status: "QUEUED", conclusion: "" };
		const result = runReady(pr([["2026-11-10T09:00:00Z", CLEAN]], [...GREEN, running, checkFixture]));
		equal(result.status, 1);
		equal(gate(result.stdout, "ci"), "FAIL");
	});
}

await check("conflicting PR is not ready", () => {
	const result = runReady(pr([["2026-11-10T09:00:00Z", CLEAN]], GREEN, "CONFLICTING"));
	equal(result.status, 1);
	equal(result.stdout.trim().split("\n").at(-1), "NOT READY: mergeable");
});

await check("head without any check fails CI", () => {
	const result = runReady(pr([["2026-11-10T09:00:00Z", CLEAN]], []));
	equal(result.status, 1);
	ok(result.stdout.split("\n").includes("ci            FAIL     no checks on head"));
	equal(result.stdout.trim().split("\n").at(-1), "NOT READY: ci");
});

await check("watch-prs records one matching review through the inbox launcher", () => {
	const fixture = [{
		number: 17,
		title: "Example review",
		url: "https://github.com/o/r/pull/17",
		state: "OPEN",
		mergedAt: null,
		reviews: [{
			id: 456,
			submittedAt: new Date().toISOString(),
			body: "Looks good",
			state: "APPROVED",
			author: { login: "reviewer" },
		}],
		comments: [],
		statusCheckRollup: [],
	}];
	withFakeGh(fixture, (dir, env) => {
		const inboxDir = join(dir, "inbox");
		mkdirSync(join(inboxDir, "cursors"), { recursive: true });
		writeFileSync(join(inboxDir, "rules.yaml"), "github:\n  o/r:\n    - when: { event: review }\n      tag: pr-review\n      action: notify\n");
		writeFileSync(join(inboxDir, "cursors", "github-prs.since"), "2000-01-01T00:00:00Z\n");
		const result = run(watchScript, [], { env: { ...env, WAYNE_INBOX_DIR: inboxDir } });
		equal(result.status, 0, result.stdout + result.stderr);
		const rows = readFileSync(join(inboxDir, "ledger.tsv"), "utf8").trimEnd().split("\n");
		equal(rows.length, 2, result.stdout + result.stderr);
		const row = rows[1].split("\t");
		equal(row[1], "github:o/r#17:review:456");
		equal(row[5], "pr-review");
		equal(row[6], "notify");
	});
});

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
