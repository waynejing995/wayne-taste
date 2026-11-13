/**
 * The MCP server over an in-memory transport: the tool listing, a call round trip, argument validation, the sign-in
 * hint and image content.
 *
 *   bun mcp/tests/server.test.mjs
 *
 * Offline: the inbox and the token cache are temp directories, and fetch throws.
 */
import { deepStrictEqual } from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

async function connect(clientName) {
	const server = createServer();
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: clientName, version: "0" });
	await server.connect(a);
	await client.connect(b);
	return { server, client };
}

// ── Tools ───────────────────────────────────────────────────────────────────
{
	const { client, server } = await connect("test");
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
	check("declares tools and no experimental capability", () => deepStrictEqual(client.getServerCapabilities()?.experimental, undefined));

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
	check("teams_watch start is refused: nothing could receive its cards", () => deepStrictEqual([watch.isError, /not available over MCP/.test(watch.content[0].text)], [true, true]));
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

rmSync(tmp, { recursive: true, force: true });
console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
