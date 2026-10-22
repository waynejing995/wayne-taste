/**
 * Every offline suite of the package: Teams' and Outlook's, plus the package's own load check.
 *
 *   node tests/run.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = 0;
for (const [label, script] of [
	["teams", join(root, "teams", "tests", "run.mjs")],
	["outlook", join(root, "outlook", "tests", "run.mjs")],
	["package", join(root, "tests", "load.test.mjs")],
]) {
	const r = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: dirname(dirname(script)) });
	const ok = r.status === 0;
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (!ok) console.log(`${r.stdout}${r.stderr}`);
}
console.log(failed === 0 ? "\nall green" : `\n${failed} group(s) failed`);
process.exit(failed === 0 ? 0 : 1);
