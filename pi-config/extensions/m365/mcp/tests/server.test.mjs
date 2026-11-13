/**
 * The MCP server over an in-memory transport: the tool listing, a call round trip, argument validation, the sign-in
 * hint, image content, and the channel's push path (inbox card and the test-only local source).
 *
 *   bun mcp/tests/server.test.mjs
 *
 * Offline: the inbox and the token cache are temp directories, and fetch throws.
 */
import { deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const { startChannel } = await import("../channel.ts");
const { listOwners } = await import("../../teams/watch.ts");
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

async function connect(channel, clientName) {
	const server = createServer({ channel });
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: clientName, version: "0" });
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

// ── Tools ───────────────────────────────────────────────────────────────────
{
	const { client, server } = await connect(false, "test");
	const { tools } = await client.listTools();
	const names = tools.map((t) => t.name);
	check("lists every teams_* tool", () =>
		deepStrictEqual(names.filter((n) => n.startsWith("teams_")).sort(), ["teams_chats", "teams_download", "teams_people", "teams_read", "teams_send", "teams_transcript", "teams_unread", "teams_watch"]),
	);
	check("lists ten outlook_* tools", () => deepStrictEqual(names.filter((n) => n.startsWith("outlook_")).length, 10));
	check("lists the inbox tools", () =>
		deepStrictEqual(names.filter((n) => n.startsWith("inbox_")).sort(), ["inbox_ask", "inbox_done", "inbox_fact", "inbox_facts", "inbox_ls", "inbox_set"]),
	);
	check("every tool has an object input schema", () => deepStrictEqual(tools.filter((t) => t.inputSchema?.type !== "object").map((t) => t.name), []));
	check("no channel capability without M365_CHANNEL", () => deepStrictEqual(client.getServerCapabilities()?.experimental, undefined));

	// A round trip through the inbox CLI: ask records a row, ls lists it, done archives it.
	const ask = await client.callTool({ name: "inbox_ask", arguments: { text: "Ship it?", key: "t1" } });
	check("inbox_ask records a row", () => deepStrictEqual([ask.isError ?? false, ask.content[0].text], [false, "notify 1 ask-wayne"]));
	const ls = await client.callTool({ name: "inbox_ls", arguments: { state: ["open"] } });
	check("inbox_ls lists it", () => deepStrictEqual(ls.content[0].text.split("\n")[1].split("\t").slice(0, 3), ["1", "ask-wayne:t1", "Ship it?"]));
	const done = await client.callTool({ name: "inbox_done", arguments: { ids: ["1"], note: "test" } });
	check("inbox_done archives it", () => deepStrictEqual(done.isError ?? false, false));

	const bad = await client.callTool({ name: "inbox_set", arguments: { ids: [] } });
	check("arguments are validated against the schema", () => deepStrictEqual([bad.isError, /invalid arguments for inbox_set: \/ids/.test(bad.content[0].text)], [true, true]));

	const unknown = await client.callTool({ name: "nope", arguments: {} });
	check("an unknown tool is an error", () => deepStrictEqual(unknown.isError, true));

	// No token cache in this HOME: the hint names omp, where the sign-in lives.
	const mail = await client.callTool({ name: "outlook_folders", arguments: {} });
	check("signed out: the error says to run /teams init in omp", () => deepStrictEqual([mail.isError, /run \/teams init in omp/.test(mail.content[0].text)], [true, true]));
	check("requireLogin fails loudly without a token cache", () => {
		let message = "";
		try {
			requireLogin();
		} catch (e) {
			message = e.message;
		}
		deepStrictEqual(/not signed in.*run \/teams init in omp/.test(message), true);
	});

	const watch = await client.callTool({ name: "teams_watch", arguments: { action: "start", chat_id: "48:notes" } });
	check("teams_watch start is refused without a channel", () => deepStrictEqual([watch.isError, /needs the Claude Code channel/.test(watch.content[0].text)], [true, true]));
	await server.close();
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

// ── Channel claims: opt-in only ─────────────────────────────────────────────
{
	// The saved list holds the self-chat and another chat; omp may be restarting and about to resume both.
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "rules.yaml"), "teams_watch:\n  chats:\n    - { chat: self-chat, chat_id: '48:notes', policy: '' }\n    - { chat: Team, chat_id: '19:team@thread.v2', policy: reply }\n");
	const run = async (env) => {
		const keys = ["M365_CHANNEL_WATCHES", "M365_CHANNEL_SELF", "M365_CHANNEL_INBOX"];
		for (const k of keys) delete process.env[k];
		Object.assign(process.env, env);
		const started = [];
		const teams = { startWatch: async (_ctx, chatId) => (started.push(chatId), `Watching ${chatId}`), setWatchInterval: () => "", stopAllWatches: () => {} };
		const stop = startChannel({ teams, context: {}, push: async () => {} });
		await new Promise((r) => setTimeout(r, 300));
		const inboxClaimed = (await listOwners()).some((o) => o.chatId === LEASE_ID);
		stop();
		for (const k of keys) delete process.env[k];
		await new Promise((r) => setTimeout(r, 100));
		return { started, inboxClaimed };
	};
	const none = await run({});
	check("by default the channel resumes no saved watch and leaves the inbox lease alone", () => deepStrictEqual(none, { started: [], inboxClaimed: false }));
	const watches = await run({ M365_CHANNEL_WATCHES: "1" });
	check("M365_CHANNEL_WATCHES=1 resumes the saved chats but never the self-chat", () => deepStrictEqual(watches, { started: ["19:team@thread.v2"], inboxClaimed: false }));
	const self = await run({ M365_CHANNEL_WATCHES: "1", M365_CHANNEL_SELF: "1" });
	check("M365_CHANNEL_SELF=1 also takes the self-chat", () => deepStrictEqual(self.started.sort(), ["19:team@thread.v2", "48:notes"]));
	const inbox = await run({ M365_CHANNEL_INBOX: "1" });
	check("M365_CHANNEL_INBOX=1 takes the inbox lease, and only that", () => deepStrictEqual(inbox, { started: [], inboxClaimed: true }));
}

