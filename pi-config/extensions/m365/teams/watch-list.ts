/**
 * The Teams watches to resume in a new session: the `teams_watch` section of ~/.wayne/inbox/rules.yaml.
 *
 * Only an explicit start, stop or interval change edits it; a session ending does not, so the list survives
 * restarts. Each edit changes one chat or the interval and leaves the rest alone, under an exclusive lock, so
 * two sessions editing different chats at once both land. Nothing resumes from it on its own: an agent reads
 * it and calls teams_watch start for each chat.
 *
 * rules.yaml is hand-written, so only the text of this section is rewritten: it is kept as the last top-level
 * block, and every byte before it stays as the user wrote it. inbox.py, which classifies by the rest, skips it.
 *
 * The list is a convenience, not the watch: a failed save is reported to the caller as a warning and the
 * watch runs anyway.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";

export type SavedWatch = { chat: string; chat_id: string; policy: string };
export type WatchList = { interval_sec?: number; chats: SavedWatch[] };

export const WATCH_LIST = path.join(process.env.WAYNE_INBOX_DIR ?? path.join(os.homedir(), ".wayne", "inbox"), "rules.yaml");
const SECTION = "teams_watch";
const LOCK = `${WATCH_LIST}.lock`;
const LOCK_STALE_MS = 10_000;
const HEADER = "# Teams watches to resume in a new session. Written by the m365 extension on every start / stop / interval change.\n";
/** The section with its header comment, from its first line to the next top-level key or the end of the file (with or without a final newline). */
const BLOCK = new RegExp(`(?:^# Teams watches to resume.*\\n)?^${SECTION}:.*(?:\\n|$)(?:(?:[ \\t#].*|)(?:\\n|$))*`, "m");

/** The file's text with the section cut out, and the section's value. */
function split(): { rest: string; list: WatchList } {
	const text = fs.existsSync(WATCH_LIST) ? fs.readFileSync(WATCH_LIST, "utf8") : "";
	const data = (YAML.parse(text) ?? {}) as Record<string, unknown>;
	const list = (data[SECTION] ?? { chats: [] }) as WatchList;
	if (!Array.isArray(list.chats)) throw new Error(`${WATCH_LIST}: \`${SECTION}.chats\` must be a list`);
	return { rest: text.replace(BLOCK, "").replace(/\n*$/, ""), list };
}

/** Hold the lock file for one read-modify-write. A lock older than LOCK_STALE_MS belonged to a process that died. */
function locked(edit: (list: WatchList) => WatchList): void {
	fs.mkdirSync(path.dirname(WATCH_LIST), { recursive: true });
	const deadline = Date.now() + 2000;
	for (;;) {
		try {
			fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			const age = Date.now() - (fs.statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
			if (age > LOCK_STALE_MS) fs.rmSync(LOCK, { force: true });
			else if (Date.now() > deadline) throw new Error(`${LOCK} is held by another session`);
			else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
		}
	}
	try {
		const { rest, list } = split();
		const block = HEADER + YAML.stringify({ [SECTION]: edit(list) });
		const tmp = `${WATCH_LIST}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, rest ? `${rest}\n\n${block}` : block);
		fs.renameSync(tmp, WATCH_LIST);
	} finally {
		fs.rmSync(LOCK, { force: true });
	}
}

/** Run one edit; a failure comes back as a warning line, never as a thrown error. */
function save(edit: (list: WatchList) => WatchList): string {
	try {
		locked(edit);
		return "";
	} catch (e) {
		return ` Warning: not saved to ${WATCH_LIST} (${e instanceof Error ? e.message : e}); a new session will not resume this.`;
	}
}

export function rememberWatch(w: SavedWatch): string {
	return save((l) => ({ ...l, chats: [...l.chats.filter((c) => c.chat_id !== w.chat_id), w] }));
}

export function forgetWatch(chatId: string): string {
	return save((l) => ({ ...l, chats: l.chats.filter((c) => c.chat_id !== chatId) }));
}

export function rememberInterval(sec: number): string {
	return save((l) => ({ ...l, interval_sec: sec }));
}
