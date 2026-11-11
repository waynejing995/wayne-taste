/**
 * The program-kept lists in rules.yaml (`agent_watch`, `schedule`).
 *
 * rules.yaml is hand-written, so only one list's block is rewritten in place (core/rules-block.ts): every other
 * byte stays as the user wrote it. Callers hold the rules lock around read + write.
 * Items are dumped the way PyYAML's safe_dump wrote them (single quotes, nested lists not indented), so
 * rewrites of an existing file stay close to what was there.
 */
import * as fs from "node:fs";
import YAML from "yaml";
import { replaceBlock } from "../../core/rules-block.ts";
import { InboxError, inboxFile, readRulesFile } from "./ledger.ts";

export type Item = Record<string, unknown>;

export interface ListSection {
	key: string;
	/** The comment line written above the key; its first words find an old header to replace. */
	header: string;
}

export const AGENT_LIST: ListSection = {
	key: "agent_watch",
	header:
		"# Agent sessions to watch (tern / herdr / hc / tmux). Written by `inbox agent add|rm`; probed by `inbox agent probe`, tailed by the m365 inbox extension (push: true).\n",
};

export const SCHEDULE_LIST: ListSection = {
	key: "schedule",
	header: "# Scheduled jobs. Written by `inbox schedule add|rm`; run by the m365 inbox extension and `inbox schedule run`.\n",
};

export function readList(list: ListSection): Item[] {
	const items = readRulesFile()[list.key] ?? [];
	if (!Array.isArray(items)) throw new InboxError(`${inboxFile("rules.yaml")}: \`${list.key}\` must be a list`);
	return items as Item[];
}

/** Rewrite only this list's block, where it is (appended when missing); every other byte stays. */
export function writeList(list: ListSection, items: Item[]): void {
	const file = inboxFile("rules.yaml");
	const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
	const dump = YAML.stringify(items, { version: "1.1", singleQuote: true, indentSeq: false, lineWidth: 80 });
	const body = items.length ? `${list.key}:\n${dump.replace(/\n$/, "").split("\n").map((line) => `  ${line}`).join("\n")}\n` : `${list.key}: []\n`;
	// The header's first words find an older wording of it (e.g. "… Written by `inbox.py agent add|rm` …") to replace.
	const lead = list.header.split(" ").slice(0, 4).join(" ");
	const tmp = `${file}.${process.pid}.tmp`;
	fs.mkdirSync(inboxFile(), { recursive: true });
	fs.writeFileSync(tmp, replaceBlock(text, list.key, lead, list.header + body));
	fs.renameSync(tmp, file);
}
