/**
 * The MCP server over an in-memory transport: the tool listing, a call round trip, argument validation, the sign-in
 * hint, image content, and the channel: who gets pushes, the saved watches it resumes or skips, and inbox cards.
 *
 *   unshare -rn bun mcp/tests/server.test.mjs
 *
 * Offline: the inbox and the token cache are temp directories, and fetch throws. Watch locks are abstract sockets,
 * per network namespace, so tests/run.mjs runs this under `unshare -rn`: a live session's locks are not in its way.
 */
import { deepStrictEqual } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "m365-mcp-test-"));
process.env.WAYNE_INBOX_DIR = join(tmp, "inbox");
process.env.XDG_CACHE_HOME = join(tmp, "cache");
process.env.HOME = tmp;
globalThis.fetch = async (url) => {
	throw new Error(`a test reached the network: ${url}`);
};

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createServer, mcpContent, requireLogin } = await import("../server.ts");
const { factArgv } = await import("../inbox.ts");
const { agentFooterText } = await import("../../teams/card.ts");
const { startChannel } = await import("../channel.ts");
const { claim, listOwners } = await import("../../teams/watch.ts");
const { LEASE_ID, LAUNCHER, readCursor, writeCursor } = await import("../../inbox/delivery.ts");
const { execFileSync } = await import("node:child_process");

