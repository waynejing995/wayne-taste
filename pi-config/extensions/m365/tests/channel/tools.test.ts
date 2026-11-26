/**
 * Unit I5: the channel forms of teams_channels, teams_read, teams_send and teams_react, run through createTeams with
 * a fake Graph (TeamsHost.backend) that records every request. Synthetic ids and names only.
 *
 *   bun test tests/channel/tools.test.ts
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createTeams, type TeamsHost } from "../../teams/core.ts";
import { GraphBackend } from "../../teams/graph-backend.ts";
import { GraphClient } from "../../core/graph.ts";
import { claim, type WatchLease } from "../../teams/watch.ts";
import { cursorKey, cursorPath, updateCursor } from "../../teams/cursor-store.ts";

/** Closes a held watch name and waits until it is released, so the next test can claim the same channel. */
async function closeLease(lease: WatchLease): Promise<void> {
	const closed = Promise.withResolvers<void>();
	lease.close((e) => (e ? closed.reject(e) : closed.resolve()));
	await closed.promise;
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const TEAM = "team-1";
const OTHER_TEAM = "team-2";
const CHANNEL = "19:fake-channel@thread.skype";
const DAILY = "19:fake-daily@thread.skype";
const OPS = "19:fake-ops@thread.skype";
const OID = "00000000-0000-4000-8000-000000000001";
const AUTHOR = "00000000-0000-4000-8000-000000000002";
const SESSION = "sess-1";
const BASE = `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}`;

type Reply = { status?: number; json: unknown };
type Route = (path: string, method: string, body: unknown) => Reply | undefined;
type Seen = { url: string; method: string; body: unknown };

/** A fake Graph: answers what the route names, 404s everything else, and records every request it saw. */
function fakeGraph(route: Route = () => undefined) {
	const seen: Seen[] = [];
	const doFetch = async (url: string, init: { method?: string; body?: string }) => {
		const method = init.method ?? "GET";
		const path = decodeURIComponent(url);
		const body = init.body ? JSON.parse(init.body) : undefined;
		seen.push({ url: path, method, body });
		const hit = route(path, method, body) ?? { status: 404, json: { error: { code: "itemNotFound", message: `no route ${path}` } } };
		const text = JSON.stringify(hit.json);
		return { status: hit.status ?? 200, text: async () => text };
	};
	const graph = new GraphClient(async () => "synthetic-token", doFetch as never);
	const backend = new GraphBackend(graph, { whoami: async () => "Operator", oid: async () => OID });
	return { seen, backend };
}

const CTX = { cwd: "/tmp", isIdle: () => true, ui: { notify: () => {} }, sessionManager: { getSessionId: () => SESSION } };

type ToolResult = { content: { type: string; text: string }[] };
type Tool = { name: string; execute(id: string, params: Record<string, unknown>, signal: undefined, onUpdate: undefined, ctx: typeof CTX): Promise<ToolResult> };

/** The tools a Teams core registers when it runs over `backend`, each called by name and returning its text. */
function teamsTools(backend: GraphBackend) {
	const tools = new Map<string, Tool>();
	createTeams({
		registerTool: (tool) => void tools.set(tool.name, tool as unknown as Tool),
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		sendMessage: () => {},
		sendUserMessage: () => {},
		backend,
	} as TeamsHost);
	return async (name: string, params: Record<string, unknown>) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`tool ${name} is not registered`);
		const result = await tool.execute("call", params, undefined, undefined, CTX);
		return result.content.map((c) => c.text).join("\n");
	};
}

const msg = (id: string, at: string, text: string, extra: Record<string, unknown> = {}) => ({
	id,
	createdDateTime: at,
	from: { user: { id: AUTHOR, displayName: "Synthetic Author" } },
	body: { contentType: "text", content: text },
	...extra,
});

const CHANNEL_JSON = { id: CHANNEL, displayName: "General", membershipType: "standard" };

/** The two joined teams and their channels: one with an email, one private, and one archived with no email. */
const DIRECTORY: Route = (path) => {
	if (path === `${GRAPH}/me/joinedTeams`)
		return { json: { value: [{ id: TEAM, displayName: "Eng" }, { id: OTHER_TEAM, displayName: "Ops" }] } };
	if (path === `${GRAPH}/teams/${TEAM}/channels`)
		return {
			json: {
				value: [
					{ id: CHANNEL, displayName: "General", membershipType: "standard", email: "general@contoso.test" },
					{ id: DAILY, displayName: "Daily sync", membershipType: "private" },
				],
			},
		};
	if (path === `${GRAPH}/teams/${OTHER_TEAM}/channels`)
		return { json: { value: [{ id: OPS, displayName: "Ops archive", membershipType: "standard", isArchived: true }] } };
	return undefined;
};

