/**
 * The watched agent sessions: the `agent_watch` list in rules.yaml.
 */
import { randomUUID } from "node:crypto";
import { addEvent, clean, InboxError, inboxFile, readTsv, stamp, supersedeSession, withRulesLock, type AddEvent } from "./ledger.ts";
import { resultOf } from "./probe.ts";
import { addThen, readThens } from "./thens.ts";
import { AGENT_LIST, readList, writeList } from "./lists.ts";

export const MUXES = ["hc", "herdr", "tern", "tmux"];

export interface AgentEntry {
	name: string;
	mux: string;
	host: string;
	pane: string;
	result?: string;
	goal?: string;
	push?: boolean;
	since?: string;
	generation?: string;
	/** Added with `--generation`: the reporter stamps this id on every event, and only those events are this registration's. */
	stamped?: boolean;
	migratedGeneration?: string;
	/** This add's own id: a re-add of the same launch in the same second is still a new registration. */
	instance?: string;
}

function migrateAgents(agents: AgentEntry[]): AgentEntry[] {
	if (!agents.some((a) => !a.generation)) return agents;
	const next = agents.map((a) => a.generation ? a : { ...a, generation: randomUUID(), migratedGeneration: "legacy" });
	writeList(AGENT_LIST, next as unknown as Record<string, unknown>[]);
	return next;
}

export function readAgents(): AgentEntry[] {
	const agents = readList(AGENT_LIST) as unknown as AgentEntry[];
	if (!agents.some((a) => !a.generation)) return agents;
	return withRulesLock(() => migrateAgents(readList(AGENT_LIST) as unknown as AgentEntry[]));
}

export function writeAgents(agents: AgentEntry[]): void {
	writeList(AGENT_LIST, agents as unknown as Record<string, unknown>[]);
}

/**
 * Watch one agent session. A second add of the same name replaces it. The dispatcher's plan for the result (what it
 * expects, whom it tells and how, what it closes) is a then on the live row the session works for, fired by the
 * session's next RESULT: the result card comes back with the plan, and the row cannot be closed until it is done.
 */
export async function addAgent(a: { name: string; mux: string; pane: string; row: string; then: string; host?: string; result?: string; goal?: string; push?: boolean; generation?: string }): Promise<string> {
	if (!MUXES.includes(a.mux)) throw new InboxError(`--mux must be one of ${MUXES.join(", ")}`);
	if (a.generation !== undefined && !/^[A-Za-z0-9-]{8,64}$/.test(a.generation)) throw new InboxError(`--generation must be 8-64 letters, digits or dashes, as WAYNE_AGENT_GENERATION was`);
	const entry: AgentEntry = { name: a.name, mux: a.mux, host: a.host || "local", pane: a.pane };
	if (a.result) entry.result = a.result;
	if (a.goal) entry.goal = clean(a.goal);
	if (a.push) entry.push = true;
	// Seconds, not minutes: the push tailer tells a re-registration of the same name by a changed `since`.
	entry.since = stamp(new Date(), true);
	// The launch's own id when the session was started with WAYNE_AGENT_GENERATION: its events carry it.
	entry.generation = a.generation ?? randomUUID();
	if (a.generation) entry.stamped = true;
	entry.instance = randomUUID();
	const version = (await resultOf({ host: a.host, result: a.result })).version;
	const baseline = version ? { version } : undefined;
	// Under the rules lock, so the plan is armed only for the registration that is written, and a racing add of the
	// same name cannot cancel a plan it did not replace.
	return withRulesLock(() => {
		const agents = migrateAgents(readList(AGENT_LIST) as unknown as AgentEntry[]);
		const old = agents.find((e) => e.name === a.name);
		// The registration and its plan change together: see addThen's `commit`.
		const then = addThen(a.row, `agent-result:${a.name}`, a.then, { generation: entry.generation!, replaces: old?.generation, replacesLegacy: old?.migratedGeneration === "legacy", baseline }, () => {
			writeAgents([...agents.filter((e) => e.name !== a.name), entry]);
			return () => writeAgents(agents);
		});
		return `watching ${a.name}; ${then}`;
	});
}

export function removeAgentsByName(names: string[], generation?: string): string {
	withRulesLock(() => {
		const agents = migrateAgents(readList(AGENT_LIST) as unknown as AgentEntry[]);
		if (!generation) {
			const missing = names.filter((name) => !agents.some((a) => a.name === name));
			if (missing.length) throw new InboxError(`not watched: ${missing.join(" ")}`);
		}
		writeAgents(agents.filter((a) => !(names.includes(a.name) && (!generation || a.generation === generation))));
	});
	return `stopped ${names.join(" ")}`;
}

const VERSION_KEY = /^agents:[^:]+:result:[0-9a-f]{16}$/;

/** A local minute stamp (`YYYY-MM-DD HH:MM`) is at least the minute of `mtime` (epoch seconds). */
function minuteAtLeast(stampText: string, mtime: number): boolean {
	const at = Date.parse(stampText.replace(" ", "T"));
	return Number.isFinite(at) && at + 60_000 > mtime * 1000;
}

/**
 * True when an older build already reported this RESULT version. Match the agent-result tag, never the note:
 * `inbox done --note` rewrites notes. Old keys are `agents:<name>:<generation>:<session>:<seq>`,
 * `agents:<name>:<generation>:result:<stat>` and `agents:<name>:result:<epoch>`; a version key is not one of them.
 */
export function legacyReported(name: string, mtime: number): boolean {
	if (!mtime) return false;
	const prefix = `agents:${name}:`;
	const rows = [...readTsv(inboxFile("ledger.tsv")), ...readTsv(inboxFile("archive.tsv"))];
	return rows.some((row) => row.source === "agents" && row.tag === "agent-result" && row.key.startsWith(prefix) && !VERSION_KEY.test(row.key) && minuteAtLeast(row.first_seen, mtime));
}

/**
 * Record one agent event, then leave at most the new row live for that session. A known key changes nothing.
 * The parent row of a fired, open then stays: its plan is still owed.
 */
export function recordAgentRow(ev: AddEvent): string {
	const out = addEvent(ev);
	const made = /^(do|notify) (\d+) /.exec(out);
	if (!made) return out;
	supersedeSession(ev.place, made[2]!, readThens().filter((t) => t.fired && !t.done).map((t) => t.row));
	return out;
}



/** One tab-separated line per session: name, mux, host, pane, result, since, goal, push. */
export function listAgents(): string {
	return readAgents()
		.map((a) => [a.name, a.mux, a.host, a.pane, a.result, a.since, a.goal].map((v) => String(v ?? "")).concat(a.push ? "push" : "").join("\t"))
		.join("\n");
}
