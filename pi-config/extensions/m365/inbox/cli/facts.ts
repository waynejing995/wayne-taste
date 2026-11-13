/**
 * Standing facts: one markdown file, one entry per key. The ledger keeps work rows; facts are read directly.
 *
 * Writes share the ledger lock and land through a temp file renamed over facts.md.
 */
import * as fs from "node:fs";
import { clean, finishRows, inboxFile, listRows, readTsv, stamp, withLedger, withLock, type Row } from "./ledger.ts";
import { InboxError } from "./ledger.ts";

export const FACT_KINDS = ["endpoint", "cred", "decision", "owed", "info"];
const SECRET = /(?:(?:password|passwd|pw|secret|token|api[-_ ]?key)(?:\s*[:=]|\s+(?:is|was)?|-)\s*(?!in\b|stored\b|kept\b|owned\b|goes\b|lives\b|are\b)(?!\b[A-Za-z]+\b)(?=\S*\d|\S*[^A-Za-z\s])\S{4,}|Bearer\s+[A-Za-z0-9_-]{8,}|\b(?:ghp|sk)[_-][A-Za-z0-9_-]{8,}|\bxox[bp]-[A-Za-z0-9-]{8,})/i;

export interface Fact {
	kind: string;
	key: string;
	text: string;
	source: string;
	since: string;
	updated: string;
	superseded: string[];
}

function file(): string {
	return inboxFile("facts.md");
}

function parse(text: string): Fact[] {
	const facts: Fact[] = [];
	for (const block of text.split(/^## /m).slice(1)) {
		const [heading, ...body] = block.split("\n");
		const match = /^\[([a-z]+):([^\]]+)\]$/.exec(heading.trim());
		if (!match || !FACT_KINDS.includes(match[1])) throw new InboxError(`facts.md has a bad heading: ${heading.trim()}`);
		const lines = body.join("\n").trim().split("\n");
		const source = lines.find((line) => line.startsWith("source: "));
		const since = lines.find((line) => line.startsWith("since: "));
		if (!source || !since) throw new InboxError(`facts.md entry ${heading.trim()} lacks source or since`);
		const updated = lines.find((line) => line.startsWith("updated: "));
		facts.push({
			kind: match[1],
			key: match[2],
			text: lines.filter((line) => !line.startsWith("source: ") && !line.startsWith("since: ") && !line.startsWith("updated: ") && !line.startsWith("superseded: ")).join("\n").trim(),
			source: source.slice(8),
			since: since.slice(7),
			updated: updated?.slice(9) || since.slice(7),
			superseded: lines.filter((line) => line.startsWith("superseded: ")).map((line) => line.slice(12)),
		});
	}
	return facts;
}

function render(facts: Fact[]): string {
	if (!facts.length) return "";
	return facts.map((fact) => [
		`## [${fact.kind}:${fact.key}]`,
		"",
		fact.text,
		"",
		`source: ${fact.source}`,
		`since: ${fact.since}`,
		`updated: ${fact.updated}`,
		...fact.superseded.map((text) => `superseded: ${text}`),
		"",
	].join("\n")).join("\n");
}

export function readFacts(): Fact[] {
	return fs.existsSync(file()) ? parse(fs.readFileSync(file(), "utf8")) : [];
}

function saveFacts(facts: Fact[]): void {
	const target = file();
	const tmp = `${target}.tmp`;
	fs.mkdirSync(inboxFile(), { recursive: true });
	fs.writeFileSync(tmp, render(facts));
	fs.renameSync(tmp, target);
}

