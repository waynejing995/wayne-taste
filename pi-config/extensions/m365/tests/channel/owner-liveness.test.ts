/**
 * R2: a session:<id> thread owner that is not this session and has no live watch is
 * unbound and rebound here. Live session owners and agent:/inbox: owners still relay.
 *
 *   bun test tests/channel/owner-liveness.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTeams, type TeamsHost } from "../../teams/core.ts";
import type { Backend } from "../../teams/backend.ts";
import { type CursorFile, cursorKey, cursorPath, loadCursor } from "../../teams/cursor-store.ts";
import { planDelivery, type ChannelEvent } from "../../teams/channel.ts";
import { claim, type WatchLease } from "../../teams/watch.ts";
import type { RawSkypeMessage } from "../../teams/skype.ts";

const TEAM = "team-1";
const CHANNEL = "19:fake-channel@thread.skype";
const ME = "00000000-0000-4000-8000-000000000001";
const SELF = "session:sess-owner-b";
const DEAD = "session:sess-owner-a";
const LIVE = "session:sess-owner-live";
const AGENT = "agent:x";
const INBOX = "inbox:42";
const WATCH_LOG = join(process.env.XDG_CACHE_HOME!, "pi", "teams-watch.log");
if (!process.env.WAYNE_INBOX_DIR) throw new Error("WAYNE_INBOX_DIR is not set: bunfig.toml must load tests/channel/preload.ts first");

const instruction = (id: string, threadId: string, text: string): ChannelEvent => ({
	id,
	threadId,
	isRoot: id === threadId,
	at: "",
	authorOid: ME,
	author: "Synthetic User",
	email: false,
	agentEcho: false,
	text,
	md: text,
});

const plan = (events: ChannelEvent[], threads: Record<string, { owner: string; subject?: string }>, liveSessionIds?: Set<string>) =>
	planDelivery(events, { mode: "personal", myOid: ME, self: SELF, threads, ...(liveSessionIds ? { liveSessionIds } : {}) });

describe("planDelivery session liveness", () => {
	test("a dead session owner is unbound: here-prompt and bind to self", () => {
		const result = plan(
			[instruction("202", "201", "follow-up in the old thread")],
			{ "201": { owner: DEAD, subject: "Old job" } },
			new Set(),
		);
		expect(result.entries).toEqual([
			expect.objectContaining({ threadId: "201", kind: "prompt", owner: SELF, turn: true, untrusted: false }),
		]);
		expect(result.bind).toEqual({ "201": SELF });
	});

	test("a live session owner still relays", () => {
		const result = plan(
			[instruction("302", "301", "follow-up for a live peer")],
			{ "301": { owner: LIVE } },
			new Set(["sess-owner-live"]),
		);
		expect(result.entries).toEqual([
			expect.objectContaining({ threadId: "301", kind: "relay", owner: LIVE, turn: true, untrusted: false }),
		]);
		expect(result.bind).toEqual({});
	});

	test("agent: and inbox: owners still relay when no session is live", () => {
		const result = plan(
			[instruction("402", "401", "follow-up for the worker"), instruction("502", "501", "follow-up for the inbox row")],
			{ "401": { owner: AGENT }, "501": { owner: INBOX } },
			new Set(),
		);
		expect(result.entries.map(({ threadId, kind, owner }) => ({ threadId, kind, owner }))).toEqual([
			{ threadId: "401", kind: "relay", owner: AGENT },
			{ threadId: "501", kind: "relay", owner: INBOX },
		]);
		expect(result.bind).toEqual({});
	});

	test("without a live set, a foreign session owner still relays (first pass)", () => {
		const result = plan(
			[instruction("202", "201", "follow-up")],
			{ "201": { owner: DEAD } },
		);
		expect(result.entries[0]).toEqual(expect.objectContaining({ kind: "relay", owner: DEAD }));
		expect(result.bind).toEqual({});
	});
});

const raw = (id: string, text: string, extra: Partial<RawSkypeMessage> = {}): RawSkypeMessage => ({
	id,
	from: `https://example.test/contacts/8:orgid:${ME}`,
	imdisplayname: "Synthetic User",
	composetime: "2026-01-01T00:00:00Z",
	content: text,
	...extra,
});

type Tool = { name: string; execute(id: string, params: Record<string, unknown>, signal: undefined, onUpdate: undefined, ctx: unknown): Promise<unknown> };

type Harness = {
	key: string;
	ctx: { cwd: string; isIdle(): boolean; ui: { notify(t: string): void }; sessionManager: { getSessionId(): string } };
	stream: RawSkypeMessage[];
	prompts: { text: string }[];
	reacts: { messageId: string; type: string }[];
	warningNotices: string[];
	start(): Promise<string>;
	tick(): Promise<void>;
	cursor(): CursorFile | null;
	teams: { stopAllWatches(): void };
};

const originalInterval = globalThis.setInterval;
let h: Harness | undefined;
const extraLeases: WatchLease[] = [];

afterEach(async () => {
	h?.teams.stopAllWatches();
	h = undefined;
	globalThis.setInterval = originalInterval;
	for (const lease of extraLeases.splice(0)) {
		const closed = Promise.withResolvers<void>();
		lease.close((e) => (e ? closed.reject(e) : closed.resolve()));
		await closed.promise;
	}
	rmSync(join(process.env.WAYNE_INBOX_DIR!, "cursors"), { recursive: true, force: true });
	rmSync(WATCH_LOG, { force: true });
});

function setup() {
	h?.teams.stopAllWatches();
	const key = cursorKey({ teamId: TEAM, channelId: CHANNEL });
	rmSync(join(process.env.WAYNE_INBOX_DIR!, "cursors"), { recursive: true, force: true });
	rmSync(WATCH_LOG, { force: true });
	const stream: RawSkypeMessage[] = [];
	const prompts: { text: string }[] = [];
	const reacts: { messageId: string; type: string }[] = [];
	const warningNotices: string[] = [];
	let poll: (() => Promise<void>) | undefined;
	const ctx = {
		cwd: "/tmp",
		isIdle: () => true,
		ui: { notify: (t: string, level?: string) => { if (level === "warning") warningNotices.push(t); } },
		sessionManager: { getSessionId: () => "sess-owner-b" },
	};
	const tools = new Map<string, Tool>();
	const backend = {
		resolveChannel: async () => ({ teamId: TEAM, channelId: CHANNEL, label: "General" }),
		me: async () => ({ oid: ME, name: "Synthetic User" }),
		channelMembers: async () => ({ membershipType: "private", memberOids: [ME] }),
		channelStream: async (_a: unknown, size: number, cursor?: string) => {
			const all = [...stream].sort((a, b) => (BigInt(String(b.id)) < BigInt(String(a.id)) ? -1 : 1));
			const start = cursor === undefined ? 0 : Number(cursor);
			return { raw: all.slice(start, start + size), older: start + size < all.length ? String(start + size) : undefined };
		},
		reactChannel: async (_a: unknown, messageId: string, type: string) => { reacts.push({ messageId, type }); },
		send: async () => ({ id: "sent-1" }),
		selfMessages: async () => [],
		chatsPage: async () => ({ chats: [] }),
	} as unknown as Backend;
	globalThis.setInterval = ((fn: () => Promise<void>) => { poll = fn; return { unref() {} }; }) as unknown as typeof setInterval;
	const teams = createTeams({
		backend,
		turnEvents: false,
		registerTool: (t) => void tools.set(t.name, t as unknown as Tool),
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		sendMessage: async () => {},
		sendUserMessage: async (text: string) => { prompts.push({ text }); },
	} as TeamsHost);
	h = {
		key,
		ctx,
		stream,
		prompts,
		reacts,
		warningNotices,
		start: () => teams.startChannelWatch(ctx, { teamId: TEAM, channelId: CHANNEL, mode: "personal" }),
		tick: async () => { if (!poll) throw new Error("watch timer missing"); await poll(); },
		cursor: () => loadCursor(key),
		teams,
	};
	return h;
}

test("restart: a follow-up in session A's thread is handled here as session B; live session and agent:x still relay", async () => {
	const s = setup();
	mkdirSync(join(process.env.WAYNE_INBOX_DIR!, "cursors"), { recursive: true });
	writeFileSync(cursorPath(s.key), JSON.stringify({
		version: 1,
		key: s.key,
		watermark: "201",
		done: ["201"],
		threads: {
			"201": { owner: DEAD, subject: "Old job" },
			"301": { owner: LIVE },
			"401": { owner: AGENT },
		},
	}));
	await s.start();
	const peer = await claim({
		chatId: "synthetic-live-peer-owner-liveness",
		label: "peer",
		pid: process.pid,
		sessionId: "sess-owner-live",
		cwd: "/tmp",
		since: new Date().toISOString(),
	});
	if (!("lease" in peer)) throw new Error("synthetic live peer already held");
	extraLeases.push(peer.lease);
	s.stream.push(
		raw("202", "follow-up in the old thread", { rootMessageId: "201" }),
		raw("302", "follow-up for a live peer", { rootMessageId: "301" }),
		raw("402", "follow-up for the worker", { rootMessageId: "401" }),
	);
	await s.tick();

	const here = s.prompts.filter((p) => p.text.includes("follow-up in the old thread"));
	expect(here).toHaveLength(1);
	expect(here[0].text).not.toContain("hand it to that owner");
	expect(here[0].text).toContain("owner: session:sess-owner-b");
	expect(here[0].text).toContain("Answer in this thread with teams_send reply_to=201");

	const liveRelay = s.prompts.filter((p) => p.text.includes("follow-up for a live peer"));
	expect(liveRelay).toHaveLength(1);
	expect(liveRelay[0].text).toContain(`This thread is owned by ${LIVE}; hand it to that owner rather than answering here.`);

	const agentRelay = s.prompts.filter((p) => p.text.includes("follow-up for the worker"));
	expect(agentRelay).toHaveLength(1);
	expect(agentRelay[0].text).toContain(`This thread is owned by ${AGENT}; hand it to that owner rather than answering here.`);

	expect(s.cursor()?.threads).toEqual({
		"201": { owner: SELF, subject: "Old job" },
		"301": { owner: LIVE },
		"401": { owner: AGENT },
	});
	expect(s.warningNotices.some((n) => n.includes(DEAD))).toBe(true);
});
