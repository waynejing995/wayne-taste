import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const groups = [
	{ label: "outlook", script: join(root, "outlook", "tests", "run.mjs"), local: false },
	{ label: "package", script: join(root, "tests", "load.test.mjs"), local: false },
	{ label: "inbox mail", script: join(root, "inbox", "tests", "mail.test.mjs"), local: false },
	{ label: "inbox card", script: join(root, "inbox", "tests", "card.test.mjs"), local: false },
	{ label: "inbox agents", script: join(root, "inbox", "tests", "agents.test.mjs"), local: false },
	{ label: "inbox schedule", script: join(root, "inbox", "tests", "schedule.test.mjs"), local: false },
	{ label: "inbox probe", script: join(root, "inbox", "tests", "probe.test.mjs"), local: false },
	{ label: "inbox probe channel", script: join(root, "inbox", "tests", "probe-channel.test.mjs"), local: false },
	{ label: "inbox auto-review", script: join(root, "inbox", "tests", "auto-review.test.mjs"), local: false },
	{ label: "pr ready", script: join(root, "tests", "pr-ready.test.mjs"), local: false },
	{ label: "inbox jobs", script: join(root, "inbox", "tests", "jobs.test.mjs"), local: false },
	{ label: "inbox thens", script: join(root, "inbox", "tests", "thens.test.mjs"), local: false },
	{ label: "inbox verdict", script: join(root, "inbox", "tests", "verdict.test.mjs"), local: false },
	{ label: "inbox facts", script: join(root, "inbox", "tests", "facts.test.mjs"), local: false },
	{ label: "inbox rules migrate", script: join(root, "inbox", "tests", "migrate.test.mjs"), local: false },
	{ label: "teams active since", script: join(root, "tests", "active-since.test.mjs"), local: false },
	{ label: "inbox tools", script: join(root, "inbox", "tests", "tools.test.mjs"), local: false },
	{ label: "rules block", script: join(root, "tests", "rules-block.test.mjs"), local: false },
	{ label: "teams watch list", script: join(root, "tests", "watch-list.test.mjs"), local: false },
	{ label: "teams watch delivery", script: join(root, "tests", "watch-delivery.test.mjs"), local: false },
	{ label: "teams cards", script: join(root, "tests", "card.test.mjs"), local: false },
	{ label: "teams app mentions", script: join(root, "tests", "app-mentions.test.mjs"), local: false },
	{ label: "teams images", script: join(root, "tests", "images.test.mjs"), local: false },
	{ label: "teams image files", script: join(root, "tests", "attachments.test.mjs"), local: false },
	{ label: "teams forwards", script: join(root, "tests", "forward.test.mjs"), local: true },
	{ label: "teams bot cards", script: join(root, "tests", "bot-cards.test.mjs"), local: true },
	{ label: "teams file sends", script: join(root, "tests", "files.test.mjs"), local: false },
	{ label: "teams reactions", script: join(root, "tests", "reactions.test.mjs"), local: true },
	// The MCP server runs under bun (Node's type stripping cannot load the Teams core), so its test does too. It takes
	// watch locks, so it gets its own network namespace like the Teams suite.
	{ label: "mcp server", script: join(root, "mcp", "tests", "server.test.mjs"), local: false, runtime: "bun", isolated: true },
	// The Teams core loads only under bun (Node's type stripping cannot load it), so this regression test does too.
	// Isolated like the MCP server: the sandboxed HOME has no Teams token and `fetch` throws, and the network
	// namespace makes sure nothing can reach Graph or the identity endpoint anyway.
	{ label: "teams core send", script: join(root, "inbox", "tests", "teams-send.test.mjs"), local: false, runtime: "bun", isolated: true },
	{ label: "teams history scan", script: join(root, "tests", "history-scan.test.mjs"), local: false },
	{ label: "teams (local-only)", script: join(root, "teams", "tests", "run.mjs"), local: true, isolated: true },
	{ label: "teams channel (bun test)", script: join(root, "tests", "channel"), runtime: "bun", args: ["test", "--preload", "./tests/channel/preload.ts", "./tests/channel"], cwd: root, local: false, isolated: true },
];

export function runGroup({ script, isolated, runtime = process.versions.bun ? "node" : process.execPath, args, cwd }) {
	// A Teams watch is claimed with an abstract socket, which is per network namespace: in the
	// host's namespace the suite collides with a live session's watch (the self-chat). `unshare
	// -rn` gives it a namespace of its own, no root needed.
	const argv = args ?? [script];
	const [cmd, cmdArgs] = isolated ? ["unshare", ["-rn", runtime, ...argv]] : [runtime, argv];
	const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", cwd: cwd ?? dirname(dirname(script)), env: process.env });
	if (r.error) throw r.error;
	return r;
}
