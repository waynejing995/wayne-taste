/**
 * Mailbox, the Graph adapter. Every request goes through a fake transport, so
 * nothing is sent and no Graph call leaves the process.
 *
 *   node tests/mailbox.test.mjs      # run.mjs runs it with the rest of the suite
 *
 * U13 list and search: newest first, the unread filter only when asked; search
 *     quotes its phrase with the quotes escaped, sends ConsistencyLevel: eventual
 *     and no $orderby.
 * U14 read: the metadata and the raw MIME; Markdown from the HTML part, or the
 *     text part of a text-only message.
 * U15 submit and saveDraft: the EML as base64 under text/plain, to the endpoint
 *     each kind of draft names.
 * U16 a Graph refusal is a GraphError carrying the status and Graph's text; a
 *     token refusal reaches the caller unchanged. Neither becomes [] or 0.
 * U17 move, setRead and unreadCount send the request and read the field back.
 * U31 draftFor answers the original (sender, RE:, threading); a new draft is
 *     empty; build sends From as the signed-in user; /me is fetched once, then read from disk.
 */
import { deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti, PI } from "../../tests/host.mjs";
// Resolved paths: importing through the symlink would give a SECOND copy of
// every module, and `instanceof` across the two silently fails. See ext-path.mjs.
import { EXT_DIR, ext } from "./ext-path.mjs";

// Mailbox caches /me on disk; keep that cache out of the user's real one.
const cacheHome = mkdtempSync(join(tmpdir(), "outlook-mailbox-"));
process.env.XDG_CACHE_HOME = cacheHome;
process.on("exit", () => rmSync(cacheHome, { recursive: true, force: true }));
const ME_CACHE = join(cacheHome, "pi", "outlook-me.json");

const D = PI;
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${D}/dist/index.js`,
		"@earendil-works/pi-ai": `${D}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${D}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${D}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const { GraphClient, GraphError } = await jiti.import(join(EXT_DIR, "..", "core", "graph.ts"));
const { Mailbox, FOLDER_LABELS } = await jiti.import(ext("mailbox.ts"));
const { parseEml } = await jiti.import(ext("mime.ts"));

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name));

/** The fields Mailbox selects for a summary, in the order it sends them. */
const SELECT = "id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview";
const UNREAD = "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false";
const REFUSED = "not authenticated — run /teams init";
const EML = Buffer.from("From: me@example.com\r\nSubject: Plain\r\n\r\nHello, 世界.\r\n", "utf8");

/** The message as Graph reports it; its bytes are fixtures/mime-original.eml. */
const ORIG = {
	id: "m-orig",
	subject: "Quarterly status",
	from: { emailAddress: { name: "Alice", address: "alice@example.com" } },
	receivedDateTime: "2026-10-14T01:30:00Z",
	isRead: true,
	hasAttachments: false,
	bodyPreview: "Status is green.",
};
const SUMMARY_ORIG = {
	id: "m-orig",
	subject: "Quarterly status",
	from: { name: "Alice", address: "alice@example.com" },
	received: "2026-10-14T01:30:00Z",
	isRead: true,
	hasAttachments: false,
	preview: "Status is green.",
};
const ME = { displayName: "Me Example", mail: "me@example.com", userPrincipalName: "me@contoso.example" };