describe("teams_channels", () => {
	test("U1: lists every joined channel with its ids, and a query keeps only the channel it names", async () => {
		const { seen, backend } = fakeGraph(DIRECTORY);
		const call = teamsTools(backend);
		const all = await call("teams_channels", {});
		expect(all).toContain(`Eng / General  team_id: ${TEAM}  channel_id: ${CHANNEL}  standard  email: general@contoso.test`);
		expect(all).toContain(`Ops / Ops archive  team_id: ${OTHER_TEAM}  channel_id: ${OPS}  standard  [archived]`);
		expect(seen.map((s) => s.url)).toEqual([`${GRAPH}/me/joinedTeams`, `${GRAPH}/teams/${TEAM}/channels`, `${GRAPH}/teams/${OTHER_TEAM}/channels`]);

		const one = await call("teams_channels", { query: "DAILY" });
		expect(one).toContain("Daily sync");
		expect(one).not.toContain("General");
	});

	test("U2: a channel with no email and archived renders no email field and says archived; a query matching nothing says so without throwing", async () => {
		const { backend } = fakeGraph(DIRECTORY);
		const call = teamsTools(backend);
		const archived = await call("teams_channels", { query: "archive" });
		const line = archived.split("\n").find((l) => l.includes("Ops archive"));
		expect(line).toContain("[archived]");
		expect(line).not.toContain("email:");
		expect(await call("teams_channels", { query: "nothing-here" })).toBe('No channel matches "nothing-here".');
	});
});

describe("teams_read channel", () => {
	test("U4: ids and no message_id list the roots oldest first, each with its id, subject and reply count", async () => {
		const user = { user: { id: AUTHOR, displayName: "Synthetic Author" } };
		const { seen, backend } = fakeGraph((path) => {
			if (path === BASE) return { json: CHANNEL_JSON };
			if (path === `${BASE}/messages?$top=20&$expand=replies`)
				return {
					json: {
						value: [
							{ id: "1700000000002", createdDateTime: "2026-11-26T09:00:00Z", subject: "Second", from: user, body: { contentType: "text", content: "Second root" }, replies: [] },
							{
								id: "1700000000001",
								createdDateTime: "2026-11-26T08:00:00Z",
								subject: "First",
								from: user,
								body: { contentType: "text", content: "First root" },
								replies: [msg("1700000000003", "2026-11-26T08:10:00Z", "A reply")],
							},
						],
					},
				};
			return undefined;
		});
		const call = teamsTools(backend);
		const out = await call("teams_read", { target: "channel", team_id: TEAM, channel_id: CHANNEL });
		expect(seen.map((s) => s.url)).toContain(`${BASE}/messages?$top=20&$expand=replies`);
		expect(out.indexOf("(id: 1700000000001)")).toBeGreaterThan(-1);
		expect(out.indexOf("(id: 1700000000001)")).toBeLessThan(out.indexOf("(id: 1700000000002)"));
		expect(out).toContain("First (1 replies): First root");
		expect(out).toContain("Second (0 replies): Second root");
	});

	test("U5: message_id reads the root, then every replies page, oldest first, replies carrying reply_to", async () => {
		const ROOT = "1700000000001";
		const NEXT = `${BASE}/messages/${ROOT}/replies?$skiptoken=page-2`;
		const { seen, backend } = fakeGraph((path) => {
			if (path === BASE) return { json: CHANNEL_JSON };
			if (path === `${BASE}/messages/${ROOT}`) return { json: msg(ROOT, "2026-11-26T08:00:00Z", "Root text", { subject: "First" }) };
			if (path === `${BASE}/messages/${ROOT}/replies?$top=50`)
				return { json: { value: [msg("1700000000002", "2026-11-26T08:10:00Z", "Reply one")], "@odata.nextLink": NEXT } };
			if (path === NEXT) return { json: { value: [msg("1700000000003", "2026-11-26T08:20:00Z", "Reply two")] } };
			return undefined;
		});
		const call = teamsTools(backend);
		const out = await call("teams_read", { target: "channel", team_id: TEAM, channel_id: CHANNEL, message_id: ROOT });
		expect(seen.map((s) => s.url)).toEqual(expect.arrayContaining([`${BASE}/messages/${ROOT}`, `${BASE}/messages/${ROOT}/replies?$top=50`, NEXT]));
		const root = out.indexOf(`(id: ${ROOT})`);
		const one = out.indexOf("(id: 1700000000002, reply_to: 1700000000001)");
		const two = out.indexOf("(id: 1700000000003, reply_to: 1700000000001)");
		expect(root).toBeGreaterThan(-1);
		expect(root).toBeLessThan(one);
		expect(one).toBeLessThan(two);
	});

	test("U5: a thread reply with a reaction prints reactions under that reply", async () => {
		const ROOT = "1700000000001";
		const { backend } = fakeGraph((path) => {
			if (path === BASE) return { json: CHANNEL_JSON };
			if (path === `${BASE}/messages/${ROOT}`) return { json: msg(ROOT, "2026-11-26T08:00:00Z", "Root text") };
			if (path === `${BASE}/messages/${ROOT}/replies?$top=50`)
				return { json: { value: [msg("1700000000002", "2026-11-26T08:10:00Z", "Reply with a reaction", { reactions: [{ reactionType: "👍" }] })] } };
			return undefined;
		});
		const call = teamsTools(backend);
		const out = await call("teams_read", { target: "channel", team_id: TEAM, channel_id: CHANNEL, message_id: ROOT });
		const reply = out.indexOf("(id: 1700000000002, reply_to: 1700000000001)");
		const reactions = out.indexOf("reactions: 👍 1");
		expect(reply).toBeGreaterThan(-1);
		expect(reactions).toBeGreaterThan(reply);
	});

	test("U6: a read with neither ids nor names, or until without since, throws before any request", async () => {
		const { seen, backend } = fakeGraph(DIRECTORY);
		const call = teamsTools(backend);
		await expect(call("teams_read", { target: "channel" })).rejects.toThrow();
		await expect(call("teams_read", { target: "channel", team_id: TEAM, channel_id: CHANNEL, until: "2026-11-26 09:00" })).rejects.toThrow("`until` needs `since`");
		expect(seen).toHaveLength(0);
	});

	test("U6: an ambiguous channel name throws after its one listing, and no message request follows", async () => {
		const { seen, backend } = fakeGraph((path) => {
			if (path === `${GRAPH}/me/joinedTeams`) return { json: { value: [{ id: TEAM, displayName: "Eng" }] } };
			if (path === `${GRAPH}/teams/${TEAM}/channels`)
				return {
					json: {
						value: [
							{ id: "19:fake-daily-a@thread.skype", displayName: "Daily sync", membershipType: "standard" },
							{ id: "19:fake-daily-b@thread.skype", displayName: "Daily standup", membershipType: "standard" },
						],
					},
				};
			return undefined;
		});
		const call = teamsTools(backend);
		await expect(call("teams_read", { target: "channel", team: "Eng", channel: "Daily" })).rejects.toThrow("Ambiguous channel");
		expect(seen.map((s) => s.url)).toEqual([`${GRAPH}/me/joinedTeams`, `${GRAPH}/teams/${TEAM}/channels`]);
	});
});

