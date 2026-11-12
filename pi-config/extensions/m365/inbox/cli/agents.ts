/**
 * The watched agent sessions: the `agent_watch` list in rules.yaml.
 */
import { randomUUID } from "node:crypto";
import { clean, InboxError, stamp, withRulesLock } from "./ledger.ts";
import { addThen } from "./thens.ts";
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
}

export function readAgents(): AgentEntry[] {
	const agents = readList(AGENT_LIST) as unknown as AgentEntry[];
	if (!agents.some((a) => !a.generation)) return agents;
	const migrated = agents.map((a) => a.generation ? a : { ...a, generation: randomUUID() });
	return withRulesLock(() => {
		const current = readList(AGENT_LIST) as unknown as AgentEntry[];
		if (!current.some((a) => !a.generation)) return current;
		const next = current.map((a) => a.generation ? a : { ...a, generation: randomUUID() });
		writeList(AGENT_LIST, next as unknown as Record<string, unknown>[]);
		return next;
	});
}

export function writeAgents(agents: AgentEntry[]): void {
	writeList(AGENT_LIST, agents as unknown as Record<string, unknown>[]);
}

/**
 * Watch one agent session. A second add of the same name replaces it. The dispatcher's plan for the result (what it
 * expects, whom it tells and how, what it closes) is a then on the live row the session works for, fired by the
 * session's next RESULT: the result card comes back with the plan, and the row cannot be closed until it is done.
 */
export function addAgent(a: { name: string; mux: string; pane: string; row: string; then: string; host?: string; result?: string; goal?: string; push?: boolean }): string {
	if (!MUXES.includes(a.mux)) throw new InboxError(`--mux must be one of ${MUXES.join(", ")}`);
	const then = addThen(a.row, `agent-result:${a.name}`, a.then, true);
	const entry: AgentEntry = { name: a.name, mux: a.mux, host: a.host || "local", pane: a.pane };
	if (a.result) entry.result = a.result;
	if (a.goal) entry.goal = clean(a.goal);
	if (a.push) entry.push = true;
	// Seconds, not minutes: the push tailer tells a re-registration of the same name by a changed `since`.
	entry.since = stamp(new Date(), true);
	entry.generation = randomUUID();
	withRulesLock(() => writeAgents([...readAgents().filter((e) => e.name !== a.name), entry]));
	return `watching ${a.name}; ${then}`;
}

export function removeAgents(entries: { name: string; generation?: string }[]): string {
	withRulesLock(() => {
		const agents = readAgents();
		writeAgents(agents.filter((a) => !entries.some((e) => e.name === a.name && (!e.generation || e.generation === a.generation))));
	});
	return `stopped ${entries.map((e) => e.name).join(" ")}`;
}

export function removeAgentsByName(names: string[], generation?: string): string {
	withRulesLock(() => {
		const agents = readAgents();
		if (!generation) {
			const missing = names.filter((name) => !agents.some((a) => a.name === name));
			if (missing.length) throw new InboxError(`not watched: ${missing.join(" ")}`);
		}
		writeAgents(agents.filter((a) => !(names.includes(a.name) && (!generation || a.generation === generation))));
	});
	return `stopped ${names.join(" ")}`;
}


/** One tab-separated line per session: name, mux, host, pane, result, since, goal, push. */
export function listAgents(): string {
	return readAgents()
		.map((a) => [a.name, a.mux, a.host, a.pane, a.result, a.since, a.goal].map((v) => String(v ?? "")).concat(a.push ? "push" : "").join("\t"))
		.join("\n");
}
