import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTeams, type TeamsHost } from "../../teams/core.ts";
import type { Backend, SelfMessage } from "../../teams/backend.ts";
import type { HistoryMessage } from "../../teams/types.ts";
import { cursorPath, loadCursor } from "../../teams/cursor-store.ts";

const SELF = "48:notes";
const CHAT = "19:synthetic-i6@thread.v2";
const T0 = "2026-01-01T00:00:00Z";
const T1 = "2026-01-01T00:01:00Z";
const T2 = "2026-01-01T00:02:00Z";
const T3 = "2026-01-01T00:03:00Z";
const note = (id: string, text: string): SelfMessage => ({ id, at: T0, text });
const message = (at: string, text: string, mine = false): HistoryMessage => ({ at, text, mine, sender: mine ? "Synthetic User" : "Synthetic Author" });

const originalInterval = globalThis.setInterval;
let poll: (() => Promise<void>) | undefined;
let teams: { startWatch(ctx: never, chatId?: string, name?: string, policy?: string, save?: boolean): Promise<string>; stopAllWatches(): void; flushCards(): Promise<void>; logCard(event: "delivered", card: { chatId: string; ids: string[]; thread?: string; route?: string }): void } | undefined;
afterEach(() => {
	teams?.stopAllWatches();
	teams = undefined;
	globalThis.setInterval = originalInterval;
	for (const key of [SELF, CHAT]) rmSync(cursorPath(key), { force: true });
	rmSync(`${cursorPath(SELF)}.lock`, { recursive: true, force: true });
});

function setup() {
	for (const key of [SELF, CHAT]) rmSync(cursorPath(key), { force: true });
	rmSync(join(process.env.XDG_CACHE_HOME!, "pi", "teams-watch.log"), { force: true });
	const notes: SelfMessage[] = [note("100", "old note")];
	const messages: HistoryMessage[] = [message(T0, "old message")];
	const backend = {
		chatsPage: async () => ({ chats: [{ id: CHAT, label: "Synthetic Chat", chat_type: "group" }] }),
		selfMessages: async (since: string) => notes.filter((m) => !since || BigInt(m.id) > BigInt(since)),
		messages: async () => ({ messages: [...messages] }),
	} as unknown as Backend;
	let idle = true;
	let fail = false;
	const cards: { details: { chatId: string; ids: string[] }; content: unknown }[] = [];
	const prompts: string[] = [];
	let failPrompt = false;
	let hold: Promise<void> | undefined;
	const sending = Promise.withResolvers<void>();
	const notices: string[] = [];
	const ctx = { cwd: "/tmp", isIdle: () => idle, ui: { notify: (text: string) => notices.push(text) }, sessionManager: { getSessionId: () => "synthetic-session" } };
	globalThis.setInterval = ((fn: () => Promise<void>) => { poll = fn; return { unref() {} }; }) as unknown as typeof setInterval;
	teams = createTeams({
		backend, registerTool: () => {}, exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		sendMessage: async (card) => { sending.resolve(); if (hold) await hold; if (fail) { fail = false; throw new Error("synthetic push failure"); } cards.push(card); },
		sendUserMessage: async (text) => { if (failPrompt) { failPrompt = false; throw new Error("synthetic prompt failure"); } prompts.push(text); },
	} as TeamsHost);
	const tick = async () => { if (!poll) throw new Error("watch timer missing"); await poll(); };
	return { notes, messages, cards, prompts, notices, ctx, tick, sending: sending.promise, idle: (v: boolean) => { idle = v; }, failNext: () => { fail = true; }, failPrompt: () => { failPrompt = true; }, hold: (v: Promise<void>) => { hold = v; } };
}

test("U21: self and group watches baseline once and resume after restart", async () => {
	const s = setup();
	await teams!.startWatch(s.ctx as never, SELF, undefined, undefined, false);
	await teams!.startWatch(s.ctx as never, CHAT, undefined, undefined, false);
	expect(loadCursor(SELF)?.watermark).toBe("100");
	expect(loadCursor(CHAT)?.watermark).toBe(T0);
	await s.tick();
	expect(s.cards).toHaveLength(0);
	teams!.stopAllWatches();
	s.notes.push(note("101", "new note"));
	s.messages.push(message(T1, "new message"));
	await teams!.startWatch(s.ctx as never, SELF, undefined, undefined, false);
	await teams!.startWatch(s.ctx as never, CHAT, undefined, undefined, false);
	await s.tick();
	await s.tick();
	expect(s.cards.map((c) => [c.details.chatId, c.details.ids])).toEqual([[CHAT, [T1]], [SELF, ["101"]]]);
	expect(loadCursor(SELF)?.watermark).toBe("101");
	expect(loadCursor(CHAT)?.watermark).toBe(T1);
});

