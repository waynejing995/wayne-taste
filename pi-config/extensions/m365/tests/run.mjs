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
	{ label: "inbox mail", script: join(root, "inbox", "tests", "mail.test.mjs"), local: false },
	{ label: "inbox card", script: join(root, "inbox", "tests", "card.test.mjs"), local: false },
	{ label: "inbox agents", script: join(root, "inbox", "tests", "agents.test.mjs"), local: false },
	{ label: "inbox schedule", script: join(root, "inbox", "tests", "schedule.test.mjs"), local: false },
	{ label: "inbox probe", script: join(root, "inbox", "tests", "probe.test.mjs"), local: false },
	{ label: "pr ready", script: join(root, "tests", "pr-ready.test.mjs"), local: false },
	{ label: "inbox jobs", script: join(root, "inbox", "tests", "jobs.test.mjs"), local: false },
	{ label: "inbox thens", script: join(root, "inbox", "tests", "thens.test.mjs"), local: false },
	{ label: "rules block", script: join(root, "tests", "rules-block.test.mjs"), local: false },
	{ label: "teams watch list", script: join(root, "tests", "watch-list.test.mjs"), local: false },
	{ label: "teams watch delivery", script: join(root, "tests", "watch-delivery.test.mjs"), local: false },
	{ label: "teams cards", script: join(root, "tests", "card.test.mjs"), local: false },
	{ label: "teams images", script: join(root, "tests", "images.test.mjs"), local: false },
	{ label: "teams image files", script: join(root, "tests", "attachments.test.mjs"), local: false },
	{ label: "teams forwards", script: join(root, "tests", "forward.test.mjs"), local: true },
	{ label: "teams bot cards", script: join(root, "tests", "bot-cards.test.mjs"), local: true },
	{ label: "teams file sends", script: join(root, "tests", "files.test.mjs"), local: false },
	{ label: "teams reactions", script: join(root, "tests", "reactions.test.mjs"), local: true },
	// The MCP server runs under bun (Node's type stripping cannot load the Teams core), so its test does too.
	{ label: "mcp server", script: join(root, "mcp", "tests", "server.test.mjs"), local: false, runtime: "bun" },
	{ label: "teams (local-only)", script: join(root, "teams", "tests", "run.mjs"), local: true, isolated: true },
];
let failed = 0;
for (const { label, script, local, isolated, runtime = process.execPath } of groups) {
	if (local && !existsSync(script)) {
		console.log(`SKIP  ${label}: not in this checkout`);
		continue;
	}
	// A Teams watch is claimed with an abstract socket, which is per network namespace: in the
	// host's namespace the suite collides with a live session's watch (the self-chat). `unshare
	// -rn` gives it a namespace of its own, no root needed.
	const [cmd, args] = isolated ? ["unshare", ["-rn", runtime, script]] : [runtime, [script]];
	const r = spawnSync(cmd, args, { encoding: "utf8", cwd: dirname(dirname(script)) });
	if (r.error) throw r.error;
	const ok = r.status === 0;
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (!ok) console.log(`${r.stdout}${r.stderr}`);
}
console.log(failed === 0 ? "\nall green" : `\n${failed} group(s) failed`);
process.exit(failed === 0 ? 0 : 1);