// --- Checks ------------------------------------------------------------------

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
	if (ok) {
		passed++;
		console.log(`PASS ${label}`);
	} else {
		failed++;
		console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`);
	}
};

/** Deep equality with key order ignored; a key set to undefined is not the same as a missing key. */
const equal = (label, actual, expected) => {
	let same = true;
	try {
		deepStrictEqual(actual, expected);
	} catch {
		same = false;
	}
	check(label, same, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

/** An exception inside a section fails that section; the other sections still run. */
async function section(title, run) {
	console.log(`\n== ${title} ==`);
	try {
		await run();
	} catch (e) {
		check(`${title}: ran to the end`, false, e instanceof Error ? e.message : String(e));
	}
}

/** The error a call rejects with, or null when it resolves. */
const caught = async (fn) => {
	try {
		await fn();
		return null;
	} catch (e) {
		return e;
	}
};

/**
 * A Graph client over a fake transport. `routes` maps "METHOD /path" (no /v1.0,
 * no query) to a reply: `{ status, body }` for JSON or text, `{ bytes }` for a
 * $value. Every request is recorded; a request with no route throws, so a stray
 * call fails the test instead of being answered by accident.
 */
function fakeGraph(routes, token = async () => "TOK") {
	const seen = [];
	const doFetch = async (url, init = {}) => {
		const method = init.method ?? "GET";
		const u = new URL(url);
		const path = u.pathname.replace(/^\/v1\.0/, "");
		seen.push({ method, path, query: u.searchParams, headers: init.headers ?? {}, body: init.body });
		const r = routes[`${method} ${path}`];
		if (!r) throw new Error(`unrouted ${method} ${url}`);
		const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
		return {
			status: r.status ?? 200,
			text: async () => text,
			arrayBuffer: async () => Uint8Array.from(r.bytes ?? []).buffer,
		};
	};
	return { seen, client: new GraphClient(token, doFetch) };
}

/** A draft for the send and save tests: only `kind` and `id` decide where it goes. */
const draft = (kind, id) => ({ kind, id, to: [], cc: [], subject: "Subj", references: [], attachments: [] });

// --- Tests -------------------------------------------------------------------

await section("U13 list: newest first, and the unread filter only when asked", async () => {
	const { seen, client } = fakeGraph({
		"GET /me/mailFolders/inbox/messages": { body: { value: [{ ...ORIG, isRead: false }] } },
	});
	const rows = await new Mailbox(client).list("inbox", { unreadOnly: true, top: 5 });
	const req = seen[0] ?? {};
	equal("U13 unread list asks the inbox messages, once", [seen.length, req.method, req.path], [1, "GET", "/me/mailFolders/inbox/messages"]);
	equal("U13 $top is the caller's 5", req.query?.get("$top"), "5");
	equal("U13 newest first", req.query?.get("$orderby"), "receivedDateTime desc");
	equal("U13 $select is the summary field set", req.query?.get("$select"), SELECT);
	equal("U13 unreadOnly filters on receivedDateTime first", req.query?.get("$filter"), UNREAD);
	equal("U13 each row is a summary of the message", rows, [{ ...SUMMARY_ORIG, isRead: false }]);
});

await section("U13 list without unreadOnly sends no $filter", async () => {
	const { seen, client } = fakeGraph({ "GET /me/mailFolders/archive/messages": { body: { value: [] } } });
	await new Mailbox(client).list("archive", { top: 20 });
	equal("U13 the folder name is the path segment", seen[0]?.path, "/me/mailFolders/archive/messages");
	check("U13 no $filter when unreadOnly is not set", seen[0] !== undefined && !seen[0].query.has("$filter"));
});

await section("U13 search: a quoted phrase, eventual consistency, no $orderby", async () => {
	const { seen, client } = fakeGraph({ "GET /me/messages": { body: { value: [ORIG] } } });
	const rows = await new Mailbox(client).search('a "b"', 10);
	const req = seen[0] ?? {};
	equal("U13 search asks /me/messages once", [seen.length, req.path], [1, "/me/messages"]);
	equal("U13 $search is the phrase with its inner quotes escaped", req.query?.get("$search"), '"a \\"b\\""');
	equal("U13 $top is 10", req.query?.get("$top"), "10");
	equal("U13 ConsistencyLevel: eventual is sent", req.headers?.ConsistencyLevel, "eventual");
	check("U13 no $orderby with $search", req.query !== undefined && !req.query.has("$orderby"));
	equal("U13 $select is the summary field set", req.query?.get("$select"), SELECT);
	equal("U13 search rows are summaries", rows, [SUMMARY_ORIG]);
});

await section("the five folders have their display labels", async () => {
	equal("labels", FOLDER_LABELS, {
		inbox: "Inbox",
		archive: "Archive",
		sentitems: "Sent Items",
		drafts: "Drafts",
		deleteditems: "Deleted Items",
	});
});

await section("U14 read: metadata and MIME, Markdown from the HTML part", async () => {
	const { seen, client } = fakeGraph({
		"GET /me/messages/m-orig": { body: ORIG },
		"GET /me/messages/m-orig/$value": { bytes: fixture("mime-original.eml") },
	});
	const got = await new Mailbox(client).read("m-orig");
	const meta = seen.find((r) => r.path === "/me/messages/m-orig");
	equal("U14 the metadata request asks for the summary fields", meta?.query.get("$select"), SELECT);
	check("U14 the raw MIME is fetched from $value", seen.some((r) => r.path === "/me/messages/m-orig/$value"));
	equal("U14 the summary is the metadata", got.summary, SUMMARY_ORIG);
	equal("U14 the parsed mail carries the subject", got.mail.subject, "Quarterly status");
	equal("U14 Markdown comes from the HTML part", got.markdown, "Status is [green]{.ok}.");
});

await section("U14 read: a text-only message returns its text part", async () => {
	const { client } = fakeGraph({
		"GET /me/messages/plain-1": { body: { ...ORIG, id: "plain-1", subject: "Plain note", bodyPreview: "Just a plain note." } },
		"GET /me/messages/plain-1/$value": { bytes: fixture("mime-text-only.eml") },
	});
	const got = await new Mailbox(client).read("plain-1");
	equal("U14 the text part is returned as it is, not converted", got.markdown, "Just a plain note.\nUse <b>bold</b> here, literally.\n");
});

for (const [kind, id, path] of [
	["new", undefined, "/me/sendMail"],
	["reply", "m-orig", "/me/messages/m-orig/reply"],
	["replyAll", "m-orig", "/me/messages/m-orig/replyAll"],
	["forward", "m-orig", "/me/messages/m-orig/forward"],
]) {
	await section(`U15 submit ${kind} posts the EML to ${path}`, async () => {
		const { seen, client } = fakeGraph({ [`POST ${path}`]: { status: 202, body: "" } });
		await new Mailbox(client).submit(draft(kind, id), EML);
		const req = seen[0] ?? {};
		equal("U15 one POST to the endpoint", [seen.length, req.method, req.path], [1, "POST", path]);
		equal("U15 the body is sent as text/plain", req.headers?.["Content-Type"], "text/plain");
		check("U15 the base64 body decodes to the given EML", Buffer.from(req.body ?? "", "base64").equals(EML));
	});
}

for (const [kind, id, path] of [
	["new", undefined, "/me/messages"],
	["reply", "m-orig", "/me/messages/m-orig/createReply"],
	["replyAll", "m-orig", "/me/messages/m-orig/createReplyAll"],
	["forward", "m-orig", "/me/messages/m-orig/createForward"],
]) {
	await section(`U15 saveDraft ${kind} posts the EML to ${path} and returns the draft id`, async () => {
		const { seen, client } = fakeGraph({ [`POST ${path}`]: { status: 201, body: { id: `draft-${kind}` } } });
		const got = await new Mailbox(client).saveDraft(draft(kind, id), EML);
		const req = seen[0] ?? {};
		equal("U15 one POST to the endpoint", [seen.length, req.method, req.path], [1, "POST", path]);
		equal("U15 the draft id is returned", got, `draft-${kind}`);
		equal("U15 the body is sent as text/plain", req.headers?.["Content-Type"], "text/plain");
		check("U15 the base64 body decodes to the given EML", Buffer.from(req.body ?? "", "base64").equals(EML));
	});
}

await section("U16 a Graph refusal is a GraphError with the status and Graph's text", async () => {
	for (const [status, body, text] of [
		[400, { error: { message: "Invalid base64 string for MIME content." } }, "Invalid base64 string for MIME content."],
		[403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } }, "Access is denied."],
	]) {
		await section(`U16 submit refused with ${status}`, async () => {
			const { client } = fakeGraph({ "POST /me/sendMail": { status, body } });
			const e = await caught(() => new Mailbox(client).submit(draft("new"), EML));
			check(`U16 ${status}: submit rejects with a GraphError`, e instanceof GraphError);
			equal(`U16 ${status}: the status is carried`, e?.status, status);
			check(`U16 ${status}: the message names the status and Graph's text`, e?.message.includes(String(status)) === true && e.message.includes(text));
		});
	}
});

