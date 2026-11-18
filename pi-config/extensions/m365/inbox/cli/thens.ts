/**
 * Deferred actions ("then:"): an obligation attached to a live row that waits for a trigger.
 *
 *   inbox then <row-id> --when <trigger> -- <action text>
 *
 * Triggers: `pr-merged:<owner/repo>#<n>` (the PR watch recorded the merge: a ledger or archive row keyed
 * `github:<repo>#<n>:merged`, so the repo's rules must record `event: merged`, `log` is enough),
 * `agent-result:<name>` (a RESULT row for that agent session added after the then, other than the RESULT version the
 * then was armed on), `gh-run:<owner/repo>:<run-id>`
 * (`gh run view` says completed), `at:<YYYY-MM-DD HH:MM>` (local time).
 *
 * When the trigger happens, one `do` row (tag `then`) starts a turn: "Trigger X happened; you owe: <action>". A fired
 * then left open gets one reminder per check, due 10 minutes, 1 hour, 4 hours, then every 24 hours after its last card,
 * until `inbox then-done`. `inbox done` refuses a then's live card, `--force` or not: close it with `inbox then-done`.
 * `inbox done <row-id>` refuses while a fired then of that row is open (`--force --note <why>` closes them). An unfired then stays armed
 * after its row is done: the obligation is the trigger's, not the row's. A watch is never removed by closing its thens: only `inbox agent close` ends it.
 *
 * State: thens.json in the inbox directory, rewritten whole (tmp + rename) under thens.json.lock. The ledger rows
 * themselves are unchanged, so ledger.tsv keeps its format.
 */
import * as fs from "node:fs";
import { clean, finishRows, InboxError, inboxFile, readTsv, recordDirect, stamp, withLedger, withLock, type Row } from "./ledger.ts";
import { parseStamp, runProcess } from "./jobs.ts";
import { readAgents } from "./agents.ts";

export interface Then {
	row: string;
	n: number;
	when: string;
	action: string;
	added: string;
	/** Highest ledger/archive id when it was added: an agent result must be newer than this. */
	after: number;
	fired?: string;
	/** What happened, e.g. `RESULT status: done` or `conclusion success`. */
	why?: string;
	/** How many reminders have been recorded. An old file may say `true` or a stamp instead of a count; both mean one. */
	reminded?: number | string | boolean;
	/** Stamp of the last reminder. Absent means the fire is the last card. */
	remindedAt?: string;
	done?: string;
	note?: string;
	/** Set for a watched name: the RESULT version at arm time. Old objects may also carry `said`, and a `generation` beside it: both are read past. */
	baseline?: { version: string; said?: string };
}
const REMIND_MIN = [10, 50, 180];
const TRIGGERS: [RegExp, string][] = [
	[/^pr-merged:[\w.-]+\/[\w.-]+#\d+$/, "pr-merged:<owner/repo>#<n>"],
	[/^gh-run:[\w.-]+\/[\w.-]+:\d+$/, "gh-run:<owner/repo>:<run-id>"],
	[/^agent-result:\S+$/, "agent-result:<name>"],
	[/^at:\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "at:<YYYY-MM-DD HH:MM>"],
];

const file = () => inboxFile("thens.json");

export function readThens(): Then[] {
	try {
		return JSON.parse(fs.readFileSync(file(), "utf8")) as Then[];
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw new InboxError(`${file()}: ${(e as Error).message}`);
	}
}

function writeThens(thens: Then[]): void {
	const tmp = `${file()}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(thens, null, 2)}\n`);
	fs.renameSync(tmp, file());
}

function withThens<T>(fn: (thens: Then[], save: () => void) => T): T {
	return withLock(inboxFile("thens.json.lock"), 2000, () => {
		const thens = readThens();
		return fn(thens, () => writeThens(thens));
	});
}

const allRows = (): Row[] => [...readTsv(inboxFile("ledger.tsv")), ...readTsv(inboxFile("archive.tsv"))];
const label = (t: Then) => `${t.row}.${t.n}`;

/**
 * A plan for a watched name's RESULT. `baseline` is the RESULT version it was armed on, which does not fire it.
 * `replace` (`agent add --then`) closes the name's previous unfired `agent-result` thens: the new plan is the one
 * the dispatcher now holds for that session.
 */
type AgentPlan = { baseline?: Then["baseline"]; replace?: boolean };

/**
 * An `agent-result` then is refused when that name is not watched: nothing would ever fire it.
 *
 * `commit` runs under the thens lock after the plan is decided and before thens.json is written, and returns how to
 * undo itself. `agent add` writes its entry there: if that write fails, thens.json is left untouched; if
 * thens.json then fails to save, the entry is undone. Either both change or neither does.
 */
