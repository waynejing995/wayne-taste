/**
 * Rewrite an old teams-digest prompt in an existing rules.yaml.
 *
 * A prompt is current once it matches the template, or once it carries the `{{receipt}}` placeholder the runner
 * fills in. Anything older is rewritten from the template. The watched-chats prompt never read unwatched chats,
 * so only that family gets backfill_since for its first all-chat scan; the job keeps the rest of the user's config.
 *
 * `inbox rules-migrate` is the way to run this; it honours WAYNE_INBOX_DIR.
 */
import * as fs from "node:fs";
import { stamp, parseYaml, withRulesLock, inboxFile } from "./ledger.ts";
import { readJobs, writeJobs, type Job } from "./jobs.ts";
import { TEMPLATE } from "./setup.ts";

/** Seven days back, as the local `YYYY-MM-DD HH:MM` stamp rules.yaml holds. */
export function defaultBackfill(now = new Date()): string {
	return stamp(new Date(now.getTime() - 7 * 24 * 3600_000));
}

function templateDigest(): Job {
	const rules = parseYaml(fs.readFileSync(TEMPLATE, "utf8")) as { schedule?: Job[] };
	const job = rules.schedule?.find((item) => item.name === "teams-digest");
	if (!job?.action) throw new Error("template has no teams-digest action");
	return job;
}

/** The watched-chats family read `teams_watch.chats` and never the unwatched chats, so it needs the backfill. */
function watchedChats(text: string): boolean {
	return text.includes("teams_watch.chats") || text.includes("watched chats") || text.includes("watched Teams chats");
}

export function migrateRules(now = new Date()): string {
	return withRulesLock(() => {
		const file = inboxFile("rules.yaml");
		if (!fs.existsSync(file)) return "no rules.yaml";
		const jobs = readJobs();
		const job = jobs.find((item) => item.name === "teams-digest");
		const fresh = templateDigest();
		const text = job?.action.kind === "prompt" ? job.action.text : "";
		const freshText = fresh.action.kind === "prompt" ? fresh.action.text : "";
		if (!job || freshText === "" || text === freshText || text.includes("{{receipt}}")) return "rules.yaml already current";
		job.action = fresh.action;
		job.tools = fresh.tools;
		const stamped = job as Job & { backfill_since?: string };
		if (watchedChats(text)) stamped.backfill_since ??= defaultBackfill(now);
		writeJobs(jobs);
		return stamped.backfill_since ? `migrated teams-digest; backfill_since ${stamped.backfill_since}` : "migrated teams-digest";
	});
}

/** What `rules-migrate --dry-run` prints: the file as `migrateRules` would write it, without writing. */
export function migrateRulesText(text: string, now = new Date()): { text: string; changed: boolean } {
	const dir = fs.mkdtempSync(new URL(`file://${process.env.TMPDIR ?? "/tmp"}/`).pathname + "inbox-migrate-");
	const rules = `${dir}/rules.yaml`;
	fs.writeFileSync(rules, text);
	const saved = process.env.WAYNE_INBOX_DIR;
	process.env.WAYNE_INBOX_DIR = dir;
	try {
		const result = migrateRules(now);
		return { text: fs.readFileSync(rules, "utf8"), changed: result !== "rules.yaml already current" && result !== "no rules.yaml" };
	} finally {
		if (saved === undefined) delete process.env.WAYNE_INBOX_DIR;
		else process.env.WAYNE_INBOX_DIR = saved;
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

