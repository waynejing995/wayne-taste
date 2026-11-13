/**
 * The inbox's files: rules.yaml classifies an event, ledger.tsv keeps the live rows, archive.tsv remembers
 * finished ones by key. Plain node only (no pi import), so the `inbox` launcher and the plugin share it.
 *
 * ledger.tsv is written the way Python's csv module wrote it: a cell holding `"` is wrapped in quotes with the
 * quote doubled; cells never hold a tab or a newline (`clean`). Writes go to a temp file renamed over the target.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";

/** A usage or data error: the CLI prints `Error: <message>` and exits 1. */
export class InboxError extends Error {}

export const COLUMNS = ["id", "key", "subject", "first_seen", "source", "tag", "action", "state", "owner", "note", "link"];
export const ACTIONS = ["do", "ignore", "log", "notify"];
export const STATES = ["claimed", "open"];
/** Sections of rules.yaml that are lists kept by programs, not classification rules. */
const LISTS = new Set(["teams_watch", "agent_watch", "schedule"]);
const LOCK_STALE_MS = 10_000;

export type Row = Record<string, string>;
type Rule = { action: string; tag?: string; owner?: string; when?: Record<string, unknown> };
type Rules = Record<string, Record<string, Rule[]>>;

export function inboxDir(): string {
	return process.env.WAYNE_INBOX_DIR ?? path.join(os.homedir(), ".wayne", "inbox");
}

export function inboxFile(...parts: string[]): string {
	return path.join(inboxDir(), ...parts);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local time, `YYYY-MM-DD HH:MM` (with `:SS` when asked): the stamps the ledger and rules.yaml hold. */
export function stamp(at: Date = new Date(), seconds = false): string {
	const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
	return `${day} ${pad(at.getHours())}:${pad(at.getMinutes())}${seconds ? `:${pad(at.getSeconds())}` : ""}`;
}

/** A TSV cell: no tabs or newlines. */
export function clean(text: string | undefined | null): string {
	return (text ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

/** YAML as PyYAML's safe_load read it (1.1: bare yes/no are booleans), so a rule means what it always meant. */
export function parseYaml(text: string): unknown {
	return YAML.parse(text, { version: "1.1" });
}

/** The whole of rules.yaml; {} when it does not exist yet. */
export function readRulesFile(): Record<string, unknown> {
	const file = inboxFile("rules.yaml");
	if (!fs.existsSync(file)) return {};
	const data = parseYaml(fs.readFileSync(file, "utf8")) ?? {};
	if (typeof data !== "object" || Array.isArray(data)) throw new InboxError(`${file}: top level must be a mapping`);
	return data as Record<string, unknown>;
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const pyList = (items: string[]) => `[${items.map((i) => `'${i}'`).join(", ")}]`;

/**
 * rules.yaml checked: source -> place -> ordered rules. A bad file stops the run, because classifying with half
 * a rule set silently drops events.
 */
export function loadRules(): Rules {
	const file = inboxFile("rules.yaml");
	if (!fs.existsSync(file)) throw new InboxError(`no rules file at ${file}`);
	const data = parseYaml(fs.readFileSync(file, "utf8")) ?? {};
	if (!isMap(data) || Object.keys(data).length === 0) throw new InboxError(`${file}: top level must map source -> place -> rules`);
	const rules: Rules = {};
	for (const [source, places] of Object.entries(data)) {
		if (LISTS.has(source)) continue;
		if (!isMap(places)) throw new InboxError(`${file}: ${source}: must map place -> rules`);
		for (const [place, list] of Object.entries(places)) {
			const where = `${file}: ${source} / ${place}`;
			if (!Array.isArray(list) || list.length === 0) throw new InboxError(`${where}: must be a non-empty list of rules`);
			list.forEach((rule, i) => {
				if (!isMap(rule) || !ACTIONS.includes(rule.action as string))
					throw new InboxError(`${where}: rule ${i + 1}: \`action\` must be one of ${pyList(ACTIONS)}`);
				const when = rule.when ?? {};
				if (!isMap(when)) throw new InboxError(`${where}: rule ${i + 1}: \`when\` must map field -> value`);
				for (const [field, want] of Object.entries(when)) {
					// Events carry strings, so a value must be a plain scalar: a bare yes/no is a boolean, an empty value is
					// null, a nested value stringifies to brackets, and an empty list matches nothing; each would never match.
					const values = Array.isArray(want) ? want : [want];
					if (values.length === 0 || values.some((w) => typeof w !== "string" && typeof w !== "number"))
						throw new InboxError(
							`${where}: rule ${i + 1}: \`${field}\` must be a string or number, or a non-empty list of them (quote yes/no, fill empty values)`,
						);
				}
			});
		}
		rules[source] = places as Record<string, Rule[]>;
	}
	return rules;
}

/** Exact match. A list means any of them; a value starting with `!` means anything but it. */
export function matches(expected: unknown, value: string | undefined): boolean {
	if (value === undefined) return false;
	for (const raw of Array.isArray(expected) ? expected : [expected]) {
		const want = String(raw);
		if ((want.startsWith("!") && value !== want.slice(1)) || value === want) return true;
	}
	return false;
}

/**
 * The first rule under source/place whose every `when` field matches. A place with no rules of its own falls
 * back to the source's `"*"` rules (places named at run time, such as agent sessions).
 */
export function firstMatch(rules: Rules, source: string, place: string, fields: Record<string, string>): Rule | undefined {
	const places = rules[source] ?? {};
	const list = places[place] ?? places["*"] ?? [];
	return list.find((rule) => Object.entries(rule.when ?? {}).every(([field, want]) => matches(want, fields[field])));
}

/** ledger.tsv / archive.tsv text to rows; the header must be COLUMNS. */
export function parseTsv(text: string, where: string): Row[] {
	const [header, ...lines] = text.split("\n").filter(Boolean);
	if (header !== COLUMNS.join("\t")) throw new InboxError(`${where}: header is ${JSON.stringify(header?.split("\t") ?? null)}, expected ${JSON.stringify(COLUMNS)}`);
	return lines.map((line) => {
		const cells = line.split("\t").map((c) => (c.length >= 2 && c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1).replaceAll('""', '"') : c));
		return Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i] ?? ""]));
	});
}

