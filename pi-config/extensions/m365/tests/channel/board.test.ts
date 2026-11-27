/**
 * Offline unit tests for SharePoint task-board sync (teams/board.ts), teams_board tool,
 * teams_react("✅") personal-channel root lifecycle hook, and inbox board CLI validation.
 *
 *   bun test --preload ./tests/channel/preload.ts ./tests/channel/board.test.ts
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	BoardClient,
	type BoardConfig,
	type BoardTransport,
	DEFAULT_BOARD_COLUMNS,
	SharePointError,
	buildKanbanFormatter,
	buildThreadUrl,
	sanitizeThreadUrl,
} from "../../teams/board.ts";
import { createTeams, type TeamsHost } from "../../teams/core.ts";
import { GraphBackend } from "../../teams/graph-backend.ts";
import { GraphClient } from "../../core/graph.ts";
import { inbox } from "../../inbox/cli/main.ts";

const INBOX_DIR = process.env.WAYNE_INBOX_DIR;
if (!INBOX_DIR) throw new Error("WAYNE_INBOX_DIR is not set: bunfig.toml / preload must run first");
const RULES = join(INBOX_DIR, "rules.yaml");

const SITE_URL = "https://contoso.sharepoint.test/sites/AgentSite";
const LIST_ID = "00000000-0000-4000-8000-000000000099";
const TEAM_ID = "00000000-0000-4000-8000-000000000010";
const CHANNEL_ID = "19:fake-personal@thread.skype";
const SHARED_CHANNEL_ID = "19:fake-shared@thread.skype";
const TENANT_ID = "00000000-0000-4000-8000-000000000020";
const ENTITY_TYPE = "SP.Data.Task_x0020_boardListItem";
const OID = "00000000-0000-4000-8000-000000000001";

const CFG: BoardConfig = {
	site_url: SITE_URL,
	list_id: LIST_ID,
};

function fakeJwt(tid: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({ tid, oid: OID })).toString("base64url");
	return `${header}.${payload}.sig`;
}

type SeenReq = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: unknown;
};

interface FakeSharePointItem {
	Id: number;
	Title: string;
	board_x0020_choice: string;
	Summary?: string;
	ThreadId: string;
	ThreadLink?: { Url: string; Description?: string };
}

interface FakeSharePointField {
	Id: string;
	InternalName: string;
	Title: string;
	TypeAsString: string;
	Choices?: string[];
}

interface FakeSharePointView {
	Id: string;
	Title: string;
	ViewType: string;
	ViewType2?: string;
	CustomFormatter?: string;
}

function makeFakeSharePoint(opts: {
	items?: FakeSharePointItem[];
	fields?: FakeSharePointField[];
	views?: FakeSharePointView[];
	staleDigestCount?: number;
	always403Mutation?: boolean;
	failAllRequests?: boolean;
} = {}) {
	const seen: SeenReq[] = [];
	const scopesRequested: string[] = [];
	const items: FakeSharePointItem[] = [...(opts.items ?? [])];
	const fields: FakeSharePointField[] = [...(opts.fields ?? [])];
	const views: FakeSharePointView[] = [...(opts.views ?? [])];
	let nextId = items.reduce((m, i) => Math.max(m, i.Id), 0) + 1;
	let digestGen = 0;
	let remaining403 = opts.staleDigestCount ?? 0;

	const transport: BoardTransport = async (rawUrl, init) => {
		const url = decodeURIComponent(rawUrl);
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(init.body) : undefined;
		seen.push({ url, method, headers: init.headers, body });

		if (opts.failAllRequests) {
			return { status: 500, text: async () => JSON.stringify({ error: { message: "SharePoint unavailable" } }) };
		}

		if (url === `${SITE_URL}/_api/contextinfo` && method === "POST") {
			digestGen++;
			return {
				status: 200,
				text: async () =>
					JSON.stringify({
						d: {
							GetContextWebInformation: {
								FormDigestValue: `digest-${digestGen}`,
								FormDigestTimeoutSeconds: 1800,
							},
						},
					}),
			};
		}

		if (method === "POST" && (opts.always403Mutation || remaining403 > 0)) {
			if (remaining403 > 0) remaining403--;
			return {
				status: 403,
				text: async () =>
					JSON.stringify({
						"odata.error": { code: "-2130575251, Microsoft.SharePoint.SPException", message: { value: "The security validation for this page is invalid." } },
					}),
			};
		}

		if (url === `${SITE_URL}/_api/web/lists(guid'${LIST_ID}')?$select=ListItemEntityTypeFullName` && method === "GET") {
			return { status: 200, text: async () => JSON.stringify({ ListItemEntityTypeFullName: ENTITY_TYPE }) };
		}

		if (url.startsWith(`${SITE_URL}/_api/web/lists(guid'${LIST_ID}')/items`) && method === "GET") {
			const filterMatch = url.match(/\$filter=ThreadId eq '([^']*(?:''[^']*)*)'/);
			if (filterMatch) {
				const wanted = filterMatch[1].replace(/''/g, "'");
				const matched = items.filter((i) => i.ThreadId === wanted);
				return { status: 200, text: async () => JSON.stringify({ value: matched }) };
			}
			return { status: 200, text: async () => JSON.stringify({ value: items }) };
		}

		if (url === `${SITE_URL}/_api/web/lists(guid'${LIST_ID}')/items` && method === "POST") {
			const created: FakeSharePointItem = {
				Id: nextId++,
				Title: body.Title,
				board_x0020_choice: body.board_x0020_choice,
				ThreadId: body.ThreadId,
				...(body.Summary !== undefined ? { Summary: body.Summary } : {}),
				...(body.ThreadLink ? { ThreadLink: { Url: body.ThreadLink.Url, Description: body.ThreadLink.Description } } : {}),
			};
			items.push(created);
			return { status: 201, text: async () => JSON.stringify({ d: created }) };
		}

		const itemMatch = url.match(new RegExp(`^${SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/_api/web/lists\\(guid'${LIST_ID}'\\)/items\\((\\d+)\\)$`));
		if (itemMatch && method === "POST" && init.headers["X-HTTP-Method"] === "MERGE") {
			const id = Number(itemMatch[1]);
			const existing = items.find((i) => i.Id === id);
			if (!existing) return { status: 404, text: async () => JSON.stringify({ error: { message: "Item not found" } }) };
			if (body.Title !== undefined) existing.Title = body.Title;
			if (body.board_x0020_choice !== undefined) existing.board_x0020_choice = body.board_x0020_choice;
			if (body.Summary !== undefined) existing.Summary = body.Summary;
			if (body.ThreadLink !== undefined) existing.ThreadLink = { Url: body.ThreadLink.Url, Description: body.ThreadLink.Description };
			return { status: 204, text: async () => "" };
		}

		if (url.startsWith(`${SITE_URL}/_api/web/lists(guid'${LIST_ID}')/fields?`) && method === "GET") {
			return { status: 200, text: async () => JSON.stringify({ value: fields }) };
		}

		if (url === `${SITE_URL}/_api/web/lists(guid'${LIST_ID}')/fields/createfieldasxml` && method === "POST") {
			const xml: string = body?.parameters?.SchemaXml ?? "";
			const nameMatch = xml.match(/Name="([^"]+)"/);
			const typeMatch = xml.match(/Type="([^"]+)"/);
			const choices = [...xml.matchAll(/<CHOICE>([^<]+)<\/CHOICE>/g)].map((m) => m[1]);
			const internalName = nameMatch?.[1] ?? "unknown";
			fields.push({
				Id: `field-${fields.length + 1}`,
				InternalName: internalName,
				Title: internalName,
				TypeAsString: typeMatch?.[1] ?? "Text",
				...(choices.length > 0 ? { Choices: choices } : {}),
			});
			return { status: 200, text: async () => JSON.stringify({ d: { InternalName: internalName } }) };
		}

		const fieldPatchMatch = url.match(new RegExp(`^${SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/_api/web/lists\\(guid'${LIST_ID}'\\)/fields\\(guid'([^']+)'\\)$`));
		if (fieldPatchMatch && method === "POST" && init.headers["X-HTTP-Method"] === "MERGE") {
			const fid = fieldPatchMatch[1];
			const target = fields.find((f) => f.Id === fid);
			if (!target) return { status: 404, text: async () => "{}" };
			if (Array.isArray(body?.Choices?.results)) target.Choices = body.Choices.results;
			return { status: 204, text: async () => "" };
		}

		if (url.startsWith(`${SITE_URL}/_api/web/lists(guid'${LIST_ID}')/views?`) && method === "GET") {
			return { status: 200, text: async () => JSON.stringify({ value: views }) };
		}

		const viewPatchMatch = url.match(new RegExp(`^${SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/_api/web/lists\\(guid'${LIST_ID}'\\)/views\\(guid'([^']+)'\\)$`));
		if (viewPatchMatch && method === "POST" && init.headers["X-HTTP-Method"] === "MERGE") {
			const vid = viewPatchMatch[1];
			const target = views.find((v) => v.Id === vid);
			if (!target) return { status: 404, text: async () => "{}" };
			target.CustomFormatter = body.CustomFormatter;
			return { status: 204, text: async () => "" };
		}

		return { status: 404, text: async () => JSON.stringify({ error: { message: `Unhandled ${method} ${url}` } }) };
	};

	const client = new BoardClient({
		token: async (scope) => {
			scopesRequested.push(scope);
			return fakeJwt(TENANT_ID);
		},
		fetch: transport,
	});

	return { client, seen, scopesRequested, items, fields, views };
}

function writeRulesWithPersonalBoard(extraChannelsYaml = "") {
	mkdirSync(INBOX_DIR!, { recursive: true });
	writeFileSync(
		RULES,
		[
			"teams_watch:",
			"  chats: []",
			"  channels:",
			"    - channel: Agent Desk",
			`      team_id: ${TEAM_ID}`,
			`      channel_id: "${CHANNEL_ID}"`,
			"      mode: personal",
			'      policy: ""',
			"      board:",
			`        site_url: ${SITE_URL}`,
			`        list_id: ${LIST_ID}`,
			extraChannelsYaml,
		].join("\n"),
	);
}

beforeEach(() => {
	if (existsSync(RULES)) rmSync(RULES);
});

afterEach(() => {
	if (existsSync(RULES)) rmSync(RULES);
});

describe("URL guard (SPFieldUrl 255-char limit)", () => {
	test("strips &createdTime=<id> automatically and keeps valid <= 255-char URLs", () => {
		const raw = `https://teams.microsoft.com/l/message/${encodeURIComponent(CHANNEL_ID)}/1700000000001?tenantId=${TENANT_ID}&groupId=${TEAM_ID}&parentMessageId=1700000000001&createdTime=1700000000001`;
		const cleaned = sanitizeThreadUrl(raw);
		expect(cleaned).not.toContain("createdTime");
		expect(cleaned).toContain(`tenantId=${TENANT_ID}`);
		expect(cleaned).toContain("parentMessageId=1700000000001");
		expect(cleaned.length).toBeLessThanOrEqual(255);
	});

	test("throws clearly when a URL still exceeds 255 chars after stripping createdTime", () => {
		const long = `https://teams.microsoft.com/l/message/19:fake/1?tenantId=${TENANT_ID}&extra=${"a".repeat(220)}&createdTime=99`;
		expect(() => sanitizeThreadUrl(long)).toThrow("255-char SPFieldUrl limit");
	});

	test("buildThreadUrl builds a valid Teams deep link <= 255 chars without createdTime", () => {
		const built = buildThreadUrl({ teamId: TEAM_ID, channelId: CHANNEL_ID, tenantId: TENANT_ID, threadId: "1700000000123" });
		expect(built).toContain("https://teams.microsoft.com/l/message/");
		expect(built).toContain(`groupId=${TEAM_ID}`);
		expect(built).toContain("parentMessageId=1700000000123");
		expect(built).not.toContain("createdTime");
		expect(built.length).toBeLessThanOrEqual(255);
	});
});

describe("BoardClient REST operations", () => {
	test("upsertCard creates on missing ThreadId (caching ListItemEntityTypeFullName) and MERGEs only supplied fields on existing ThreadId", async () => {
		const sp = makeFakeSharePoint();
		const created = await sp.client.upsertCard(CFG, {
			threadId: "1700000000001",
			title: "Investigate timeout",
			summary: "Initial summary",
			status: "waiting",
			threadUrl: `https://teams.microsoft.com/l/message/ch/1700000000001?tenantId=${TENANT_ID}&createdTime=1700000000001`,
		});
		expect(created).toEqual({
			action: "created",
			id: 1,
			threadId: "1700000000001",
			status: "waiting",
			column: DEFAULT_BOARD_COLUMNS.waiting,
		});
		expect(sp.scopesRequested.every((s) => s === "https://contoso.sharepoint.test/.default")).toBe(true);
		expect(sp.items[0].ThreadLink?.Url).not.toContain("createdTime");

		// Update only status -> Title, Summary, ThreadLink remain intact (not overwritten!)
		const updated = await sp.client.upsertCard(CFG, {
			threadId: "1700000000001",
			status: "working",
		});
		expect(updated).toEqual({
			action: "updated",
			id: 1,
			threadId: "1700000000001",
			status: "working",
			column: DEFAULT_BOARD_COLUMNS.working,
		});
		expect(sp.items[0].Title).toBe("Investigate timeout");
		expect(sp.items[0].Summary).toBe("Initial summary");
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.working);

		// Entity type was queried only once across both mutations
		const entityLookups = sp.seen.filter((r) => r.url.includes("$select=ListItemEntityTypeFullName"));
		expect(entityLookups.length).toBe(1);
		// MERGE sent only __metadata and board_x0020_choice
		const mergeReq = sp.seen.find((r) => r.headers["X-HTTP-Method"] === "MERGE");
		expect(mergeReq?.body).toEqual({
			__metadata: { type: ENTITY_TYPE },
			board_x0020_choice: DEFAULT_BOARD_COLUMNS.working,
		});
	});

	test("moveCard moves existing card and returns { updated: false } on missing card", async () => {
		const sp = makeFakeSharePoint({
			items: [{ Id: 7, Title: "Existing", board_x0020_choice: DEFAULT_BOARD_COLUMNS.working, ThreadId: "t-7" }],
		});
		const missing = await sp.client.moveCard(CFG, "t-missing", "done");
		expect(missing).toEqual({ updated: false, threadId: "t-missing", status: "done", column: DEFAULT_BOARD_COLUMNS.done });
		expect(sp.seen.some((r) => r.method === "POST")).toBe(false);

		const moved = await sp.client.moveCard(CFG, "t-7", "done");
		expect(moved).toEqual({ updated: true, id: 7, threadId: "t-7", status: "done", column: DEFAULT_BOARD_COLUMNS.done });
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.done);
	});

	test("FormDigestValue is cached per origin and refreshes once on HTTP 403 stale digest", async () => {
		const sp = makeFakeSharePoint({
			items: [{ Id: 1, Title: "Card", board_x0020_choice: DEFAULT_BOARD_COLUMNS.waiting, ThreadId: "t-1" }],
			staleDigestCount: 1, // First mutation attempt returns 403 -> refresh once -> succeeds
		});
		// First mutation: fetches digest-1, gets 403, refreshes digest-2, succeeds
		await sp.client.moveCard(CFG, "t-1", "working");
		// Second mutation: reuses cached digest-2 without hitting _api/contextinfo again!
		await sp.client.moveCard(CFG, "t-1", "done");

		const digestCalls = sp.seen.filter((r) => r.url.endsWith("/_api/contextinfo"));
		expect(digestCalls.length).toBe(2);
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.done);

		// Persistent 403 fails loudly after exactly one retry
		const failing = makeFakeSharePoint({
			items: [{ Id: 1, Title: "Card", board_x0020_choice: DEFAULT_BOARD_COLUMNS.waiting, ThreadId: "t-1" }],
			always403Mutation: true,
		});
		await expect(failing.client.moveCard(CFG, "t-1", "done")).rejects.toThrow(SharePointError);
		expect(failing.seen.filter((r) => r.url.endsWith("/_api/contextinfo")).length).toBe(2);
	});

	test("ensureSchema creates missing fields, updates choices, and patches KANBAN view without KanbanCardDesigner100 or designerConfig", async () => {
		const sp = makeFakeSharePoint({
			fields: [
				{ Id: "f-choice", InternalName: "board_x0020_choice", Title: "board choice", TypeAsString: "Choice", Choices: [DEFAULT_BOARD_COLUMNS.waiting] },
			],
			views: [{ Id: "v-board", Title: "Board", ViewType: "HTML", ViewType2: "KANBAN", CustomFormatter: "{}" }],
		});

		const res = await sp.client.ensureSchema(CFG);
		expect(res.createdFields).toEqual(["Summary", "ThreadLink", "ThreadId"]);
		expect(res.updatedFields).toEqual(["board_x0020_choice"]);
		expect(res.viewPatched).toBe(true);
		expect(res.viewTitle).toBe("Board");

		const choiceField = sp.fields.find((f) => f.InternalName === "board_x0020_choice");
		expect(choiceField?.Choices).toEqual([DEFAULT_BOARD_COLUMNS.waiting, DEFAULT_BOARD_COLUMNS.working, DEFAULT_BOARD_COLUMNS.done]);

		const rawFormatter = sp.views[0].CustomFormatter!;
		expect(rawFormatter).not.toContain("KanbanCardDesigner100");
		expect(rawFormatter).not.toContain("designerConfig");
		const parsed = JSON.parse(rawFormatter);
		expect(parsed).toEqual(buildKanbanFormatter());
		expect(parsed.kanbanProps.formatter.elmType).toBe("div");
		expect(rawFormatter).toContain("[$Title]");
		expect(rawFormatter).toContain("[$Summary]");
		expect(rawFormatter).toContain("[$ThreadLink]");
	});

	test("listCards maps columns back to waiting/working/done statuses", async () => {
		const sp = makeFakeSharePoint({
			items: [
				{
					Id: 11,
					Title: "Review PR",
					board_x0020_choice: DEFAULT_BOARD_COLUMNS.waiting,
					Summary: "Needs decision",
					ThreadId: "1700000000011",
					ThreadLink: { Url: "https://teams.microsoft.com/l/message/c/1700000000011", Description: "Open thread" },
				},
			],
		});
		const cards = await sp.client.listCards(CFG);
		expect(cards).toEqual([
			{
				id: 11,
				title: "Review PR",
				status: "waiting",
				column: DEFAULT_BOARD_COLUMNS.waiting,
				summary: "Needs decision",
				threadId: "1700000000011",
				threadUrl: "https://teams.microsoft.com/l/message/c/1700000000011",
				linkDescription: "Open thread",
			},
		]);
	});
});

describe("teams_board tool & teams_react personal-channel board hook", () => {
	function makeTeamsHarness(sp: ReturnType<typeof makeFakeSharePoint>) {
		const reactCalls: { path: string; body: unknown }[] = [];
		const doGraphFetch = async (url: string, init: { method?: string; body?: string }) => {
			const path = decodeURIComponent(url);
			const method = init.method ?? "GET";
			const body = init.body ? JSON.parse(init.body) : undefined;
			if (path === `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${CHANNEL_ID}` && method === "GET") {
				return { status: 200, text: async () => JSON.stringify({ id: CHANNEL_ID, displayName: "Agent Desk", membershipType: "private" }) };
			}
			if (path === `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${SHARED_CHANNEL_ID}` && method === "GET") {
				return { status: 200, text: async () => JSON.stringify({ id: SHARED_CHANNEL_ID, displayName: "Shared Room", membershipType: "standard" }) };
			}
			if (path === `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}` && method === "GET") {
				return { status: 200, text: async () => JSON.stringify({ id: TEAM_ID, displayName: "Control Plane" }) };
			}
			if (path.includes("/setReaction") || path.includes("/unsetReaction")) {
				reactCalls.push({ path, body });
				return { status: 204, text: async () => "" };
			}
			return { status: 404, text: async () => JSON.stringify({ error: { message: `No fake route ${method} ${path}` } }) };
		};
		const graph = new GraphClient(async () => fakeJwt(TENANT_ID), doGraphFetch as never);
		const backend = new GraphBackend(graph, { whoami: async () => "Operator", oid: async () => OID });

		const tools = new Map<string, { execute(id: string, params: Record<string, unknown>, s: undefined, u: undefined, ctx: unknown): Promise<{ content: { text: string }[] }> }>();
		createTeams({
			registerTool: (t) => void tools.set(t.name, t as never),
			exec: async () => ({ code: 0, stdout: "", stderr: "" }),
			sendMessage: () => {},
			sendUserMessage: () => {},
			backend,
			board: sp.client,
		} as TeamsHost);

		const ctx = { cwd: "/tmp", isIdle: () => true, ui: { notify: () => {} }, sessionManager: { getSessionId: () => "sess-board" } };
		const call = async (name: string, params: Record<string, unknown>) => {
			const t = tools.get(name);
			if (!t) throw new Error(`missing tool ${name}`);
			const r = await t.execute("call", params, undefined, undefined, ctx);
			return r.content.map((c) => c.text).join("\n");
		};
		return { call, reactCalls };
	}

	test("teams_board upsert auto-builds thread_url from personal channel + tid claim, then list and done work end-to-end", async () => {
		writeRulesWithPersonalBoard();
		const sp = makeFakeSharePoint({
			views: [{ Id: "v-1", Title: "Board", ViewType: "HTML", ViewType2: "KANBAN" }],
		});
		const { call } = makeTeamsHarness(sp);

		const setupOut = await call("teams_board", { action: "setup" });
		expect(setupOut).toContain("Board setup complete");
		expect(setupOut).toContain('patched KANBAN view "Board"');

		const upOut = await call("teams_board", {
			action: "upsert",
			thread_id: "1700000000100",
			status: "waiting",
			title: "Approve deploy",
			summary: "Ready for decision",
		});
		expect(upOut).toContain('Created card #1 for thread 1700000000100 in "🟡 待拍板"');
		expect(sp.items[0].ThreadLink?.Url).toContain(`tenantId=${TENANT_ID}`);
		expect(sp.items[0].ThreadLink?.Url).toContain(`groupId=${TEAM_ID}`);
		expect(sp.items[0].ThreadLink?.Url).toContain("parentMessageId=1700000000100");

		const listOut = await call("teams_board", { action: "list" });
		expect(listOut).toContain("#1 [🟡 待拍板] Approve deploy  thread_id: 1700000000100");
		expect(listOut).toContain("summary: Ready for decision");

		const doneOut = await call("teams_board", { action: "done", thread_id: "1700000000100" });
		expect(doneOut).toContain('Moved card #1 for thread 1700000000100 to "✅ 已完成"');
	});

	test("teams_react('✅') on personal channel root moves matching card to done, and ignores reply / other emoji / remove / non-board channel", async () => {
		writeRulesWithPersonalBoard([
			"    - channel: Shared Room",
			`      team_id: ${TEAM_ID}`,
			`      channel_id: "${SHARED_CHANNEL_ID}"`,
			"      mode: shared",
			'      policy: ""',
			"      board:",
			`        site_url: ${SITE_URL}`,
			`        list_id: ${LIST_ID}`,
			"",
		].join("\n"));

		const sp = makeFakeSharePoint({
			items: [{ Id: 5, Title: "Personal Task", board_x0020_choice: DEFAULT_BOARD_COLUMNS.working, ThreadId: "1700000000555" }],
		});
		const { call, reactCalls } = makeTeamsHarness(sp);

		// 1. Reply in personal channel -> should NOT move card
		await call("teams_react", { team_id: TEAM_ID, channel_id: CHANNEL_ID, reply_to: "1700000000555", message_id: "1700000000555", reaction: "✅" });
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.working);

		// 2. Non-✅ emoji on root -> should NOT move card
		await call("teams_react", { team_id: TEAM_ID, channel_id: CHANNEL_ID, message_id: "1700000000555", reaction: "👍" });
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.working);

		// 3. Removing ✅ on root -> should NOT move card
		await call("teams_react", { team_id: TEAM_ID, channel_id: CHANNEL_ID, message_id: "1700000000555", reaction: "✅", remove: true });
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.working);

		// 4. Shared channel root ✅ -> should NOT move card (personal mode only)
		await call("teams_react", { team_id: TEAM_ID, channel_id: SHARED_CHANNEL_ID, message_id: "1700000000555", reaction: "✅" });
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.working);

		// 5. Personal channel root ✅ -> moves card to done!
		const out = await call("teams_react", { team_id: TEAM_ID, channel_id: CHANNEL_ID, message_id: "1700000000555", reaction: "✅" });
		expect(out).toContain("Reacted ✅ to message 1700000000555");
		expect(out).toContain('Board card #5 moved to "✅ 已完成"');
		expect(sp.items[0].board_x0020_choice).toBe(DEFAULT_BOARD_COLUMNS.done);
		expect(reactCalls.length).toBe(5);
	});

	test("teams_react('✅') surfaces warning when board call fails, without hiding Teams reaction success", async () => {
		writeRulesWithPersonalBoard();
		const sp = makeFakeSharePoint({ failAllRequests: true });
		const { call, reactCalls } = makeTeamsHarness(sp);

		const originalWarn = console.warn;
		const warns: unknown[] = [];
		console.warn = (...args: unknown[]) => warns.push(args);
		try {
			const out = await call("teams_react", { team_id: TEAM_ID, channel_id: CHANNEL_ID, message_id: "1700000000999", reaction: "✅" });
			expect(reactCalls.length).toBe(1);
			expect(out).toContain("Reacted ✅ to message 1700000000999");
			expect(out).toContain("Warning: board sync failed (SharePoint 500");
			expect(warns.length).toBe(1);
		} finally {
			console.warn = originalWarn;
		}
	});
});

describe("inbox board CLI", () => {
	test("inbox board --help and missing board config return clean messages/errors", async () => {
		const help = await inbox(["board", "list", "--help"]);
		expect(help).toContain("Usage: inbox board list");
		let caught: unknown;
		try {
			await inbox(["board", "list"]);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(Error);
		expect((caught as Error).message).toContain("No personal channel with a board config found");
	});
});
