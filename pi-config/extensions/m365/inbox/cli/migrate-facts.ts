/**
 * Move open teams-fact ledger rows into facts.md and close those rows.
 *
 * Usage: node --experimental-strip-types inbox/cli/migrate-facts.ts [--dir DIR] [--dry-run]
 * Archived facts are not migrated. Do not point --dir at the live inbox until the checkout is applied.
 */
import { readTsv } from "./ledger.ts";
import { migrateFacts, planMigration } from "./facts.ts";

const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dir");
const dir = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
if (!dir) throw new Error("--dir is required; point it at a copy, not the live inbox");
process.env.WAYNE_INBOX_DIR = dir;

const openFacts = readTsv(`${dir}/ledger.tsv`).filter((row) => row.tag === "teams-fact");
const dry = args.includes("--dry-run");
const result = dry ? planMigration(openFacts) : migrateFacts(openFacts);
console.log(`${dry ? "would write" : "wrote"} ${result.written} facts and ${dry ? "close" : "closed"} ${result.closed.length} rows`);
for (const r of result.refused) console.error(`${dry ? "would refuse" : "refused"} row ${r.id}, left open: ${r.reason}`);
if (result.refused.length) process.exitCode = 1;
