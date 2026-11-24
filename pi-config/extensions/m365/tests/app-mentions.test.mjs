/**
 * @mentions of a Teams app (a bot): `@[Display Name](app:<app id>)`. The app has no address, so nothing is asked of
 * the directory; Graph gets `mentioned.application`. People keep their directory lookup and `mentioned.user`. The
 * self-chat has no app in it, so every send there (text, card or file, by target self or by its id) refuses one. A
 * card's app mentions notify from the message body beside it, as a person's do.
 *
 * The Graph backend runs on a recording fetch; the last section loads the extension with fetch and the token stubbed.
 * Synthetic data only.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Before the extension loads: a temp HOME and cache (no teams.json: the Graph backend), and a uid of our own, so the
// watch's socket names never meet a live session's.
const home = mkdtempSync(join(tmpdir(), "teams-app-mentions-"));
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
process.env.HOME = home;
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.WAYNE_INBOX_DIR = join(home, "inbox");
process.getuid = () => 0x7e590000 + (process.pid & 0xffff);
mkdirSync(join(home, ".cache", "pi", "teams-auth"), { recursive: true });
writeFileSync(join(home, ".cache", "pi", "teams-auth", "identity.json"), JSON.stringify({ displayName: "Synthetic Self", upn: "self@contoso.test", oid: "oid-self", tid: "tid-1" }));

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
const { renderWithMentions } = await jiti.import(join(ROOT, "teams", "mentions.ts"));
const { GraphBackend } = await jiti.import(join(ROOT, "teams", "graph-backend.ts"));
const { GraphClient } = await jiti.import(join(ROOT, "core", "graph.ts"));
const auth = await jiti.import(join(ROOT, "core", "auth.ts"));
const teams = await jiti.import(join(ROOT, "teams", "index.ts"), { default: true });

let failed = 0;
const check = (label, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};
const threw = async (fn) => {
	try {
		await fn();
		return "";
	} catch (e) {
		return String(e?.message ?? e);
	}
};
/** Runs a section; an exception fails it, and the other sections still run. */
async function section(title, run) {
	console.log(`\n== ${title} ==`);
	try {
		await run();
	} catch (e) {
		failed++;
		console.log(`FAIL ${title}: ran to the end (${e?.message ?? e})`);
	}
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const PEOPLE = `${GRAPH}/me/people`;
const CHAT = "19:test@thread.v2";
const APP = "00000000-0000-0000-0000-000000000001";
const PAT = { name: "Pat Example", email: "pat.example@contoso.test", oid: "00000000-0000-4000-8000-0000000000a1" };
const appMention = (name, id) => ({
	mentioned: { application: { "@odata.type": "#microsoft.graph.teamworkApplicationIdentity", id, displayName: name, applicationIdentityType: "bot" } },
});

/** /me/people as Graph answers a quoted address search: PAT for PAT's address, nobody otherwise. */
function directory(url) {
	const q = new URL(url).searchParams.get("$search")?.replace(/^"|"$/g, "").toLowerCase() ?? "";
	const pat = { id: PAT.oid, displayName: PAT.name, scoredEmailAddresses: [{ address: PAT.email }], personType: { subclass: "OrganizationUser" } };
	return { value: q === PAT.email ? [pat] : [] };
}

/** A Graph backend on a fetch that records every request. */
function graphBackend(extra = {}) {
	const seen = [];
	const doFetch = async (url, init) => {
		const method = init?.method ?? "GET";
		seen.push({ url, method, body: init?.body ? JSON.parse(init.body) : null });
		const body = url.startsWith(PEOPLE) ? directory(url) : { id: "m1" };
		return { status: method === "POST" ? 201 : 200, text: async () => JSON.stringify(body) };
	};
	return { seen, b: new GraphBackend(new GraphClient(async () => "T", doFetch), { whoami: async () => "Synthetic Self", ...extra }) };
}

await section("an app mention posts mentioned.application and asks the directory nothing", async () => {
	const { seen, b } = graphBackend();
	const { html, mentions } = renderWithMentions(`@[Captain](app:${APP}) hi`);
	await b.send({ kind: "chat", chat: "", id: CHAT }, html.trim(), true, mentions);
	const post = seen.find((s) => s.method === "POST");
	check("posted to the chat", post?.url, `${GRAPH}/chats/${CHAT}/messages`);
	check("<at id=\"0\"> where the mention was", post?.body.body, { contentType: "html", content: '<p><at id="0">Captain</at> hi</p>' });
	check("the mention names the app", post?.body.mentions, [{ id: 0, mentionText: "Captain", ...appMention("Captain", APP) }]);
	check("no directory lookup", seen.filter((s) => s.url.startsWith(PEOPLE)).length, 0);
	console.log(`  the POST body: ${JSON.stringify(post?.body)}`);
});

await section("people and an app in one message keep their ids in line", async () => {
	const { seen, b } = graphBackend();
	const { html, mentions } = renderWithMentions(`@[${PAT.name}](${PAT.email}), @[Captain](app:${APP}) and @[Pat E.](${PAT.email})`);
	await b.send({ kind: "chat", chat: "", id: CHAT }, html.trim(), true, mentions);
	const post = seen.find((s) => s.method === "POST");
	check("the body numbers them in order", post?.body.body.content, `<p><at id="0">${PAT.name}</at>, <at id="1">Captain</at> and <at id="2">Pat E.</at></p>`);
	check("the mentions array in the same order", post?.body.mentions, [
		{ id: 0, mentionText: PAT.name, mentioned: { user: { id: PAT.oid, displayName: PAT.name, userIdentityType: "aadUser" } } },
		{ id: 1, mentionText: "Captain", ...appMention("Captain", APP) },
		{ id: 2, mentionText: "Pat E.", mentioned: { user: { id: PAT.oid, displayName: "Pat E.", userIdentityType: "aadUser" } } },
	]);
	check("one lookup, for the person", seen.filter((s) => s.url.startsWith(PEOPLE)).length, 1);
});

await section("an app mention in a code span is an example and notifies nobody", async () => {
	const { seen, b } = graphBackend();
	const { html, mentions } = renderWithMentions(`write \`@[Captain](app:${APP})\`, then @[Captain](app:${APP}) deploy`);
	check("only the real one is a mention", mentions.length, 1);
	await b.send({ kind: "chat", chat: "", id: CHAT }, html.trim(), true, mentions);
	const post = seen.find((s) => s.method === "POST");
	check("the example stays in its code span", post?.body.body.content.includes(`<code>@[Captain](app:${APP})</code>`), true);
	check("one mention posted", post?.body.mentions?.map((m) => m.id), [0]);
});

await section("an app target that is not an app id is refused, not sent as text", async () => {
	for (const bad of ["app:not-a-guid", "app:not a guid", `app:${APP.slice(0, -1)}`])
		check(`@[Captain](${bad}) is refused, naming it`, (await threw(() => renderWithMentions(`@[Captain](${bad}) hi`))).includes(bad), true);
	// Spaces or a line break around the id and the case of `app:` are not typos worth refusing: it is the same app.
	check("spaces and APP: still name the app", renderWithMentions(`@[Captain](APP: ${APP} ) hi`).mentions, [{ name: "Captain", app: APP }]);
	check("a line break before ) still names the app", renderWithMentions(`@[Captain](app:${APP}\n) hi`).mentions, [{ name: "Captain", app: APP }]);
	// An unclosed fragment does not run across lines into a later `)`: it stays text, and the message still goes.
	const prose = renderWithMentions("an unclosed @[Bot](app: example\nsee [runbook](https://example.test) for more");
	check("an unclosed app fragment stays text", [prose.mentions, prose.html.includes("https://example.test")], [[], true]);
});

await section("the self-chat refuses an app mention, as text, card or file, before anything is sent", async () => {
	const png = join(home, "shot.png");
	writeFileSync(png, Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
	const log = join(home, "run.log");
	writeFileSync(log, "line 1\n");
	const { html, mentions } = renderWithMentions(`note @[Captain](app:${APP})`);
	const shapes = {
		"text with a picture (chatsvc)": (b) => b.send({ kind: "self" }, html, true, mentions, [png]),
		"a card (Graph)": (b) => b.send({ kind: "self" }, html, true, mentions, [], { type: "AdaptiveCard" }),
		"a file (Graph)": (b) => b.send({ kind: "self" }, html, true, mentions, [], undefined, [log]),
		"text to chat_id 48:notes": (b) => b.send({ kind: "chat", chat: "", id: "48:notes" }, html, true, mentions),
		"a missing file (refused before it is read)": (b) => b.send({ kind: "self" }, html, true, mentions, [], undefined, [join(home, "missing.log")]),
	};
	for (const [shape, send] of Object.entries(shapes)) {
		const sent = [];
		const uploads = [];
		const skype = { send: async (...a) => sent.push(a), uploadImage: async (...a) => uploads.push(a), selfMessages: async () => [] };
		const { seen, b } = graphBackend({ skype });
		const msg = await threw(() => send(b));
		check(`${shape}: refused, saying why`, /self-chat has no apps/.test(msg), true);
		check(`${shape}: nothing uploaded, sent or posted`, [uploads.length, sent.length, seen.filter((s) => s.method !== "GET").length], [0, 0, 0]);
	}
});

await section("teams_send: an app mention in a card notifies from the body beside it", async () => {
	const calls = [];
	const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
	globalThis.fetch = async (url, init) => {
		const method = init?.method ?? "GET";
		calls.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body) : null });
		if (String(url).startsWith(PEOPLE)) return reply(200, directory(String(url)));
		if (method === "POST") return reply(201, { id: "m1" });
		return reply(200, { value: [] });
	};
	auth.getToken = async () => "SYNTHETIC-TOKEN";
	const tools = {};
	await teams({
		registerTool: (t) => (tools[t.name] = t),
		registerCommand: () => {},
		registerShortcut: () => {},
		on: () => {},
		exec: async () => {
			throw new Error("the graph backend shelled out");
		},
		sendUserMessage: () => {},
		sendMessage: () => {},
	});
	const ctx = {
		hasUI: false,
		cwd: "/tmp",
		isIdle: () => true,
		sessionManager: { getSessionId: () => "app-mentions-session" },
		ui: { theme: { fg: (_c, s) => s }, setStatus: () => {}, notify: () => {} },
	};
	await tools.teams_send.execute("1", { target: "chat", chat_id: CHAT, message: `@[Captain](app:${APP}) please deploy`, card: true }, null, null, ctx);
	const post = calls.find((c) => c.method === "POST" && c.url === `${GRAPH}/chats/${CHAT}/messages`);
	check("the body notifies the app", post?.body.body.content.startsWith('<p><at id="0">Captain</at></p>'), true);
	check("as the app", post?.body.mentions, [{ id: 0, mentionText: "Captain", ...appMention("Captain", APP) }]);
	const card = post?.body.attachments?.[0]?.content ?? "";
	check("the card shows the bold name, not the syntax", [card.includes("**Captain** please deploy"), card.includes("app:")], [true, false]);
	check("no directory lookup", calls.filter((c) => c.url.startsWith(PEOPLE)).length, 0);
});

console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
