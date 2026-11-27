/**
 * The watched agent sessions: the `agent_watch` list in rules.yaml. A watch is one omp session (host + session id,
 * bound in the watch's record, cli/observed.ts); the entry's pane is where that session is now.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { addEvent, clean, finishRows, InboxError, inboxFile, readTsv, stamp, supersedeSession, withLedger, withLock, withRulesLock, type AddEvent, type Row } from "./ledger.ts";
import { agentOf, phaseOf, runProbe, type Probe } from "./probe.ts";
import { readObserved, updateObserved, type Observed } from "./observed.ts";
import { addThen, readThens, thenDone } from "./thens.ts";
import { AGENT_LIST, readList, writeList } from "./lists.ts";

export const MUXES = ["hc", "herdr", "tern", "tmux"];

/** Entries written by older builds also carry `generation`, `stamped`, `instance`, `migratedGeneration` and `push`: read past, kept on a rewrite. */
export interface AgentEntry {
	name: string;
	mux: string;
	host: string;
	pane: string;
	result?: string;
	/** The personal-channel thread (root message id) this session's progress is posted to; absent: the thread the channel's cursor binds to `agent:<name>`, else a new one. */
	thread?: string;
	goal?: string;
	since?: string;
	/** Set by `inbox agent close --ack`: the close was acknowledged, the pane may be killed, and the probe removes the entry once it is gone. */
	closing?: { at: string; ack: string; note: string };
}

/** The list as it is in rules.yaml. Never rewrites it. */
export function readAgents(): AgentEntry[] {
	return readList(AGENT_LIST) as unknown as AgentEntry[];
}

export function writeAgents(agents: AgentEntry[]): void {
	writeList(AGENT_LIST, agents as unknown as Record<string, unknown>[]);
}

/**
 * Watch the agent session that runs in a pane. The pane is probed first: a pane that is not there, or holds no agent
 * process, is refused, and what the watch attached to is printed, so the caller sees which session it now watches.
 * A second add of the same name replaces its entry. `row` and `then` are the dispatcher's plan for the result (what
 * it expects, whom it tells and how, what it closes): a then on the live row the session works for, fired by the
 * session's next RESULT, so the result card comes back with the plan and the row cannot be closed until it is done.
 * A new plan closes the name's previous unfired ones; an add without one leaves them armed.
 */
export async function addAgent(
	a: { name: string; mux: string; pane: string; host?: string; result?: string; goal?: string; thread?: string; row?: string; then?: string },
	probe: (a: AgentEntry, want: boolean, events: boolean) => Promise<Probe> = runProbe,
): Promise<string> {
	if (!MUXES.includes(a.mux)) throw new InboxError(`--mux must be one of ${MUXES.join(", ")}`);
	if ((a.row === undefined) !== (a.then === undefined)) throw new InboxError("--row and --then go together: the plan is armed on the row the session works for");
	const entry: AgentEntry = { name: a.name, mux: a.mux, host: a.host || "local", pane: a.pane };
	if (a.result) entry.result = a.result;
	const thread = a.thread !== undefined ? String(a.thread).trim() : "";
	if (thread) entry.thread = thread;
	if (a.goal) entry.goal = clean(a.goal);
	// Seconds, not minutes: a close and the probe tell a re-registration of the same name by a changed `since`.
	entry.since = stamp(new Date(), true);
	const where = `${entry.mux} pane ${entry.pane} on ${entry.host}`;
	const p = await probe(entry, false, true);
	if (!p.alive) throw new InboxError(`no ${where}: nothing to watch. Not added.`);
	if (p.agent_pid === 0) throw new InboxError(`${where} holds no agent process, only shells: start the session there first. Not added.`);
	const agent = agentOf(p);
	const phase = phaseOf(p);
	// Under the rules lock, so the plan is armed only for the entry that is written, and a racing add of the same
	// name cannot cancel a plan it did not replace.
	const { plan, old } = withRulesLock(() => {
		const agents = readAgents();
		const old = agents.find((e) => e.name === a.name);
		const write = () => writeAgents([...agents.filter((e) => e.name !== a.name), entry]);
		if (a.row === undefined) {
			write();
			return { plan: "no plan armed", old };
		}
		// The entry and its plan change together: see addThen's `commit`.
		const plan = addThen(a.row, `agent-result:${a.name}`, a.then!, { baseline: p.rhash ? { version: p.rhash } : undefined, replace: true }, () => {
			write();
			return () => writeAgents(agents);
		});
		return { plan, old };
	});
	// After the rules lock is released: the tailer takes the record's lock first and the rules lock inside it.
	await updateObserved((state) => {
		const prev = state.watches[a.name];
		// The session the name already watched: its record goes on, so what changed since the last look is still
		// reported. Any other session starts as a first observation. A mux that names no agent process (herdr, hc)
		// tells the two apart by the pane; a new record of such a pane holds no agent, so the session's first event
		// binds it by name.
		const kept = prev && (agent ? prev.agent?.pid === agent.pid && prev.agent.session === agent.session : old?.mux === entry.mux && String(old.pane) === entry.pane && (old.host || "local") === entry.host) ? prev : undefined;
		const next: Observed = kept ? { ...kept } : { phase, at: p.now * 1000, by: "probe", active: p.smtime || p.now };
		if (agent) next.agent = agent;
		state.watches[a.name] = next;
	});
	const events = p.events ?? 0;
	return [
		`watching ${a.name}: ${where}`,
		agent ? `agent pid ${agent.pid}, session ${agent.session || "none (no omp session file)"}, phase ${phase}` : `agent process unknown (${entry.mux} does not say), phase ${phase}`,
		p.rfile ? `RESULT ${p.rfile}, status ${p.rstatus || "none"}, version ${p.rhash}` : "RESULT none",
		`reporter events of this session on ${entry.host}: ${events}${events ? "" : " (no reporter has written for it: only the probe watches it)"}`,
		plan,
	].join("\n");
}