await section("U16 a token refusal reaches list and unreadCount unchanged, never [] or 0", async () => {
	const refused = async () => {
		throw new Error(REFUSED);
	};
	const { seen, client } = fakeGraph({}, refused);
	const mb = new Mailbox(client);
	const listError = await caught(() => mb.list("inbox", { top: 5 }));
	const countError = await caught(() => mb.unreadCount());
	equal("U16 list rejects with the sign-in hint", listError?.message, REFUSED);
	equal("U16 unreadCount rejects with the sign-in hint", countError?.message, REFUSED);
	equal("U16 no request goes out without a token", seen.length, 0);
});

for (const folder of ["archive", "deleteditems"]) {
	await section(`U17 move to ${folder} posts the destination`, async () => {
		const { seen, client } = fakeGraph({ "POST /me/messages/m1/move": { status: 201, body: { id: "m1" } } });
		await new Mailbox(client).move("m1", folder);
		const req = seen[0] ?? {};
		equal("U17 one POST to /me/messages/m1/move", [seen.length, req.method, req.path], [1, "POST", "/me/messages/m1/move"]);
		equal("U17 the body names the destination", JSON.parse(req.body ?? "null"), { destinationId: folder });
	});
}

await section("U17 setRead(false) PATCHes isRead on the message", async () => {
	const { seen, client } = fakeGraph({ "PATCH /me/messages/m1": { body: { id: "m1", isRead: false } } });
	await new Mailbox(client).setRead("m1", false);
	const req = seen[0] ?? {};
	equal("U17 one PATCH to /me/messages/m1", [seen.length, req.method, req.path], [1, "PATCH", "/me/messages/m1"]);
	equal("U17 the body is isRead false", JSON.parse(req.body ?? "null"), { isRead: false });
});

