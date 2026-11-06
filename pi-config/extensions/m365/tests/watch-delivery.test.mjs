/**
 * When a watch card reaches the agent, offline: the omp extension API and fetch_teams.py are both faked.
 *
 * A self-chat note is the user's own. While the agent works, it must reach that turn at the next tool-call
 * boundary as a steer, the way an `omp:`/`pi:` prompt does, not wait until the turn ends. A card from another
 * chat quotes other people, so it still waits for idle. Every card reaches the agent once, and each step is
 * logged with its message ids.
 *
 * What omp does with a steered card on Esc is outside this fake; the throwaway-session smoke proves that.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Before the extension loads: a temp HOME and cache (teams.json, rules.yaml, the card log), and a uid of our own.
// The watch lease is an abstract socket named by uid and chat, so a live session watching 48:notes cannot refuse us.
const home = mkdtempSync(join(tmpdir(), "teams-delivery-"));
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
writeFileSync(join(home, "fetch_teams.py"), "# stand-in: pi.exec is faked\n");
writeFileSync(join(home, ".pi", "agent", "teams.json"), JSON.stringify({ backend: "script", script: join(home, "fetch_teams.py"), selfReply: false }));
process.env.HOME = home;
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.WAYNE_INBOX_DIR = join(home, "inbox");
process.getuid = () => 0x7e570000 + (process.pid & 0xffff);
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
const teams = await jiti.import(join(ROOT, "teams", "index.ts"), { default: true });

let failed = 0;
const check = (label, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

const GROUP = `19:delivery-${process.pid}@thread.v2`;
const notes = [{ id: "100", at: "2026-11-06T11:00:00Z", text: "before the watch" }];
const group = [{ sender: "Lin", at: "2026-11-06T11:00:00Z", mine: false, text: "before the watch" }];
const exec = async (_cmd, argv) => {
	const args = argv.slice(argv.findIndex((a) => a.endsWith(".py")) + 1);
	const json = (o) => ({ stdout: JSON.stringify(o), stderr: "", code: 0 });
	if (args[0] === "chats" && args.includes("--self")) {
		const since = args.includes("--since-id") ? Number(args[args.indexOf("--since-id") + 1]) : -1;
		return json({ messages: notes.filter((n) => Number(n.id) > since) });
	}
	if (args[0] === "chats" && args.includes("--list")) return json({ chats: [{ id: GROUP, label: "Release Sync", display: "Release Sync", chat_type: "group" }] });
	if (args[0] === "chats") return json({ messages: group });
	return json({ unread_chats: 0, items: [] });
};

const tools = {};
const handlers = {};
/** Every pi.sendMessage call: the card and its delivery options. */
const sent = [];
await teams({
	registerTool: (t) => (tools[t.name] = t),
	registerCommand: () => {},
	registerShortcut: () => {},
	on: (ev, h) => (handlers[ev] = h),
	exec,
	sendUserMessage: () => {},
	sendMessage: (m, o) => sent.push({ m, o }),
});
let idle = true;
const ctx = {
	hasUI: false,
	cwd: "/tmp",
	isIdle: () => idle,
	sessionManager: { getSessionId: () => "delivery-session" },
	ui: { theme: { fg: (_c, s) => s }, setStatus: () => {}, notify: () => {} },
};
// The watch poll runs on an interval; capture its callback and fire it by hand.
const realSetInterval = globalThis.setInterval;
let pollFn;
globalThis.setInterval = (fn) => {
	pollFn = fn;
	return realSetInterval(() => {}, 1 << 30);
};
const tick = () => new Promise((r) => setTimeout(r, 20));
const poll = async () => {
	pollFn();
	await tick();
};
const watch = (params) => tools.teams_watch.execute("w", params, null, null, ctx).then((r) => r.content[0].text);
await watch({ action: "start", chat_id: "48:notes" });
await watch({ action: "start", chat_id: GROUP });
await poll();
check("history already there is not news", sent.length, 0);

const notesIn = (s) => s.m.content.match(/note-\d/g) ?? [];
/** How many times each self-chat note reached the agent, over every card sent. */
const noteCounts = () => Object.fromEntries(["note-1", "note-2", "note-3"].map((n) => [n, sent.flatMap(notesIn).filter((x) => x === n).length]));

console.log("== the agent is busy (a long tool call): a self-chat note is steered in at once ==");
idle = false;
notes.push({ id: "101", at: "2026-11-06T11:01:00Z", text: "note-1" });
await poll();
check("one card, with no turn end", sent.length, 1);
check("it steers the running turn and would start one if the turn just ended", sent[0]?.o, { triggerTurn: true, deliverAs: "steer" });
check("it carries the note", notesIn(sent[0] ?? { m: { content: "" } }), ["note-1"]);
check("its details name the message id", sent[0]?.m.details.ids, ["101"]);

console.log("\n== another chat's card waits for idle: it quotes other people ==");
group.push({ sender: "Lin", at: "2026-11-06T11:02:00Z", mine: false, text: "group-1" });
await poll();
check("not sent while busy", sent.length, 1);

console.log("\n== two notes in one poll: one card, steered ==");
notes.push({ id: "102", at: "2026-11-06T11:03:00Z", text: "note-2" }, { id: "103", at: "2026-11-06T11:03:05Z", text: "note-3" });
await poll();
check("a second card", sent.length, 2);
check("steered", sent[1]?.o?.deliverAs, "steer");

console.log("\n== the turn ends: the held card goes in, nothing twice ==");
idle = true;
await handlers.agent_end({}, ctx);
await tick();
check("the group card follows and starts a turn", [sent.length, sent.at(-1)?.m.details.chatId, sent.at(-1)?.o?.triggerTurn], [3, GROUP, true]);
await poll();
check("a later poll sends nothing", sent.length, 3);
check("each note reached the agent exactly once", noteCounts(), { "note-1": 1, "note-2": 1, "note-3": 1 });

console.log("\n== every card step is logged with its message ids ==");
// The host echoes each card as a message once it is in the conversation.
for (const s of sent) await handlers.message_end({ message: { role: "custom", customType: "teams-watch", content: s.m.content, details: s.m.details } }, ctx);
idle = false;
group.push({ sender: "Lin", at: "2026-11-06T11:05:00Z", mine: false, text: "group-2" });
await poll();
await handlers.session_switch({}, ctx); // /new while that card is held: it goes with the old session
const log = readFileSync(join(home, ".cache", "pi", "teams-watch.log"), "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l));
const steps = (id) => log.filter((e) => e.ids.includes(id)).map((e) => e.event);
check("a steered note: queued, flushed, delivered", steps("101"), ["queued", "flushed", "delivered"]);
check("a held group message: queued, flushed, delivered", steps("2026-11-06T11:02:00Z"), ["queued", "flushed", "delivered"]);
check("a card dropped with its session: queued, dropped", steps("2026-11-06T11:05:00Z"), ["queued", "dropped"]);
check("a flush says how it went in", log.find((e) => e.event === "flushed" && e.ids.includes("101"))?.how, "steer");

console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
