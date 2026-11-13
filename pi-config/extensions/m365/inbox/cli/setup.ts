/**
 * `inbox setup`: make an inbox directory usable, the one init path for the CLI, `/inbox setup` and `/inbox watch`.
 *
 * It never overwrites: a missing rules.yaml is copied from templates/rules.yaml, missing cursors are started at
 * "now" (what is already in the ledger, and mail already received, is not news), and enabled jobs with no
 * next fire get one. Then it checks that every enabled job can run here and fails loud naming what is missing.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BIN_DIR, nextFire, onPath, readJobs, writeJobs, type Job } from "./jobs.ts";
import { InboxError, inboxFile, readTsv, stamp, withRulesLock } from "./ledger.ts";

export const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates", "rules.yaml");
/** Node the `inbox` launcher needs: stripTypeScriptTypes and module.register. */
const NODE_MIN = [22, 13];
/** What a shell job's program needs beyond itself. */
const NEEDS: Record<string, string[]> = { "watch-prs.sh": ["gh", "jq"], "pr-ready.sh": ["gh", "jq"], inbox: ["node", "bash"] };

export function isSetUp(): boolean {
	return fs.existsSync(inboxFile("rules.yaml"));
}

/** Directory, cursors and rules.yaml. Idempotent; returns what it created. */
export function initInbox(): string[] {
	const made: string[] = [];
	fs.mkdirSync(inboxFile("cursors"), { recursive: true });
	const rules = inboxFile("rules.yaml");
	if (!fs.existsSync(rules)) {
		fs.copyFileSync(TEMPLATE, rules, fs.constants.COPYFILE_EXCL);
		made.push(`created ${rules} from the template`);
	}
	const push = inboxFile("cursors", "session-push.id");
	if (!fs.existsSync(push)) {
		const max = readTsv(inboxFile("ledger.tsv")).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
		fs.writeFileSync(push, `${max}\n`);
		made.push(`started ${push} at row ${max}`);
	}
	const mail = inboxFile("cursors", "outlook-inbox.since");
	if (!fs.existsSync(mail)) {
		fs.writeFileSync(mail, `${new Date().toISOString().replace(/\.\d+Z$/, "Z")}\n`);
		made.push(`started ${mail} now`);
	}
	withRulesLock(() => {
		const jobs = readJobs();
		const fresh = jobs.filter((j) => j.enabled !== false && !j.next_fire);
		for (const j of fresh) j.next_fire = stamp(nextFire(j, new Date()));
		if (fresh.length) {
			writeJobs(jobs);
			made.push(`scheduled ${fresh.map((j) => `${j.name} (next ${j.next_fire})`).join(", ")}`);
		}
	});
	return made;
}

function nodeVersion(): string | undefined {
	const r = spawnSync("node", ["--version"], { encoding: "utf8" });
	return r.status === 0 ? r.stdout.trim() : undefined;
}

/** The programs an enabled job needs that this machine lacks, as `job: what`. */
export function missingTools(jobs: Job[] = readJobs()): string[] {
	const found = (name: string) => (path.isAbsolute(name) ? fs.existsSync(name) : !!onPath(name) || fs.existsSync(path.join(BIN_DIR, name)));
	const missing: string[] = [];
	const version = nodeVersion();
	const [major, minor] = (version ?? "v0.0").slice(1).split(".").map(Number);
	if (!version) missing.push("inbox launcher: node is not on PATH");
	else if (major < NODE_MIN[0] || (major === NODE_MIN[0] && minor < NODE_MIN[1])) missing.push(`inbox launcher: node ${version} is older than v${NODE_MIN.join(".")}`);
	for (const job of jobs) {
		if (job.enabled === false) continue;
		const a = job.action;
		const need: string[] = [];
		if (a?.kind === "shell") {
			const prog = a.argv[0];
			need.push(prog, ...(NEEDS[path.basename(prog)] ?? []));
		} else if ((a?.kind === "prompt" || a?.kind === "digest") && !process.env.INBOX_AGENT) {
			if (!onPath("omp") && !onPath("pi")) missing.push(`${job.name}: a prompt job needs omp or pi on PATH`);
		} else if (a?.kind === "prompt" || a?.kind === "digest") need.push(process.env.INBOX_AGENT!);
		for (const n of new Set(need)) if (n !== "node" && !found(n)) missing.push(`${job.name}: ${n} is not on PATH`);
	}
	return missing;
}

/** `inbox setup`: init, then fail loud on a missing tool. */
export function setup(): string {
	const made = initInbox();
	const missing = missingTools();
	const jobs = readJobs()
		.map((j) => `${j.name}${j.enabled === false ? " (disabled)" : ` next ${j.next_fire}`}`)
		.join(", ");
	const lines = [made.length ? made.join("\n") : `${inboxFile()} is already set up`, `jobs: ${jobs || "none"}`];
	if (missing.length) throw new InboxError(`${lines.join("\n")}\nmissing:\n${missing.map((m) => `  ${m}`).join("\n")}\nInstall them, or \`inbox schedule disable <job>\`, then run setup again.`);
	lines.push("tools: ok", "Jobs run while an omp or pi session with the m365 plugin is open; `/inbox watch` there delivers the cards.");
	return lines.join("\n");
}
