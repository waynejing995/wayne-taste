/**
 * Standing facts: one markdown file, one entry per key. The ledger keeps work rows; facts are read directly.
 *
 * Writes share the ledger lock and land through a temp file renamed over facts.md.
 */
import * as fs from "node:fs";
import { clean, finishRows, inboxFile, ledgerLockWaitMs, listRows, readTsv, stamp, withLedger, withLock, type Row } from "./ledger.ts";
import { InboxError } from "./ledger.ts";

export const FACT_KINDS = ["endpoint", "cred", "decision", "owed", "info"];
// The credential guard finds every place a value could sit and judges the whole token there; no word list vetoes a
// value by being near it. A value position follows a credential word and
//   `:`, `=`, a full-width colon, a spaced dash, a comma, or a quote, with an optional "(prod)"/"[prod]" between;
//   is/was/are/were, optionally "now"/"still"/"set to"/"changed to"/..., with up to eight words of the same
//   sentence between ("password for the new prod db is ...");
//   "now" or "to" right after it ("token now X", "changed the CI password to X");
//   是/为 after 密码/口令; "with password X", "user NAME password X".
// The text there (quotes and "the string" removed) is a value unless it is made only of safe pointer forms, each
// bounded to one place, holder, description or status, with nothing else after it: a path or URL, an env name, a
// place or holder ("in Vault", "stored in ...", "owned by Ops", "ask Lin"), a known description ("a PAT", "a
// reference to Vault", "repo secret"), or a status ("expired", "TBD", "not needed", "rotated yesterday"). After any
// safe form the rest of the text is judged again, so `password: TBD hunter2` or `in Vault, but use X` is a value.
// An attribute noun right after the credential word ("token owner is Lin", "token endpoint is https://...") leaves
// no value position. The credential word may be an identifier: glued (PGPASSWORD, accessToken), `_`/`-` joined
// (MYSQL_PWD, aws_secret_access_key), after a digit or `_` (client_secret). `pass` alone, 密码 and 口令 count only
// before a separator. Without a separator, a credential word right before an ASCII token with a digit or symbol
// ("password hunter2!") is a value too. Keys are checked for vendor token shapes only: a key names a fact.
const CORE = String.raw`password|passwd|passphrase|passcode|pwd|pw|secret|token|credentials?|creds|api[-_ ]?key|access[-_]?key|pin|psk|otp|(?:recovery|backup)[-_ ]codes?|private[-_ ]keys?`;
// Repeats are bounded so a long `a-a-a-...` token cannot make matching quadratic.
const CRED_WORD = String.raw`(?<![A-Za-z0-9])(?:[A-Za-z0-9]{0,24}?(?:password|passwd|pwd|secret|token)|(?:[A-Za-z0-9]{1,24}[_-]){0,4}(?:${CORE}))(?:[_-][A-Za-z0-9]{1,24}){0,4}s?(?![A-Za-z0-9])`;
const CRED_ASSIGN = String.raw`(?:${CRED_WORD}|(?<![A-Za-z0-9])(?:[A-Za-z0-9]{1,24}[_-]){0,4}pass(?![A-Za-z0-9])|密码|口令)`;
const ATTR = String.raw`(?:owners?|stores?|storage|rotations?|budget|expiry|expiration|quotas?|polic(?:y|ies)|location|vault|manager|limits?|length|format|scopes?|ttl|lifetime|age|name|type|count|size|field|file|path|env|variable|holder|team|process|service|provider|requirements?|rules?|status|issuer|refresh|reset|schedule|cadence|usage|cost|plan|page|docs?|ticket|flow|prompt|endpoints?|url|uri|headers?|prefix|claims?|audience)\b`;
// Words of the same sentence between a credential word and is/:/=. A host:port or a time is one word, so its colon
// never reads as the separator ("password for db.internal:5432 is in Vault").
const BETWEEN = String.raw`(?:\s+(?!${ATTR})[\w-]{1,40}(?:\.[\w-]{1,40}){0,3}(?::\d{1,5})?){0,8}?`;
const QUALIFIER = String.raw`(?:\s*[(\[][^)\]\n]{0,40}[)\]])?`;
const SEP = String.raw`(?:\s*[:=：]|\s*(?:→|->|=>|—|–|--)|\s+-(?=\s))`;
const CHANGE = String.raw`(?:now|still|currently|became|becomes|(?:been\s+)?(?:set|changed|updated|reset|rotated)\s+to)`;
const VALUE_AT = new RegExp(
	[
		String.raw`${CRED_ASSIGN}s?${QUALIFIER}${SEP}`,
		// An opening quote (one followed by text): `"API tokens" button` ends with a closing one.
		String.raw`${CRED_ASSIGN}s?${QUALIFIER}(?=\s*["'“”‘’\x60]+[^\s"'“”‘’\x60])`,
		String.raw`${CRED_WORD}s?(?!\s+${ATTR})${BETWEEN}(?:\s*[:=：](?!\d)|\s*(?:→|->|=>|—|–)|\s+(?:is|was|are|were|has\s+been)\b(?:\s+${CHANGE}\b)?)`,
		// "to" alone is a destination ("move the password to Vault"); only a change verb makes it an assignment,
		// after the credential word ("token now X") or before it ("changed the CI password to X").
		String.raw`${CRED_WORD}s?\s+${CHANGE}\b`,
		String.raw`\b(?:set|changed?|update[sd]?|reset|rotated)\s+(?:[\w-]{1,40}\s+){0,4}?${CRED_WORD}\s+to\b`,
		// A comma counts only right after a singular word and before a token with a digit or symbol ("token, ab12-cd"),
		// since "token, and ..." and "pass, merge it" are lists.
		String.raw`${CRED_WORD}(?<![sS]),\s*(?=[A-Za-z0-9]*[\d_!@#$%^&*+=/~-])`,
		String.raw`(?:密码|口令)\s*(?:是|为)?(?=\s*\S)`,
		String.raw`(?:\bwith|\buser\s+\S{1,40})\s+${CRED_ASSIGN}(?=\s)`,
	].join("|"),
	"gi",
);
const BARE_AT = new RegExp(String.raw`${CRED_WORD}(?<![sS])(?:\s+|-)(?!${ATTR})(?=[\x21-\x7e])`, "gi");
// Credentials recognisable without a credential word.
const SHAPED = new RegExp(
	[
		String.raw`\b[a-z][a-z0-9+.-]{0,20}://[^\s/:@]{1,100}:[^\s/@]{1,200}@`,
		String.raw`\b(?:Basic|Bearer)\s+(?=[A-Za-z0-9+/_=-]*[\d=])[A-Za-z0-9+/_=-]{8,}`,
		String.raw`Authorization:\s*(?:Basic|Bearer|Token|Digest)\s+\S{4,}`,
		String.raw`\bsshpass\s+(?:-\w\s+){0,4}-p\s*\S+`,
		String.raw`\bcurl\b[^\n]{0,200}?\s(?:-u|--user)\s*\S+:\S+`,
		String.raw`\bmysql(?:dump|admin)?\b[^\n]{0,200}?\s-p\S{3,}`,
		String.raw`\bghp_[A-Za-z0-9]{20,}`,
		String.raw`\bsk[-_](?:live[-_]|test[-_]|proj-)?(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16,}`,
		String.raw`\bgithub_pat_[A-Za-z0-9_]{8,}`,
		String.raw`\bxox[bp]-(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{8,}`,
		String.raw`\bAKIA[0-9A-Z]{16}\b`,
		String.raw`\bAIza[0-9A-Za-z_-]{30,}`,
		String.raw`\bATATT[0-9A-Za-z_=-]{10,}`,
		String.raw`-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----`,
	].join("|"),
	"i",
);
// A place or holder is one word ("Vault", "Ops", ".env", "~/.pgpass"), or a multi-word place that ends in a known
// place noun: "az cli", "the team vault", "the app DB password", "its existing database password". Any other word
// after it is not part of the place, so "in Vault hunter" and "owned by Ops abc" leave a rest that is judged again,
// whatever the rest is made of.
const PLACE_NOUN = String.raw`(?:vault|safe|store|portal|cli|manager|item|entry|file|\.?env|repo|repository|config|secret|password|credential|setting|variable|header|keychain|keyring|db|database|bucket|account|team|channel|chat|wiki|doc|docs|page|note|server|host|pipeline|settings|profile|container|cluster|service|startup|boot|runtime|deploy|app|application)(?:\s+itself)?`;
// A place noun "item"/"entry" may carry its one-word name ("1Password item ci-bot").
const PLACE = String.raw`(?:(?:(?:the|our|my|your|their|its)\s+)?(?:[^\s,;()]+\s+){0,3}${PLACE_NOUN}(?:(?<=item|entry)\s+[^\s,;()]+)?|[^\s,;()]+)(?=[\s.,;!?)\]}"'”’\x60]|$)`;
const STATUS = String.raw`(?:expired|revoked|rotated|unset|missing|empty|invalid|valid|pending|disabled|enabled|required|optional|needed|configured|short-lived|long-lived|personal|shared|unknown|unchanged|read-only|per-user|per-team|broken|working|ready|available|locked|blocked|removed|deleted|dropped|gone|retired|deprecated)`;
const WHEN = String.raw`(?:yesterday|today|recently|daily|weekly|monthly|by\s+hand|manually|last\s+\w+|(?:on|at|after|until|since)\s+[^\s,;()]+|(?:in|for|from|by)\s+${PLACE})`;
// A place form may carry a time or second place ("derived from the app DB password at startup").
const THEN = String.raw`(?:\s+(?:at|on|after|during|before)\s+(?:the\s+)?(?:app\s+)?(?:startup|boot|deploy|login|runtime|start))?`;
// One safe pointer form at the start of the text. Each is bounded; whatever follows is judged again.
const SAFE_FORM = new RegExp(
	"^(?:" +
		[
			String.raw`~?/[^\s,;()]+`,
			String.raw`https?://[^\s,;()]+`,
			String.raw`env:[A-Za-z_]\w*`,
			String.raw`\$\{?[A-Za-z_]\w*\}?`,
			String.raw`\d+(?:\.\d+)?(?:/\d+|%)`,
			// Before the bare words below, so "no longer configured" is not read as "no" plus a rest.
			String.raw`(?:not|no\s+longer)\s+(?:${STATUS}(?:\s+${WHEN})?|an?\s+env(?:ironment)?\s+var(?:iable)?|(?:(?:in|at|on|from)\s+|an?\s+)${PLACE})`,
			String.raw`(?:n/a|tbd|none|unset|yes|no)`,
			String.raw`(?:in|inside|at|from|under|behind|via|on)\s+${PLACE}`,
			String.raw`(?:stored|kept|held|saved|located|managed|exported|set|loaded|configured|defined|derived|generated|injected|mounted|lives|sits)\s+(?:(?:automatically|manually)\s+)?(?:(?:in|at|on|under|behind|by|from|via|through)\s+${PLACE}${THEN}|locally|elsewhere|separately|only)`,
			String.raw`(?:ask|see|contact|request\s+it\s+from)\s+${PLACE}(?:\s+for\s+(?:it|access|one))?`,
			String.raw`(?:owned|issued|rotated|revoked|handled|provided|held|scoped|created|generated)\s+(?:by|per|for)\s+${PLACE}`,
			// "a/an" only before a known description, never any word: `password: a hunter2` is a value.
			String.raw`(?:a|an)\s+(?:(?:personal\s+access|OAuth|bot|service\s+account|API|access|refresh|session)\s+)?(?:PAT|JWT|token|key|secret|password|reference\s+to\s+${PLACE})`,
			String.raw`(?:repo|repository|org|organization|environment|actions|ci)\s+secret`,
			String.raw`env\s+[A-Z]+(?:_[A-Z]+)+`,
			String.raw`\d+\s+(?:chars?|characters|digits|bytes|days|hours|minutes|months)`,
			String.raw`rotate[sd]?\s+(?:daily|weekly|monthly|quarterly|yearly|every\s+[^\s,;()]+)`,
			String.raw`${STATUS}(?:\s+${WHEN})?`,
			String.raw`(?:the\s+)?same\s+as\s+${PLACE}`,
			String.raw`the\s+one`,
		].join("|") +
		String.raw`)(?=[\s.,;!?)\]}"'”’\x60]|$)`,
	"i",
);
// An env name is upper case on purpose: pass_word and my_secret_value are values.
const ENV_NAME = /^[A-Z]+(?:_[A-Z]+)+(?=[\s.,;!?)\]}"'”’`]|$)/;
const STOP = /^[\s.,;!?)\]}"'”’`]+/;

