/**
 * Restart-dedup, R5 replyTo ACK, and replied-reset on merge (personal channel).
 * Crash injection: host/Graph accept, then a hung Promise; drop the engine and start a new one on the same cursor.
 *
 *   bun test tests/channel/restart-dedup.test.ts
 */
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createTeams, type TeamsHost } from "../../teams/core.ts";
import type { Backend } from "../../teams/backend.ts";
import { type CursorFile, cursorKey, cursorPath, loadCursor } from "../../teams/cursor-store.ts";
import type { RawSkypeMessage } from "../../teams/skype.ts";
import type { SendTarget } from "../../teams/types.ts";

const TEAM = "team-1";
const CHANNEL = "19:fake-channel@thread.skype";
const ME = "00000000-0000-4000-8000-000000000001";
const SESSION = "sess-restart-dedup";
const OID = ME;
const WATCH_LOG = join(process.env.XDG_CACHE_HOME!, "pi", "teams-watch.log");
if (!process.env.WAYNE_INBOX_DIR) throw new Error("WAYNE_INBOX_DIR is not set: bunfig.toml must load tests/channel/preload.ts first");

const raw = (id: string, text: string, author = ME, extra: Partial<RawSkypeMessage> = {}): RawSkypeMessage => ({
	id,
	from: `https://example.test/contacts/8:orgid:${author}`,
	imdisplayname: author === ME ? "Synthetic User" : "Synthetic Author",
	composetime: `2026-01-01T00:${String(Number(id) % 60).padStart(2, "0")}:00Z`,
	content: text,
	...extra,
});

type ToolResult = { content: { type: string; text: string }[]; details: Record<string, unknown> };
type Tool = { name: string; execute(id: string, params: Record<string, unknown>, signal: undefined, onUpdate: undefined, ctx: unknown): Promise<ToolResult> };

type Harness = {
	key: string;
	ctx: { cwd: string; isIdle(): boolean; ui: { notify(t: string): void }; sessionManager: { getSessionId(): string } };
	stream: RawSkypeMessage[];
	prompts: { text: string; options?: { deliverAs: string }; meta: { chatId: string; policy: string } }[];
	reacts: { messageId: string; type: string; replyTo?: string }[];
	sends: { target: unknown; message: string; card?: unknown }[];
	start(mode?: "shared" | "personal"): Promise<string>;
	restart(mode?: "shared" | "personal"): Promise<void>;
	tick(): Promise<void>;
	tool(name: string): Tool;
	cursor(): CursorFile | null;
	teams: { stopAllWatches(): void; noteAssistantText(text: string): void; turnEnded(): void; replyToSelf(ctx: unknown): Promise<void> };
	idle(v: boolean): void;
	holdHandoff(p: Promise<void>): void;
	holdSend(p: Promise<void>): void;
	failHandoff(n: number): void;
	handoffStarted(): Promise<void>;
	sendStarted(): Promise<void>;
};
const originalInterval = globalThis.setInterval;
let h: Harness | undefined;

afterEach(() => {
	h?.teams.stopAllWatches();
	h = undefined;
	globalThis.setInterval = originalInterval;
	rmSync(join(process.env.WAYNE_INBOX_DIR!, "cursors"), { recursive: true, force: true });
	rmSync(WATCH_LOG, { force: true });
});

