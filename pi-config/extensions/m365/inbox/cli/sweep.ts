/**
 * `inbox sweep`: findings about thens that need a person. Dry-run prints them; `--apply` records each once.
 *
 * Later stages (a merged PR, a stale row, a model judgment) belong in this file as more findings. They are not here:
 * this command never closes a then or an agent row, and it never asks GitHub or a model.
 *
 * Keys: `sweep:then-overdue:<row>.<n>:<date>` (fired, still open, older than 24 h).
 */
import { inboxFile, readTsv, recordDirect, stamp } from "./ledger.ts";
import { readThens } from "./thens.ts";
interface Finding { key: string; subject: string; note: string }

/** The findings as of `now`. Same inputs give the same keys, so a second run the same day records nothing new. */
export function sweepFindings(now = new Date()): Finding[] {
	const out: Finding[] = [];
	for (const t of readThens()) {
		if (t.done || !t.fired || now.getTime() - Date.parse(t.fired.replace(" ", "T")) <= 24 * 60 * 60_000) continue;
		const id = `${t.row}.${t.n}`;
		out.push({ key: `then-overdue:${id}:${stamp(now).slice(0, 10)}`, subject: `then ${id} overdue`, note: `Fired ${t.fired}, still open: ${t.action}` });
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
