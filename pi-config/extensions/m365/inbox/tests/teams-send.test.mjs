/**
 * The Teams core's `send` as the inbox probe's digest uses it (commit d5d1296 removed it from the object
 * `createTeams()` returns; the live `agent-probe` schedule then failed with "teams.send is not a function").
 *
 * The wiring, not a fake sender: `coreSender()` (inbox/cli/probe.ts) builds the digest's DigestSender over the
 * real `createTeams()` core, and both of its sends must reach the core's `send`. With no Teams token the core's
 * own auth error is the answer; a missing `send` member turns it into `TypeError: teams.send is not a function`.
 *
 * Offline: HOME and XDG_CACHE_HOME are temp directories holding no teams.json and no MSAL cache, `fetch`
 * throws, and tests/run.mjs runs this under `unshare -rn`, a network namespace with no route out, so nothing
 * can reach Graph or login.microsoftonline.com even if something tried.
 *
 *   unshare -rn bun inbox/tests/teams-send.test.mjs
 *
 * Runs under bun: the Teams core is TypeScript Node's type stripping cannot load.
 */
import { rejects, strictEqual } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "m365-teams-send-"));
process.env.HOME = tmp;
process.env.XDG_CACHE_HOME = join(tmp, "cache");
process.env.WAYNE_INBOX_DIR = join(tmp, "inbox");
globalThis.fetch = async (url) => {
	throw new Error(`a test reached the network: ${url}`);
};

const { createTeams } = await import("../../teams/core.ts");
const { coreSender } = await import("../cli/probe.ts");

/** The stub host the probe's own coreSender passes: no tools, nothing watched, no exec ever reached (backend is graph). */
const host = {
	registerTool: () => {},
	exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	sendMessage: () => {
		throw new Error("the probe watches no chat");
	},
	sendUserMessage: () => {
		throw new Error("the probe watches no chat");
	},
};

let failed = 0;
const check = (label, fn) =>
	fn().then(
		() => console.log(`PASS ${label}`),
		(e) => {
			failed++;
			console.log(`FAIL ${label}: ${e.message}`);
		},
	);

// createTeams exposes send: the member the inbox probe's coreSender calls.
await check("createTeams returns a send function", async () => {
	const teams = createTeams(host);
	strictEqual(typeof teams.send, "function");
});

// The probe's real wiring: coreSender over createTeams, no injected sender. Both digest sends reach the
// core's send and reject with the core's own auth error (no token in the sandboxed HOME) — never a TypeError.
await check("the probe's digest card reaches the core's send", async () => {
	const to = await coreSender();
	await rejects(async () => to.card({ title: "digest", agents: [] }), /not authenticated — run \/teams init/);
});

await check("the probe's digest text reaches the core's send", async () => {
	const to = await coreSender();
	await rejects(async () => to.text("digest"), /not authenticated — run \/teams init/);
});

await check("the probe's personal-channel privacy check reaches the core's backend", async () => {
	const to = await coreSender();
	strictEqual(typeof to.verifyPersonal, "function");
	await rejects(async () => to.verifyPersonal({ teamId: "team-1", channelId: "19:fake-channel@thread.skype" }), /not authenticated — run \/teams init/);
});

console.log(failed === 0 ? "\nall green" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
