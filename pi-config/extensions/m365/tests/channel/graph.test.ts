/**
 * Unit I3: the graph backend's channel operations and the script backend's refusal. A fake Graph serves synthetic
 * teams, channels, people and uploads and records every request; synthetic ids and names only.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphBackend } from "../../teams/graph-backend.ts";
import { ScriptBackend } from "../../teams/backend.ts";
import { GraphClient } from "../../core/graph.ts";
import { renderWithMentions } from "../../teams/mentions.ts";
import type { SendTarget } from "../../teams/types.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TEAM = "team-1";
const CHANNEL = "19:fake-channel@thread.skype";
const OID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const GUID = "2B4C9ABD-2954-4C9F-AF98-87D2EE333032";
const CARD = { type: "AdaptiveCard", version: "1.5", body: [] };
const MENTION = { name: "Synthetic User", email: "synthetic@contoso.test" };
const MENTION_HTML = renderWithMentions("see @[Synthetic User](synthetic@contoso.test)").html;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "none" })}.${b64({ oid: OID, tid: "tid-1" })}.sig`;

type Seen = { url: string; method: string; body: unknown; headers: Record<string, string> };
type Reply = { status: number; json: unknown };

const dir = mkdtempSync(join(tmpdir(), "teams-channel-"));
const pngBytes = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.from("picture bytes")]);
const PNG = join(dir, "shot.png");
writeFileSync(PNG, pngBytes);
const LOG = join(dir, "run.log");
writeFileSync(LOG, "line 1\n");

/** A fake Graph: synthetic discovery, directory and upload answers, recording every request it saw. */
function fakeGraph(extra: (url: string, method: string, body: unknown, seen: Seen[]) => Reply | undefined = () => undefined) {
	const seen: Seen[] = [];
	const reply = (status: number, json: unknown): { status: number; text: () => Promise<string> } => ({ status, text: async () => JSON.stringify(json) });
	const doFetch = async (url: string, init: { method?: string; headers: Record<string, string>; body?: string | Uint8Array }) => {
		const method = init.method ?? "GET";
		const path = decodeURIComponent(url);
		const body = init.body instanceof Uint8Array ? Buffer.from(init.body) : init.body ? JSON.parse(init.body) : null;
		seen.push({ url: path, method, body, headers: init.headers });
		const hit = extra(path, method, body, seen);
		if (hit) return reply(hit.status, hit.json);
		if (path.endsWith("/createUploadSession")) return reply(200, { uploadUrl: `https://upload.test/session/${seen.length}` });
		if (path.startsWith("https://upload.test/"))
			return reply(201, {
				id: "item-1",
				name: "run.log",
				eTag: `"{${GUID}},1"`,
				webDavUrl: "https://contoso.test/Documents/General/run.log",
				parentReference: { driveId: "b!team-lib" },
			});
		if (path === `${GRAPH}/me/joinedTeams`) return reply(200, { value: [{ id: TEAM, displayName: "Eng" }] });
		if (path === `${GRAPH}/teams/${TEAM}/channels`) return reply(200, { value: [{ id: CHANNEL, displayName: "General", membershipType: "standard" }] });
		if (path === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}`) return reply(200, { id: CHANNEL, displayName: "General", membershipType: "standard" });
		if (path === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/filesFolder`) return reply(200, { id: "folder-1", name: "General", parentReference: { driveId: "b!team-lib" } });
		if (path.startsWith(`${GRAPH}/me/people?`))
			return reply(200, {
				value: [{ id: OTHER, displayName: "Synthetic User", scoredEmailAddresses: [{ address: "synthetic@contoso.test" }], personType: { subclass: "OrganizationUser" } }],
			});
		return reply(201, { id: "msg-9", webUrl: "https://teams.test/general/msg-9" });
	};
	return { seen, b: new GraphBackend(new GraphClient(async () => TOKEN, doFetch as never), { whoami: async () => "Me", oid: async () => OID }) };
}

