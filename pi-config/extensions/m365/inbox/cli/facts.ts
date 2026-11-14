/**
 * Standing facts: one markdown file, one entry per key. The ledger keeps work rows; facts are read directly.
 *
 * Writes share the ledger lock and land through a temp file renamed over facts.md.
 */
import * as fs from "node:fs";
import { clean, finishRows, inboxFile, ledgerLockWaitMs, listRows, readTsv, stamp, withLedger, withLock, type Row } from "./ledger.ts";
import { InboxError } from "./ledger.ts";

export const FACT_KINDS = ["endpoint", "cred", "decision", "owed", "info"];
// A credential word followed by what reads as its value. A pointer word ("is in the vault", "was rotated") is not
// a value. After `:`/`=` or is/was, a value is a token with a digit or symbol, or a bare word not followed by a pointer word
// ("password is abc.", "token: hunter"); "token: ask Lin for it" is a pointer. Right after the word, an ASCII token with a digit or symbol.
// The word may follow `_` or a digit (client_secret, GITHUB_TOKEN, db_password), so it starts after any non-letter.
// Up to four words, within one sentence, may sit between it and is/:/= ("password for user ci is ...", "token for the bot: ..."); then only
// a token with a digit or symbol counts, so "token rotation is weekly" stays a pointer.
const CRED_WORD = String.raw`(?<![A-Za-z])(?:password|passwd|passphrase|passcode|pw|secret|token|credentials?|creds|api[-_ ]?key)`;
const POINTER = String.raw`(?:in|inside|at|on|under|behind|stored|kept|owned|held|located|saved|managed|shared|issued|set|rotated|revoked|expired|reset|changed|required|needed|missing|valid|invalid|unknown|pending|deployed|not|no|none|now|still|being|available|the|per|via|from|by|with|only|also|handled|provided|generated|lives|goes|used|configured|scoped|created|leaked|exposed|empty|here|there|ready|fine|ok|wrong|correct|broken|gone|done|live|active|disabled|enabled|working|unchanged|same|different|new|old|exported|loaded|read|written|passed|sent|derived|copied|fetched|injected|mounted|checked|verified|ask|asked|see|use|request|requested|contact|rotate|delegated)\b`;
// A bare word is a value too, even with words after it ("password is abc for prod"), unless a pointer word
// follows it ("token: Graph delegated via az cli").
const ALPHA = String.raw`[A-Za-z]+\b(?!\s+${POINTER})`;
// A digit or any non-letter (`_` included: pass_word, abc_def) marks a token as a value, not a word.
const SYMBOLIC = String.raw`(?=\S*(?:\d|[^A-Za-z\s]))`;
const SECRET = new RegExp(
	[
		String.raw`${CRED_WORD}s?\s*[:=]\s*(?!${POINTER})(?:${SYMBOLIC}\S+|${ALPHA})`,
		String.raw`${CRED_WORD}s?\s+(?:is|was|are|were)\s+(?!${POINTER})(?:${SYMBOLIC}\S+|${ALPHA})`,
		String.raw`${CRED_WORD}s?(?:\s+[\w-]+(?:\.[\w-]+)*){1,4}?(?:\s*[:=]|\s+(?:is|was|are|were))\s*(?!${POINTER})(?:${SYMBOLIC}\S+|${ALPHA})`,
		String.raw`${CRED_WORD}(?:\s+|-)(?!${POINTER})(?!\b[A-Za-z]+\b)(?![("'\[])(?=[\x21-\x7e]*[\d\W])[\x21-\x7e]{4,}`,
		String.raw`Bearer\s+[A-Za-z0-9_-]{8,}`,
		String.raw`\b(?:ghp|sk)[_-][A-Za-z0-9_-]{8,}`,
		String.raw`\bxox[bp]-[A-Za-z0-9-]{8,}`,
	].join("|"),
	"i",
);

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
	return withLock(inboxFile("ledger.tsv.lock"), ledgerLockWaitMs(), () => fn(readFacts()));
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

const REDACTED = "[redacted: credential value]";

/** A stored fact with credential values redacted: the fact stays (never silently deleted), its value does not. */
function scrub(fact: Fact): Fact {
	const bad = (value: string) => SECRET.test(value);
	if (!bad(fact.text) && !bad(fact.source) && !fact.superseded.some(bad)) return fact;
	return { ...fact, text: bad(fact.text) ? REDACTED : fact.text, source: bad(fact.source) ? REDACTED : fact.source, superseded: fact.superseded.filter((text) => !bad(text)) };
}

