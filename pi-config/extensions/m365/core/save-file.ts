/**
 * Writing a downloaded file without ever destroying one. Shared by teams_download and Outlook's saves.
 *
 * Every write creates its file exclusively (`wx`): a path that exists is an error, never a
 * truncation, and two saves racing for one free name cannot both win -- the loser moves on.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** A remote name must never decide where on disk we write. */
export function safeName(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? "";
	const cleaned = base.replace(/^\.+/, "").trim();
	return cleaned || "teams-file";
}

/** Where a save goes: exactly this path (which must not exist yet), or a free name in this directory. */
export type SaveTarget = string | { dir: string };

const isTaken = (e: unknown) => e instanceof Error && (e as NodeJS.ErrnoException).code === "EEXIST";

/**
 * Writes `bytes` to `target` and returns the path written. An exact path that exists is refused;
 * in a directory, `name` is tried first, then "name (1).ext", "name (2).ext", … until one is free.
 */
export function saveNew(target: SaveTarget, name: string, bytes: Uint8Array): string {
	if (typeof target === "string") {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		try {
			fs.writeFileSync(target, bytes, { flag: "wx" });
		} catch (e) {
			if (isTaken(e)) throw new Error(`${target} already exists; nothing was written. Give a new path, or none to pick a free name.`);
			throw e;
		}
		return target;
	}
	fs.mkdirSync(target.dir, { recursive: true });
	const safe = safeName(name);
	const ext = path.extname(safe);
	const stem = safe.slice(0, safe.length - ext.length);
	for (let n = 0; ; n++) {
		const candidate = path.join(target.dir, n === 0 ? safe : `${stem} (${n})${ext}`);
		try {
			fs.writeFileSync(candidate, bytes, { flag: "wx" });
			return candidate;
		} catch (e) {
			if (!isTaken(e)) throw e;
		}
	}
}
