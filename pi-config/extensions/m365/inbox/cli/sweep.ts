/**
 * `inbox sweep`: findings about watches and thens that need a person. Dry-run prints them; `--apply` records each once.
 *
 * Later stages (a merged PR, a stale row, a model judgment) belong in this file as more findings. They are not here:
 * this command never closes a then or an agent row, and it never asks GitHub or a model.
 *
 * Keys: `sweep:then-overdue:<row>.<n>:<date>` (fired, still open, older than 24 h), `sweep:then-dead:<row>.<n>`
 * (unfired, and that generation is no longer watched), `sweep:watch-dead:<name>:<generation>` (the tailer says the
 * session ended or died, and a then of that generation is still open), `sweep:held:<name>:<session>` (events arrived
 * for a name that is not watched).
 */
import * as fs from "node:fs";
import { readAgents } from "./agents.ts";
import { inboxFile, readTsv, recordDirect, stamp } from "./ledger.ts";
import { readThens, type Then } from "./thens.ts";
interface HeldEvent { event?: { session?: string } }
interface NameCursor { state?: string; generation?: string; pending?: HeldEvent[] }
interface Cursors { names: Record<string, NameCursor> }
interface Finding { key: string; subject: string; note: string }

function day(now: Date): string {
	return stamp(now).slice(0, 10);
}

function cursors(): Cursors {
	try {
		return JSON.parse(fs.readFileSync(inboxFile("cursors/agent-events.json"), "utf8")) as Cursors;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return { names: {} };
		throw e;
	}
}

/** The findings as of `now`. Same inputs give the same keys, so a second run the same day records nothing new. */
export function sweepFindings(now = new Date()): Finding[] {
	const thens = readThens().filter((t) => !t.done);
	const watched = new Set(readAgents().map((a) => `${a.name}:${a.generation ?? ""}`));
	const out: Finding[] = [];
	const overdue = (t: Then) => !!t.fired && now.getTime() - Date.parse(t.fired.replace(" ", "T")) > 24 * 60 * 60_000;
	for (const t of thens) {
		const id = `${t.row}.${t.n}`;
		if (overdue(t)) out.push({ key: `then-overdue:${id}:${day(now)}`, subject: `then ${id} overdue`, note: `Fired ${t.fired}, still open: ${t.action}` });
		if (!t.fired && t.generation && t.when.startsWith("agent-result:") && !watched.has(`${t.when.slice("agent-result:".length)}:${t.generation}`))
			out.push({ key: `then-dead:${id}`, subject: `then ${id} has no registration`, note: `${t.when} generation ${t.generation} is not watched` });
	}
	const state = cursors();
	for (const [name, st] of Object.entries(state.names ?? {})) {
		if ((st.state === "dead" || st.state === "ended") && st.generation && thens.some((t) => t.generation === st.generation && t.when === `agent-result:${name}`))
			out.push({ key: `watch-dead:${name}:${st.generation}`, subject: `watch ${name} ${st.state}`, note: `generation ${st.generation} is ${st.state} with an open then` });
		const held = new Set((st.pending ?? []).map((p) => p.event?.session).filter((s): s is string => !!s));
		if (!readAgents().some((a) => a.name === name)) for (const session of held)
			out.push({ key: `held:${name}:${session}`, subject: `held events for ${name}`, note: `session ${session} reported while ${name} was not watched` });
	}
	return out;
}

export function sweep(apply: boolean, now = new Date()): string {
	const seen = new Set([...readTsv(inboxFile("ledger.tsv")), ...readTsv(inboxFile("archive.tsv"))].map((r) => r.key));
	const lines: string[] = [];
	for (const f of sweepFindings(now)) {
		const key = `sweep:${f.key}`;
		if (seen.has(key)) {
			lines.push(`seen ${key}`);
			continue;
		}
		if (!apply) {
			lines.push(`would ${key} ${f.subject}`);
			continue;
		}
		lines.push(recordDirect("sweep", "do", f.key, f.subject, "sweep", f.note, "", "coordinator"));
	}
	return lines.join("\n");
}