/** The session of watch `name` runs in another pane of its mux now: its entry follows it. Every other field stays, also ones this build does not know. */
export function followPane(name: string, pane: string): void {
	withRulesLock(() => {
		const agents = readAgents();
		const entry = agents.find((a) => a.name === name);
		// Closed while the event was read: there is no entry to move.
		if (!entry) return;
		entry.pane = pane;
		writeAgents(agents);
	});
}

/**
 * End a watch: the only way one ends. The session is probed first and what the probe saw is printed, so the caller
 * closes on the session's state now, not on what it remembers. Without `ack` nothing is closed: the report is the
 * error. With `ack` (the RESULT version the caller read, `none` for no RESULT) and a note, a gone session's entry is
 * removed and a live idle one is marked `closing` until its pane is gone.
 */
export async function closeAgent(name: string, o: { ack?: string; note?: string }, probe: (a: AgentEntry) => Promise<Probe> = runProbe): Promise<string> {
	const note = clean(o.note);
	if (o.ack !== undefined && !note) throw new InboxError("--ack needs --note saying what you verified");
	const entry = readAgents().find((a) => a.name === name);
	if (!entry) throw new InboxError(`not watched: ${name}`);
	const p = await probe(entry);
	const phase = phaseOf(p);
	const version = p.rhash || "none";
	const thens = readThens().filter((t) => t.when === `agent-result:${name}` && !t.done);
	const report = [
		`${name}: ${p.alive ? "alive" : "gone"}, phase ${phase}, idle ${p.smtime ? Math.floor(Math.max(0, p.now - p.smtime) / 60) : "?"} min, ${entry.mux} pane ${entry.pane} on ${entry.host || "local"}`,
		`RESULT ${p.rfile || "none"}, version ${version}`,
		`  status: ${p.rstatus || "-"}`,
		`  open: ${p.ropen_text || "-"}`,
		`  verified: ${p.rverified || "-"}`,
		`open thens: ${thens.map((t) => (t.fired ? `${t.row}.${t.n} FIRED ${t.fired}: ${t.action}` : `${t.row}.${t.n} waits for ${t.when}: ${t.action}`)).join("; ") || "none"}`,
	].join("\n");
	const refuse = (why: string) => new InboxError(`${why}\n${report}`);
	if (o.ack === undefined)
		throw new InboxError(`${report}\nNot closed. Read the RESULT at its source, then: inbox agent close ${name} --ack ${version} --note <what you verified>`);
	if (o.ack !== version) throw refuse(`--ack ${o.ack} is not the current RESULT version ${version}: read that one. Not closed.`);
	if (phase === "working" || phase === "asking")
		throw refuse(`${name} is ${phase}: ${phase === "asking" ? "answer its question" : "let its turn end"} before closing. Not closed.`);
	const fired = thens.find((t) => t.fired);
	if (fired) throw refuse(`then ${fired.row}.${fired.n} fired and is open: do it and run \`inbox then-done ${fired.row} ${fired.n}\` first. Not closed.`);
	for (const t of thens) thenDone(t.row, String(t.n), `watch closed: ${note}`);
	return withRulesLock(() => {
		const agents = readList(AGENT_LIST) as unknown as AgentEntry[];
		// Same name and `since`: a re-add while the pane was probed is a new registration, which this close never saw.
		const current = agents.find((a) => a.name === name && a.since === entry.since);
		if (!current) throw new InboxError(`${name} was registered again while it was probed: run \`inbox agent close ${name}\` again`);
		if (phase === "gone") {
			writeAgents(agents.filter((a) => a !== current));
			return `closed ${name}`;
		}
		current.closing = { at: stamp(), ack: version, note };
		writeAgents(agents);
		return `closing ${name}: acknowledged; kill the pane now, the probe removes the watch when it is gone`;
	});
}