/** Insert or replace one fact. The replaced text stays as `superseded:`. */
export function upsertFact(kind: string, key: string, text: string, source: string, at = stamp()): string {
	const cleanKind = clean(kind);
	const cleanKey = clean(key);
	const cleanText = clean(text);
	const cleanSource = clean(source);
	checkFact(cleanKind, cleanKey, cleanText, cleanSource);
	return mutate((facts) => {
		const stored = facts.map(scrub);
		const old = stored.find((fact) => fact.kind === cleanKind && fact.key === cleanKey);
		const history = [...(old?.superseded ?? [])];
		if (old && old.text !== cleanText) history.unshift(old.text);
		const next: Fact = { kind: cleanKind, key: cleanKey, text: cleanText, source: cleanSource, since: old?.since ?? at.slice(0, 10), updated: at, superseded: history };
		saveFacts(old ? stored.map((fact) => fact === old ? next : fact) : [...stored, next]);
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

/** Why a teams-fact row cannot become a fact facts.md can read back, or undefined when it can. */
function unstorable(key: string, text: string, source: string): string | undefined {
	if (!KEY_RE.test(key)) return `key ${JSON.stringify(key)} is not lowercase words, digits, dots, underscores, or dashes`;
	if (!text || META_RE.test(text)) return "its text would read back as facts.md metadata";
	if (META_RE.test(source)) return "its source would read back as facts.md metadata";
	return undefined;
}

type Migration = { written: number; closed: string[]; refused: { id: string; reason: string }[] };

/**
 * Move open teams-fact rows into facts.md. Newest repeated key wins; archived facts stay archived. Every row is
 * credential-checked before it is archived, whether or not it wins. A row facts.md could not read back (a bad key,
 * text that parses as metadata) is refused: not written, left open, and named in `refused`.
 */
export function migrateFacts(rows = listRows({ states: ["open", "claimed"] }).split("\n").slice(1).filter(Boolean).map((line) => Object.fromEntries(line.split("\t").map((cell, i) => [["id", "key", "subject", "first_seen", "source", "tag", "action", "state", "owner", "note", "link"][i], cell])) as Row)): Migration {
	return withLedger((liveRows, save) => {
		const facts = rows.filter((row) => row.tag === "teams-fact" && row.state !== "done");
		// Each field on its own, as checkFact does: a clause-ending value ("password: abc") stops ending its clause once joined.
		const redacted = facts.filter((row) => [factKey(row), row.subject, row.source, row.note].some((field) => SECRET.test(field))).map((row) => row.id);
		const refused: { id: string; reason: string }[] = [];
		for (const row of facts) {
			if (redacted.includes(row.id)) continue;
			const source = clean([row.source, row.note, row.first_seen].filter(Boolean).join(" "));
			const reason = unstorable(factKey(row), clean(row.subject), source);
			if (reason) refused.push({ id: row.id, reason });
		}
		const skip = new Set([...redacted, ...refused.map((r) => r.id)]);
		const newest = new Map<string, Row>();
		for (const row of facts.filter((row) => !skip.has(row.id))) {
			const key = factKey(row);
			const old = newest.get(key);
			if (!old || row.first_seen > old.first_seen || (row.first_seen === old.first_seen && Number(row.id) > Number(old.id))) newest.set(key, row);
		}
		const next = [...readFacts()];
		let written = 0;
		for (const row of newest.values()) {
			const key = factKey(row);
			const current = next.find((fact) => fact.key === key);
			if (current && (current.updated || current.since) >= row.first_seen) continue;
			const kind = current?.kind ?? mappedKind(row);
			const source = [row.source, row.note, row.first_seen].filter(Boolean).join(" ");
			const fact: Fact = { kind, key, text: clean(row.subject), source: clean(source), since: current?.since ?? row.first_seen.slice(0, 10), updated: row.first_seen, superseded: current && current.text !== row.subject ? [current.text, ...current.superseded] : current?.superseded ?? [] };
			if (current) next[next.indexOf(current)] = fact;
			else next.push(fact);
			written++;
		}
		saveFacts(next.map(scrub));
		for (const row of liveRows.filter((row) => redacted.includes(row.id))) {
			row.subject = "[redacted: credential value]";
			row.source = SECRET.test(row.source) ? "[redacted]" : row.source;
			row.note = "redacted because the row held a credential value";
			row.key = SECRET.test(row.key) ? "teams-fact:[redacted]" : row.key;
		}
		finishRows(liveRows, redacted, undefined, save);
		const cleanIds = facts.map((row) => row.id).filter((id) => !skip.has(id));
		finishRows(liveRows.filter((row) => !redacted.includes(row.id)), cleanIds, "moved to facts.md", save);
		return { written, closed: [...redacted, ...cleanIds], refused };
	});
}
/** Read rows directly for the migration script, including a copied inbox directory. */
export function migrateFile(dir = inboxFile()): Migration {
	const rows = readTsv(`${dir}/ledger.tsv`).filter((row) => row.tag === "teams-fact");
	return migrateFacts(rows);
}