export function formatTsv(rows: Row[]): string {
	const cell = (c: string) => (/["\t\r\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c);
	return [COLUMNS.join("\t"), ...rows.map((r) => COLUMNS.map((c) => cell(r[c] ?? "")).join("\t"))].join("\n") + "\n";
}

export function readTsv(file: string): Row[] {
	return fs.existsSync(file) ? parseTsv(fs.readFileSync(file, "utf8"), file) : [];
}

function writeTsv(file: string, rows: Row[]): void {
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, formatTsv(rows));
	fs.renameSync(tmp, file);
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));

/**
 * Hold `lock` (created exclusively) for one read-modify-write. A lock older than 10 s belonged to a process
 * that died. Every section edit is milliseconds of sync file work, so blocking the caller this long is fine.
 */
export function withLock<T>(lock: string, waitMs: number, fn: () => T): T {
	fs.mkdirSync(path.dirname(lock), { recursive: true });
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			fs.closeSync(fs.openSync(lock, "wx"));
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			let age: number;
			try {
				age = Date.now() - fs.statSync(lock).mtimeMs;
			} catch {
				continue; // released between the create and the stat: try again
			}
			if (age > LOCK_STALE_MS) fs.rmSync(lock, { force: true, recursive: true });
			else if (Date.now() > deadline) throw new InboxError(`${lock} is held by another writer`);
			else Atomics.wait(sleeper, 0, 0, 20);
		}
	}
	try {
		return fn();
	} finally {
		fs.rmSync(lock, { force: true, recursive: true });
	}
}

/** The rules.yaml lock: the same file the Teams watch list takes, so one writer edits rules.yaml at a time. */
export function withRulesLock<T>(fn: () => T): T {
	return withLock(inboxFile("rules.yaml.lock"), 2000, fn);
}

/** ledger.tsv's rows under the ledger lock. `save` writes them back. Waits past the stale age, so a dead holder never blocks. */
export function withLedger<T>(fn: (rows: Row[], save: (rows: Row[]) => void) => T): T {
	return withLock(inboxFile("ledger.tsv.lock"), LOCK_STALE_MS + 2000, () => {
		const file = inboxFile("ledger.tsv");
		return fn(readTsv(file), (rows) => writeTsv(file, rows));
	});
}

/** Adds one row unless its key is already live or archived. Returns `seen <id>` or the new id. */
function insert(row: Omit<Row, "id">): { id: string; seen: boolean; tag: string } {
	return withLedger((rows, save) => {
		// A finished row stays remembered in the archive, or the next scan would record it again.
		const all = [...rows, ...readTsv(inboxFile("archive.tsv"))];
		const old = all.find((r) => r.key === row.key);
		if (old) return { id: old.id, seen: true, tag: old.tag };
		const id = String(all.reduce((max, r) => Math.max(max, Number(r.id)), 0) + 1);
		save([...rows, { id, ...row }]);
		return { id, seen: false, tag: row.tag };
	});
}