/** The probe saw an acknowledged session's pane gone: drop that registration (same name and `since`). False when it was replaced meanwhile. */
export function removeClosed(entry: AgentEntry): boolean {
	return withRulesLock(() => {
		const agents = readList(AGENT_LIST) as unknown as AgentEntry[];
		const kept = agents.filter((a) => !(a.name === entry.name && a.since === entry.since && a.closing));
		if (kept.length === agents.length) return false;
		writeAgents(kept);
		return true;
	});
}

/** A command that ends a pane: `tern kill|close`, `tmux … kill-session|kill-pane|kill-window|kill-server`, `herdr pane close`. */
export const KILL_VERB = /\b(?:(tern)\s+(?:kill|close)|(tmux)\b[^;&|\n]*?\bkill-(?:session|pane|window|(server))|(herdr)\s+pane\s+close)\b/;

/**
 * Why a shell command must not run: it kills the pane of a watched session whose close was not acknowledged.
 * The verb is looked for anywhere in the command, so `ssh host '…'` is covered; its target is a whole token in the
 * rest of that shell segment (the pane id, the name, or the session part of a tmux target). Undefined: let it run.
 */
export function killGuard(command: string, agents: AgentEntry[]): string | undefined {
	const hit = new Set<string>();
	for (const m of command.matchAll(new RegExp(KILL_VERB, "g"))) {
		const mux = m[1] ?? m[2] ?? m[4];
		const rest = command.slice(m.index + m[0].length).split(/[;&|\n]/)[0]!;
		// tmux targets may be written `=session` or `session:`.
		const tokens = rest.split(/[\s'"`()]+/).map((t) => (mux === "tmux" ? t.replace(/^=/, "").replace(/:$/, "") : t));
		for (const a of agents) {
			if (a.mux !== mux || a.closing) continue;
			const targets = [String(a.pane), a.name, ...(mux === "tmux" ? [String(a.pane).split(":")[0]!] : [])];
			if (m[3] || targets.some((t) => tokens.includes(t))) hit.add(a.name);
		}
	}
	if (!hit.size) return undefined;
	const names = [...hit];
	return (
		`Not run: this kills the pane of a watched agent session (${names.join(", ")}). A watch ends only through its close gate: ` +
		`run ${names.map((n) => `\`inbox agent close ${n}\``).join(" and ")}, read what it prints, acknowledge it with --ack and --note, then kill the pane.`
	);
}

const VERSION_KEY = /^agents:[^:]+:result:[0-9a-f]{16}$/;

/** A local minute stamp (`YYYY-MM-DD HH:MM`) is at least the minute of `mtime` (epoch seconds). */
export function minuteAtLeast(stampText: string, mtime: number): boolean {
	const at = Date.parse(stampText.replace(" ", "T"));
	return Number.isFinite(at) && at + 60_000 > mtime * 1000;
}

/**
 * True when an older build already reported this RESULT version. Match the agent-result tag, never the note:
 * `inbox done --note` rewrites notes. Old keys are `agents:<name>:<launch id>:<session>:<seq>`,
 * `agents:<name>:<launch id>:result:<stat>` and `agents:<name>:result:<epoch>`; a version key is not one of them.
 */
export function legacyReported(name: string, mtime: number): boolean {
	if (!mtime) return false;
	const prefix = `agents:${name}:`;
	const rows = [...readTsv(inboxFile("ledger.tsv")), ...readTsv(inboxFile("archive.tsv"))];
	return rows.some((row) => row.source === "agents" && row.tag === "agent-result" && row.key.startsWith(prefix) && !VERSION_KEY.test(row.key) && minuteAtLeast(row.first_seen, mtime));
}

/** The text after `Last output: ` in a no-result note, without the `. Goal: …` the recorder appends. Empty when absent. */
function lastOutputOf(note: string): string {
	const at = note.indexOf("Last output: ");
	if (at < 0) return "";
	return note.slice(at + "Last output: ".length).replace(/\.*\s+Goal: [\s\S]*$/, "").replace(/\s+/g, " ").trim();
}

/**
 * Record one agent event, then leave at most the new row live for that session. A known key changes nothing.
 * The parent row of a fired, open then stays: its plan is still owed.
 * A no-result row (`event=idle`) whose last output equals the previous no-result row's for the same name and
 * session is skipped: a session idle on its own subagents ends a turn per subagent message with nothing new to
 * read. That previous row may be live or closed (`--verdict nothing-pending` rewrites its note), so what it said is
 * kept in `cursors/agent-said.json`, not read back from the ledger.
 */
export function recordAgentRow(ev: AddEvent): string {
	const said = ev.fields?.includes("event=idle") ? lastOutputOf(ev.note ?? "") : "";
	if (!said) return record(ev);
	// `agents:<name>:<session>:idle:<n>`; a probe of a pane with no session file makes `agents:<name>:idle:<n>`. A
	// coordinator still running the older tailer sends `agents:<name>:<launch id>:<session>:<seq>`.
	const parts = ev.key.split(":");
	const session = parts.length < 5 ? "" : parts[3] === "idle" ? parts[2]! : parts[3]!;
	const hash = createHash("sha256").update(said).digest("hex").slice(0, 16);
	const file = inboxFile("cursors", "agent-said.json");
	return withLock(`${file}.lock`, 2000, () => {
		const all = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}) as Record<string, { session?: string; said: string }>;
		const prev = all[ev.place];
		// An entry an older build wrote names no session: what it said is compared alone, so a deploy repeats no row.
		if (prev && (prev.session ?? session) === session && prev.said === hash) return `skip repeat: same last output as the previous no-result row of ${ev.place}`;
		const out = record(ev);
		if (/^(do|notify) /.test(out)) {
			all[ev.place] = { session, said: hash };
			const tmp = `${file}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
			fs.renameSync(tmp, file);
		}
		return out;
	});
}