/** The POST bodies a channel send with a card, a mention, a picture and a file produces, shared by U7 and U8. */
function assertRichSend(body: Record<string, unknown>) {
	expect(body.body).toEqual({
		contentType: "html",
		content: `<p>see <at id="0">Synthetic User</at></p>\n<p><img src="../hostedContents/1/$value" alt="shot.png"></p><attachment id="${(body.attachments as { id: string }[])[0].id}"></attachment><attachment id="${GUID.toLowerCase()}"></attachment>`,
	});
	expect(body.mentions).toEqual([{ id: 0, mentionText: "Synthetic User", mentioned: { user: { id: OTHER, displayName: "Synthetic User", userIdentityType: "aadUser" } } }]);
	expect(body.hostedContents).toEqual([{ "@microsoft.graph.temporaryId": "1", contentBytes: pngBytes.toString("base64"), contentType: "image/png" }]);
	expect(body.attachments).toEqual([
		{ id: expect.any(String), contentType: "application/vnd.microsoft.card.adaptive", content: JSON.stringify(CARD) },
		{ id: GUID.toLowerCase(), contentType: "reference", contentUrl: "https://contoso.test/Documents/General/run.log", name: "run.log" },
	]);
}

describe("GraphBackend channel operations", () => {
	test("U3: a team whose channel list fails refuses the whole list, naming the failed request", async () => {
		const { b, seen } = fakeGraph((url) => {
			if (url === `${GRAPH}/me/joinedTeams`)
				return { status: 200, json: { value: [{ id: TEAM, displayName: "Eng" }, { id: "team-2", displayName: "Ops" }] } };
			if (url === `${GRAPH}/teams/team-2/channels`) return { status: 500, json: { error: { code: "generalFailure", message: "synthetic failure" } } };
			return undefined;
		});
		await expect(b.channels()).rejects.toThrow("Graph 500 on https://graph.microsoft.com/v1.0/teams/team-2/channels");
		expect(seen.map((s) => s.url)).toEqual([`${GRAPH}/me/joinedTeams`, `${GRAPH}/teams/${TEAM}/channels`, `${GRAPH}/teams/team-2/channels`]);
	});

	test("U7: a channel root send posts subject, card, mention, picture and file, and returns the created message", async () => {
		const { b, seen } = fakeGraph();
		const created = await b.send({ kind: "channel", teamId: TEAM, channelId: CHANNEL, subject: "Thread subject" }, MENTION_HTML, true, [MENTION], [PNG], CARD, [LOG]);
		expect(created).toEqual({ id: "msg-9", webUrl: "https://teams.test/general/msg-9" });
		const posts = seen.filter((s) => s.method === "POST" && s.url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages`);
		expect(posts).toHaveLength(1);
		expect((posts[0].body as Record<string, unknown>).subject).toBe("Thread subject");
		assertRichSend(posts[0].body as Record<string, unknown>);
		// The file went up under the channel's filesFolder drive item, before the post.
		expect(seen.findIndex((s) => s.url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages` && s.method === "POST")).toBeGreaterThan(seen.findIndex((s) => s.url.endsWith("/createUploadSession")));
	});

	test("U8: a reply send posts to the root's replies without a subject", async () => {
		const { b, seen } = fakeGraph();
		const created = await b.send({ kind: "channel", teamId: TEAM, channelId: CHANNEL, replyTo: "1700000000001" }, MENTION_HTML, true, [MENTION], [PNG], CARD, [LOG]);
		expect(created).toEqual({ id: "msg-9", webUrl: "https://teams.test/general/msg-9" });
		const posts = seen.filter((s) => s.method === "POST" && s.url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/1700000000001/replies`);
		expect(posts).toHaveLength(1);
		const body = posts[0].body as Record<string, unknown>;
		expect("subject" in body).toBe(false);
		assertRichSend(body);
	});

	test("U9: a subject with a reply refuses before any request", async () => {
		const { b, seen } = fakeGraph();
		await expect(
			b.send({ kind: "channel", teamId: TEAM, channelId: CHANNEL, subject: "Thread subject", replyTo: "1700000000001" }, "hello", true),
		).rejects.toThrow("a channel reply cannot set a subject");
		expect(seen).toHaveLength(0);
	});

	test("U11: reactions on roots and replies hit exactly the four URLs", async () => {
		const { b, seen } = fakeGraph();
		const addr = { teamId: TEAM, channelId: CHANNEL };
		await b.reactChannel(addr, "m-1", "🤖");
		await b.reactChannel(addr, "m-1", "🤖", { remove: true });
		await b.reactChannel(addr, "m-2", "🤖", { replyTo: "m-0" });
		await b.reactChannel(addr, "m-2", "🤖", { replyTo: "m-0", remove: true });
		expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
			{ url: `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/m-1/setReaction`, method: "POST", body: { reactionType: "🤖" } },
		{ url: `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/m-1/unsetReaction`, method: "POST", body: { reactionType: "🤖" } },
		{ url: `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/m-0/replies/m-2/setReaction`, method: "POST", body: { reactionType: "🤖" } },
		{ url: `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/m-0/replies/m-2/unsetReaction`, method: "POST", body: { reactionType: "🤖" } },
		]);
	});
	test("channels filters by team or channel name and maps fields; resolveChannel prefers ids", async () => {
		const { b, seen } = fakeGraph((url) => {
			if (url === `${GRAPH}/me/joinedTeams`)
				return { status: 200, json: { value: [{ id: TEAM, displayName: "Eng", isArchived: false }, { id: "team-2", displayName: "Ops", isArchived: true }] } };
			if (url === `${GRAPH}/teams/${TEAM}/channels`)
				return { status: 200, json: { value: [{ id: CHANNEL, displayName: "General", membershipType: "private", email: "gen@contoso.test", isArchived: false }] } };
			if (url === `${GRAPH}/teams/team-2/channels`)
				return { status: 200, json: { value: [{ id: "19:ops@thread.skype", displayName: "Alerts", membershipType: "standard" }] } };
			return undefined;
		});
		expect(await b.channels("al")).toEqual([
			{ teamId: TEAM, team: "Eng", channelId: CHANNEL, channel: "General", membershipType: "private", email: "gen@contoso.test", archived: false },
			{ teamId: "team-2", team: "Ops", channelId: "19:ops@thread.skype", channel: "Alerts", membershipType: "standard", archived: true },
		]);
		seen.length = 0;
		expect(await b.resolveChannel({ teamId: TEAM, channelId: CHANNEL, team: "Ignored", channel: "Ignored" })).toEqual({
			teamId: TEAM,
			channelId: CHANNEL,
			label: "General",
		});
		expect(seen.map((s) => s.url)).toEqual([`${GRAPH}/teams/${TEAM}/channels/${CHANNEL}`]);
		expect(await b.resolveChannel({ team: "ops", channel: "al" })).toEqual({
			teamId: "team-2",
			channelId: "19:ops@thread.skype",
			label: "Alerts",
		});
	});

	test("channelRoots and channelThread project oldest-first with channel imageSource and reply pagination", async () => {
		const { b } = fakeGraph((url) => {
			if (url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages?$top=20&$expand=replies`)
				return {
					status: 200,
					json: {
						value: [
							{ id: "r-2", createdDateTime: "2026-11-26T10:05:00Z", subject: "Second", from: { user: { displayName: "Synthetic User" } }, body: { contentType: "text", content: "later" }, "replies@odata.count": 4 },
							{ id: "r-1", createdDateTime: "2026-11-26T10:00:00Z", subject: "First", from: { user: { displayName: "Me" } }, body: { contentType: "html", content: '<p>hi <img src="../hostedContents/1/$value"></p>' }, replies: [{ id: "rep-1" }] },
						],
					},
				};
			if (url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/r-1`)
				return { status: 200, json: { id: "r-1", createdDateTime: "2026-11-26T10:00:00Z", from: { user: { displayName: "Me" } }, body: { contentType: "html", content: '<img src="../hostedContents/1/$value">' } } };
			if (url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/r-1/replies?$top=50`)
				return {
					status: 200,
					json: {
						value: [{ id: "rep-2", createdDateTime: "2026-11-26T10:02:00Z", from: { user: { displayName: "Synthetic User" } }, body: { contentType: "html", content: '<img src="../hostedContents/2/$value">' } }],
						"@odata.nextLink": `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/r-1/replies?page=2`,
					},
				};
			if (url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/messages/r-1/replies?page=2`)
				return { status: 200, json: { value: [{ id: "rep-1", createdDateTime: "2026-11-26T10:01:00Z", from: { user: { displayName: "Synthetic User" } }, body: { contentType: "text", content: "first reply" } }] } };
			return undefined;
		});
		const roots = await b.channelRoots({ teamId: TEAM, channelId: CHANNEL }, 20);
		expect(roots.me).toBe("Me");
		expect(roots.roots.map((r) => ({ id: r.root.id, subject: r.root.subject, replyCount: r.replyCount, imageSource: r.root.imageSource, images: r.root.images }))).toEqual([
			{
				id: "r-1",
				subject: "First",
				replyCount: 1,
				imageSource: `${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-1/`,
				images: [`${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-1/hostedContents/1/$value`],
			},
			{
				id: "r-2",
				subject: "Second",
				replyCount: 4,
				imageSource: `${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-2/`,
				images: [],
			},
		]);

		const thread = await b.channelThread({ teamId: TEAM, channelId: CHANNEL }, "r-1");
		expect(thread.messages.map((m) => ({ id: m.id, imageSource: m.imageSource, images: m.images }))).toEqual([
			{
				id: "r-1",
				imageSource: `${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-1/`,
				images: [`${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-1/hostedContents/1/$value`],
			},
			{
				id: "rep-1",
				imageSource: `${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-1/replies/rep-1/`,
				images: [],
			},
			{
				id: "rep-2",
				imageSource: `${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-1/replies/rep-2/`,
				images: [`${GRAPH}/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/r-1/replies/rep-2/hostedContents/2/$value`],
			},
		]);
	});

	test("channelMembers, me, and channelStream return membership, identity, and delegated skype stream", async () => {
		const { b } = fakeGraph((url) => {
			if (url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}`) return { status: 200, json: { id: CHANNEL, membershipType: "private" } };
			if (url === `${GRAPH}/teams/${TEAM}/channels/${CHANNEL}/members`) return { status: 200, json: { value: [{ userId: OID }] } };
			return undefined;
		});
		expect(await b.channelMembers({ teamId: TEAM, channelId: CHANNEL })).toEqual({ membershipType: "private", memberOids: [OID] });
		expect(await b.me()).toEqual({ oid: OID, name: "Me" });
		const streamCalls: unknown[][] = [];
		const withSkype = new GraphBackend(new GraphClient(async () => TOKEN, (async () => ({ status: 200, text: async () => "{}" })) as never), {
			whoami: async () => "Me",
			skype: { conversationPage: async (...args: unknown[]) => { streamCalls.push(args); return { raw: [{ id: "1" }], older: "cur-2" }; } } as never,
		});
		expect(await withSkype.channelStream({ teamId: TEAM, channelId: CHANNEL }, 25, "cur-1")).toEqual({ raw: [{ id: "1" }], older: "cur-2" });
		expect(streamCalls).toEqual([[CHANNEL, 25, "cur-1"]]);
		await expect(withSkype.me()).rejects.toThrow("oid");
		await expect(b.channelStream({ teamId: TEAM, channelId: CHANNEL }, 20)).rejects.toThrow("chatsvc");
	});
});

describe("ScriptBackend refuses channels", () => {
	test("U37: every new channel method and id/subject/reply send rejects with the graph configuration line", async () => {
		const runs: string[][] = [];
		const b = new ScriptBackend(async (args) => {
			runs.push(args);
			return "{}";
		});
		const refuse = /set "backend": "graph" in ~\/\.pi\/agent\/teams\.json/;
		const addr = { teamId: TEAM, channelId: CHANNEL };
		await expect(b.channels()).rejects.toThrow(refuse);
		await expect(b.channels("gen")).rejects.toThrow(refuse);
		await expect(b.resolveChannel({ teamId: TEAM, channelId: CHANNEL })).rejects.toThrow(refuse);
		await expect(b.resolveChannel({ team: "Eng", channel: "General" })).rejects.toThrow(refuse);
		await expect(b.channelRoots(addr, 20)).rejects.toThrow(refuse);
		await expect(b.channelThread(addr, "1700000000001")).rejects.toThrow(refuse);
		await expect(b.channelMembers(addr)).rejects.toThrow(refuse);
		await expect(b.reactChannel(addr, "m-1", "🤖")).rejects.toThrow(refuse);
		await expect(b.channelStream(addr, 50)).rejects.toThrow(refuse);
		await expect(b.me()).rejects.toThrow(refuse);
		const sends: SendTarget[] = [
			{ kind: "channel", teamId: TEAM, channelId: CHANNEL },
			{ kind: "channel", team: "Eng", channel: "General", teamId: TEAM },
			{ kind: "channel", team: "Eng", channel: "General", channelId: CHANNEL },
			{ kind: "channel", team: "Eng", channel: "General", subject: "Thread subject" },
			{ kind: "channel", team: "Eng", channel: "General", replyTo: "1700000000001" },
		];
		for (const target of sends) await expect(b.send(target, "hello", false)).rejects.toThrow(refuse);
		expect(runs).toHaveLength(0);
	});

	test("U38: a name-addressed channel root send is refused like every other channel send", async () => {
		const runs: string[][] = [];
		const b = new ScriptBackend(async (args) => {
			runs.push(args);
			return "{}";
		});
		await expect(b.send({ kind: "channel", team: "Eng", channel: "General" }, "hello", false)).rejects.toThrow(
			'channels need the graph backend; set "backend": "graph" in ~/.pi/agent/teams.json',
		);
		expect(runs).toHaveLength(0);
	});
});