test("U40: three busy polls queue one card and idle hands it over once", async () => {
	const s = setup();
	await teams!.startWatch(s.ctx as never, CHAT, undefined, undefined, false);
	s.idle(false);
	s.messages.push(message(T1, "waiting"));
	await s.tick();
	await s.tick();
	await s.tick();
	s.idle(true);
	await teams!.flushCards();
	await s.tick();
	expect(s.cards.map((c) => c.details.ids)).toEqual([[T1]]);
	expect(loadCursor(CHAT)?.watermark).toBe(T1);
});

test("U40: queued cards hold the watermark across echoes, restart and rejected handoff", async () => {
	const s = setup();
	await teams!.startWatch(s.ctx as never, CHAT, undefined, undefined, false);
	s.idle(false);
	s.messages.push(message(T1, "waiting"), message(T2, "echo", true));
	await s.tick();
	expect(loadCursor(CHAT)).toMatchObject({ watermark: T0, done: [T2] });
	s.messages.push(message(T3, "later echo", true));
	await s.tick();
	await s.tick();
	expect(loadCursor(CHAT)).toMatchObject({ watermark: T0, done: [T2, T3] });
	expect(s.cards).toHaveLength(0);
	teams!.stopAllWatches();
	await teams!.startWatch(s.ctx as never, CHAT, undefined, undefined, false);
	await s.tick();
	s.idle(true);
	s.failNext();
	await teams!.flushCards();
	expect(s.cards).toHaveLength(0);
	expect(loadCursor(CHAT)?.watermark).toBe(T0);
	await s.tick();
	await s.tick();
	expect(s.cards.map((c) => c.details.ids)).toEqual([[T1]]);
	expect(loadCursor(CHAT)).toMatchObject({ watermark: T3, done: [] });
	expect(s.notices.filter((n) => n.includes("synthetic push failure"))).toHaveLength(1);
	const log = readFileSync(join(process.env.XDG_CACHE_HOME!, "pi", "teams-watch.log"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
	expect(log.filter((e) => e.event === "queued" && e.chatId === CHAT && e.ids.includes(T1))).toHaveLength(3);
});

test("failed prompt stays below a later handed-over card and is retried", async () => {
	const s = setup();
	await teams!.startWatch(s.ctx as never, SELF, undefined, undefined, false);
	s.notes.push(note("101", "omp: synthetic command"), note("102", "later note"));
	s.failPrompt();
	await s.tick();
	expect(s.cards.map((c) => c.details.ids)).toEqual([["102"]]);
	expect(loadCursor(SELF)).toMatchObject({ watermark: "100", done: ["102"] });
	await s.tick();
	expect(s.prompts).toEqual(["[Teams self-chat instruction]\nsynthetic command"]);
	expect(loadCursor(SELF)).toMatchObject({ watermark: "102", done: [] });
});

test("successful handoff with failed cursor write warns once and replays only after restart", async () => {
	const s = setup();
	await teams!.startWatch(s.ctx as never, SELF, undefined, undefined, false);
	s.notes.push(note("101", "new note"));
	const lock = `${cursorPath(SELF)}.lock`;
	mkdirSync(lock);
	await s.tick();
	await s.tick();
	expect(s.cards).toHaveLength(1);
	expect(s.notices.filter((n) => n.includes("Teams watch") && n.includes("failed"))).toHaveLength(1);
	rmSync(lock, { recursive: true });
	teams!.stopAllWatches();
	await teams!.startWatch(s.ctx as never, SELF, undefined, undefined, false);
	await s.tick();
	expect(s.cards.map((c) => c.details.ids)).toEqual([["101"], ["101"]]);
	expect(loadCursor(SELF)?.watermark).toBe("101");
});

test("an unresolved handoff does not advance the cursor or write after the watch stops", async () => {
	const s = setup();
	await teams!.startWatch(s.ctx as never, SELF, undefined, undefined, false);
	const gate = Promise.withResolvers<void>();
	s.hold(gate.promise);
	s.notes.push(note("101", "new note"));
	const pending = s.tick();
	await s.sending;
	expect(loadCursor(SELF)?.watermark).toBe("100");
	teams!.stopAllWatches();
	gate.resolve();
	await pending;
	expect(loadCursor(SELF)?.watermark).toBe("100");
});

test("card logs retain thread and route", () => {
	setup();
	teams!.logCard("delivered", { chatId: CHAT, ids: ["101"], thread: "thread-1", route: "session-1" });
	const line = JSON.parse(readFileSync(join(process.env.XDG_CACHE_HOME!, "pi", "teams-watch.log"), "utf8").trim());
	expect(line).toMatchObject({ event: "delivered", thread: "thread-1", route: "session-1" });
});
