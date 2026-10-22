/**
 * The merged package loads as pi loads it: one entry registers Teams' and Outlook's tools and
 * commands, each name once, with no network call and no process started at load.
 */
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti, PI } from "./host.mjs";

// Resolved: importing through a symlink gives a second copy of every module (see teams/tests/ext-path.mjs).
const ROOT = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
const netCalls = [];
globalThis.fetch = async (url) => {
	netCalls.push(String(url));
	throw new Error(`a test reached the network: ${url}`);
};

const D = PI;
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${D}/dist/index.js`,
		"@earendil-works/pi-ai": `${D}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${D}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${D}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const extension = await jiti.import(join(ROOT, "index.ts"), { default: true });

let failed = 0;
const check = (label, ok, detail = "") => {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail ? ` (${detail})` : ""}`);
};

const tools = [];
const commands = [];
let execCalls = 0;
await extension({
	registerTool: (t) => tools.push(t.name),
	registerCommand: (name) => commands.push(name),
	registerShortcut: () => {},
	on: () => {},
	exec: async () => {
		execCalls++;
		return { stdout: "", stderr: "", code: 0, killed: false };
	},
	sendUserMessage: () => {},
});

const teams = tools.filter((t) => t.startsWith("teams_"));
const outlook = tools.filter((t) => t.startsWith("outlook_"));
check("Teams' tools are registered", teams.includes("teams_send") && teams.includes("teams_read") && teams.includes("teams_download"), teams.join(","));
check("Outlook's tools are registered", outlook.length === 10 && outlook.includes("outlook_download"), outlook.join(","));
check("nothing else is registered", tools.length === teams.length + outlook.length, tools.join(","));
check("every tool name once", new Set(tools).size === tools.length, tools.join(","));
check("both commands, once each", JSON.stringify([...commands].sort()) === JSON.stringify(["outlook", "teams"]), commands.join(","));
check("no network call at load", netCalls.length === 0, netCalls.join(","));
check("no process started at load", execCalls === 0, String(execCalls));
console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
