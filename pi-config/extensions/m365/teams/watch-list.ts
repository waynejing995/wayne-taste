/**
 * The Teams watches to resume in a new session: the `teams_watch` section of ~/.wayne/inbox/rules.yaml.
 *
 * Only an explicit start, stop or interval change edits it; a session ending does not, so the list survives
 * restarts. Each edit changes one chat or the interval and leaves the rest alone, under an exclusive lock, so
 * two sessions editing different chats at once both land. Nothing resumes from it on its own: an agent reads
 * it and calls teams_watch start for each chat.
 *
 * rules.yaml is hand-written, so only the text of this section is rewritten, in place (core/rules-block.ts):
 * every other byte stays as the user wrote it. The inbox CLI, which classifies by the rest, skips it.
 *
 * The list is a convenience, not the watch: a failed save is reported to the caller as a warning and the
 * watch runs anyway.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";
import { replaceBlock } from "../core/rules-block.ts";

export type BoardColumnsConfig = { waiting?: string; working?: string; done?: string };
export type SavedBoardConfig = { site_url: string; list_id: string; columns?: BoardColumnsConfig };
export type SavedWatch = { chat: string; chat_id: string; policy: string };
export type SavedChannelWatch = { channel: string; team_id: string; channel_id: string; mode?: "shared" | "personal"; policy: string; board?: SavedBoardConfig };
export type WatchList = { interval_sec?: number; chats: SavedWatch[]; channels?: SavedChannelWatch[] };

export const WATCH_LIST = path.join(process.env.WAYNE_INBOX_DIR ?? path.join(os.homedir(), ".wayne", "inbox"), "rules.yaml");
const SECTION = "teams_watch";
const LOCK = `${WATCH_LIST}.lock`;
const LOCK_STALE_MS = 10_000;
const HEADER = "# Teams watches to resume in a new session. Written by the m365 extension on every start / stop / interval change.\n";

/** The file's text and the section's value. */
function split(): { text: string; list: WatchList } {
	const text = fs.existsSync(WATCH_LIST) ? fs.readFileSync(WATCH_LIST, "utf8") : "";
	const data = (YAML.parse(text) ?? {}) as Record<string, unknown>;
	const raw = (data[SECTION] ?? { chats: [] }) as Partial<WatchList>;
	if (raw.chats !== undefined && !Array.isArray(raw.chats)) throw new Error(`${WATCH_LIST}: \`${SECTION}.chats\` must be a list`);
	if (raw.channels !== undefined && !Array.isArray(raw.channels)) throw new Error(`${WATCH_LIST}: \`${SECTION}.channels\` must be a list`);
	const list: WatchList = { ...raw, chats: raw.chats ?? [] };
	return { text, list };
}

/** The saved watches, as a harness resuming them reads them. A channel with no mode is shared, the design's default. */
export function savedWatches(): WatchList {
	const { list } = split();
	return list.channels === undefined ? list : { ...list, channels: list.channels.map((c) => ({ ...c, mode: c.mode ?? "shared" })) };
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
		const { text, list } = split();
		const block = HEADER + YAML.stringify({ [SECTION]: edit(list) });
		const tmp = `${WATCH_LIST}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, replaceBlock(text, SECTION, "# Teams watches to resume", block));
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

export function rememberChannelWatch(w: SavedChannelWatch): string {
	return save((l) => {
		const prev = (l.channels ?? []).find((c) => c.team_id === w.team_id && c.channel_id === w.channel_id);
		const merged: SavedChannelWatch = w.board === undefined && prev?.board !== undefined ? { ...w, board: prev.board } : w;
		return {
			...l,
			channels: [...(l.channels ?? []).filter((c) => c.team_id !== w.team_id || c.channel_id !== w.channel_id), merged],
		};
	});
}

export function forgetChannelWatch(teamId: string, channelId: string): string {
	return save((l) => ({ ...l, channels: (l.channels ?? []).filter((c) => c.team_id !== teamId || c.channel_id !== channelId) }));
}