function record(ev: AddEvent): string {
	const out = addEvent(ev);
	const made = /^(do|notify) (\d+) /.exec(out);
	if (!made) return out;
	supersedeSession(ev.place, made[2]!, readThens().filter((t) => t.fired && !t.done).map((t) => t.row));
	return out;
}

/** A live, unclaimed row of the session that says what it waits on: an ask row of this build, or an older build's ask or blocked row. */
function isAsk(row: Row, name: string): boolean {
	const prefix = `agents:${name}:`;
	if (row.source !== "agents" || row.tag === "ask-wayne" || row.state !== "open" || !row.key.startsWith(prefix)) return false;
	return row.tag === "agent-ask" || row.key.startsWith(`${prefix}ask:`) || row.key.includes(":blocked:") || row.note.startsWith("waiting on ");
}

/** A live row already shows the session's ask. */
export function askShown(name: string): boolean {
	return readTsv(inboxFile("ledger.tsv")).some((row) => isAsk(row, name));
}

/** The session stopped asking: its live, unclaimed ask rows are archived. Returns their ids. */
export function resolveAsks(name: string): string[] {
	return withLedger((rows, save) => {
		const asks = rows.filter((row) => isAsk(row, name));
		const ids = asks.map((row) => row.id);
		for (const row of asks) row.note = clean(`${row.note} [ask resolved in the session]`);
		if (ids.length) finishRows(rows, ids, undefined, save);
		return ids;
	});
}

/** One tab-separated line per session: name, mux, host, pane, result, since, goal, phase (plus ` closing`). */
export function listAgents(): string {
	const watches = readObserved().watches;
	return readAgents()
		.map((a) => [a.name, a.mux, a.host, a.pane, a.result, a.since, a.goal, `${watches[a.name]?.phase ?? ""}${a.closing ? " closing" : ""}`.trim()].map((v) => String(v ?? "")).join("\t"))
		.join("\n");
}