export interface AddEvent {
	source: string;
	place: string;
	key: string;
	subject: string;
	fields?: string[];
	note?: string;
	link?: string;
}

/** Classify one event. `<action> <id> <tag>` when recorded, `seen <id> <tag>` when its key is known, `skip <reason>` when not recorded. */
export function addEvent(ev: AddEvent): string {
	const fields: Record<string, string> = {};
	for (const item of ev.fields ?? []) {
		const at = item.indexOf("=");
		if (at < 0) throw new InboxError(`--field needs k=v, got '${item}'`);
		fields[item.slice(0, at)] = item.slice(at + 1);
	}
	const rule = firstMatch(loadRules(), ev.source, ev.place, fields);
	if (!rule) return "skip unmatched";
	if (rule.action === "ignore") return "skip ignore";
	const got = insert({
		key: clean(ev.key),
		subject: clean(ev.subject),
		first_seen: stamp(),
		source: ev.source,
		tag: clean(rule.tag),
		action: rule.action,
		state: "open",
		owner: clean(rule.owner),
		note: clean(ev.note),
		link: clean(ev.link),
	});
	return got.seen ? `seen ${got.id} ${got.tag}` : `${rule.action} ${got.id} ${rule.tag ?? ""}`;
}

/** One row without rules: the caller already knows what it is. Same key dedup as `addEvent`; the key gets a `<tag>:` prefix. */
export function recordDirect(tag: string, action: string, key: string, subject: string, source: string, note = "", link = "", owner = "wayne"): string {
	const got = insert({
		key: `${tag}:${clean(key)}`,
		subject: clean(subject),
		first_seen: stamp(),
		source: clean(source),
		tag,
		action,
		state: "open",
		owner: clean(owner) || "wayne",
		note: clean(note),
		link: clean(link),
	});
	return got.seen ? `seen ${got.id} ${tag}` : `${action} ${got.id} ${tag}`;
}

/** Edit live rows in place. */
export function setRows(ids: string[], change: { state?: string; owner?: string; note?: string }): string {
	if (change.state === undefined && change.owner === undefined && change.note === undefined)
		throw new InboxError("nothing to set: give --state, --owner or --note");
	withLedger((rows, save) => {
		const missing = ids.filter((id) => !rows.some((r) => r.id === id));
		if (missing.length) throw new InboxError(`no such id: ${missing.join(", ")}`);
		for (const row of rows.filter((r) => ids.includes(r.id))) {
			if (change.state !== undefined) row.state = change.state;
			if (change.owner !== undefined) row.owner = clean(change.owner);
			if (change.note !== undefined) row.note = clean(change.note);
		}
		save(rows);
	});
	return `updated ${ids.join(" ")}`;
}

/** Move finished rows out of the ledger into archive.tsv. */
export function doneRows(ids: string[], note?: string): string {
	withLedger((rows, save) => {
		const missing = ids.filter((id) => !rows.some((r) => r.id === id));
		if (missing.length) throw new InboxError(`no such live id: ${missing.join(", ")}`);
		const finished = rows.filter((r) => ids.includes(r.id));
		for (const row of finished) {
			// The archive is the finished state; its state column says so instead of the last live one.
			row.state = "done";
			if (note !== undefined) row.note = clean(note);
		}
		// Archive first: a crash between the two writes leaves a row in both, never in neither.
		const archive = inboxFile("archive.tsv");
		writeTsv(archive, [...readTsv(archive), ...finished]);
		save(rows.filter((r) => !ids.includes(r.id)));
	});
	return `done ${ids.join(" ")}`;
}

/** Live rows as TSV with the header. `states` defaults to open and claimed; owner and subject are substrings. */
export function listRows(filter: { states?: string[]; owner?: string; subject?: string } = {}): string {
	const states = filter.states?.length ? filter.states : STATES;
	const rows = withLedger((rows) => rows).filter(
		(r) =>
			states.includes(r.state) &&
			(filter.owner === undefined || r.owner.includes(filter.owner)) &&
			(filter.subject === undefined || r.subject.includes(filter.subject)),
	);
	return formatTsv(rows);
}

/** The places rules.yaml lists under `source`, one per line. None is an error. */
export function places(source: string): string {
	const found = Object.keys(loadRules()[source] ?? {}).filter((p) => p !== "*");
	if (!found.length) throw new InboxError(`${inboxFile("rules.yaml")}: no places under \`${source}\``);
	return found.join("\n");
}
