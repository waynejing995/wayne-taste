/**
 * Where inbox delivery keeps its state, shared by every harness that delivers inbox cards (omp's /inbox watch, the
 * MCP server's channel): the ledger, the delivery cursor, and the lease that lets only one of them deliver.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseLedger, type Row } from "./card.ts";
import { BIN_DIR } from "./cli/jobs.ts";

export const DIR = process.env.WAYNE_INBOX_DIR ?? path.join(os.homedir(), ".wayne", "inbox");
export const LEDGER = path.join(DIR, "ledger.tsv");
const CURSOR = path.join(DIR, "cursors", "session-push.id");
/** The lease name: one deliverer per inbox directory, machine and user, whatever chat the Teams watch holds. */
export const LEASE_ID = `wayne-inbox:${DIR}`;
/** The launcher the agent runs for `inbox set` / `inbox done`, named on every card. */
export const LAUNCHER = path.join(BIN_DIR, "inbox");
export const PUSHED = new Set(["notify", "do"]);

export function readRows(): Row[] {
	return fs.existsSync(LEDGER) ? parseLedger(fs.readFileSync(LEDGER, "utf8")) : [];
}

export function readCursor(): number | null {
	if (!fs.existsSync(CURSOR)) return null;
	const n = Number(fs.readFileSync(CURSOR, "utf8").trim());
	if (!Number.isInteger(n) || n < 0) throw new Error(`${CURSOR} does not hold a row id`);
	return n;
}

export function writeCursor(id: number): void {
	fs.mkdirSync(path.dirname(CURSOR), { recursive: true });
	const tmp = `${CURSOR}.tmp`;
	fs.writeFileSync(tmp, `${id}\n`);
	fs.renameSync(tmp, CURSOR);
}

