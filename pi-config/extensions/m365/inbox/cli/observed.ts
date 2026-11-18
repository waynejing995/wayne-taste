/**
 * What is known about each watched agent session: one record per watch in cursors/agents.json, written by both
 * sensors (the probe, and the event tailer of the m365 inbox extension). Rows are made on a change of the record, by
 * whichever sensor sees it first, so one turn end seen by both is one row.
 *
 * Every access is a read of the file, and every change a read-modify-write under cursors/agents.json.lock: the probe
 * is a child process and the tailer lives in the coordinator, so no process may keep a copy in memory.
 */
import * as fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { InboxError, inboxFile } from "./ledger.ts";

export type Phase = "working" | "asking" | "idle" | "gone";

export interface Observed {
	phase: Phase;
	/** ms, the pane host's clock. Only moves forward: an observation older than it is dropped. */
	at: number;
	by: "event" | "probe";
	/** The agent process last seen in the pane. Kept after `gone`: it is what a resume needs. */
	agent?: { pid: number; session: string; sessionFile: string; cwd: string };
	/** Probe: an ask seen but not yet recorded. It becomes a row on its second sighting. */
	ask?: { id: string; sightings: number };
	/** Epoch seconds of the last output (stall and idle minutes). */
	active?: number;
	/** Pane text hash, for a mux with no session file. */
	text?: string;
	/** The digest entry last sent for this session. */
	digested?: string;
}

export interface ObservedFile {
	watches: Record<string, Observed>;
	digest?: { at: number };
}

/** A holder writes the rows its change owes before it lets go, and a row can wait 12 s on the ledger lock. */
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 40_000;

/** The records as they are now. A missing file is no observation yet. */
export function readObserved(): ObservedFile {
	let text: string;
	try {
		text = fs.readFileSync(inboxFile("cursors", "agents.json"), "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return { watches: {} };
		throw e;
	}
	const saved = JSON.parse(text) as Partial<ObservedFile>;
	return { ...saved, watches: saved.watches ?? {} };
}

/**
 * One read-modify-write of the records under their lock. `change` edits the file object in place and may record
 * the rows the change owes: when it throws, nothing is saved, so the same change is seen (and owed) again.
 */
export async function updateObserved<T>(change: (state: ObservedFile) => T | Promise<T>): Promise<T> {
	const file = inboxFile("cursors", "agents.json");
	const lock = `${file}.lock`;
	fs.mkdirSync(inboxFile("cursors"), { recursive: true });
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			fs.closeSync(fs.openSync(lock, "wx"));
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			// Released between the create and the stat: age 0, try again.
			const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
			if (age > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
			else if (Date.now() > deadline) throw new InboxError(`${lock} is held by another writer`);
			else await sleep(20);
		}
	}
	try {
		const state = readObserved();
		const out = await change(state);
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`);
		fs.renameSync(tmp, file);
		return out;
	} finally {
		fs.rmSync(lock, { force: true });
	}
}
