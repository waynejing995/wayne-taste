/**
 * teams_send `files`: any local file goes up through a Graph upload session and is attached as a "reference"
 * attachment. A chat's file goes to the sender's OneDrive "Microsoft Teams Chat Files" and is shared read-only with
 * exactly the chat's members; a channel's goes into the channel's own files folder; a self-chat file stays private.
 * The Graph backend runs with fetch stubbed; synthetic data only.
 */
import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

let failed = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.stack}`);
	}
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "none" })}.${b64({ oid: "oid-me", tid: "tid-1" })}.sig`;
const GUID = "2B4C9ABD-2954-4C9F-AF98-87D2EE333032";
const DRIVE = "b!drive-me";
const CHAT = "19:files@thread.v2";

const dir = mkdtempSync(join(tmpdir(), "teams-files-"));
const LOG = join(dir, "run.log");
writeFileSync(LOG, "line 1\nline 2\n");

/** A Graph that serves uploads, members and channels, recording every request. */
/** The chat files folder as Graph lists its permissions: owned by me alone, unless a test shares it. */
const OWNER_ONLY = [{ id: "p-me", roles: ["owner"], grantedToV2: { user: { id: "oid-me", email: "me@contoso.test" } }, inheritedFrom: {} }];
const PERMISSIONS = `${GRAPH}/me/drive/root:/Microsoft Teams Chat Files:/permissions`;

