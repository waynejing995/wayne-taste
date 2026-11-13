/**
 * Rewrite the known old teams-digest prompt in an existing rules.yaml.
 *
 * The old prompt scanned watched chats with a 200-message limit. Its last_ok therefore cannot be the boundary for
 * every chat. The migrated job keeps enabled, last_ok, and the rest of the user's config, and adds backfill_since
 * for the first all-chat scan.
 */
import * as fs from "node:fs";
import YAML from "yaml";
import { inboxFile, withRulesLock } from "./ledger.ts";
import { TEMPLATE } from "./setup.ts";

const OLD = "watched chats";

export function defaultBackfill(now = new Date()): string {
	return new Date(now.getTime() - 7 * 24 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

function templateDigest(): Record<string, unknown> {
	const rules = YAML.parse(fs.readFileSync(TEMPLATE, "utf8")) as { schedule?: Record<string, unknown>[] };
	const job = rules.schedule?.find((item) => item.name === "teams-digest");
	if (!job?.action) throw new Error("template has no teams-digest action");
	return job;
}

export function migrateRulesText(text: string, now = new Date()): { text: string; changed: boolean } {
	const rules = YAML.parse(text) as { schedule?: Record<string, unknown>[] };
	const job = rules.schedule?.find((item) => item.name === "teams-digest");
	const action = job?.action as { text?: string } | undefined;
	if (!job || !action?.text?.includes(OLD) || !action.text.includes("limit 200")) return { text, changed: false };
	const fresh = templateDigest();
	job.action = fresh.action;
	job.tools = fresh.tools;
	job.backfill_since ??= defaultBackfill(now);
	return { text: YAML.stringify(rules), changed: true };
}

export function migrateRules(now = new Date()): string {
	return withRulesLock(() => {
		const file = inboxFile("rules.yaml");
		if (!fs.existsSync(file)) return "no rules.yaml";
		const current = fs.readFileSync(file, "utf8");
		const next = migrateRulesText(current, now);
		if (!next.changed) return "rules.yaml already current";
		const tmp = `${file}.tmp.${process.pid}`;
		fs.writeFileSync(tmp, next.text);
		fs.renameSync(tmp, file);
		return `migrated teams-digest; backfill_since ${YAML.parse(next.text).schedule.find((job: { name: string }) => job.name === "teams-digest").backfill_since}`;
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const file = args.includes("--file") ? args[args.indexOf("--file") + 1] : inboxFile("rules.yaml");
	const current = fs.readFileSync(file, "utf8");
	const next = migrateRulesText(current);
	if (args.includes("--dry-run")) process.stdout.write(next.changed ? next.text : current);
	else console.log(next.changed ? "migrated" : "rules.yaml already current");
}
