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
import { existsSync } from "node:fs";
import { groups, runGroup } from "./groups.mjs";

let failed = 0;
for (const group of groups) {
	const { label, script, local } = group;
	if (local && !existsSync(script)) {
		console.log(`SKIP  ${label}: not in this checkout`);
		continue;
	}
	const r = runGroup(group);
	const ok = r.status === 0;
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (!ok) console.log(`${r.stdout}${r.stderr}`);
}
console.log(failed === 0 ? "\nall green" : `\n${failed} group(s) failed`);
process.exit(failed === 0 ? 0 : 1);