describe("teams_send channel root and the cursor store", () => {
	/** Each root post gets the next id from 1700000000100, so every post in a test is distinct. */
	function postRoutes(): Route {
		let next = 100;
		return (path, method) => {
			if (path === `${BASE}`) return { json: CHANNEL_JSON };
			if (path === `${GRAPH}/teams/${TEAM}/channels/${DAILY}`) return { json: { id: DAILY, displayName: "Daily sync", membershipType: "private" } };
			if ((path === `${BASE}/messages` || path === `${GRAPH}/teams/${TEAM}/channels/${DAILY}/messages`) && method === "POST")
				return { status: 201, json: { id: String(1700000000000 + next++), webUrl: "https://teams.test/general/post" } };
			return undefined;
		};
	}

	const readCursor = (key: string) => JSON.parse(readFileSync(cursorPath(key), "utf8")) as { threads?: Record<string, unknown> };

	test("U10: a root post writes its thread into a live channel's cursor file; with no live watch the file stays as it was and none is created", async () => {
		const key = cursorKey({ teamId: TEAM, channelId: CHANNEL });
		const idle = cursorKey({ teamId: TEAM, channelId: DAILY });
		updateCursor(key, (c) => c, () => ({ version: 1, key, watermark: "1700000000000", done: [] }));

		const { seen, backend } = fakeGraph(postRoutes());
		const call = teamsTools(backend);
		const lease = await claim({
			chatId: key,
			label: "Synthetic channel",
			pid: process.pid,
			sessionId: "other-session",
			cwd: "/tmp",
			since: new Date().toISOString(),
		});
		if (!("lease" in lease)) throw new Error("the synthetic channel's watch is already held by a peer");
		try {
			const first = await call("teams_send", { target: "channel", team_id: TEAM, channel_id: CHANNEL, message: "First root", card: false });
			expect(first).toContain("(id: 1700000000100) https://teams.test/general/post");
			expect(readCursor(key).threads).toEqual({ "1700000000100": { owner: `session:${SESSION}` } });

			await call("teams_send", { target: "channel", team_id: TEAM, channel_id: CHANNEL, message: "Second root", card: false, subject: "Daily", bind: "inbox:42" });
			expect(readCursor(key).threads).toEqual({
				"1700000000100": { owner: `session:${SESSION}` },
				"1700000000101": { owner: "inbox:42", subject: "Daily" },
			});
		} finally {
			await closeLease(lease.lease);
		}
		const before = readFileSync(cursorPath(key), "utf8");
		await call("teams_send", { target: "channel", team_id: TEAM, channel_id: CHANNEL, message: "Third root", card: false });
		expect(readFileSync(cursorPath(key), "utf8")).toBe(before);

		await call("teams_send", { target: "channel", team_id: TEAM, channel_id: DAILY, message: "Unwatched root", card: false });
		expect(existsSync(cursorPath(idle))).toBe(false);
		expect(seen.filter((s) => s.method === "POST").map((s) => s.url)).toEqual([
			`${BASE}/messages`,
			`${BASE}/messages`,
			`${BASE}/messages`,
			`${GRAPH}/teams/${TEAM}/channels/${DAILY}/messages`,
		]);
	});

	test("a root posted by team and channel name binds under the channel's real ids, not the names", async () => {
		const key = cursorKey({ teamId: TEAM, channelId: CHANNEL });
		updateCursor(key, (c) => c, () => ({ version: 1, key, watermark: "1700000000000", done: [] }));
		const { backend } = fakeGraph((path, method) => {
			if (path === `${GRAPH}/me/joinedTeams`) return { json: { value: [{ id: TEAM, displayName: "Eng" }] } };
			if (path === `${GRAPH}/teams/${TEAM}/channels`) return { json: { value: [{ id: CHANNEL, displayName: "General", membershipType: "standard" }] } };
			if (path === BASE) return { json: { id: CHANNEL, displayName: "General", membershipType: "standard" } };
			if (path === `${BASE}/messages` && method === "POST") return { status: 201, json: { id: "1700000000200", webUrl: "https://teams.test/general/named" } };
			return undefined;
		});
		const call = teamsTools(backend);
		const lease = await claim({ chatId: key, label: "General", pid: process.pid, sessionId: "other-session", cwd: "/tmp", since: new Date().toISOString() });
		if (!("lease" in lease)) throw new Error("the synthetic channel's watch is already held by a peer");
		try {
			const text = await call("teams_send", { target: "channel", team: "Eng", channel: "General", message: "Named root", card: false, subject: "By name" });
			expect(text).toContain("(id: 1700000000200) https://teams.test/general/named");
			expect(JSON.parse(readFileSync(cursorPath(key), "utf8")).threads).toMatchObject({
				"1700000000200": { owner: `session:${SESSION}`, subject: "By name" },
			});
			expect(existsSync(cursorPath(cursorKey({ teamId: "Eng", channelId: "General" })))).toBe(false);
		} finally {
			await closeLease(lease.lease);
		}
	});

	test("a reply by team and channel name reaches the thread hook under the real channel key", async () => {
		const { backend } = fakeGraph((path, method) => {
			if (path === `${GRAPH}/me/joinedTeams`) return { json: { value: [{ id: TEAM, displayName: "Eng" }] } };
			if (path === `${GRAPH}/teams/${TEAM}/channels`) return { json: { value: [{ id: CHANNEL, displayName: "General", membershipType: "standard" }] } };
			if (path === BASE) return { json: { id: CHANNEL, displayName: "General", membershipType: "standard" } };
			if (path === `${BASE}/messages/1700000000201/replies` && method === "POST") return { status: 201, json: { id: "1700000000202", webUrl: "https://teams.test/general/reply" } };
			return undefined;
		});
		const call = teamsTools(backend);
		const text = await call("teams_send", { target: "channel", team: "Eng", channel: "General", message: "A reply", card: false, reply_to: "1700000000201" });
		expect(text).toContain("(id: 1700000000202)");
	});
});

describe("teams_react channel addressing", () => {
	test("U12: both chat and channel ids, neither, only team_id, and only channel_id each throw before any request", async () => {
		const { seen, backend } = fakeGraph();
		const call = teamsTools(backend);
		const base = { message_id: "1700000000001", reaction: "like" };
		await expect(call("teams_react", { ...base, chat_id: "48:notes", team_id: TEAM, channel_id: CHANNEL })).rejects.toThrow("exactly one");
		await expect(call("teams_react", base)).rejects.toThrow("exactly one");
		await expect(call("teams_react", { ...base, team_id: TEAM })).rejects.toThrow("exactly one");
		await expect(call("teams_react", { ...base, channel_id: CHANNEL })).rejects.toThrow("exactly one");
		expect(seen).toHaveLength(0);
	});
});
