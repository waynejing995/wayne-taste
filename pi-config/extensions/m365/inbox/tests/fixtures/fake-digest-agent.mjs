#!/usr/bin/env node
/**
 * Stands in for `omp -p --mode json` running the teams-digest prompt. It follows only what the prompt it is given
 * says, so a test passes only when the real prompt carries the real contract:
 * - the window is the times after "`active_since`" and "`until`" in the prompt; no start, no teams_chats call;
 * - it reads the self-chat and the chats its teams_chats call lists, each with that `since` and `until`;
 * - it records one fact through the real `inbox fact` command;
 * - its last line is the receipt the prompt's "for example {...}" shows, filled in; a prompt without one gets the
 *   prompt's own last instruction instead.
 * Outside `--mode json` it prints plain text, as omp does. FAKE_DIGEST_MODE: ok, readfail (Ops cannot be read),
 * lie (never reads Ops, claims complete), exit (exits 1), factfail (the inbox fact command fails), shortwindow (Ops
 * is read only to a minute after the start), elided (omp elides lines 41-960 of the self-chat read; the agent reads
 * them from the artifact only if the prompt says how), elidedskip (the same, and it never reads them).
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
const until = /`until` (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(prompt)?.[1];
const window = until ? { since, until } : { since };
const events = [];
let n = 0;
function call(toolName, args, text, isError = false, details) {
	const toolCallId = `call-${++n}`;
	events.push({ type: "tool_execution_start", toolCallId, toolName, args });
	events.push({ type: "tool_execution_end", toolCallId, toolName, result: { content: [{ type: "text", text }], ...(details ? { details } : {}) }, ...(isError ? { isError } : {}) });
}
const failed = [];
let findings = 0;
if (since) {
	if (mode === "listelided" || mode === "listelidedskip") {
		const truncation = { direction: "middle", totalLines: 3, headRange: { start: 1, end: 1 }, tailRange: { start: 3, end: 3 }, elidedLines: 1, artifactId: "1" };
		call("teams_chats", { active_since: since }, "2 chat(s)\n[Showing lines 1-1 and 3-3 of 3; 1 middle lines elided. Read artifact://1 for full output]\n- Lin  [oneOnOne]  id: 19:lin@unq.gbl.spaces", false, { meta: { truncation } });
		if (mode === "listelided") call("read", { path: "artifact://1:2-2" }, "- Ops  [group]  id: 19:ops@thread.v2");
	} else call("teams_chats", { active_since: since }, "2 chat(s)\n- Ops  [group]  id: 19:ops@thread.v2\n- Lin  [oneOnOne]  id: 19:lin@unq.gbl.spaces");
	if (mode === "elided" || mode === "elidedskip") {
		const truncation = { direction: "middle", totalLines: 1000, headRange: { start: 1, end: 40 }, tailRange: { start: 961, end: 1000 }, elidedLines: 920, artifactId: "0" };
		call("teams_read", { target: "self", ...window, images: false }, "self-chat (48:notes) — 300 message(s)\n[Showing lines 1-40 and 961-1000 of 1000; 920 middle lines elided. Read artifact://0 for full output]", false, { meta: { truncation } });
		if (mode === "elided" && /`read artifact:\/\/N:A-B`/.test(prompt)) {
			call("read", { path: "artifact://0:41-600" }, "[400 more lines in resource. Use :601 to continue]");
			call("read", { path: "artifact://0:601-960" }, "[40 more lines in resource. Use :961 to continue]");
		}
	} else if (mode === "tailskip") {
		// omp kept only the tail (head cut, artifactHeadBytes=0) and the agent never reads lines 1-960.
		const truncation = { direction: "tail", totalLines: 1000, tailRange: { start: 961, end: 1000 }, artifactId: "0" };
		call("teams_read", { target: "self", ...window, images: false }, "[Showing lines 961-1000 of 1000. Read artifact://0 for full output]", false, { meta: { truncation } });
	} else call("teams_read", { target: "self", ...window, images: false }, "(no messages)");
	if (mode === "readfail") {
		call("teams_read", { chat_id: "19:ops@thread.v2", ...window, images: false }, "Graph 503 Service Unavailable", true);
		failed.push({ chat: "Ops", reason: "Graph 503" });
	} else if (mode === "shortwindow") {
		const short = new Date(new Date(since).getTime() + 60_000);
		call("teams_read", { chat_id: "19:ops@thread.v2", since, until: short.toISOString(), images: false }, "(no messages)");
	} else if (mode !== "lie") call("teams_read", { chat_id: "19:ops@thread.v2", ...window, images: false }, "[11-10 11:00] lin: build server is build.example.com");
	call("teams_read", { chat_id: "19:lin@unq.gbl.spaces", ...window, images: false }, "(no messages)");
	const args = ["fact", "--kind", "endpoint", "--key", "build-server", "--source", "teams-digest", "--note", "Ops, lin, 11-10 11:00", "--", "The build server is build.example.com."];
	const quote = (list) => `inbox ${list.map((a) => (/^[\w.,:-]+$/.test(a) ? a : `'${a}'`)).join(" ")}`;
	const write = (list, command = quote(list)) => {
		try {
			call("bash", { command }, execFileSync("inbox", list, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
			return true;
		} catch (e) {
			call("bash", { command }, String(e.stderr || e.message), true);
			return false;
		}
	};
	if (mode === "factfail" || mode === "factretry") {
		const bad = [...args];
		bad[2] = "bogus";
		if (!write(bad) && mode === "factfail") failed.push({ chat: "Ops", reason: "inbox fact failed" });
	}
	if (mode === "credreject") write(["fact", "--kind", "cred", "--key", "ops-db", "--source", "teams-digest", "--note", "Ops, lin, 11-10 11:00", "--", "password: hunter2"]);
	if (mode === "multiwrite") {
		execFileSync("inbox", args, { stdio: "ignore" });
		call("bash", { command: `${quote(args)}; inbox ask --key q1 --note 'Ops, lin, 11-10 11:00' -- 'Who owns it?'` }, "added endpoint:build-server\nnotify 9 ask-wayne");
		findings++;
	} else if (mode === "quotedmulti") {
		// The fact fails (bad kind), the quoted ask after it succeeds, so the call as a whole exits 0.
		execFileSync("inbox", ["ask", "--key", "q1", "--note", "Ops, lin, 11-10 11:00", "--", "Who owns it?"], { stdio: "ignore" });
		call("bash", { command: "inbox fact --kind bogus --key build-server --note 'Ops, lin, 11-10 11:00' -- 'The build server is build.example.com.'; inbox 'ask' --key q1 --note 'Ops, lin, 11-10 11:00' -- 'Who owns it?'" }, "--kind must be one of endpoint, cred, decision, owed, info\nnotify 9 ask-wayne");
	} else if (mode === "askmask") {
		const bad = [...args];
		bad[2] = "bogus";
		write(bad);
		if (write(["ask", "--key", "build-server", "--source", "teams-digest", "--note", "Ops, lin, 11-10 11:00", "--", "Who owns the build server?"])) findings++;
	} else if (mode === "quoteretry") {
		// A stray quote: bash refuses the line and runs nothing; the corrected retry writes the same fact.
		call("bash", { command: "inbox fact --kind endpoint --key build-server --source teams-digest --note 'Ops, lin, 11-10 11:00' -- 'Lin's build server is build.example.com.'" }, "bash: -c: line 1: unexpected EOF while looking for matching `''", true);
		if (write(args)) findings++;
	} else if (mode !== "factfail" && write(args)) findings++;
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
const text = `teams digest: ${findings} findings from ${since} to ${until}\n${last}`;
if (!json) {
	console.log(text);
	process.exit(0);
}
events.push({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
events.push({ type: "agent_end" });
for (const e of events) console.log(JSON.stringify(e));
