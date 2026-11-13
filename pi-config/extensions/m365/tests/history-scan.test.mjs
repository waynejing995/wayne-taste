/**
 * Time-bounded Teams history, offline.
 *
 * An unwatched chat can have more than 200 messages since the digest boundary. `since` must read every one by walking
 * Graph pages, and `active_since` must find that chat even when it is not on the first page.
 *
 * Synthetic data only.
 */
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti, PI } from "./host.mjs";

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
const { GraphBackend } = await jiti.import(join(ROOT, "teams", "graph-backend.ts"));
const { GraphClient } = await jiti.import(join(ROOT, "core", "graph.ts"));
const { readTeams, freshChatList } = await jiti.import(join(ROOT, "teams", "core.ts"));

let failed = 0;
const check = (label, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

const CHAT = "19:unwatched@thread.v2";
const SINCE = "2026-11-13 10:00";
const boundary = new Date(SINCE).getTime();
const at = (offset) => new Date(boundary + offset * 60_000).toISOString();
const raw = (id, offset, text) => ({
	id,
	messageType: "message",
	createdDateTime: at(offset),
	from: { user: { displayName: "Ada" } },
	body: { contentType: "text", content: text },
});

const pages = {
	[`/chats/${CHAT}/messages?$top=50&$orderby=createdDateTime desc`]: {
		value: [raw("edited-old", -30, "edited old"), ...Array.from({ length: 49 }, (_, i) => raw(`new-${i}`, 250 - i, `new ${i}`))],
		"@odata.nextLink": "https://graph.microsoft.com/page-2",
	},
	"https://graph.microsoft.com/page-2": {
		value: [
			raw("new-49", 201, "new 49"),
			...Array.from({ length: 151 }, (_, i) => raw(`old-${i}`, 200 - i, `kept ${i}`)),
			raw("boundary", 0, "boundary"),
		],
		"@odata.nextLink": "https://graph.microsoft.com/page-3",
	},
	"https://graph.microsoft.com/page-3": {
		value: [raw("too-old", -1, "too old")],
		"@odata.nextLink": "https://graph.microsoft.com/page-4",
	},
};
const chatPages = {
	"/me/chats?$top=50&$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc": {
		value: [{ id: "19:recent@thread.v2", topic: "Recent", chatType: "group", lastMessagePreview: { createdDateTime: at(-100) } }],
		"@odata.nextLink": "https://graph.microsoft.com/chats-2",
	},
	"https://graph.microsoft.com/chats-2": {
		value: [{ id: CHAT, topic: "Unwatched", chatType: "group", lastMessagePreview: { createdDateTime: at(250) } }],
	},
};

const requested = [];
const fetchImpl = async (url) => {
	const path = url.replace("https://graph.microsoft.com/v1.0", "");
	requested.push(path);
	const page = pages[path] ?? chatPages[path];
	if (!page) return { status: 404, text: async () => "missing" };
	return { status: 200, text: async () => JSON.stringify(page) };
};
const backend = new GraphBackend(new GraphClient(async () => "T", fetchImpl), { whoami: async () => "Me" });

const history = await backend.messages({ id: CHAT }, 200, SINCE);
check("an edited old message does not hide a newer message on the next page", history.messages.some((m) => m.text === "new 49") && !history.messages.some((m) => m.text === "edited old"), true);
check("the oldest kept message is the boundary", history.messages[0].text, "boundary");
check("the newest message is kept", history.messages.at(-1).text, "new 0");
check("the walk stops after the first page older than the boundary", requested.includes("https://graph.microsoft.com/page-3") && !requested.includes("https://graph.microsoft.com/page-4"), true);

const load = async (_target, _limit, since) => (await backend.messages({ id: CHAT }, 200, since)).messages;
const text = await readTeams({ target: "chat", chat_id: CHAT, since: SINCE, limit: 200 }, load);
check("teams_read since returns the full bounded history", text.includes("202 message(s)") && text.includes("boundary") && text.includes("new 0"), true);

const first = await backend.chatsPage();
const found = [];
for await (const page of (async function* () {
	let cursor;
	let page = first;
	for (;;) {
		yield page;
		cursor = page.next;
		if (!cursor) return;
		page = await backend.chatsPage(cursor);
	}
})()) {
	found.push(...page.chats.filter((chat) => new Date(chat.last_at ?? "").getTime() >= boundary));
}
check("active_since finds an unwatched chat beyond the first page", found.map((chat) => chat.id), [CHAT]);

check("active_since bypasses a cached chat list", freshChatList(SINCE, false), true);
check("a normal list can use the cache", freshChatList(undefined, false), false);

if (failed) process.exit(1);