export function addThen(row: string, when: string, action: string, agent?: AgentPlan, commit?: () => () => void): string {
	if (!TRIGGERS.some(([re]) => re.test(when)))
		throw new InboxError(`bad trigger '${when}': expected one of ${TRIGGERS.map(([, h]) => h).join(", ")}`);
	// Date() rolls an impossible time over (13th month, 99:00) instead of failing; the round trip catches it.
	if (when.startsWith("at:") && stamp(parseStamp(when.slice(3))) !== when.slice(3)) throw new InboxError(`bad time in '${when}'`);
	if (!clean(action)) throw new InboxError("then needs the action text after --");
	const live = readTsv(inboxFile("ledger.tsv"));
	if (!live.some((r) => r.id === row)) throw new InboxError(`no such live id: ${row}`);
	const after = allRows().reduce((max, r) => Math.max(max, Number(r.id)), 0);
	const baseline = agent?.baseline;
	// `agent add` arms its plan as it writes the entry (`commit`); any other then needs the watch to be there.
	if (!commit && when.startsWith("agent-result:")) {
		const name = when.slice("agent-result:".length);
		if (!readAgents().some((a) => a.name === name)) throw new InboxError(`not watched: ${name}. Run \`inbox agent add\` first.`);
	}
	return withThens((thens, save) => {
		if (agent?.replace) for (const t of thens) if (t.when === when && !t.fired && !t.done) Object.assign(t, { done: stamp(), note: "replaced by a new plan" });
		const n = thens.filter((t) => t.row === row).reduce((max, t) => Math.max(max, t.n), 0) + 1;
		thens.push({ row, n, when, action, added: stamp(), after, ...(baseline ? { baseline } : {}) });
		const undo = commit?.();
		try {
			save();
		} catch (e) {
			undo?.();
			throw e;
		}
		return `then ${row}.${n} waits for ${when}`;
	});
}

/**
 * Close one then. A watch is not touched: `then-done` of the last open then of a watched name ends with `; watch <name> stays`,
 * so the caller sees the watch is still there.
 */
export function thenDone(row: string, n: string, note = ""): string {
	const watched = new Set(readAgents().map((a) => a.name));
	return withThens((thens, save) => {
		const t = thens.find((x) => x.row === row && String(x.n) === n);
		if (!t) throw new InboxError(`no then ${row}.${n}`);
		if (t.done) throw new InboxError(`then ${row}.${n} is already done (${t.done})`);
		const name = t.when.startsWith("agent-result:") ? t.when.slice("agent-result:".length) : "";
		t.done = stamp();
		if (note) t.note = clean(note);
		save();
		archiveThenCards(row, n, `[then-done]${note ? ` ${clean(note)}` : ""}`);
		const last = name !== "" && watched.has(name) && !thens.some((x) => x.when === t.when && !x.done);
		return `then-done ${row}.${n}${t.fired ? "" : " (cancelled before it fired)"}${last ? `; watch ${name} stays` : ""}`;
	});
}

/** Archive every live card of one then. The note replaces the card's, so a `--note` is kept with the close mark. */
function archiveThenCards(row: string, n: string, note: string): void {
	const prefix = `then:${row}.${n}:`;
	withLedger((rows, save) => {
		const ids = rows.filter((r) => r.key.startsWith(prefix)).map((r) => r.id);
		if (ids.length) finishRows(rows, ids, note, save);
	});
}

/** One live card per then: the previous unclaimed cards are archived naming the reminder that replaced them. */
function supersedeThenCards(ids: string[], by: string): void {
	if (!ids.length) return;
	withLedger((rows, save) => {
		const gone = rows.filter((row) => ids.includes(row.id) && row.state === "open");
		for (const row of gone) row.note = clean(`${row.note} [superseded by #${by}]`);
		if (gone.length) finishRows(rows, gone.map((row) => row.id), undefined, save);
	});
}

/** Called by `done`: refuse a then's live card, and refuse while a fired then of these rows is open. */
export function guardDone(ids: string[], force: boolean, note: string | undefined): void {
	const live = readTsv(inboxFile("ledger.tsv"));
	for (const id of ids) {
		const row = live.find((r) => r.id === id);
		const card = row && /^then:(\d+)\.(\d+):/.exec(row.key);
		if (!card) continue;
		const cardThen = readThens().find((t) => t.row === card[1] && String(t.n) === card[2] && !t.done);
		if (cardThen) throw new InboxError(`#${id} is the card of then ${card[1]}.${card[2]}: close it with \`inbox then-done ${card[1]} ${card[2]}\``);
	}
	const open = readThens().filter((t) => ids.includes(t.row) && t.fired && !t.done);
	if (!open.length) return;
	const list = open.map((t) => `${label(t)} (fired ${t.fired}): ${t.action}`).join("; ");
	if (!force) throw new InboxError(`open then-actions: ${list}. Run \`inbox then-done <row-id> <n>\` for each, or \`inbox done ... --force --note <why>\`.`);
	if (!note) throw new InboxError("--force needs --note saying why the open then-actions are dropped");
	withThens((thens, save) => {
		for (const t of thens) if (ids.includes(t.row) && t.fired && !t.done) Object.assign(t, { done: stamp(), note: `forced: ${clean(note)}` });
		save();
	});
}