function setup() {
	h?.teams.stopAllWatches();
	h = undefined;
	const key = cursorKey({ teamId: TEAM, channelId: CHANNEL });
	rmSync(join(process.env.WAYNE_INBOX_DIR!, "cursors"), { recursive: true, force: true });
	rmSync(WATCH_LOG, { force: true });

	const stream: RawSkypeMessage[] = [];
	const prompts: Harness["prompts"] = [];
	const reacts: Harness["reacts"] = [];
	const sends: Harness["sends"] = [];
	let holdHandoff: Promise<void> | undefined;
	let holdSend: Promise<void> | undefined;
	let handoffFail = 0;
	const handoffStarted = Promise.withResolvers<void>();
	const sendStarted = Promise.withResolvers<void>();
	let idle = true;
	let poll: (() => Promise<void>) | undefined;
	const ctx = { cwd: "/tmp", isIdle: () => idle, ui: { notify: () => {} }, sessionManager: { getSessionId: () => SESSION } };
	const tools = new Map<string, Tool>();

	const backend = {
		resolveChannel: async (a: { teamId?: string; channelId?: string }) => ({ teamId: a.teamId ?? TEAM, channelId: a.channelId ?? CHANNEL, label: "General" }),
		me: async () => ({ oid: OID, name: "Synthetic User" }),
		channelMembers: async () => ({ membershipType: "private", memberOids: [OID] }),
		channelStream: async (_a: unknown, size: number, cursor?: string) => {
			const all = [...stream].sort((a, b) => (BigInt(String(b.id)) < BigInt(String(a.id)) ? -1 : 1));
			const start = cursor === undefined ? 0 : Number(cursor);
			return { raw: all.slice(start, start + size), older: start + size < all.length ? String(start + size) : undefined };
		},
		reactChannel: async (_a: unknown, messageId: string, type: string, opts?: { replyTo?: string }) => {
			reacts.push(opts?.replyTo !== undefined ? { messageId, type, replyTo: opts.replyTo } : { messageId, type });
		},
		send: async (target: SendTarget, message: string, _h: boolean, _m: unknown, _i: unknown, card?: unknown) => {
			const id = String(20000 + sends.length + 1);
			sends.push({ target, message, card });
			if (target.kind === "channel") {
				const text = message.trim() ? message : "card";
				stream.push(raw(id, `${text}\n\nsent by agent`, ME, target.replyTo ? { rootMessageId: target.replyTo } : {}));
			}
			sendStarted.resolve();
			if (holdSend) await holdSend;
			return { id };
		},
		selfMessages: async () => [],
		chatsPage: async () => ({ chats: [] }),
	} as unknown as Backend;

	globalThis.setInterval = ((fn: () => Promise<void>) => { poll = fn; return { unref() {} }; }) as unknown as typeof setInterval;

	const makeTeams = () =>
		createTeams({
			backend,
			registerTool: (t) => void tools.set((t as { name: string }).name, t as unknown as Tool),
			exec: async () => ({ code: 0, stdout: "", stderr: "" }),
			turnEvents: true,
			sendMessage: async () => {},
			sendUserMessage: async (text: string, options: { deliverAs: string } | undefined, meta: { chatId: string; policy: string }) => {
				if (handoffFail > 0) { handoffFail--; throw new Error("synthetic handoff failure"); }
				prompts.push({ text, options, meta });
				handoffStarted.resolve();
				if (holdHandoff) await holdHandoff;
			},
		} as TeamsHost);

	let teams = makeTeams();
	const start = (mode?: "shared" | "personal") => teams.startChannelWatch(ctx, { teamId: TEAM, channelId: CHANNEL, mode });
	const restart = async (mode?: "shared" | "personal") => {
		holdHandoff = undefined;
		holdSend = undefined;
		handoffFail = 0;
		teams.stopAllWatches();
		teams = makeTeams();
		poll = undefined;
		await start(mode);
	};
	const tick = async () => { if (!poll) throw new Error("watch timer missing"); await poll(); };
	const tool = (name: string) => {
		const t = tools.get(name);
		if (!t) throw new Error(`tool ${name} is not registered`);
		return t;
	};

	h = {
		key, ctx, stream, prompts, reacts, sends, start, restart, tick, tool,
		cursor: () => loadCursor(key),
		get teams() { return teams as unknown as Harness["teams"]; },
		idle: (v: boolean) => { idle = v; },
		holdHandoff: (p: Promise<void>) => { holdHandoff = p; },
		holdSend: (p: Promise<void>) => { holdSend = p; },
		failHandoff: (n: number) => { handoffFail = n; },
		handoffStarted: () => handoffStarted.promise,
		sendStarted: () => sendStarted.promise,
	};
	return h;
}

test("crash after hand-off before done: restart re-delivers once with the mark, never as a fresh prompt", async () => {
	const s = setup();
	s.stream.push(raw("100", "old note", ME));
	await s.start("personal");
	s.stream.push(raw("101", "please summarize the deploy thread", ME));
	s.holdHandoff(new Promise(() => {}));
	void s.tick();
	await s.handoffStarted();
	expect(s.prompts).toHaveLength(1);
	expect(s.prompts[0].text).not.toContain("(re-delivered after a restart");
	expect(s.cursor()?.awaiting).toEqual({ "101": ["101"] });
	expect(s.cursor()?.done ?? []).not.toContain("101");

	const before = s.prompts.length;
	await s.restart("personal");
	await s.tick();
	const after = s.prompts.slice(before);
	expect(after).toHaveLength(1);
	expect(after[0].text).toContain("please summarize the deploy thread");
	expect(after[0].text).toContain("(re-delivered after a restart: check the thread before repeating side effects)");
	await s.tick();
	expect(s.prompts.slice(before)).toHaveLength(1);
});