await section("U17 unreadCount reads the inbox's unreadItemCount", async () => {
	const { seen, client } = fakeGraph({ "GET /me/mailFolders/inbox": { body: { unreadItemCount: 7 } } });
	const count = await new Mailbox(client).unreadCount();
	const req = seen[0] ?? {};
	equal("U17 the count is the inbox's unreadItemCount", count, 7);
	equal("U17 it asks the inbox for that one field", [seen.length, req.path, req.query?.get("$select")], [1, "/me/mailFolders/inbox", "unreadItemCount"]);
});

const FIXTURE_ROUTES = {
	"GET /me": { body: ME },
	"GET /me/messages/m-orig": { body: ORIG },
	"GET /me/messages/m-orig/$value": { bytes: fixture("mime-original.eml") },
};

await section("U31 draftFor reply answers the original", async () => {
	const { client } = fakeGraph(FIXTURE_ROUTES);
	const reply = await new Mailbox(client).draftFor("reply", "m-orig");
	equal("U31 To is the original sender", reply.to, [{ name: "Alice", address: "alice@example.com" }]);
	equal("U31 Subject is RE: the original's subject", reply.subject, "RE: Quarterly status");
	equal("U31 inReplyTo is the original Message-ID", reply.inReplyTo, "<a@x>");
	equal("U31 references end with the original Message-ID", reply.references, ["<z@x>", "<a@x>"]);
	equal("U31 the draft names the message it answers", reply.id, "m-orig");
});

await section("U31 draftFor new is empty and carries no quote", async () => {
	const { client } = fakeGraph({});
	const fresh = await new Mailbox(client).draftFor("new");
	equal("U31 a new draft has empty fields and no quote or id", fresh, {
		kind: "new",
		to: [],
		cc: [],
		subject: "",
		references: [],
		attachments: [],
	});
});

await section("U31 build sends From as the signed-in address; /me is fetched once, then read from disk", async () => {
	rmSync(ME_CACHE, { force: true });
	const { seen, client } = fakeGraph(FIXTURE_ROUTES);
	const mb = new Mailbox(client);
	const reply = await mb.draftFor("reply", "m-orig");
	const back = await parseEml(await mb.build({ ...reply, markdown: "Thanks.\n" }));
	equal("U31 From is the /me name and address", back.from, { name: "Me Example", address: "me@example.com" });
	equal("U31 /me is fetched once for the process", seen.filter((r) => r.path === "/me").length, 1);
	const later = fakeGraph(FIXTURE_ROUTES);
	const again = await parseEml(await new Mailbox(later.client).build({ ...reply, markdown: "Again.\n" }));
	equal("U31 a later process reads /me from disk, not Graph", later.seen.filter((r) => r.path === "/me").length, 0);
	equal("U31 with the same From", again.from, { name: "Me Example", address: "me@example.com" });
});

await section("U31 build sends the draft as edited", async () => {
	const { client } = fakeGraph(FIXTURE_ROUTES);
	const mb = new Mailbox(client);
	const reply = await mb.draftFor("reply", "m-orig");
	const edited = { ...reply, to: [{ address: "dana@example.com" }], subject: "Changed", markdown: "Edited.\n" };
	const back = await parseEml(await mb.build(edited));
	equal("U31 an edited To is what goes out", back.to, [{ address: "dana@example.com" }]);
	equal("U31 an edited subject is what goes out", back.subject, "Changed");
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "all ok" : "FAIL");
process.exit(failed === 0 ? 0 : 1);
