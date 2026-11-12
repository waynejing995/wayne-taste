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
	migratedGeneration?: string;
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
export function addAgent(a: { name: string; mux: string; pane: string; row: string; then: string; host?: string; result?: string; goal?: string; push?: boolean }): string {
	if (!MUXES.includes(a.mux)) throw new InboxError(`--mux must be one of ${MUXES.join(", ")}`);
	const entry: AgentEntry = { name: a.name, mux: a.mux, host: a.host || "local", pane: a.pane };
	if (a.result) entry.result = a.result;
	if (a.goal) entry.goal = clean(a.goal);
	if (a.push) entry.push = true;
	// Seconds, not minutes: the push tailer tells a re-registration of the same name by a changed `since`.
	entry.since = stamp(new Date(), true);
	entry.generation = randomUUID();
	// Under the rules lock, so the plan is armed only for the registration that is written, and a racing add of the
	// same name cannot cancel a plan it did not replace.
	return withRulesLock(() => {
		const agents = migrateAgents(readList(AGENT_LIST) as unknown as AgentEntry[]);
		const old = agents.find((e) => e.name === a.name);
		const legacy = old?.migratedGeneration === "legacy" && old.since ? { replacesLegacySince: old.since } : {};
		// The registration and its plan change together: see addThen's `commit`.
		const then = addThen(a.row, `agent-result:${a.name}`, a.then, { generation: entry.generation!, replaces: old?.generation, ...legacy }, () => {
			writeAgents([...agents.filter((e) => e.name !== a.name), entry]);
			return () => writeAgents(agents);
		});
		return `watching ${a.name}; ${then}`;
	});
}

export function removeAgents(entries: { name: string; generation?: string }[]): string {
	const removed: string[] = [];
	withRulesLock(() => {
		const agents = migrateAgents(readList(AGENT_LIST) as unknown as AgentEntry[]);
		const matched = entries.filter((e) => e.generation && agents.some((a) => a.name === e.name && a.generation === e.generation));
		for (const e of entries) if (!matched.includes(e)) console.warn(`agent cleanup skipped ${e.name}: missing or changed generation`);
		removed.push(...matched.map((e) => e.name));
		writeAgents(agents.filter((a) => !matched.some((e) => e.name === a.name && e.generation === a.generation)));
	});
	return `stopped ${removed.join(" ")}`;
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


/** One tab-separated line per session: name, mux, host, pane, result, since, goal, push. */
export function listAgents(): string {
	return readAgents()
		.map((a) => [a.name, a.mux, a.host, a.pane, a.result, a.since, a.goal].map((v) => String(v ?? "")).concat(a.push ? "push" : "").join("\t"))
		.join("\n");
}
