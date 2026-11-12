/**
 * A picture sent as a file (a PNG dragged into a chat, not pasted) is a picture too: the watch card and teams_read
 * attach it as an image part with its saved path, the same as a pasted one. Its bytes come through the share
 * (/shares/{id}/driveItem) with the Graph token, the size is capped and the type sniffed; a file that is not a picture
 * by name is never fetched, and one that fails says why.
 *
 * End to end on the Graph backend: the extension loads with fetch and the token stubbed. Synthetic data only.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Before the extension loads: a temp HOME and cache (no teams.json: the Graph backend), and a uid of our own, so the
// watch's socket names never meet a live session's.
const home = mkdtempSync(join(tmpdir(), "teams-attachments-"));
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
process.env.HOME = home;
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.WAYNE_INBOX_DIR = join(home, "inbox");
process.getuid = () => 0x7e580000 + (process.pid & 0xffff);
mkdirSync(join(home, ".cache", "pi", "teams-auth"), { recursive: true });
writeFileSync(join(home, ".cache", "pi", "teams-auth", "identity.json"), JSON.stringify({ displayName: "Synthetic Self", upn: "self@contoso.test", oid: "oid-self", tid: "tid-1" }));

const { createJiti, PI } = await import("./host.mjs");
const ROOT = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${PI}/dist/index.js`,
		"@earendil-works/pi-ai": `${PI}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${PI}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${PI}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const auth = await jiti.import(join(ROOT, "core", "auth.ts"));
const { shareId } = await jiti.import(join(ROOT, "core", "shares.ts"));
const teams = await jiti.import(join(ROOT, "teams", "index.ts"), { default: true });

let failed = 0;
const check = (label, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

const GRAPH = "https://graph.microsoft.com/v1.0";
const GROUP = "19:attachments@thread.v2";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const FILES = "https://contoso.sharepoint.com/personal/lin_contoso_test/Documents/Microsoft%20Teams%20Chat%20Files";
/** The share behind each file: what driveItem says, and its bytes. */
const shares = {
	[`${FILES}/shot.png`]: { item: { name: "shot.png", size: PNG.length, file: { mimeType: "image/png" } }, bytes: PNG },
	[`${FILES}/fake.png`]: { item: { name: "fake.png", size: 7, file: { mimeType: "image/png" } }, bytes: Buffer.from("TOKEN=x") },
	[`${FILES}/notes.pdf`]: { item: { name: "notes.pdf", size: 3, file: { mimeType: "application/pdf" } }, bytes: Buffer.from("pdf") },
};
const byShare = Object.fromEntries(Object.entries(shares).map(([url, s]) => [shareId(url), { url, ...s }]));

/** The chat, newest first as Graph returns it. */
const chat = [];
const message = (id, at, attachments) => ({
	id,
	createdDateTime: at,
	messageType: "message",
	from: { user: { id: "oid-lin", displayName: "Lin" } },
	body: { contentType: "html", content: attachments.map((a) => `<attachment id="${a.id}"></attachment>`).join("") },
	attachments,
});
const file = (id, name) => ({ id, contentType: "reference", name, contentUrl: `${FILES}/${name}` });

/** Every share fetched, by its file name. */
const fetched = [];
const reply = (status, body) => {
	const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
	return { status, text: async () => bytes.toString("utf8"), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
};
globalThis.fetch = async (url) => {
	const u = String(url);
	if (u.startsWith(`${GRAPH}/me/chats`)) return reply(200, { value: [] });
	if (u.startsWith(`${GRAPH}/chats/${GROUP}/messages`)) return reply(200, { value: chat });
	const m = u.match(/\/shares\/([^/]+)\/driveItem(\/content)?$/);
	if (m && byShare[m[1]]) {
		const s = byShare[m[1]];
		if (!m[2]) return reply(200, s.item);
		fetched.push(s.item.name);
		return reply(200, s.bytes);
	}
	return reply(404, { error: { code: "itemNotFound", message: u } });
};
auth.getToken = async () => "SYNTHETIC-TOKEN";

const tools = {};
const sent = [];
await teams({
	registerTool: (t) => (tools[t.name] = t),
	registerCommand: () => {},
	registerShortcut: () => {},
	on: () => {},
	exec: async () => {
		throw new Error("the graph backend shelled out");
	},
	sendUserMessage: () => {},
	sendMessage: (m, o) => sent.push({ m, o }),
});
const notices = [];
const ctx = {
	hasUI: false,
	cwd: "/tmp",
	isIdle: () => true,
	sessionManager: { getSessionId: () => "attachments-session" },
	ui: { theme: { fg: (_c, s) => s }, setStatus: () => {}, notify: (text, level) => notices.push({ text, level }) },
};
const realSetInterval = globalThis.setInterval;
let pollFn;
globalThis.setInterval = (fn) => {
	pollFn = fn;
	return realSetInterval(() => {}, 1 << 30);
};
const poll = async () => {
	pollFn();
	await new Promise((r) => setTimeout(r, 50));
};
const texts = (content) => (Array.isArray(content) ? content : [{ type: "text", text: content }]).filter((p) => p.type === "text").map((p) => p.text).join("\n");
const images = (content) => (Array.isArray(content) ? content : []).filter((p) => p.type === "image");

console.log("== a watched chat: a PNG sent as a file arrives as a picture ==");
{
	await tools.teams_watch.execute("w", { action: "start", chat_id: GROUP }, null, null, ctx);
	chat.unshift(message("1", "2026-11-12T08:00:00Z", [file("a1", "shot.png"), file("a2", "notes.pdf")]));
	await poll();
	const card = sent.at(-1)?.m;
	check("one card", sent.length, 1);
	check("with the picture as an image part", images(card?.content).map((p) => [p.mimeType, p.data]), [["image/png", PNG.toString("base64")]]);
	const text = texts(card?.content);
	const saved = text.match(/image 1 saved: (\S+)\]/)?.[1] ?? "";
	check("its saved path, inside the untrusted block", /<untrusted-teams-content>[\s\S]*image 1 saved: [\s\S]*<\/untrusted-teams-content>/.test(text), true);
	check("the file there is the picture", saved ? readFileSync(saved).equals(PNG) : false, true);
	check("the file line is still there for teams_download", text.includes("notes.pdf"), true);
	check("a file that is not a picture by name is not fetched", fetched, ["shot.png"]);
	await tools.teams_watch.execute("w", { action: "stop", chat_id: GROUP }, null, null, ctx);
}

console.log("\n== teams_read: the same, and a file named .png that is not one says so ==");
{
	chat.unshift(message("2", "2026-11-12T08:05:00Z", [file("b1", "fake.png")]));
	fetched.length = 0;
	const r = await tools.teams_read.execute("r", { target: "chat", chat_id: GROUP, limit: 5 }, null, null, ctx);
	const text = texts(r.content);
	check("the picture is an image part", images(r.content).map((p) => p.data), [PNG.toString("base64")]);
	check("with its saved path", /\[image 1 saved: \S+\]/.test(text), true);
	check("a .png that is not a picture is refused, with the reason", /\[image 2: download failed: not a PNG, JPEG, GIF or WebP image\]/.test(text), true);
	check("only the pictures were fetched", fetched.sort(), ["fake.png", "shot.png"]);
	const off = await tools.teams_read.execute("r", { target: "chat", chat_id: GROUP, limit: 5, images: false }, null, null, ctx);
	check("images: false fetches nothing", images(off.content).length, 0);
}

console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
