import { strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../bin/auto-review.sh");
const prefix = "Multi-source auto-review @ abcdef0: No new CRITICAL issues.\n\n";
const cases = [
	["downgraded table still open", "### CRITICAL candidates downgraded\n\n| Finding | Reason |\n| file.txt | still open, but not critical |\n", "clean"],
	["none and downgraded table still present", "### CRITICAL\n\nNone.\n\n### CRITICAL candidates downgraded\n\n| Finding | Reason |\n| file.txt | Still present, but not critical |\n", "clean"],
	["none alone", "### CRITICAL\n\nNone.\n\n### INFORMATIONAL\n\nOther notes.\n", "clean"],
	["none without period and CRLF", "### CRITICAL\r\n\r\nNone\r\n\r\n### INFORMATIONAL\r\n\r\nOther notes.\r\n", "clean"],
	["explicit none without summary phrase", "### CRITICAL\n\nNone.\n\n### INFORMATIONAL\n\nNotes.\n", "clean", "Multi-source auto-review @ abcdef0\n\n"],
	["empty section alone is not enough", "### CRITICAL\n\n\n### INFORMATIONAL\n\nNotes.\n", "critical", "Multi-source auto-review @ abcdef0\n\n"],
	["explicit none plus another finding", "### CRITICAL\n\nNone.\n\n### CRITICAL\n\n- A finding.\n", "critical", "Multi-source auto-review @ abcdef0\n\n"],
	["informational table", "### INFORMATIONAL\n\n| Finding | Reason |\n| file.txt | still open |\n", "clean"],
	["real critical section", "### CRITICAL\n\n- A critical finding in file.txt.\n\n### INFORMATIONAL\n\nNotes.\n", "critical"],
	["real critical after none", "### CRITICAL\n\nNone.\n\n### CRITICAL\n\n- A finding.\n", "critical"],
	["none with extra text", "### CRITICAL\n\nNone. A finding remains.\n", "critical"],
	["none followed by a finding", "### CRITICAL\n\nNone.\n\n- A finding.\n", "critical"],
	["summary persistence", "Prior CRITICALs are still present.\n\n### INFORMATIONAL\n\nNotes.\n", "critical"],
	["persistence after informational section", "### INFORMATIONAL\n\nNotes.\n\n### Summary\n\nThe findings remain open.\n", "critical"],
	["nested subsection stays informational", "### INFORMATIONAL\n\n#### Details\n\nThe item is still open.\n", "clean"],
];

let failed = 0;
for (const [label, body, expected, heading = prefix] of cases) {
	const result = spawnSync("bash", ["-c", 'source "$AUTO_REVIEW"; jq -r --arg auto "$AUTO" "$AUTO_JQ"'], {
		input: JSON.stringify({ body: heading + body }),
		encoding: "utf8",
		env: { ...process.env, AUTO_REVIEW: script },
	});
	try {
		strictEqual(result.status, 0, result.stderr);
		strictEqual(result.stdout, `verdict=${expected}\ncommit=abcdef0\n`);
		console.log(`PASS ${label}`);
	} catch (error) {
		failed++;
		console.error(`FAIL ${label}: ${error.message}`);
	}
}
console.log(failed ? `${failed} failed` : "all green");
process.exitCode = failed ? 1 : 0;
