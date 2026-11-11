/**
 * When a watch card reaches the agent, offline: the omp extension API and fetch_teams.py are both faked, and the
 * tiny-model gate answers from pi-ai's faux provider.
 *
 * A self-chat note is the user's own. While the agent works, it must reach that turn at the next tool-call
 * boundary as a steer, the way an `omp:`/`pi:` prompt does, not wait until the turn ends. A card from another
 * chat quotes other people, so it waits for idle. It starts a turn only when its chat's policy gate answers YES,
 * or the gate fails; on NO, or with no policy (no model call at all), it is display-only. Every card reaches the
 * agent once, and each step is logged with its message ids.
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
// The same pi-ai module the extension imports: its completeSimple dispatches to this faux provider.
const { registerFauxProvider, fauxAssistantMessage } = await jiti.import("@earendil-works/pi-ai");
const faux = registerFauxProvider();
/** Every gate call's context, in order. */
const gateCalls = [];
/** The next gate call answers with `reply` (a faux assistant message). */
const gateAnswers = (reply) => faux.setResponses([(context) => (gateCalls.push(context), reply)]);

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
/** Every pi.sendUserMessage call: an omp:/pi: command sent as a prompt. */
const prompts = [];
await teams({
	registerTool: (t) => (tools[t.name] = t),
	registerCommand: () => {},
	registerShortcut: () => {},
	on: (ev, h) => (handlers[ev] = h),
	exec,
	sendUserMessage: (m, o) => prompts.push({ m, o }),
	sendMessage: (m, o) => sent.push({ m, o }),
});
let idle = true;
const ctx = {
	hasUI: false,
	cwd: "/tmp",
	isIdle: () => idle,
	sessionManager: { getSessionId: () => "delivery-session" },
	ui: { theme: { fg: (_c, s) => s }, setStatus: () => {}, notify: (text, level) => notices.push({ text, level }) },
	// omp's model facade: `@tiny` is the configured tiny role.
	models: { resolve: (spec) => (spec === "@tiny" ? faux.getModel() : undefined) },
	modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "faux-key" }) },
};
/** Every ui.notify call. */
const notices = [];
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

console.log("\n== the turn ends: the held card from a chat with no policy goes in display-only, without a model call ==");
idle = true;
await handlers.agent_end({}, ctx);
await tick();
check("the group card follows with no turn", [sent.length, sent.at(-1)?.m.details.chatId, sent.at(-1)?.o], [3, GROUP, { triggerTurn: false }]);
check("it says it is display-only", /\*\*Delivery\*\*: display-only/.test(sent.at(-1)?.m.content ?? ""), true);
check("no gate call for a chat with no policy", gateCalls.length, 0);
await poll();
check("a later poll sends nothing", sent.length, 3);
check("each note reached the agent exactly once", noteCounts(), { "note-1": 1, "note-2": 1, "note-3": 1 });

const POLICY = "Reply to messages that @-mention me; ignore the rest.";
await watch({ action: "start", chat_id: GROUP, policy: POLICY });
const groupCard = () => sent.at(-1)?.m.details.chatId === GROUP;

console.log("\n== a policy, and the gate says YES: the card starts a turn ==");
gateAnswers(fauxAssistantMessage("YES"));
group.push({ sender: "Lin", at: "2026-11-06T11:04:00Z", mine: false, mentions_me: true, text: "group-yes: can you check the build?" });
await poll();
check("one gate call", gateCalls.length, 1);
// The faux provider sees the transcript: the system prompt as its first message, then the user turn.
const text = (c) => (typeof c === "string" ? c : (c ?? []).map((p) => p.text ?? "").join(""));
const said = (role) => (gateCalls[0]?.messages ?? []).filter((m) => m.role === role).map((m) => text(m.content)).join("\n");
check("the policy is the system prompt", said("system").includes(POLICY), true);
const asked = said("user");
check("the message goes in as JSON data, with the @you flag from Teams", [asked.includes('"text": "group-yes: can you check the build?"'), asked.includes('"mentions_user": true')], [true, true]);
check("the policy is not in the user turn", asked.includes(POLICY), false);
check("sent with a turn", [sent.length, groupCard(), sent.at(-1)?.o], [4, true, { triggerTurn: true }]);

console.log("\n== the gate says NO: display-only ==");
gateAnswers(fauxAssistantMessage("NO"));
group.push({ sender: "Mei", at: "2026-11-06T11:05:00Z", mine: false, text: "group-no: lively in here" });
await poll();
check("sent with no turn", [sent.length, groupCard(), sent.at(-1)?.o], [5, true, { triggerTurn: false }]);

console.log("\n== NO while the agent is busy: held, then sent at idle without a turn, never steered ==");
idle = false;
gateAnswers(fauxAssistantMessage("NO"));
group.push({ sender: "Mei", at: "2026-11-06T11:06:00Z", mine: false, text: "group-no-busy" });
await poll();
check("not sent while busy", sent.length, 5);
idle = true;
await handlers.agent_end({}, ctx);
await tick();
check("sent at idle with no turn", [sent.length, groupCard(), sent.at(-1)?.o], [6, true, { triggerTurn: false }]);

