/**
 * The user's standing note for every card that wakes the agent (inbox and Teams watch): `card-note.md` in the inbox
 * directory, if present. It is said on each card so it survives compaction; it is the user's own text, so it sits
 * outside the untrusted fence. Read fresh per card: an edit applies to the next card, and no file means no note.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function cardNote(): string {
	const file = path.join(process.env.WAYNE_INBOX_DIR ?? path.join(os.homedir(), ".wayne", "inbox"), "card-note.md");
	try {
		return fs.readFileSync(file, "utf8").trim();
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw e;
	}
}
