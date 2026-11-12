/**
 * Pictures in Teams, both ways, offline.
 *
 * Receive: a picture pasted into the self-chat is an AMS object (`<img src=".../views/imgo">`) fetched with the skype
 * token; one in a Graph chat is a hostedContents URL fetched with the Graph token. Each token goes only to its own
 * host: an <img src> is written by whoever sent the message, so a token sent wherever it points would leak.
 *
 * Send: local image files go inline into any chat (hostedContents on Graph, AMS in the self-chat), with a card too,
 * and a Markdown `![](local path)` in the message is one of them.
 *
 * Synthetic data only.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
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
const { SkypeClient } = await jiti.import(join(ROOT, "teams", "skype.ts"));
const { GraphBackend } = await jiti.import(join(ROOT, "teams", "graph-backend.ts"));
const { GraphClient, readBounded } = await jiti.import(join(ROOT, "core", "graph.ts"));

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
		return String(e.message ?? e);
	}
};

const AMS = "https://us-api.asm.skype.com";
const AUTHZ = { tokens: { skypeToken: "SKYPE-1" }, regionGtms: { messagingService: "https://amer.ng.msg.teams.microsoft.com/v1", ams: AMS } };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a464946", "hex");

/** A chatsvc client whose transport answers from `route(url, init)`: {status, body (object or Buffer)}. */
function skype(route) {
	const seen = [];
	const doFetch = async (url, init) => {
		seen.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body });
		if (url.includes("/authsvc/")) return { status: 200, text: async () => JSON.stringify(AUTHZ) };
		const r = route(url, init) ?? { status: 404, body: {} };
		const bytes = Buffer.isBuffer(r.body) ? r.body : Buffer.from(JSON.stringify(r.body ?? {}));
		return {
			status: r.status ?? 200,
			text: async () => bytes.toString("utf8"),
			arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
		};
	};
	return { seen, c: new SkypeClient(async () => "AAD", doFetch) };
}

console.log("== receive: a picture pasted into the self-chat keeps its address ==");
const pasted = `<p><img src="${AMS}/v1/objects/0-wus-d1-abc/views/imgo" itemtype="http://schema.skype.com/AMSImage" itemscope="png" alt="image"></p><p>&nbsp;why need me</p>`;
{
	const { c } = skype((url) =>
		url.includes("/conversations/") ? { body: { messages: [{ id: "7", composetime: "2026-11-12T07:52:00Z", content: pasted, messagetype: "RichText/Html" }] } } : undefined,
	);
	const [m] = await c.selfMessages("", 20);
	check("the text still reads the picture as a marker", m.text.includes("[image]") && m.text.includes("why need me"), true);
	check("the picture's AMS address is carried", m.images, [`${AMS}/v1/objects/0-wus-d1-abc/views/imgo`]);
	const { c: plain } = skype((url) => (url.includes("/conversations/") ? { body: { messages: [{ id: "8", content: "no picture", messagetype: "Text" }] } } : undefined));
	check("a message without one has none", (await plain.selfMessages("", 20))[0].images, undefined);
}


