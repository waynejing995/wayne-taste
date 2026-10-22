/**
 * Offline regression suite for the outlook extension. Loads the modules through
 * jiti exactly the way pi does, then checks what they produce.
 *
 *   node tests/run.mjs          # offline tests only
 *
 * Each unit that lands a suite adds it to the list below.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suites = ["render.test.mjs", "convert.test.mjs", "mime.test.mjs", "mailbox.test.mjs", "overlay.test.mjs", "tools.test.mjs", "status.test.mjs", "load.test.mjs"];
let failed = 0;

for (const s of suites) {
	const r = spawnSync(process.execPath, [join(here, s)], { encoding: "utf8" });
	const out = `${r.stdout}${r.stderr}`;
	// A FAIL at the start of a line, which is how every suite reports one.
	// A bare /FAIL/ also matches the word inside a heading or a quoted message,
	// so a green suite can be reported red.
	const ok = r.status === 0 && !/^\s*FAIL\b/m.test(out);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${s}`);
	if (!ok) console.log(out);
}
console.log(failed === 0 ? "\nall green" : `\n${failed} suite(s) failed`);
process.exit(failed === 0 ? 0 : 1);