test("crash after Graph answer post before awaiting clear: restart does not re-deliver and clears awaiting", async () => {
	const s = setup();
	s.stream.push(raw("100", "old note", ME));
	await s.start("personal");
	s.stream.push(raw("101", "please summarize the deploy thread", ME));
	await s.tick();
	expect(s.cursor()?.awaiting).toEqual({ "101": ["101"] });
	s.teams.noteAssistantText("Summarized: the deploy went out at noon.");
	s.teams.turnEnded();
	s.holdSend(new Promise(() => {}));
	void s.teams.replyToSelf(s.ctx);
	await s.sendStarted();
	expect(s.sends).toHaveLength(1);
	expect(s.cursor()?.awaiting).toEqual({ "101": ["101"] });

	const before = s.prompts.length;
	await s.restart("personal");
	await s.tick();
	expect(s.prompts.slice(before)).toHaveLength(0);
	expect(s.cursor()?.awaiting).toEqual({});
});

test("👀 on a reply instruction uses replyTo", async () => {
	const s = setup();
	s.stream.push(raw("100", "old note", ME));
	await s.start("personal");
	s.stream.push(raw("101", "root instruction", ME));
	await s.tick();
	expect(s.reacts).toEqual([{ messageId: "101", type: "👀" }]);
	s.idle(false);
	s.stream.push(raw("102", "follow-up in the thread", ME, { rootMessageId: "101" }));
	await s.tick();
	expect(s.reacts[1]).toEqual({ messageId: "102", type: "👀", replyTo: "101" });
});

test("explicit reply mid-turn then a steered follow-up is answered at turn end", async () => {
	const s = setup();
	s.stream.push(raw("100", "old note", ME));
	await s.start("personal");
	s.stream.push(raw("101", "first instruction", ME));
	await s.tick();
	expect(s.cursor()?.awaiting).toEqual({ "101": ["101"] });
	await s.tool("teams_send").execute("t", { target: "channel", team_id: TEAM, channel_id: CHANNEL, reply_to: "101", message: "Checked, all green.", card: false }, undefined, undefined, s.ctx);
	expect(s.cursor()?.awaiting).toEqual({});
	s.idle(false);
	s.stream.push(raw("102", "steered follow-up", ME, { rootMessageId: "101" }));
	await s.tick();
	expect(s.prompts).toHaveLength(2);
	expect(s.prompts[1].options).toEqual({ deliverAs: "steer" });
	expect(s.cursor()?.awaiting).toEqual({ "101": ["102"] });
	s.teams.noteAssistantText("follow-up is handled");
	s.teams.turnEnded();
	s.idle(true);
	await s.tick();
	expect(s.sends.length).toBeGreaterThanOrEqual(2);
	expect(s.sends.at(-1)?.target).toMatchObject({ kind: "channel", teamId: TEAM, channelId: CHANNEL, replyTo: "101" });
	expect(JSON.stringify(s.sends.at(-1)?.card)).toContain("follow-up is handled");
});

test("crash after hand-off before done, own reply already visible: restart does not re-deliver as a fresh prompt", async () => {
	const s = setup();
	s.stream.push(raw("100", "old note", ME));
	await s.start("personal");
	s.stream.push(raw("101", "please summarize the deploy thread", ME));
	s.holdHandoff(new Promise(() => {}));
	void s.tick();
	await s.handoffStarted();
	expect(s.cursor()?.awaiting).toEqual({ "101": ["101"] });
	expect(s.cursor()?.done ?? []).not.toContain("101");
	s.stream.push(raw("102", "Summarized: the deploy went out at noon.\n\nsent by agent", ME, { rootMessageId: "101" }));

	const before = s.prompts.length;
	await s.restart("personal");
	await s.tick();
	expect(s.prompts.slice(before)).toHaveLength(0);
	expect(s.cursor()?.awaiting).toEqual({});
});

test("redelivered hand-off throw keeps the marked command so the next poll retries it", async () => {
	const s = setup();
	s.stream.push(raw("100", "old", ME));
	s.stream.push(raw("101", "please restart me", ME));
	mkdirSync(join(process.env.WAYNE_INBOX_DIR!, "cursors"), { recursive: true });
	writeFileSync(cursorPath(s.key), JSON.stringify({ version: 1, key: s.key, watermark: "100", done: ["101"], awaiting: { "101": ["101"] } }, null, 2));
	s.failHandoff(1);
	await s.start("personal");
	await s.tick();
	expect(s.prompts).toHaveLength(0);
	expect(s.cursor()?.awaiting).toEqual({ "101": ["101"] });
	await s.tick();
	expect(s.prompts).toHaveLength(1);
	expect(s.prompts[0].text).toContain("please restart me");
	expect(s.prompts[0].text).toContain("(re-delivered after a restart: check the thread before repeating side effects)");
	expect(s.reacts).toEqual([]);
});