/**
 * The text at a value position, up to the end of its sentence: quotes opened there and "the string"/"the value"
 * removed. A sentence ends at `.`/`;`/`!`/`?` before a capitalised word that does not label a value ("Old: X" does).
 */
function valueAt(rest: string): string {
	const phrase = rest.replace(/^\s+/, "").replace(/^(?:the|a|an)\s+(?:string|value|literal|word)\s+/i, "");
	const quoted = /^(["'“”‘’`]+)([^"'“”‘’`]*)["'“”‘’`]*/.exec(phrase);
	const text = quoted ? `${quoted[2]} ${phrase.slice(quoted[0].length)}` : phrase;
	const end = /[.;!?]\s+(?=[A-Z][\w-]*(?:\s|$))|\n/.exec(text);
	return end ? text.slice(0, end.index + 1) : text;
}

// After a safe form the rest is judged again. It is safe when it is another safe form ("derived from the app password
// and set at startup"), or a clause of its own: it opens with a joining word (so, which, since, no, the, ...), every
// word is a plain word, an env name or a path, none hands over a value (use, it's, old, value, contains, currently,
// or, but, then), and the whole guard finds no value in it ("..., so shells must load those exports", "; no manual
// secret"). Anything else ("TBD hunter2", "n/a, X", "in Vault, but until then use X", "Old: X", "(currently X)") is a value.
// "and"/"but" (with an optional copula) may join two safe forms; the next text must still be a safe form, so
// "in Vault, but until then use X" is a value. "now"/"still"/"instead" may lead a form ("is now derived from ...").
const AND = /^(?:,\s*)?\s*(?:and|but)(?:\s+(?:(?:the|its)\s+(?:[\w-]+\s+){0,3})?(?:is|was|are|were))?\s+/i;
const LEAD = /^(?:now|still|instead)\s+/i;
const OPENER = /^(?:so|which|that|since|because|as|while|when|where|unless|before|after|and|never|no|the|its|it|this|there|requires?|needs?)$/i;
// A parenthetical of plain words ("(TRACE_X removed)", a quoted remark) is skipped; one with a digit, a symbol or a
// hand-over word ("(currently X)", "(it's X)", "(old one X)") is not.
const ASIDE = /^\s*\(([^()]{1,200})\)\s*:?/;
const plainWords = (text: string) => text.split(/\s+/).map((w) => w.replace(/^["'“”‘’`(\[]+|["'“”‘’`)\].,;:!?]+$/g, "")).filter(Boolean).every((w) => !HANDOVER.test(w) && (/^[\p{L}][\p{L}'-]*$/u.test(w) || ENV_NAME.test(w)));
const HANDOVER = /^(?:use|it['’]s|old|value|contains|currently|or|but|then)$/i;
function plainClause(rest: string): boolean {
	const words = rest.replace(/^[\s,;:(]+/, "").split(/\s+/).map((w) => w.replace(/^["'“”‘’`(\[]+|["'“”‘’`)\].,;:!?]+$/g, "")).filter(Boolean);
	if (!(words.length >= 3 && OPENER.test(words[0]) && words.every((w) => !HANDOVER.test(w) && (/^[\p{L}][\p{L}'-]*$/u.test(w) || ENV_NAME.test(w) || /^~?\/\S+$/.test(w) || /^\.\w+$/.test(w))))) return false;
	// "which is hunter", "it is hunter": whatever a copula in the clause names is judged as a value too.
	for (const m of rest.matchAll(/\b(?:is|was|are|were|be)\s+/gi)) if (!pointerOnly(rest.slice(m.index + m[0].length))) return false;
	return !holdsCredential(rest);
}

/** Whether the text is nothing but safe pointer forms: each form is consumed and the rest judged again. */
function pointerOnly(phrase: string): boolean {
	let rest = phrase;
	for (let i = 0; i < 12; i++) {
		const aside = i > 0 && ASIDE.exec(rest);
		if (aside && plainWords(aside[1])) rest = rest.slice(aside[0].length);
		if (i > 0 && /^[\s,;:(]/.test(rest) && plainClause(rest)) return true;
		if (i > 0) rest = rest.replace(AND, "").replace(LEAD, "");
		rest = rest.replace(STOP, "");
		if (!rest) return true;
		const form = SAFE_FORM.exec(rest) ?? ENV_NAME.exec(rest);
		if (!form) return false;
		rest = rest.slice(form[0].length);
	}
	return false;
}

/** The longest text the guard checks; longer fact text is refused before it gets here. */
export const MAX_FACT_CHARS = 2000;

/** Whether text may hold a credential value. `key` checks a fact key, which names a fact: vendor token shapes only. */
export function holdsCredential(text: string, key = false): boolean {
	const checked = text.slice(0, MAX_FACT_CHARS);
	if (SHAPED.test(checked)) return true;
	if (key) return false;
	for (const m of checked.matchAll(VALUE_AT)) {
		const phrase = valueAt(checked.slice(m.index + m[0].length));
		if (phrase.trim() && !pointerOnly(phrase)) return true;
	}
	for (const m of checked.matchAll(BARE_AT)) {
		const phrase = valueAt(checked.slice(m.index + m[0].length));
		const token = (/^\S*/.exec(phrase)?.[0] ?? "").replace(/[.,;!?)\]}"'”’]+$/, "");
		if (/^[\x21-\x7e]{4,}$/.test(token) && /^[^([{"'`]/.test(token) && /[\d\W_]/.test(token) && !pointerOnly(phrase)) return true;
	}
	return false;
}

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
	if (text.length > MAX_FACT_CHARS || source.length > MAX_FACT_CHARS) throw new InboxError(`a fact's text and source stay under ${MAX_FACT_CHARS} characters`);
	if (holdsCredential(key, true) || [text, source].some((value) => holdsCredential(value))) throw new InboxError("a fact names where the credential lives, never its value");
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
		const next: Fact = { kind: cleanKind, key: cleanKey, text: cleanText, source: cleanSource, since: old?.since ?? at.slice(0, 10), updated: at, superseded: history.filter((line) => !holdsCredential(line)) };
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

/** Why each open teams-fact row cannot migrate: a credential value in any raw column, or text facts.md cannot hold. */
export function refusals(facts: Row[]): { id: string; reason: string }[] {
	const refused: { id: string; reason: string }[] = [];
	for (const row of facts) {
		// The guard reads only the first MAX_FACT_CHARS of a value, so any longer column (or the joined source) is refused
		// before it is checked: a credential past the limit would otherwise reach facts.md or archive.tsv unread.
		const source = clean([row.source, row.note, row.first_seen].filter(Boolean).join(" "));
		const fields = ["key", "subject", "source", "owner", "note", "link"] as const;
		const longest = fields.find((field) => (row[field] ?? "").length > MAX_FACT_CHARS) ?? (source.length > MAX_FACT_CHARS ? "joined source" : undefined);
		const long = longest ? `its ${longest} is over ${MAX_FACT_CHARS} characters` : undefined;
		// Every column that can carry raw text, each on its own as checkFact does; the key names the fact.
		const column = (long ? undefined : fields.find((field) => holdsCredential(row[field] ?? "", field === "key")));
		// The text and source the migration writes, checked as checkFact checks them: joined columns can make a value.
		const written = !long && !column && [clean(row.subject), source].some((value) => holdsCredential(value)) ? "the source it would write (source, note and time joined) may hold a credential value; record where the credential lives instead" : undefined;
		const reason = long ?? (column ? `its ${column} may hold a credential value; record where the credential lives instead` : (written ?? unstorable(factKey(row), clean(row.subject), source)));
		if (reason) refused.push({ id: row.id, reason });
	}
	return refused;
}

/**
 * Move open teams-fact rows into facts.md. Newest repeated key wins; archived facts stay archived. A row facts.md could
 * not read back (a bad key, text that parses as metadata) or one that may hold a credential value is refused: not
 * written, not archived, left open as it is, and named in `refused`. The guard can be wrong, so refusing never
 * destroys the row's text; the person reading `refused` rewrites or drops it.
 */
export function migrateFacts(rows = listRows({ states: ["open", "claimed"] }).split("\n").slice(1).filter(Boolean).map((line) => Object.fromEntries(line.split("\t").map((cell, i) => [["id", "key", "subject", "first_seen", "source", "tag", "action", "state", "owner", "note", "link"][i], cell])) as Row)): Migration {
	return withLedger((liveRows, save) => {
		const plan = planMigration(rows);
		saveFacts(plan.facts);
		finishRows(liveRows, plan.closed, "moved to facts.md", save);
		return { written: plan.written, closed: plan.closed, refused: plan.refused };
	});
}

/** What migrateFacts would do, without writing: the same refusal pass, facts and counts. `--dry-run` prints it. */
export function planMigration(rows: Row[]): Migration & { facts: Fact[] } {
	const facts = rows.filter((row) => row.tag === "teams-fact" && row.state !== "done");
	const refused = refusals(facts);
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
		const fact: Fact = { kind, key, text: clean(row.subject), source: clean(source), since: current?.since ?? row.first_seen.slice(0, 10), updated: row.first_seen, superseded: history.filter((line) => !holdsCredential(line)) };
		if (current) next[next.indexOf(current)] = fact;
		else next.push(fact);
		written++;
	}
	return { facts: next, written, closed: facts.map((row) => row.id).filter((id) => !skip.has(id)), refused };
}
/** Read rows directly for the migration script, including a copied inbox directory. */
export function migrateFile(dir = inboxFile()): Migration {
	const rows = readTsv(`${dir}/ledger.tsv`).filter((row) => row.tag === "teams-fact");
	return migrateFacts(rows);
}
