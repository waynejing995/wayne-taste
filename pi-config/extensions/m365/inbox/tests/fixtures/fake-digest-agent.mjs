#!/usr/bin/env node
/**
 * Stands in for `omp -p --mode json` running the teams-digest prompt. It follows only what the prompt it is given
 * says, so a test passes only when the real prompt carries the real contract:
 * - the boundary is the time after "`active_since`" in the prompt; no such time, no teams_chats call;
 * - it reads the self-chat and the chats its teams_chats call lists, each with that `since`;
 * - it records one fact through the real `inbox fact` command;
 * - its last line is the receipt the prompt's "for example {...}" shows, filled in; a prompt without one gets the
 *   prompt's own last instruction instead.
 * Outside `--mode json` it prints plain text, as omp does. FAKE_DIGEST_MODE: ok, readfail (Ops cannot be read),
 * lie (never reads Ops, claims complete), exit (exits 1), factfail (the inbox fact command fails).
 */
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const prompt = argv.at(-1);
const mode = process.env.FAKE_DIGEST_MODE ?? "ok";
if (mode === "exit") {
	process.stderr.write("boom: no teams token\n");
	process.exit(1);
}
const json = argv.includes("--mode") && argv[argv.indexOf("--mode") + 1] === "json";
const since = /`active_since` (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(prompt)?.[1];
const events = [];
let n = 0;
function call(toolName, args, text, isError = false) {
	const toolCallId = `call-${++n}`;
	events.push({ type: "tool_execution_start", toolCallId, toolName, args });
	events.push({ type: "tool_execution_end", toolCallId, toolName, result: { content: [{ type: "text", text }] }, ...(isError ? { isError } : {}) });
}
const failed = [];
let findings = 0;
if (since) {
	call("teams_chats", { active_since: since }, "2 chat(s)\n- Ops  [group]  id: 19:ops@thread.v2\n- Lin  [oneOnOne]  id: 19:lin@unq.gbl.spaces");
	call("teams_read", { target: "self", since, images: false }, "(no messages)");
	if (mode === "readfail") {
		call("teams_read", { chat_id: "19:ops@thread.v2", since, images: false }, "Graph 503 Service Unavailable", true);
		failed.push({ chat: "Ops", reason: "Graph 503" });
	} else if (mode !== "lie") call("teams_read", { chat_id: "19:ops@thread.v2", since, images: false }, "[11-10 11:00] lin: build server is build.example.com");
	call("teams_read", { chat_id: "19:lin@unq.gbl.spaces", since, images: false }, "(no messages)");
	const args = ["fact", "--kind", "endpoint", "--key", "build-server", "--source", "teams-digest", "--note", "Ops, lin, 11-10 11:00", "--", "The build server is build.example.com."];
	if (mode === "factfail") args[2] = "bogus";
	const command = `inbox ${args.map((a) => (/^[\w.,:-]+$/.test(a) ? a : `'${a}'`)).join(" ")}`;
	try {
		call("bash", { command }, execFileSync("inbox", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
		findings++;
	} catch (e) {
		call("bash", { command }, String(e.stderr || e.message), true);
		failed.push({ chat: "Ops", reason: "inbox fact failed" });
	}
}
const example = /for example (\{.*\})/.exec(prompt)?.[1];
let last;
if (example) {
	const receipt = JSON.parse(example);
	if ("complete" in receipt) receipt.complete = failed.length === 0;
	if ("chats" in receipt) receipt.chats = since ? 3 : 0;
	if ("findings" in receipt) receipt.findings = findings;
	if ("failed" in receipt) receipt.failed = failed;
	last = JSON.stringify(receipt);
} else last = prompt.trim().split("\n").at(-1);
const text = `teams digest: ${findings} findings since ${since}\n${last}`;
if (!json) {
	console.log(text);
	process.exit(0);
}
events.push({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
events.push({ type: "agent_end" });
for (const e of events) console.log(JSON.stringify(e));
