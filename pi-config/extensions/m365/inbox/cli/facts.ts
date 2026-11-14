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
// Up to four words, within one sentence, may sit between it and is/:/= ("password for user ci is ...", "token for the bot: ...").
// When the word after the credential word names an attribute of it (ATTR: "token owner is Lin", "secret store is Vault",
// "password expiry is 90 days"), the sentence is about that attribute, not the value.
// Identifier forms count too: glued (PGPASSWORD, accessToken, clientSecret), joined by `_`/`-` (MYSQL_PWD,
// aws_secret_access_key). `pass` alone is a credential word only before `:`/`=` (DB_PASS=..., pass: x), as are 密码/口令.
const CORE = String.raw`password|passwd|passphrase|passcode|pwd|pw|secret|token|credentials?|creds|api[-_ ]?key|access[-_]?key`;
const CRED_WORD = String.raw`(?<![A-Za-z0-9])(?:[A-Za-z0-9]*?(?:password|passwd|pwd|secret|token)|(?:[A-Za-z0-9]+[_-])*(?:${CORE}))(?:[_-][A-Za-z0-9]+)*(?![A-Za-z0-9])`;
const CRED_ASSIGN = String.raw`(?:${CRED_WORD}|(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*pass(?![A-Za-z0-9])|密码|口令)`;
const POINTER = String.raw`(?:in|inside|at|on|under|behind|stored|kept|owned|held|located|saved|managed|shared|issued|set|rotated|revoked|expired|reset|changed|required|needed|missing|valid|invalid|unknown|pending|deployed|not|no|none|now|still|being|available|the|per|via|from|by|with|only|also|handled|provided|generated|lives|goes|used|configured|scoped|created|leaked|exposed|empty|here|there|ready|fine|ok|wrong|correct|broken|gone|done|live|active|disabled|enabled|working|unchanged|same|different|new|old|exported|loaded|read|written|passed|sent|derived|copied|fetched|injected|mounted|checked|verified|ask|asked|see|use|request|requested|contact|rotate|delegated)\b`;
// A bare word is a value too, even with words after it ("password is abc for prod", "password is abc in Vault").
// Only a verb right after it makes it a name, not a value ("token: Graph delegated via az cli"); a preposition never
// does, so the start of the phrase alone decides whether it is a pointer.
const NAMED_BY = String.raw`(?:stored|kept|owned|held|located|saved|managed|shared|issued|rotated|revoked|expired|changed|required|needed|deployed|handled|provided|generated|lives|goes|used|configured|scoped|created|exported|loaded|written|passed|sent|derived|copied|fetched|injected|mounted|checked|verified|delegated)\b`;
const ALPHA = String.raw`[A-Za-z]+\b(?!\s+${NAMED_BY})`;
// Nouns that name an attribute of a credential, not its value.
const ATTR = String.raw`(?:owners?|stores?|storage|rotations?|budget|expiry|expiration|quotas?|polic(?:y|ies)|location|vault|manager|limits?|length|format|scopes?|ttl|lifetime|age|name|type|count|size|field|file|path|env|variable|holder|team|process|service|provider|requirements?|rules?|status|issuer|refresh|reset|schedule|cadence|usage|cost|plan|page|docs?|ticket|flow|prompt)\b`;
// A digit or any non-letter (`_` included: pass_word, abc_def) marks a token as a value, not a word.
const SYMBOLIC = String.raw`(?=\S*(?:\d|[^A-Za-z\s]))`;
const VALUE = String.raw`(?!${POINTER})(?:${SYMBOLIC}\S+|${ALPHA})`;
// `:`, `=`, a full-width colon, or a spaced dash ("password - x").
const SEP = String.raw`(?:\s*[:=：]|\s+-)`;
const SECRET = new RegExp(
	[
		String.raw`${CRED_ASSIGN}${SEP}\s*${VALUE}`,
		String.raw`${CRED_ASSIGN}${SEP}?\s*(?:"(?!${POINTER})[^"\s]+"|'(?!${POINTER})[^'\s]+')`,
		String.raw`${CRED_WORD}\s+(?:is|was|are|were)\s+${VALUE}`,
		String.raw`${CRED_WORD}(?!\s+${ATTR})(?:\s+(?!${ATTR})[\w-]+(?:\.[\w-]+)*){1,4}?(?:\s*[:=：]|\s+(?:is|was|are|were))\s*${VALUE}`,
		String.raw`${CRED_WORD}(?<![sS])(?:\s+|-)(?!${POINTER})(?!\b[A-Za-z]+\b)(?![("'\[])(?=[\x21-\x7e]*[\d\W])[\x21-\x7e]{4,}`,
		// URL userinfo (scheme://user:pass@host), HTTP auth headers, sshpass -p, vendor token prefixes.
		String.raw`\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@`,
		String.raw`\b(?:Basic|Bearer)\s+[A-Za-z0-9+/_=-]{8,}`,
		String.raw`Authorization:\s*(?:Basic|Bearer|Token|Digest)\s+\S{4,}`,
		String.raw`\bsshpass\s+(?:-\w\s+)*-p\s*\S+`,
		String.raw`\b(?:ghp|sk)[_-][A-Za-z0-9_-]{8,}`,
		String.raw`\bgithub_pat_[A-Za-z0-9_]{8,}`,
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

/** Insert or replace one fact. The replaced text stays as `superseded:`; history the guard flags is dropped. Other facts are left as stored. */
export function upsertFact(kind: string, key: string, text: string, source: string, at = stamp()): string {
	const cleanKind = clean(kind);
	const cleanKey = clean(key);
	const cleanText = clean(text);
	const cleanSource = clean(source);
	checkFact(cleanKind, cleanKey, cleanText, cleanSource);
	return mutate((facts) => {
		const old = facts.find((fact) => fact.kind === cleanKind && fact.key === cleanKey);
		const history = [...(old?.superseded ?? [])];
		if (old && old.text !== cleanText) history.unshift(old.text);
		const next: Fact = { kind: cleanKind, key: cleanKey, text: cleanText, source: cleanSource, since: old?.since ?? at.slice(0, 10), updated: at, superseded: history.filter((line) => !SECRET.test(line)) };
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

/** Why a teams-fact row cannot become a fact facts.md can read back, or undefined when it can. */
function unstorable(key: string, text: string, source: string): string | undefined {
	if (!KEY_RE.test(key)) return `key ${JSON.stringify(key)} is not lowercase words, digits, dots, underscores, or dashes`;
	if (!text || META_RE.test(text)) return "its text would read back as facts.md metadata";
	if (META_RE.test(source)) return "its source would read back as facts.md metadata";
	return undefined;
}

type Migration = { written: number; closed: string[]; refused: { id: string; reason: string }[] };

/**
 * Move open teams-fact rows into facts.md. Newest repeated key wins; archived facts stay archived. A row facts.md could
 * not read back (a bad key, text that parses as metadata) or one that may hold a credential value is refused: not
 * written, not archived, left open as it is, and named in `refused`. The guard can be wrong, so refusing never
 * destroys the row's text; the person reading `refused` rewrites or drops it.
 */
export function migrateFacts(rows = listRows({ states: ["open", "claimed"] }).split("\n").slice(1).filter(Boolean).map((line) => Object.fromEntries(line.split("\t").map((cell, i) => [["id", "key", "subject", "first_seen", "source", "tag", "action", "state", "owner", "note", "link"][i], cell])) as Row)): Migration {
	return withLedger((liveRows, save) => {
		const facts = rows.filter((row) => row.tag === "teams-fact" && row.state !== "done");
		const refused: { id: string; reason: string }[] = [];
		for (const row of facts) {
			// Every column that can carry raw text, each on its own as checkFact does.
			const column = (["key", "subject", "source", "owner", "note", "link"] as const).find((field) => SECRET.test(row[field] ?? ""));
			const source = clean([row.source, row.note, row.first_seen].filter(Boolean).join(" "));
			const reason = column ? `its ${column} may hold a credential value; record where the credential lives instead` : unstorable(factKey(row), clean(row.subject), source);
			if (reason) refused.push({ id: row.id, reason });
		}
		const skip = new Set(refused.map((r) => r.id));
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
			const history = current && current.text !== row.subject ? [current.text, ...current.superseded] : current?.superseded ?? [];
			const fact: Fact = { kind, key, text: clean(row.subject), source: clean(source), since: current?.since ?? row.first_seen.slice(0, 10), updated: row.first_seen, superseded: history.filter((line) => !SECRET.test(line)) };
			if (current) next[next.indexOf(current)] = fact;
			else next.push(fact);
			written++;
		}
		saveFacts(next);
		const cleanIds = facts.map((row) => row.id).filter((id) => !skip.has(id));
		finishRows(liveRows, cleanIds, "moved to facts.md", save);
		return { written, closed: cleanIds, refused };
	});
}
/** Read rows directly for the migration script, including a copied inbox directory. */
export function migrateFile(dir = inboxFile()): Migration {
	const rows = readTsv(`${dir}/ledger.tsv`).filter((row) => row.tag === "teams-fact");
	return migrateFacts(rows);
}