function mutate<T>(fn: (facts: Fact[]) => T): T {
	return withLock(inboxFile("ledger.tsv.lock"), Number(process.env.INBOX_LOCK_WAIT_MS ?? 1000), () => fn(readFacts()));
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]*$/;
const META_RE = /^(?:## |(?:source|since|superseded|updated): )/;

function checkLine(label: string, value: string): void {
	if (!value || value.includes("\n") || value.includes("\t") || META_RE.test(value)) throw new InboxError(`--${label} must be one plain line`);
}

function checkFact(kind: string, key: string, text: string, source: string): void {
	if (!FACT_KINDS.includes(kind)) throw new InboxError(`--kind must be one of ${FACT_KINDS.join(", ")}`);
	if (!KEY_RE.test(key)) throw new InboxError("--key must be lowercase words, digits, dots, underscores, or dashes");
	checkLine("text", text);
	checkLine("source", source);
	if ([key, text, source].some((value) => SECRET.test(value))) throw new InboxError("a fact names where the credential lives, never its value");
}

/** Insert or replace one fact. The replaced text stays as `superseded:`. */
export function upsertFact(kind: string, key: string, text: string, source: string, at = stamp()): string {
	const cleanKind = clean(kind);
	const cleanKey = clean(key);
	const cleanText = clean(text);
	const cleanSource = clean(source);
	checkFact(cleanKind, cleanKey, cleanText, cleanSource);
	return mutate((facts) => {
		const old = facts.find((fact) => fact.kind === cleanKind && fact.key === cleanKey);
		if (facts.some((fact) => [fact.key, fact.text, fact.source].some((value) => SECRET.test(value)))) throw new InboxError("a fact names where the credential lives, never its value");
		const history = (old?.superseded ?? []).filter((text) => !SECRET.test(text));
		if (old && old.text !== cleanText) history.unshift(old.text);
		const next: Fact = { kind: cleanKind, key: cleanKey, text: cleanText, source: cleanSource, since: old?.since ?? at.slice(0, 10), updated: at, superseded: history };
		saveFacts(old ? facts.map((fact) => fact === old ? next : fact) : [...facts, next]);
		if (old && old.text === cleanText) return `unchanged ${cleanKind}:${cleanKey}`;
		return old ? `updated ${cleanKind}:${cleanKey}` : `added ${cleanKind}:${cleanKey}`;
	});
}

export function listFacts(grep = ""): string {
	const needle = grep.toLowerCase();
	const facts = readFacts().filter((fact) => !needle || `${fact.kind} ${fact.key} ${fact.text} ${fact.source}`.toLowerCase().includes(needle));
	return render(facts);
}

export function dropFact(key: string): string {
	const cleanKey = clean(key);
	return mutate((facts) => {
		const hits = facts.filter((fact) => fact.key === cleanKey || `${fact.kind}:${fact.key}` === cleanKey);
		if (!hits.length) throw new InboxError(`no such fact: ${cleanKey}`);
		saveFacts(facts.filter((fact) => !hits.includes(fact)));
		return `dropped ${hits.map((fact) => `${fact.kind}:${fact.key}`).join(" ")}`;
	});
}

function mappedKind(row: Row): string {
	const recorded = /\[(endpoint|cred|decision|owed|info):/.exec(row.subject)?.[1];
	if (recorded) return recorded;
	const text = row.subject.toLowerCase();
	if (/\b(endpoint|url|host|port)\b/.test(text)) return "endpoint";
	if (/\b(password|credential|token|secret|key)\b/.test(text)) return "cred";
	if (/\b(owe|owed|todo|action item|follow up)\b/.test(text)) return "owed";
	if (/\b(decide|decision|agreed|rule|authorize|approved)\b/.test(text)) return "decision";
	return "info";
}

function factKey(row: Row): string {
	return row.key.replace(/^teams-fact:/, "");
}

/** Move open teams-fact rows into facts.md. Newest repeated key wins; archived facts stay archived. */
export function migrateFacts(rows = listRows({ states: ["open", "claimed"] }).split("\n").slice(1).filter(Boolean).map((line) => Object.fromEntries(line.split("\t").map((cell, i) => [["id", "key", "subject", "first_seen", "source", "tag", "action", "state", "owner", "note", "link"][i], cell])) as Row)): { written: number; closed: string[] } {
	return withLedger((liveRows, save) => {
		const facts = rows.filter((row) => row.tag === "teams-fact" && row.state !== "done");
		const newest = new Map<string, Row>();
		for (const row of facts) {
			const key = factKey(row);
			const old = newest.get(key);
			if (!old || row.first_seen > old.first_seen || (row.first_seen === old.first_seen && Number(row.id) > Number(old.id))) newest.set(key, row);
		}
		const existing = readFacts();
		const redacted: string[] = [];
		const next = [...existing];
		for (const row of newest.values()) {
			const key = factKey(row);
			const current = next.find((fact) => fact.key === key);
			if (current && (current.updated || current.since) >= row.first_seen) continue;
			if (SECRET.test(`${key} ${row.subject} ${row.source} ${row.note}`)) {
				redacted.push(row.id);
				continue;
			}
			const kind = current?.kind ?? mappedKind(row);
			const source = [row.source, row.note, row.first_seen].filter(Boolean).join(" ");
			const fact: Fact = { kind, key, text: clean(row.subject), source: clean(source), since: current?.since ?? row.first_seen.slice(0, 10), updated: row.first_seen, superseded: current && current.text !== row.subject ? [current.text, ...current.superseded] : current?.superseded ?? [] };
			if (current) next[next.indexOf(current)] = fact;
			else next.push(fact);
		}
		saveFacts(next.filter((fact) => !SECRET.test(`${fact.key} ${fact.text} ${fact.source} ${fact.superseded.join(" ")}`)));
		for (const row of liveRows.filter((row) => redacted.includes(row.id))) {
			row.subject = "[redacted: credential value]";
			row.note = "redacted because the row held a credential value";
		}
		finishRows(liveRows, redacted, undefined, save);
		const cleanIds = facts.map((row) => row.id).filter((id) => !redacted.includes(id));
		finishRows(liveRows.filter((row) => !redacted.includes(row.id)), cleanIds, "moved to facts.md", save);
		return { written: newest.size - redacted.length, closed: facts.map((row) => row.id) };
	});
}
/** Read rows directly for the migration script, including a copied inbox directory. */
export function migrateFile(dir = inboxFile()): { written: number; closed: string[] } {
	const rows = readTsv(`${dir}/ledger.tsv`).filter((row) => row.tag === "teams-fact");
	return migrateFacts(rows);
}