let failed = 0;
const check = (label, fn) => {
	try {
		fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}: ${e.message}`);
	}
};

async function connect(clientName, capabilities = {}) {
	const server = createServer();
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: clientName, version: "0" }, { capabilities });
	const events = [];
	client.fallbackNotificationHandler = async (n) => void events.push(n);
	await server.connect(a);
	await client.connect(b);
	return { server, client, events };
}

const until = async (pred, ms = 5000) => {
	const end = Date.now() + ms;
	while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rules = (chats) =>
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "rules.yaml"), `teams_watch:\n  chats:\n${chats.map((c) => `    - { chat: '${c.chat}', chat_id: '${c.id}', policy: '' }\n`).join("") || "    []\n"}`);
/** Another session's lock on `chatId`: a lease held in this process under a pid that is not ours. */
const holdAs = async (chatId, pid) => {
	const claimed = await claim({ chatId, label: chatId, pid, sessionId: `other-${pid}`, cwd: "/elsewhere", since: new Date().toISOString() });
	if (!("lease" in claimed)) throw new Error(`could not hold ${chatId}`);
	return claimed.lease;
};
const ownerOf = async (chatId) => (await listOwners()).find((o) => o.chatId === chatId);
const ask = (text, key) => execFileSync(LAUNCHER, ["ask", text, "--key", key], { env: process.env });
const text = (r) => (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
mkdirSync(process.env.WAYNE_INBOX_DIR, { recursive: true });
rules([]);

// ── Tools ───────────────────────────────────────────────────────────────────
{
	const { client, server } = await connect("test");
	const { tools } = await client.listTools();
	const names = tools.map((t) => t.name);
	check("lists every teams_* tool", () =>
		deepStrictEqual(names.filter((n) => n.startsWith("teams_")).sort(), ["teams_chats", "teams_download", "teams_people", "teams_react", "teams_read", "teams_send", "teams_transcript", "teams_unread", "teams_watch"]),
	);
	const props = (name) => Object.keys(tools.find((t) => t.name === name).inputSchema.properties);
	check("teams_send takes files, teams_react a chat, message and reaction", () =>
		deepStrictEqual([props("teams_send").includes("files"), props("teams_react")], [true, ["chat_id", "message_id", "reaction", "remove"]]),
	);
	check("lists ten outlook_* tools", () => deepStrictEqual(names.filter((n) => n.startsWith("outlook_")).length, 10));
	check("lists the inbox tools", () =>
		deepStrictEqual(names.filter((n) => n.startsWith("inbox_")).sort(), ["inbox_ask", "inbox_done", "inbox_fact", "inbox_fact_drop", "inbox_facts", "inbox_ls", "inbox_set", "inbox_watch"]),
	);
	check("every tool has an object input schema", () => deepStrictEqual(tools.filter((t) => t.inputSchema?.type !== "object").map((t) => t.name), []));
	check("claude/channel is always declared", () => deepStrictEqual(client.getServerCapabilities()?.experimental, { "claude/channel": {} }));
	check("the footer names the client from initialize", () => deepStrictEqual(agentFooterText(), "sent by test agent"));
	const fact = tools.find((t) => t.name === "inbox_fact");
	check("inbox_fact offers the fact kinds", () => deepStrictEqual(fact.inputSchema.properties.kind.anyOf.map((k) => k.const), ["endpoint", "cred", "decision", "owed", "info"]));
	check("inbox_fact requires a kind, as `inbox fact` does", () => deepStrictEqual([fact.inputSchema.required.includes("kind"), "link" in fact.inputSchema.properties], [true, false]));
	check("inbox_fact passes --kind", () =>
		deepStrictEqual(factArgv({ text: "Deploys need a ticket", key: "f1", kind: "decision" }), ["fact", "--key", "f1", "--kind", "decision", "--", "Deploys need a ticket"]),
	);
	const read = tools.find((t) => t.name === "teams_read");
	const chats = tools.find((t) => t.name === "teams_chats");
	check("teams_read takes a since/until window and teams_chats active_since over MCP", () =>
		deepStrictEqual(["since" in read.inputSchema.properties, "until" in read.inputSchema.properties, "active_since" in chats.inputSchema.properties], [true, true, true]),
	);

	// A fact round trip through the inbox CLI: inbox_fact writes facts.md, inbox_facts lists it.
	const put = await client.callTool({ name: "inbox_fact", arguments: { text: "Deploys need a ticket", key: "deploy-ticket", kind: "decision", note: "test" } });
	const listed = await client.callTool({ name: "inbox_facts", arguments: { grep: "deploy-ticket" } });
	check("inbox_fact records a fact inbox_facts lists", () =>
		deepStrictEqual([put.isError ?? false, text(listed).includes("## [decision:deploy-ticket]"), text(listed).includes("Deploys need a ticket")], [false, true, true]),
	);
	const dashed = await client.callTool({ name: "inbox_fact", arguments: { text: "--help is what the CLI prints", key: "dash-text", kind: "info" } });
	const dashedList = await client.callTool({ name: "inbox_facts", arguments: { grep: "dash-text" } });
	check("inbox_fact stores text that starts with --", () => deepStrictEqual([dashed.isError ?? false, text(dashedList).includes("--help is what the CLI prints")], [false, true]));
	const dropped = await client.callTool({ name: "inbox_fact_drop", arguments: { key: "dash-text" } });
	const afterDrop = await client.callTool({ name: "inbox_facts", arguments: { grep: "dash-text" } });
	check("inbox_fact_drop removes a fact, as inbox fact-drop does", () => deepStrictEqual([dropped.isError ?? false, text(dropped), text(afterDrop).includes("dash-text")], [false, "dropped info:dash-text", false]));

	// A round trip through the inbox CLI: ask records a row, ls lists it, done archives it.
	const asked = await client.callTool({ name: "inbox_ask", arguments: { text: "Ship it?", key: "t1" } });
	check("inbox_ask records a row", () => deepStrictEqual([asked.isError ?? false, text(asked)], [false, "notify 1 ask-wayne"]));
	const ls = await client.callTool({ name: "inbox_ls", arguments: { state: ["open"] } });
	check("inbox_ls lists it", () => deepStrictEqual(text(ls).split("\n")[1].split("\t").slice(0, 3), ["1", "ask-wayne:t1", "Ship it?"]));
	const done = await client.callTool({ name: "inbox_done", arguments: { ids: ["1"], note: "test" } });
	check("inbox_done archives it", () => deepStrictEqual(done.isError ?? false, false));

	const bad = await client.callTool({ name: "inbox_set", arguments: { ids: [] } });
	check("arguments are validated against the schema", () => deepStrictEqual([bad.isError, /invalid arguments for inbox_set: \/ids/.test(text(bad))], [true, true]));

	const unknown = await client.callTool({ name: "nope", arguments: {} });
	check("an unknown tool is an error", () => deepStrictEqual(unknown.isError, true));

	// No token cache in this HOME: the hint names omp, where the sign-in lives.
	const mail = await client.callTool({ name: "outlook_folders", arguments: {} });
	check("signed out: the error says to run /teams init in omp", () => deepStrictEqual([mail.isError, /run \/teams init in omp/.test(text(mail))], [true, true]));
	check("requireLogin fails loudly without a token cache", () => {
		let message = "";
		try {
			requireLogin();
		} catch (e) {
			message = e.message;
		}
		deepStrictEqual(/not signed in.*run \/teams init in omp/.test(message), true);
	});

	// "test" names no push support and advertises none: its watch cards and inbox cards would go nowhere.
	const watch = await client.callTool({ name: "teams_watch", arguments: { action: "start", chat_id: "48:notes" } });
	const inbox = await client.callTool({ name: "inbox_watch", arguments: { action: "start" } });
	check("a client that cannot take pushes is refused teams_watch start and inbox_watch start", () =>
		deepStrictEqual([watch.isError, /cannot receive pushed events/.test(text(watch)), inbox.isError, /cannot receive pushed events/.test(text(inbox))], [true, true, true, true]),
	);
	const unclaimed = await ownerOf(LEASE_ID);
	check("and nothing was claimed for it", () => deepStrictEqual(unclaimed, undefined));
	await server.close();
}

// ── No environment variables ────────────────────────────────────────────────
{
	const root = dirname(dirname(new URL(import.meta.url).pathname));
	const files = ["server.ts", "channel.ts", "inbox.ts"].map((f) => join(root, f)).concat(join(dirname(root), "README.md"));
	check("no M365_ environment variable is read or documented", () => deepStrictEqual(files.filter((f) => /M365_/.test(readFileSync(f, "utf8"))), []));
}

// ── Images ──────────────────────────────────────────────────────────────────
{
	const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
	const kept = mcpContent([{ type: "text", text: "[image 1 saved: /tmp/x.png]" }, { type: "image", data: png, mimeType: "image/png" }]);
	check("an image with its own saved path is passed through", () => deepStrictEqual(kept.map((c) => c.type), ["text", "image"]));
	const saved = mcpContent([{ type: "text", text: "[photo.png]" }, { type: "image", data: png, mimeType: "image/png" }]);
	const path = /\[image saved: (.+)\]/.exec(saved[1]?.text ?? "")?.[1];
	check("an image without a file is saved and named by its path", () => deepStrictEqual([saved.map((c) => c.type), !!path && existsSync(path)], [["text", "text", "image"], true]));
}

// ── Saved watches: nothing at start; teams_watch start with no chat resumes them, a held chat skipped, never taken ──
{
	rules([
		{ chat: "self-chat", id: "48:notes" },
		{ chat: "Team", id: "19:team@thread.v2" },
		{ chat: "Busy", id: "19:busy@thread.v2" },
	]);
	const busy = await holdAs("19:busy@thread.v2", 999991);
	const started = [];
	const teams = { startWatch: async (_ctx, chatId) => (started.push(chatId), `Watching ${chatId}`), setWatchInterval: () => "", stopAllWatches: () => {} };
	const pushed = [];
	const channel = startChannel({ teams, context: {}, push: async (e) => void pushed.push(e.kind) });
	await sleep(300);
	const leaseAtStart = await ownerOf(LEASE_ID);
	check("a started channel claims nothing: no watch, no inbox lease, no event", () => deepStrictEqual([started, leaseAtStart, pushed], [[], undefined, []]));
	const summary = await channel.resume();
	check("resume starts the saved chats, the self-chat included", () => deepStrictEqual(started.sort(), ["19:team@thread.v2", "48:notes"]));
	check("a chat another session holds is skipped and named with its holder", () =>
		deepStrictEqual([channel.held.map((h) => [h.chatId, h.owner.pid]), /Skipped "Busy": held by pid 999991/.test(summary)], [[["19:busy@thread.v2", 999991]], true]),
	);
	const still = (await ownerOf("19:busy@thread.v2"))?.pid;
	const inboxFree = (await ownerOf(LEASE_ID)) === undefined;
	check("its lock stays with its holder, and a resume takes no inbox lease", () => deepStrictEqual([still, inboxFree], [999991, true]));
	channel.stop();

	// Through the server: a Claude Code client claims nothing on connect; teams_watch start {} resumes, list names the held chat.
	rules([{ chat: "Busy", id: "19:busy@thread.v2" }]);
	const { client, server, events } = await connect("claude-code");
	await sleep(300);
	const owners = (await listOwners()).filter((o) => o.pid === process.pid);
	check("a Claude Code client connecting claims nothing and gets no event", () => deepStrictEqual([owners, events.filter((e) => e.method === "notifications/claude/channel")], [[], []]));
	const resumed = await client.callTool({ name: "teams_watch", arguments: { action: "start" } });
	const list = await client.callTool({ name: "teams_watch", arguments: { action: "list" } });
	check("teams_watch start with no chat resumes the saved list, and list shows the held chat by pid", () =>
		deepStrictEqual([resumed.isError ?? false, /Skipped "Busy"/.test(text(resumed)), /Busy.*held by pid 999991/s.test(text(list))], [false, true, true]),
	);
	const { tools } = await client.listTools();
	check("teams_watch and inbox_watch say they work only in an interactive dev-channel session", () =>
		deepStrictEqual(
			["teams_watch", "inbox_watch"].map((n) => /--dangerously-load-development-channels server:m365/.test(tools.find((t) => t.name === n).description)),
			[true, true],
		),
	);
	await server.close();
	busy.close();
	rules([]);
}

// ── Who gets pushes: a client that advertises claude/channel, or Claude Code by name ─────────────────────────────
{
	const advertised = await connect("some-client", { experimental: { "claude/channel": {} } });
	const started = await advertised.client.callTool({ name: "inbox_watch", arguments: { action: "start" } });
	check("a client advertising claude/channel can start inbox_watch", () => deepStrictEqual([started.isError ?? false, /pushed here/.test(text(started))], [false, true]));
	await advertised.server.close();
	await sleep(100);
}

// ── Inbox: inbox_watch takes the lease only when it is free ────────────────────────────────────────────────────
{
	const other = await holdAs(LEASE_ID, 999992);
	const { client, server } = await connect("claude-code");
	const refused = await client.callTool({ name: "inbox_watch", arguments: { action: "start" } });
	const status = await client.callTool({ name: "inbox_watch", arguments: { action: "status" } });
	const owner = await ownerOf(LEASE_ID);
	check("inbox_watch start says who holds the inbox and does not take it", () =>
		deepStrictEqual([refused.isError, /already delivered to another session \(pid 999992/.test(text(refused)), owner?.pid], [true, true, 999992]),
	);
	check("inbox_watch status names the holder", () => deepStrictEqual(/held by pid 999992/.test(text(status)), true));
	await server.close();
	other.close();
	await sleep(100);
}

// ── Channel push: inbox cards once inbox_watch started ──────────────────────────────────────────────────────────
{
	const { client, server, events } = await connect("claude-code");
	check("nothing is pushed before inbox_watch start", () => deepStrictEqual(events.filter((e) => e.method === "notifications/claude/channel"), []));
	const started = await client.callTool({ name: "inbox_watch", arguments: { action: "start" } });
	const takenBy = (await ownerOf(LEASE_ID))?.pid;
	check("inbox_watch start takes the free lease", () => deepStrictEqual([started.isError ?? false, takenBy], [false, process.pid]));
	await client.callTool({ name: "inbox_ask", arguments: { text: "Pushed?", key: "t2" } });
	await until(() => events.some((e) => e.params?.meta?.kind === "inbox"));
	const inbox = events.find((e) => e.params?.meta?.kind === "inbox");
	check("a new notify row is pushed as notifications/claude/channel", () =>
		deepStrictEqual([inbox?.method, /Pushed\?/.test(inbox?.params.content ?? ""), inbox?.params.meta.sender], ["notifications/claude/channel", true, "inbox"]),
	);
	check("meta keys are identifiers only", () =>
		deepStrictEqual(events.flatMap((e) => Object.keys(e.params?.meta ?? {})).filter((k) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)), []),
	);
	check("the instructions say how to reply and carry the untrusted rule", () => {
		const t = client.getInstructions() ?? "";
		deepStrictEqual([/teams_send/.test(t), /UNTRUSTED/.test(t)], [true, true]);
	});
	const stopped = await client.callTool({ name: "inbox_watch", arguments: { action: "stop" } });
	await sleep(100);
	const freed = await ownerOf(LEASE_ID);
	check("inbox_watch stop frees the lease", () => deepStrictEqual([stopped.isError ?? false, freed], [false, undefined]));
	await server.close();
	await sleep(100);
}

const fakeTeams = { startWatch: async () => "", setWatchInterval: () => "", stopAllWatches: () => {} };

// ── Inbox cursor: advanced only after the push is delivered ─────────────────
{
	const before = readCursor();
	const cards = [];
	let fail = true;
	const push = async (event) => {
		if (event.kind !== "inbox") return;
		if (fail) {
			fail = false;
			throw new Error("transport closed");
		}
		cards.push(event.content);
	};
	ask("Lost?", "t3");
	const channel = startChannel({ teams: fakeTeams, context: {}, push });
	await channel.inbox.start();
	await until(() => !fail);
	await sleep(200);
	check("a push that rejects leaves the cursor unchanged", () => deepStrictEqual(readCursor(), before));
	ask("And this?", "t4");
	await until(() => cards.length > 0);
	check("the next scan delivers the rows again", () => deepStrictEqual([/Lost\?/.test(cards[0] ?? ""), /And this\?/.test(cards[0] ?? "")], [true, true]));
	channel.stop();
	await sleep(100);
}

// ── Shutdown: nothing is claimed, pushed or written after stop ───────────────
{
	ask("After stop?", "t5");

	// Stopped while an inbox push is outstanding: a successor moves the cursor, then the old push succeeds.
	const { promise: sent, resolve: deliver } = Promise.withResolvers();
	let pending = false;
	const channel = startChannel({
		teams: fakeTeams,
		context: {},
		push: async (event) => {
			if (event.kind !== "inbox") return;
			pending = true;
			await sent;
		},
	});
	await channel.inbox.start();
	await until(() => pending);
	channel.stop();
	const successor = (readCursor() ?? 0) + 100;
	writeCursor(successor);
	deliver();
	await sleep(300);
	check("a push that completes after stop does not move the successor's cursor", () => deepStrictEqual([pending, readCursor()], [true, successor]));

	// Stopped while inbox_watch start is claiming: the claim must not land afterwards and leak.
	const late = [];
	const early = startChannel({ teams: fakeTeams, context: {}, push: async (event) => void late.push(event.kind) });
	const starting = early.inbox.start().catch((e) => e.message);
	early.stop();
	const outcome = await starting;
	await sleep(500);
	const leaked = await ownerOf(LEASE_ID);
	check("a channel stopped while inbox_watch starts takes no inbox lease and pushes nothing", () => deepStrictEqual([leaked, late, /stopped/.test(String(outcome))], [undefined, [], true]));

	// inbox_watch stop while its own start is still claiming: the claim must not land afterwards, and nothing is pushed.
	const pushedLate = [];
	const live = startChannel({ teams: fakeTeams, context: {}, push: async (event) => void pushedLate.push(event.kind) });
	const pendingStart = live.inbox.start().catch((e) => e.message);
	const stopReply = live.inbox.stop();
	const startOutcome = await pendingStart;
	await sleep(500);
	const leakedByStop = await ownerOf(LEASE_ID);
	const statusAfter = await live.inbox.status();
	check("inbox_watch stop cancels a start still claiming: no inbox lease, no push", () =>
		deepStrictEqual(
			[leakedByStop, pushedLate, /before it took the inbox/.test(stopReply), /stopped while it was starting/.test(String(startOutcome)), /Nobody watches/.test(statusAfter)],
			[undefined, [], true, true, true],
		),
	);
	live.stop();
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