/** Open thens for `ls` and `/inbox status`, one line each. */
export function openThenLines(): string[] {
	return readThens()
		.filter((t) => !t.done)
		.map((t) => (t.fired ? `then ${label(t)} FIRED ${t.fired}, not then-done: ${t.action}` : `then ${label(t)} waits for ${t.when}: ${t.action}`));
}

/** Has the trigger happened? The reason when it has, undefined when not yet. Throws when it cannot tell (gh failed). */
async function happened(t: Then, rows: Row[], now: Date, gh: boolean): Promise<string | undefined> {
	const [kind, ...rest] = t.when.split(":");
	const arg = rest.join(":");
	if (kind === "pr-merged") return rows.some((r) => r.key === `github:${arg}:merged`) ? "merged" : undefined;
	if (kind === "at") return parseStamp(arg) <= now ? `it is ${stamp(now)}` : undefined;
	if (kind === "agent-result") {
		const prefix = `agents:${arg}:`;
		const baseline = t.baseline?.version ? `${prefix}result:${t.baseline.version}` : "";
		// Only rows recorded as a RESULT; `inbox set` / `done --note` rewrite notes, never tags.
		const hit = rows.find((r) => Number(r.id) > t.after && r.source === "agents" && r.tag === "agent-result" && r.key.startsWith(prefix) && r.key !== baseline);
		return hit ? `${/^RESULT status: [a-z_]+/.exec(hit.note)?.[0] ?? "RESULT"} (row #${hit.id})` : undefined;
	}
	if (kind === "gh-run" && gh) {
		const [repo, id] = [arg.slice(0, arg.lastIndexOf(":")), arg.slice(arg.lastIndexOf(":") + 1)];
		const run = JSON.parse(await runProcess(["gh", "run", "view", id, "-R", repo, "--json", "status,conclusion"], 60, `gh run view ${id}`));
		return run.status === "completed" ? `conclusion ${run.conclusion || "none"}` : undefined;
	}
	return undefined;
}

export interface CheckOptions {
	now?: Date;
	/** Also ask GitHub about gh-run triggers (the minute tick does; a ledger-change check does not). */
	gh?: boolean;
}

/**
 * Fire the thens whose trigger happened and remind the fired ones left open for 10 minutes. One line per card made;
 * a trigger that could not be checked is a `fail then …` line. Cards are keyed per then, so a second checker makes none.
 */
export async function checkThens(o: CheckOptions = {}): Promise<string[]> {
	const now = o.now ?? new Date();
	const pending = readThens().filter((t) => !t.done);
	if (!pending.length) return [];
	const rows = allRows();
	const lines: string[] = [];
	const fired = new Map<string, string>();
	for (const t of pending.filter((x) => !x.fired)) {
		try {
			const why = await happened(t, rows, now, o.gh ?? false);
			if (why) fired.set(label(t), why);
		} catch (e) {
			lines.push(`fail then ${label(t)}: ${(e as Error).message}`);
		}
	}
	const remindDue = (t: Then) => {
		if (!t.fired) return false;
		const count = typeof t.reminded === "number" ? t.reminded : t.reminded ? 1 : 0;
		const gap = count < REMIND_MIN.length ? REMIND_MIN[count]! : 1440;
		const last = t.remindedAt ?? t.fired;
		return now.getTime() >= parseStamp(last).getTime() + gap * 60_000;
	};
	// Nothing to write: do not even take the lock (the delivering session watches the directory, and the lock file is a change).
	if (!fired.size && !pending.some(remindDue)) return lines;
	withThens((thens, save) => {
		let changed = false;
		for (const t of thens) {
			if (t.done) continue;
			const why = fired.get(label(t));
			if (why && !t.fired) {
				const close = `close with \`inbox then-done ${t.row} ${t.n}\``;
				const out = recordDirect("then", "do", `${label(t)}:fired`, `then #${label(t)}: ${t.when}`, "then",
					`Trigger ${t.when} happened; you owe: ${t.action} [${why}; row #${t.row}; ${close}]`, "", "coordinator");
				Object.assign(t, { fired: stamp(now), why });
				lines.push(`fired ${label(t)}: ${out}`);
				changed = true;
			} else if (remindDue(t)) {
				const count = (typeof t.reminded === "number" ? t.reminded : t.reminded ? 1 : 0) + 1;
				const previous = readTsv(inboxFile("ledger.tsv")).filter((r) => r.key.startsWith(`then:${label(t)}:`) && r.state === "open").map((r) => r.id);
				const out = recordDirect("then", "do", `${label(t)}:remind:${count}`, `then #${label(t)} reminder ${count}: ${t.when}`, "then",
					`Reminder ${count}: trigger ${t.when} happened at ${t.fired}; you still owe: ${t.action} [row #${t.row}; close with \`inbox then-done ${t.row} ${t.n}\`]`, "", "coordinator");
				const made = /^(do|notify) (\d+) /.exec(out);
				if (made) supersedeThenCards(previous, made[2]!);
				Object.assign(t, { reminded: count, remindedAt: stamp(now) });
				lines.push(`reminded ${label(t)}: ${out}`);
				changed = true;
			}
		}
		if (changed) save();
	});
	return lines;
}