console.log("\n== receive: a file sent to the self-chat keeps its name and address ==");
{
	const SP = "https://contoso-my.sharepoint.com/personal/me_contoso_test/Documents/Microsoft%20Teams%20Chat%20Files";
	const files = JSON.stringify([{ fileName: "shot.png", fileType: "png", objectUrl: `${SP}/shot.png`, itemid: "i1" }, { fileName: "", objectUrl: "" }]);
	const { c } = skype((url) =>
		url.includes("/conversations/") ? { body: { messages: [{ id: "9", composetime: "2026-11-12T08:00:00Z", content: "", messagetype: "RichText/Html", properties: { files } }] } } : undefined,
	);
	const [m] = await c.selfMessages("", 20);
	check("a file-only note is not dropped", m?.id, "9");
	check("its file is carried, a nameless one is not", m?.files, [{ name: "shot.png", url: `${SP}/shot.png` }]);
}
console.log("\n== receive: the AMS download goes with the skype token, to the AMS host only ==");
{
	const url = `${AMS}/v1/objects/0-wus-d1-abc/views/imgo`;
	const { c, seen } = skype((u) => (u === url ? { body: JPEG } : undefined));
	const got = await c.image(url);
	check("the bytes", [...got], [...JPEG]);
	const get = seen.find((s) => s.url === url);
	check("skype_token auth, as AMS wants it", get?.headers.Authorization, "skype_token SKYPE-1");
	check("a User-Agent AMS accepts", /Mozilla\/5\.0/.test(get?.headers["User-Agent"] ?? ""), true);

	const evil = skype(() => ({ body: PNG }));
	check("another host is refused", /not a Teams image host/.test(await threw(() => evil.c.image("https://evil.example/v1/objects/x/views/imgo"))), true);
	check("and nothing is fetched from it", evil.seen.some((s) => s.url.includes("evil.example")), false);

	const gone = skype((u) => (u === url ? { status: 404, body: { error: "gone" } } : undefined));
	check("a failed download says its status", /AMS image 404/.test(await threw(() => gone.c.image(url))), true);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "none" })}.${b64({ oid: "OID-1", tid: "TID-1" })}.sig`;
const ME = "Me, Myself";

/** A Graph backend recording every Graph call; `skypeClient` is the self-chat client. */
function graph(skypeClient, fetchOverride) {
	const seen = [];
	const doFetch = fetchOverride ?? (async (url, init) => {
		seen.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
		return { status: 201, text: async () => "{}", arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
	});
	return { seen, b: new GraphBackend(new GraphClient(async () => JWT, doFetch), { whoami: async () => ME, skype: skypeClient }) };
}

console.log("\n== receive: GraphBackend.image sends each token to its own host ==");
{
	const asked = [];
	const fakeSkype = { image: async (u) => (asked.push(u), JPEG) };
	const { b, seen } = graph(fakeSkype);
	const hosted = "https://graph.microsoft.com/v1.0/chats/19:x/messages/1/hostedContents/a/$value";
	check("a hostedContents URL goes to Graph", [[...(await b.image(hosted))], seen.map((s) => s.url)], [[...PNG], [hosted]]);
	check("an AMS URL goes to the self-chat client", [[...(await b.image(`${AMS}/v1/objects/o/views/imgo`))], asked], [[...JPEG], [`${AMS}/v1/objects/o/views/imgo`]]);
	const before = seen.length;
	check("any other host is refused", /not a Teams image host/.test(await threw(() => b.image("https://evil.example/x.png"))), true);
	check("and the Graph token is not sent there", seen.length, before);
	const plain = seen.length;
	check("plain-http Graph is refused", /not https/.test(await threw(() => b.image("http://graph.microsoft.com/v1.0/chats/c/messages/m/hostedContents/h/$value"))), true);
	check("plain-http AMS is refused", /not https/.test(await threw(() => b.image("http://us-api.asm.skype.com/v1/objects/x/views/imgo"))), true);
	let cancelled = false;
	const huge = graph(undefined, async () => ({
		status: 200,
		headers: { get: () => null },
		body: { getReader: () => ({ read: async () => (cancelled ? { done: true, value: undefined } : { done: false, value: new Uint8Array(1024 * 1024) }), cancel: async () => { cancelled = true; } }) },
	}));
	check("an oversized stream is refused before it is buffered", /image over 20 MB/.test(await threw(() => huge.b.image(hosted))), true);
	check("and the stream is cancelled", cancelled, true);
	const controller = new AbortController();
	controller.abort();
	check("a stalled download times out", /download timed out/.test(await threw(() => readBounded({ status: 200, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) }, 1, controller.signal))), true);
	check("and aborts the request", controller.signal.aborted, true);
	check("and nothing is fetched over http", seen.length, plain);
}

const dir = mkdtempSync(join(tmpdir(), "teams-images-"));
writeFileSync(join(dir, "a.png"), PNG);
writeFileSync(join(dir, "b.jpg"), JPEG);

console.log("\n== send: images go inline into a chat as hostedContents ==");
{
	const { b, seen } = graph(undefined);
	await b.send({ kind: "chat", id: "19:x@thread.v2" }, "<p>look</p>", true, [], [join(dir, "a.png"), join(dir, "b.jpg")]);
	const post = seen.at(-1);
	check("one post to the chat", [seen.length, post.method, post.url], [1, "POST", "https://graph.microsoft.com/v1.0/chats/19:x@thread.v2/messages"]);
	check(
		"each picture an <img> after the text",
		post.body.body.content,
		'<p>look</p><p><img src="../hostedContents/1/$value" alt="a.png"></p><p><img src="../hostedContents/2/$value" alt="b.jpg"></p>',
	);
	check(
		"the bytes ride along as hostedContents",
		post.body.hostedContents,
		[
			{ "@microsoft.graph.temporaryId": "1", contentBytes: PNG.toString("base64"), contentType: "image/png" },
			{ "@microsoft.graph.temporaryId": "2", contentBytes: JPEG.toString("base64"), contentType: "image/jpeg" },
		],
	);
	check("html", post.body.body.contentType, "html");
}

console.log("\n== send: a card can carry images too ==");
{
	const { b, seen } = graph({ uploadImage: async () => { throw new Error("a card is not a chatsvc send"); } });
	const card = { type: "AdaptiveCard", version: "1.5", body: [] };
	await b.send({ kind: "self" }, "", true, [], [join(dir, "a.png")], card);
	const post = seen.at(-1);
	check("posted through Graph, as a card to the self-chat is", post.url, "https://graph.microsoft.com/v1.0/chats/48:notes/messages");
	check("the card is still attached", post.body.attachments?.[0]?.contentType, "application/vnd.microsoft.card.adaptive");
	check("and the picture is inline beside it", [/<img src="\.\.\/hostedContents\/1\/\$value"/.test(post.body.body.content), post.body.hostedContents?.length], [true, 1]);
}

console.log("\n== send: the self-chat still uploads to AMS ==");
{
	const order = [];
	const fake = {
		uploadImage: async (_bytes, name) => (order.push(`upload ${name}`), { id: `id-${name}`, name, host: AMS }),
		send: async (_c, _h, _m, imgs) => order.push(`send ${imgs.map((x) => x.id).join(",")}`),
	};
	const { b, seen } = graph(fake);
	await b.send({ kind: "self" }, "<p>x</p>", true, [], [join(dir, "a.png")]);
	check("upload then send, nothing to Graph", [order, seen.length], [["upload a.png", "send id-a.png"], 0]);
}

console.log("\n== send: a bad file refuses the whole message ==");
{
	writeFileSync(join(dir, "secret.txt"), "TOKEN=x");
	const { b, seen } = graph(undefined);
	check("a non-image", /not a PNG, JPEG or GIF/.test(await threw(() => b.send({ kind: "chat", id: "19:x" }, "x", true, [], [join(dir, "secret.txt")]))), true);
	check("posts nothing", seen.length, 0);
}



console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed === 0 ? 0 : 1);