console.log("\n== at idle, display-only cards go first and the card that needs the agent starts the turn ==");
idle = false;
gateAnswers(fauxAssistantMessage("NO"));
group.push({ sender: "Mei", at: "2026-11-06T11:07:00Z", mine: false, text: "group-no-held" });
await poll();
idle = true;
notes.push({ id: "104", at: "2026-11-06T11:07:30Z", text: "note-4" });
await poll();
check("two cards: the group's display-only, then the note's turn", sent.slice(6).map((s) => [s.m.details.chatId, s.o]), [
	[GROUP, { triggerTurn: false }],
	["48:notes", { triggerTurn: true }],
]);

console.log("\n== the agent's own card in the self-chat is not news: no echo loop ==");
{
	const { buildCard, cardText } = await jiti.import(join(ROOT, "teams", "card.ts"));
	const before = sent.length;
	const card = buildCard({ title: "Ship?", text: "pick one", decision: { question: "Which?", options: [{ label: "a" }, { label: "b" }], recommended: 0 } });
	// The text the self-chat read gives a card (skype.ts projects properties.cards through cardText).
	notes.push({ id: "104.5", at: "2026-11-06T11:07:45Z", text: cardText(card) });
	await poll();
	check("no card, no turn for the agent's own card", [sent.length - before, prompts.length], [0, 0]);
}

console.log("\n== the gate fails or answers off-format: warn, and start the turn ==");
gateAnswers(fauxAssistantMessage("", { stopReason: "error", errorMessage: "gateway 503" }));
group.push({ sender: "Lin", at: "2026-11-06T11:08:00Z", mine: false, text: "group-error" });
await poll();
check("an error starts a turn", [sent.length, groupCard(), sent.at(-1)?.o], [9, true, { triggerTurn: true }]);
check("and warns", notices.some((n) => n.level === "warning" && n.text.includes("gateway 503")), true);
gateAnswers(fauxAssistantMessage("Sure, YES."));
group.push({ sender: "Lin", at: "2026-11-06T11:09:00Z", mine: false, text: "group-offformat" });
await poll();
check("an answer that is not exactly YES or NO starts a turn", [sent.length, groupCard(), sent.at(-1)?.o], [10, true, { triggerTurn: true }]);
check("and warns", notices.some((n) => n.level === "warning" && n.text.includes("not YES or NO")), true);

console.log("\n== a hung gate on one chat never holds back my omp: command from another ==");
let releaseGate;
faux.setResponses([(context) => (gateCalls.push(context), new Promise((r) => (releaseGate = () => r(fauxAssistantMessage("NO")))))]);
const gatesBefore = gateCalls.length;
const sentBefore = sent.length;
notes.push({ id: "105", at: "2026-11-06T11:09:30Z", text: "omp: rerun build 412" });
group.push({ sender: "Mei", at: "2026-11-06T11:09:40Z", mine: false, text: "group-slow-gate" });
await poll();
check("the gate on the group chat is still waiting", [gateCalls.length - gatesBefore, typeof releaseGate, sent.length - sentBefore], [1, "function", 0]);
check("my command reached the agent already", prompts.map((p) => p.m), ["[Teams self-chat instruction]\nrerun build 412"]);
releaseGate();
await tick();
check("the group card follows once its gate answers", [sent.length - sentBefore, groupCard(), sent.at(-1)?.o], [1, true, { triggerTurn: false }]);

console.log("\n== every card step is logged with its message ids ==");
// The host echoes each card as a message once it is in the conversation.
for (const s of sent) await handlers.message_end({ message: { role: "custom", customType: "teams-watch", content: s.m.content, details: s.m.details } }, ctx);
idle = false;
gateAnswers(fauxAssistantMessage("NO"));
group.push({ sender: "Lin", at: "2026-11-06T11:10:00Z", mine: false, text: "group-dropped" });
await poll();
await handlers.session_switch({}, ctx); // /new while that card is held: it goes with the old session
const log = readFileSync(join(home, ".cache", "pi", "teams-watch.log"), "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l));
const steps = (id) => log.filter((e) => e.ids.includes(id)).map((e) => e.event);
const entry = (event, id) => log.find((e) => e.event === event && e.ids.includes(id));
check("a steered note: queued, flushed, delivered", steps("101"), ["queued", "flushed", "delivered"]);
check("a held group message: queued, flushed, delivered", steps("2026-11-06T11:02:00Z"), ["queued", "flushed", "delivered"]);
check("a card dropped with its session: queued, dropped", steps("2026-11-06T11:10:00Z"), ["queued", "dropped"]);
check("a flush says how it went in", ["101", "2026-11-06T11:02:00Z", "2026-11-06T11:04:00Z"].map((id) => entry("flushed", id)?.how), ["steer", "display", "turn"]);
check("a queued card says what the gate did", [entry("queued", "2026-11-06T11:02:00Z")?.gate, entry("queued", "2026-11-06T11:04:00Z")?.gate?.split(" ")[0]], ["no policy", "YES"]);

console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
