/**
 * The package's offline tests.
 *
 *   node tests/run.mjs        # npm test
 *
 * Public, in every checkout: Outlook's suite and the package load check. Teams' suite is
 * local-only -- it was written against a real mailbox and holds real names and messages,
 * so teams/.gitignore keeps it out of the repository. It runs here when it is present
 * on this machine, and is reported as skipped where it is not; a clone is not a failure.
 *
 * Needs `npm install` in this directory, and pi installed (see tests/host.mjs).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const groups = [
	{ label: "outlook", script: join(root, "outlook", "tests", "run.mjs"), local: false },
	{ label: "package", script: join(root, "tests", "load.test.mjs"), local: false },
	{ label: "teams (local-only)", script: join(root, "teams", "tests", "run.mjs"), local: true },
];
let failed = 0;
for (const { label, script, local } of groups) {
	if (local && !existsSync(script)) {
		console.log(`SKIP  ${label}: not in this checkout`);
		continue;
	}
	const r = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: dirname(dirname(script)) });
	const ok = r.status === 0;
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (!ok) console.log(`${r.stdout}${r.stderr}`);
}
console.log(failed === 0 ? "\nall green" : `\n${failed} group(s) failed`);
process.exit(failed === 0 ? 0 : 1);