function graph({ members = [], permissions = OWNER_ONLY, directory = {} } = {}) {
	const seen = [];
	const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
	const doFetch = async (url, init) => {
		const method = init.method ?? "GET";
		const body = init.body instanceof Uint8Array ? Buffer.from(init.body) : init.body ? JSON.parse(init.body) : null;
		seen.push({ url: decodeURIComponent(url), method, headers: init.headers, body });
		if (url.endsWith("/createUploadSession")) return reply(200, { uploadUrl: `https://upload.test/session/${seen.length}` });
		if (url.startsWith("https://upload.test/")) {
			const [, start, end, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(init.headers["Content-Range"]).map(Number);
			if (end + 1 < total) return reply(202, { nextExpectedRanges: [`${end + 1}-`] });
			const name = decodeURIComponent(seen.find((s) => s.url.endsWith("/createUploadSession") && s.url.includes(":/")).url.split("/").at(-2).replace(/:$/, ""));
			return reply(201, {
				id: "item-1",
				name,
				eTag: `"{${GUID}},1"`,
				webUrl: `https://contoso-my.sharepoint.com/personal/me/_layouts/15/Doc.aspx?sourcedoc=x`,
				webDavUrl: `https://contoso-my.sharepoint.com/personal/me/Documents/Microsoft%20Teams%20Chat%20Files/${encodeURIComponent(name)}`,
				parentReference: { driveId: DRIVE },
			});
		}
		if (decodeURIComponent(url) === PERMISSIONS) return permissions ? reply(200, { value: permissions }) : reply(404, { error: { code: "itemNotFound", message: "Item not found" } });
		const user = /\/users\/([^/?]+)\?\$select=mail$/.exec(url);
		if (user) return directory[user[1]] ? reply(200, directory[user[1]]) : reply(404, { error: { code: "Request_ResourceNotFound", message: "gone" } });
		if (url === `${GRAPH}/chats/${CHAT}/members`) return reply(200, { value: members });
		if (url === `${GRAPH}/me/joinedTeams`) return reply(200, { value: [{ id: "team-1", displayName: "Eng" }] });
		if (url === `${GRAPH}/teams/team-1/channels`) return reply(200, { value: [{ id: "chan-1", displayName: "General" }] });
		if (url === `${GRAPH}/teams/team-1/channels/chan-1/filesFolder`) return reply(200, { id: "folder-1", name: "General", parentReference: { driveId: "b!team-lib" } });
		return reply(201, { id: "msg-1" });
	};
	const skype = {
		send: async () => {
			throw new Error("a file send went to chatsvc");
		},
		uploadImage: async () => {
			throw new Error("a file went to AMS");
		},
	};
	return { seen, b: new GraphBackend(new GraphClient(async () => TOKEN, doFetch), { whoami: async () => "Me", skype }) };
}

const posted = (seen) => seen.filter((s) => s.method === "POST" && s.url.endsWith("/messages"));

await check("a chat file goes to Microsoft Teams Chat Files and is attached as a reference", async () => {
	const { seen, b } = graph({ members: [{ userId: "oid-me", email: "me@contoso.test" }, { userId: "oid-ann", email: "ann@contoso.test" }] });
	await b.send({ kind: "chat", id: CHAT }, "<p>the log</p>", true, [], [], undefined, [LOG]);
	const session = seen.find((s) => s.url.endsWith("/createUploadSession"));
	equal(session.url, `${GRAPH}/me/drive/root:/Microsoft Teams Chat Files/run.log:/createUploadSession`);
	deepStrictEqual(session.body, { item: { "@microsoft.graph.conflictBehavior": "rename" } });
	const put = seen.find((s) => s.method === "PUT");
	equal(put.headers.Authorization, undefined, "no bearer token to the upload URL");
	equal(put.body.toString(), "line 1\nline 2\n");
	const [post] = posted(seen);
	equal(post.url, `${GRAPH}/chats/${CHAT}/messages`);
	const id = GUID.toLowerCase();
	equal(post.body.body.content, `<p>the log</p><attachment id="${id}"></attachment>`);
	deepStrictEqual(post.body.attachments, [
		{ id, contentType: "reference", contentUrl: "https://contoso-my.sharepoint.com/personal/me/Documents/Microsoft%20Teams%20Chat%20Files/run.log", name: "run.log" },
	]);
});

await check("a chat file is shared read-only with exactly the chat's other members, before the post, no mail, no link", async () => {
	const members = [
		{ userId: "oid-me", email: "me@contoso.test" },
		{ userId: "oid-ann", email: "ann@contoso.test" },
		{ userId: "oid-bo", email: "" },
	];
	const { seen, b } = graph({ members, directory: { "oid-bo": { mail: "bo@contoso.test" } } });
	await b.send({ kind: "chat", id: CHAT }, "<p>x</p>", true, [], [], undefined, [LOG]);
	const grants = seen.filter((s) => s.url.includes("/invite") || s.url.includes("/createLink"));
	deepStrictEqual(grants.map((g) => [g.method, g.url]), [["POST", `${GRAPH}/drives/${DRIVE}/items/item-1/invite`]]);
	deepStrictEqual(grants[0].body, {
		recipients: [{ email: "ann@contoso.test" }, { email: "bo@contoso.test" }],
		roles: ["read"],
		requireSignIn: true,
		sendInvitation: false,
	});
	ok(seen.indexOf(grants[0]) < seen.indexOf(posted(seen)[0]), "shared before the message points at it");
});

await check("a channel file goes into the channel's files folder, with no extra grant", async () => {
	const { seen, b } = graph();
	await b.send({ kind: "channel", team: "Eng", channel: "General" }, "<p>x</p>", true, [], [], undefined, [LOG]);
	ok(seen.some((s) => s.url === `${GRAPH}/teams/team-1/channels/chan-1/filesFolder`));
	equal(seen.find((s) => s.url.endsWith("/createUploadSession")).url, `${GRAPH}/drives/b!team-lib/items/folder-1:/run.log:/createUploadSession`);
	ok(!seen.some((s) => s.url.includes("/invite") || s.url.includes("/createLink")), "no grant");
	equal(posted(seen)[0].url, `${GRAPH}/teams/team-1/channels/chan-1/messages`);
	equal(posted(seen)[0].body.attachments[0].contentType, "reference");
});

await check("a self-chat file goes through Graph to 48:notes and is shared with no one", async () => {
	const { seen, b } = graph();
	await b.send({ kind: "self" }, "<p>x</p>", true, [], [], undefined, [LOG]);
	equal(posted(seen)[0].url, `${GRAPH}/chats/48:notes/messages`);
	equal(posted(seen)[0].body.attachments[0].name, "run.log");
	ok(!seen.some((s) => s.url.includes("/members") || s.url.includes("/invite")), "no members, no grant");
});

await check("a large file goes up in 320 KiB-multiple pieces that cover it exactly", async () => {
	const big = join(dir, "big.bin");
	writeFileSync(big, Buffer.alloc(12 * 1024 * 1024, 7));
	const { seen, b } = graph();
	await b.send({ kind: "self" }, "<p>x</p>", true, [], [], undefined, [big]);
	const ranges = seen.filter((s) => s.method === "PUT").map((s) => s.headers["Content-Range"]);
	deepStrictEqual(ranges, ["bytes 0-5242879/12582912", "bytes 5242880-10485759/12582912", "bytes 10485760-12582911/12582912"]);
	ok(seen.filter((s) => s.method === "PUT").every((s, i, all) => i === all.length - 1 || s.body.length % (320 * 1024) === 0));
});

await check("a missing file, a device or a chat that matches nothing refuses the send before anything is uploaded", async () => {
	for (const [target, files, want] of [
		[{ kind: "self" }, [join(dir, "nope.txt")], /ENOENT/],
		[{ kind: "self" }, ["/dev/zero"], /not a regular file/],
		[{ kind: "chat", chat: "nobody here" }, [LOG], /chat/],
	]) {
		const { seen, b } = graph();
		let err = "";
		await b.send(target, "<p>x</p>", true, [], [], undefined, files).catch((e) => (err = e.message));
		match(err, want);
		ok(!seen.some((s) => s.url.endsWith("/createUploadSession") || s.url.endsWith("/messages")), `nothing uploaded or posted: ${err}`);
	}
});

await check("a chat member with no email anywhere refuses the send before anything is uploaded; never an object-id grant", async () => {
	for (const directory of [{}, { "oid-bo": { mail: null } }]) {
		const members = [{ userId: "oid-ann", email: "ann@contoso.test" }, { userId: "oid-bo", email: "", displayName: "Bo" }];
		const { seen, b } = graph({ members, directory });
		let err = "";
		await b.send({ kind: "chat", id: CHAT }, "<p>x</p>", true, [], [], undefined, [LOG]).catch((e) => (err = e.message));
		match(err, /chat member Bo has no email address/);
		ok(!seen.some((s) => s.url.endsWith("/createUploadSession") || s.method === "PUT" || s.url.includes("/invite") || s.url.endsWith("/messages")), `nothing uploaded, shared or posted: ${err}`);
	}
});

const uploads = (seen) => seen.filter((s) => s.url.endsWith("/createUploadSession") || s.method === "PUT");

await check("a chat files folder shared by an organisation link refuses chat and self sends, uploading nothing", async () => {
	const permissions = [
		...OWNER_ONLY,
		{ id: "p-org", roles: ["read"], link: { scope: "organization", type: "view" }, inheritedFrom: { path: "/drive/root:" } },
		{ id: "p-guest", roles: ["write"], grantedToV2: { user: { id: "oid-guest", email: "guest@fabrikam.test" } } },
	];
	for (const target of [{ kind: "chat", id: CHAT }, { kind: "self" }]) {
		const { seen, b } = graph({ permissions, members: [{ userId: "oid-ann", email: "ann@contoso.test" }] });
		let err = "";
		await b.send(target, "<p>x</p>", true, [], [], undefined, [LOG]).catch((e) => (err = e.message));
		match(err, /Microsoft Teams Chat Files/);
		match(err, /organization-scope view link \(read\) inherited from \/drive\/root:/);
		match(err, /guest@fabrikam\.test \(write\)/);
		ok(!err.includes("me@contoso.test"), err);
		deepStrictEqual(uploads(seen), [], "nothing uploaded");
		ok(!seen.some((s) => s.url.endsWith("/messages") || s.url.includes("/invite")), "nothing posted or shared");
	}
});

await check("a chat files folder that does not exist yet is clean, and a clean check holds for the next send", async () => {
	const { seen, b } = graph({ permissions: null });
	await b.send({ kind: "self" }, "<p>x</p>", true, [], [], undefined, [LOG]);
	await b.send({ kind: "self" }, "<p>y</p>", true, [], [], undefined, [LOG]);
	equal(uploads(seen).filter((s) => s.method === "POST").length, 2);
	equal(seen.filter((s) => s.url === PERMISSIONS).length, 1);
});

await check("a channel send does not look at the chat files folder", async () => {
	const { seen, b } = graph({ permissions: [{ id: "p-org", roles: ["read"], link: { scope: "organization" } }] });
	await b.send({ kind: "channel", team: "Eng", channel: "General" }, "<p>x</p>", true, [], [], undefined, [LOG]);
	ok(!seen.some((s) => s.url === PERMISSIONS));
});

console.log(failed === 0 ? "\nall green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