// ── Channel ─────────────────────────────────────────────────────────────────
{
	// No saved watches; the inbox is opted in and its lease is free (this temp directory's), so its cards are pushed.
	writeFileSync(join(process.env.WAYNE_INBOX_DIR, "rules.yaml"), "teams_watch:\n  chats: []\n");
	process.env.M365_CHANNEL_INBOX = "1";
	const local = join(tmp, "local-events");
	process.env.M365_CHANNEL_LOCAL = local;
	const other = await connect(true, "codex");
	check("channel capability is declared", () => deepStrictEqual(other.client.getServerCapabilities()?.experimental, { "claude/channel": {} }));
	await other.server.close();

	const { client, server, events } = await connect(true, "claude-code");
	await until(() => events.some((e) => e.params?.content?.startsWith("Inbox cards:")));
	await client.callTool({ name: "inbox_ask", arguments: { text: "Pushed?", key: "t2" } });
	await until(() => events.some((e) => e.params?.meta?.kind === "inbox"));
	appendFileSync(local, "hello from the test\n");
	await until(() => events.some((e) => e.params?.meta?.kind === "local"));
	const inbox = events.find((e) => e.params?.meta?.kind === "inbox");
	check("a new notify row is pushed as notifications/claude/channel", () =>
		deepStrictEqual([inbox?.method, /Pushed\?/.test(inbox?.params.content ?? ""), inbox?.params.meta.sender], ["notifications/claude/channel", true, "inbox"]),
	);
	const localEvent = events.find((e) => e.params?.meta?.kind === "local");
	check("the local source pushes each appended line", () => deepStrictEqual(localEvent?.params.content, "hello from the test"));
	check("meta keys are identifiers only", () =>
		deepStrictEqual(events.flatMap((e) => Object.keys(e.params?.meta ?? {})).filter((k) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)), []),
	);
	check("the instructions say how to reply and carry the untrusted rule", () => {
		const text = client.getInstructions() ?? "";
		deepStrictEqual([/teams_send/.test(text), /UNTRUSTED/.test(text)], [true, true]);
	});
	await server.close();
	delete process.env.M365_CHANNEL_INBOX;
}

// ── Inbox cursor: advanced only after the push is delivered ─────────────────
{
	process.env.M365_CHANNEL_INBOX = "1";
	// bun's execFileSync does not pass process.env changes on to the child without an explicit env.
	const ask = (text, key) => execFileSync(LAUNCHER, ["ask", text, "--key", key], { env: process.env });
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
	const teams = { startWatch: async () => "", setWatchInterval: () => "", stopAllWatches: () => {} };
	ask("Lost?", "t3");
	const stop = startChannel({ teams, context: {}, push });
	await until(() => !fail);
	await new Promise((r) => setTimeout(r, 200));
	check("a push that rejects leaves the cursor unchanged", () => deepStrictEqual(readCursor(), before));
	ask("And this?", "t4");
	await until(() => cards.length > 0);
	check("the next scan delivers the rows again", () => deepStrictEqual([/Lost\?/.test(cards[0] ?? ""), /And this\?/.test(cards[0] ?? "")], [true, true]));
	stop();
	delete process.env.M365_CHANNEL_INBOX;
}

// ── Shutdown: nothing is claimed, pushed or written after stop ───────────────
{
	process.env.M365_CHANNEL_INBOX = "1";
	const ask = (text, key) => execFileSync(LAUNCHER, ["ask", text, "--key", key], { env: process.env });
	const inboxOwned = async () => (await listOwners()).some((o) => o.chatId === LEASE_ID);
	const teams = { startWatch: async () => "", setWatchInterval: () => "", stopAllWatches: () => {} };
	ask("After stop?", "t5");

	// Stopped while an inbox push is outstanding: a successor moves the cursor, then the old push succeeds.
	const { promise: sent, resolve: deliver } = Promise.withResolvers();
	let pending = false;
	const stop = startChannel({
		teams,
		context: {},
		push: async (event) => {
			if (event.kind !== "inbox") return;
			pending = true;
			await sent;
		},
	});
	await until(() => pending);
	stop();
	const successor = (readCursor() ?? 0) + 100;
	writeCursor(successor);
	deliver();
	await new Promise((r) => setTimeout(r, 300));
	check("a push that completes after stop does not move the successor's cursor", () => deepStrictEqual([pending, readCursor()], [true, successor]));

	// Stopped before the inbox lease was claimed: the claim must not happen later and leak.
	const late = [];
	const stopEarly = startChannel({ teams, context: {}, push: async (event) => void late.push(event.kind) });
	stopEarly();
	await new Promise((r) => setTimeout(r, 500));
	const leaked = await inboxOwned();
	check("a channel stopped while starting takes no inbox lease and pushes nothing", () => deepStrictEqual([leaked, late], [false, []]));

	delete process.env.M365_CHANNEL_INBOX;
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
