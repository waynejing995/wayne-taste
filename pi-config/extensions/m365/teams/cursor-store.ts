/**
 * Every Teams watch cursor on disk: one JSON file per watched chat or channel, under <inbox>/cursors/.
 *
 * A cursor records how far a watch has handed messages over (the watermark) and which ids above it are done.
 * The watermark only moves past ids that are settled, so a message still waiting in memory is never skipped.
 * Updates take an exclusive lock, so two sessions watching different things at once both land. No message text
 * is stored here.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ThreadBinding = { owner: string; subject?: string };
export type CursorFile = {
	version: 1;
	key: string;
	watermark: string;
	done: string[];
	threads?: Record<string, ThreadBinding>;
	awaiting?: Record<string, string[]>;
};

const INBOX = process.env.WAYNE_INBOX_DIR ?? path.join(os.homedir(), ".wayne", "inbox");
const CURSOR_DIR = path.join(INBOX, "cursors");
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 2000;

/** The key a watch is stored under: the chat id, or channel:<team>/<channel> for a channel. */
export function cursorKey(target: { chatId: string } | { teamId: string; channelId: string }): string {
	return "chatId" in target ? target.chatId : `channel:${target.teamId}/${target.channelId}`;
}

/** The file for a key. The key is hashed so a channel key with slashes and colons is a safe file name. */
export function cursorPath(key: string): string {
	return path.join(CURSOR_DIR, `teams-${crypto.createHash("sha1").update(key).digest("hex")}.json`);
}

/** The cursor for a key, or null when none exists. A file that does not parse or has another version is an error. */
export function loadCursor(key: string): CursorFile | null {
	const file = cursorPath(key);
	if (!fs.existsSync(file)) return null;
	let c: CursorFile;
	try {
		c = JSON.parse(fs.readFileSync(file, "utf8")) as CursorFile;
	} catch (e) {
		throw new Error(`${file}: cursor file does not parse (${e instanceof Error ? e.message : e}); delete it to restart that watch`);
	}
	if (c.version !== 1) throw new Error(`${file}: cursor version ${String(c.version)} is not supported; delete it to restart that watch`);
	return c;
}

/** Hold `${path}.lock` for one body. A lock older than LOCK_STALE_MS belonged to a process that died. */
function withLock<T>(file: string, body: () => T): T {
	const lock = `${file}.lock`;
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
			if (age > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
			else if (Date.now() > deadline) throw new Error(`${lock} is held by another session`);
			else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
		}
	}
	try {
		return body();
	} finally {
		fs.rmSync(lock, { force: true });
	}
}

/**
 * Read, change and write one cursor under the lock. A key with no cursor takes `init()` as its first value; with no
 * `init` it is an error, so a watch never starts from a guessed baseline.
 */
export function updateCursor(
	key: string,
	change: (c: CursorFile) => CursorFile,
	init?: () => CursorFile,
): CursorFile {
	const file = cursorPath(key);
	fs.mkdirSync(CURSOR_DIR, { recursive: true });
	return withLock(file, () => {
		const current = loadCursor(key) ?? init?.();
		if (!current) throw new Error(`no cursor for ${key}`);
		const next = change(current);
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
		fs.renameSync(tmp, file);
		return next;
	});
}

/** Numeric when both ids are digit strings (Teams message ids overflow a double), else string order (ISO timestamps). */
export function compareIds(a: string, b: string): number {
	if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
		const x = BigInt(a);
		const y = BigInt(b);
		return x < y ? -1 : x > y ? 1 : 0;
	}
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Record handed-over ids and advance the watermark. `pending` is every id above the watermark that the engine has
 * read and not yet handed over or skipped, this poll's and earlier polls' alike; the watermark stops below the
 * first of them. Pure: returns the new cursor, leaves `c` alone.
 */
export function markDone(c: CursorFile, pending: string[], doneIds: string[]): CursorFile {
	const above = (id: string) => compareIds(id, c.watermark) > 0;
	const done = [...new Set([...c.done, ...doneIds])].filter(above);
	const waiting = pending.filter((p) => above(p) && !done.includes(p));
	const floor = waiting.reduce<string | undefined>((m, p) => (m === undefined || compareIds(p, m) < 0 ? p : m), undefined);
	const candidates = done.filter((d) => floor === undefined || compareIds(d, floor) < 0);
	const top = candidates.reduce<string | undefined>((m, d) => (m === undefined || compareIds(d, m) > 0 ? d : m), undefined);
	const watermark = top !== undefined && compareIds(top, c.watermark) > 0 ? top : c.watermark;
	return { ...c, watermark, done: done.filter((d) => compareIds(d, watermark) > 0).sort(compareIds) };
}

/**
 * Record handed-over or answered ids in `done` without moving the watermark. Use during recovery before the stream
 * has been read, when unread ids may sit below `ids`; the next normal poll's `markDone` advances the watermark.
 * Pure: returns the new cursor, leaves `c` alone.
 */
export function addDone(c: CursorFile, ids: string[]): CursorFile {
	const done = [...new Set([...c.done, ...ids])].filter((id) => compareIds(id, c.watermark) > 0).sort(compareIds);
	return { ...c, done };
}
