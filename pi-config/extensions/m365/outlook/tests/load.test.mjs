/**
 * Loading the extension registers exactly the seven outlook_* tools and the
 * outlook command, and subscribes to the session events it needs (U21).
 *
 * Offline: a fetch guard fails the run if anything reaches the network, and a
 * pi.exec stub counts any process the extension starts at load.
 *
 *   node tests/load.test.mjs
 */
import { createJiti } from "/root/.nvm/versions/node/v22.22.1/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
// Resolved paths: importing through the symlink would give a second copy of every module. See ext-path.mjs.
import { ext } from "./ext-path.mjs";

const netCalls = [];
globalThis.fetch = async (url) => {
	netCalls.push(String(url));
	throw new Error(`a test reached the network: ${url}`);
};

const D = "/root/.nvm/versions/node/v22.22.1/lib/node_modules/@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${D}/dist/index.js`,
		"@earendil-works/pi-ai": `${D}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${D}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${D}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const extension = await jiti.import(ext("index.ts"), { default: true });

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
	if (ok) {
		passed++;
		console.log(`PASS ${label}`);
	} else {
		failed++;
		console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`);
	}
};
/** Deep equality, key order ignored. */
const equal = (label, actual, expected) => {
	const same = JSON.stringify(actual) === JSON.stringify(expected);
	check(label, same, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

const tools = [];
const commands = [];
const specs = {};
const events = [];
let execCalls = 0;
await extension({
	registerTool: (t) => tools.push(t.name),
	registerCommand: (name, spec) => {
		commands.push(name);
		specs[name] = spec;
	},
	on: (name) => events.push(name),
	exec: async () => {
		execCalls++;
		return { stdout: "", stderr: "", code: 0, killed: false };
	},
	sendUserMessage: () => {},
});

console.log("== load registers the surface ==");
equal("exactly the ten tools", [...tools].sort(), [
	"outlook_download",
	"outlook_draft",
	"outlook_folders",
	"outlook_list",
	"outlook_mark",
	"outlook_move",
	"outlook_people",
	"outlook_read",
	"outlook_search",
	"outlook_send",
]);
equal("exactly the outlook command", commands, ["outlook"]);
check("subscribes to session_start and session_shutdown", events.includes("session_start") && events.includes("session_shutdown"), JSON.stringify(events));
equal("no network call at load", netCalls, []);
equal("no process started at load", execCalls, 0);

console.log("\n== /outlook opens the overlay ==");
let opened = 0;
const ctx = {
	hasUI: true,
	ui: {
		custom: () => {
			opened++;
			return new Promise(() => {}); // settles only when the user quits the overlay
		},
	},
};
// The handler is not awaited: its promise settles only when the overlay closes.
specs.outlook?.handler("", ctx)?.catch((e) => console.log(`FAIL /outlook handler (${e.message})`));
equal("one overlay opened through ctx.ui.custom", opened, 1);
equal("no network call from the command", netCalls, []);

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "all ok" : "FAIL");
process.exit(failed === 0 ? 0 : 1);
