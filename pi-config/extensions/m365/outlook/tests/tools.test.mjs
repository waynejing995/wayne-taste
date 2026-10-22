/**
 * The seven agent tools in index.ts.
 *
 *   U18  outlook_send and outlook_draft: the footer, the order of Mailbox calls,
 *        what the parameters override, the results, and a refused send.
 *   U19  outlook_list, outlook_search, outlook_read, outlook_move, outlook_mark:
 *        the lines, the read layout, the arguments, one unread poll per action.
 *   U33  every tool refuses without a sign-in and says so.
 *
 * index.ts builds its own Mailbox, so these tests replace Mailbox methods on the
 * class index.ts constructs (the same jiti module index.ts loads). U33 keeps the
 * real methods: their token is the real teams auth reading an empty cache, so
 * the only answer is "not authenticated". A fetch guard fails the run if
 * anything reaches the network.
 *
 *   node tests/tools.test.mjs
 */
import { deepStrictEqual } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJiti } from "/root/.nvm/versions/node/v22.22.1/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
// Resolved paths: importing through the symlink would give a second copy of every module. See ext-path.mjs.
import { EXT_DIR, ext } from "./ext-path.mjs";

// No MSAL cache in this process, so a token request can only fail with the sign-in hint.
const cacheHome = mkdtempSync(join(tmpdir(), "outlook-tools-"));
process.env.XDG_CACHE_HOME = cacheHome;
// The signature is read from ~/.pi/agent; the user's real one must not leak into a test.
process.env.HOME = cacheHome;
process.on("exit", () => rmSync(cacheHome, { recursive: true, force: true }));
const SIGNATURE_FILE = join(cacheHome, ".pi", "agent", "outlook-signature.md");
const netCalls = [];
globalThis.fetch = async (url) => {
	netCalls.push(String(url));
	throw new Error(`a test reached the network: ${url}`);
};

const D = "/root/.nvm/versions/node/v22.22.1/lib/node_modules/@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${D}/dist/index.js`,
		"@earendil-works/pi-ai": `${D}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${D}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${D}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const extension = await jiti.import(ext("index.ts"), { default: true });
const { Mailbox } = await jiti.import(ext("mailbox.ts"));
const { GraphError } = await jiti.import(join(EXT_DIR, "..", "core", "graph.ts"));
const { formatLocal } = await jiti.import(join(EXT_DIR, "..", "core", "time.ts"));

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
/** Deep equality, key order ignored. */
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
const textOf = (result) => result.content.map((c) => c.text ?? "").join("\n");

// --- The Mailbox seam --------------------------------------------------------

const METHODS = ["list", "search", "read", "draftFor", "build", "submit", "saveDraft", "move", "setRead", "unreadCount"];
const REAL = Object.fromEntries(METHODS.map((name) => [name, Mailbox.prototype[name]]));
/** Mailbox with the named methods replaced. Called with nothing, it is the real Mailbox again. */
function useMailbox(fakes = {}) {
	Object.assign(Mailbox.prototype, REAL, fakes);
}

/** The compose half of Mailbox, recorded. `refuse` makes submit reject with that error. */
function composeFakes({ refuse } = {}) {
	const log = [];
	useMailbox({
		draftFor: async (kind, id) => {
			log.push({ call: "draftFor", kind, id });
			return draftDefaults(kind, id);
		},
		build: async (d) => {
			log.push({ call: "build", d });
			return Buffer.from("EML");
		},
		submit: async (d) => {
			log.push({ call: "submit", d });
			if (refuse) throw refuse;
		},
		saveDraft: async (d) => {
			log.push({ call: "saveDraft", d });
			return "d1";
		},
	});
	return {
		log,
		calls: (name) => log.filter((e) => e.call === name),
		order: () => log.map((e) => e.call),
	};
}

/** What draftFor answers. A reply to m1 goes to Alice, copies Carl, and is titled RE:. */
function draftDefaults(kind, id) {
	if (kind === "new") return { kind, to: [], cc: [], subject: "", references: [], attachments: [] };
	return {
		kind,
		id,
		to: [{ name: "Alice", address: "alice@example.com" }],
		cc: [{ address: CARL }],
		subject: "RE: Quarterly status",
		references: [],
		attachments: [],
	};
}

// --- Loading and sessions ----------------------------------------------------

/** The tools the default export registers, by name. */
async function loadTools() {
	const tools = {};
	await extension({
		registerTool: (t) => {
			tools[t.name] = t;
		},
		registerCommand: () => {},
		on: () => {},
		exec: async () => {
			throw new Error("outlook never runs pi.exec");
		},
		sendUserMessage: () => {},
	});
	return tools;
}
const tool = (tools, name) => {
	if (!tools[name]) throw new Error(`tool ${name} is not registered`);
	return tools[name];
};
/** A session with a UI that records every status line set on it. */
function session(model = { name: "test-model" }) {
	const seen = [];
	const ctx = {
		hasUI: true,
		cwd: "/tmp",
		model,
		ui: {
			theme: { fg: (_color, s) => s },
			setStatus: (key, text) => seen.push({ key, text }),
			notify: () => {},
		},
	};
	return { ctx, outlookStatus: () => seen.filter((s) => s.key === "comms").map((s) => s.text) };
}

const ANN = "ann@example.com";
const BOB = "bob@example.com";
const CARL = "carl@example.com";
const HINT = "not authenticated — run /teams init";
const UNREAD = {
	id: "m1",
	subject: "Quarterly status",
	from: { name: "Alice", address: "alice@example.com" },
	received: "2026-10-14T01:30:00Z",
	isRead: false,
	hasAttachments: true,
	preview: "",
};
const READ = {
	id: "m2",
	subject: "Lunch?",
	from: { address: BOB },
	received: "2026-10-13T08:00:00Z",
	isRead: true,
	hasAttachments: false,
	preview: "",
};

// --- U18: outlook_send and outlook_draft -------------------------------------

await section("U18 outlook_send new: build with the footer, then submit; the result names the recipient", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx, outlookStatus } = session();
	const r = await tool(tools, "outlook_send").execute("s1", { kind: "new", to: [ANN], subject: "s", body: "b" }, undefined, undefined, ctx);
	equal("draftFor, build and submit run in that order", fake.order(), ["draftFor", "build", "submit"]);
	const built = fake.calls("build")[0].d;
	equal("the footer says an agent sent it and names no model", built.footer, "\n\n---\n\n*sent by omp agent*");
	equal("the Markdown body is what gets built", built.markdown, "b");
	equal("To is the address given", fake.calls("submit")[0].d.to, [{ address: ANN }]);
	equal("the result names the subject and recipient", textOf(r), `sent "s" to ${ANN}`);
	equal("the status says sending… first, then sent ✓", outlookStatus(), ["Outlook: … · sending…", "Outlook: … · sent ✓"]);
});

await section("U18 outlook_draft: the same footer, saveDraft and never submit", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx, outlookStatus } = session();
	const r = await tool(tools, "outlook_draft").execute("d1", { kind: "new", to: [ANN], subject: "s", body: "b" }, undefined, undefined, ctx);
	equal("draftFor, build and saveDraft run in that order", fake.order(), ["draftFor", "build", "saveDraft"]);
	equal("the same footer", fake.calls("build")[0].d.footer, "\n\n---\n\n*sent by omp agent*");
	equal("the result says the draft is unsent", textOf(r), `draft saved "s" (id d1) — in Drafts, not sent`);
	equal("nothing was submitted", fake.calls("submit").length, 0);
	equal("a draft flashes nothing", outlookStatus(), []);
});

await section("U18 an @mention adds the person to To, as Outlook does; one already in To or Cc is not repeated", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx } = session();
	const body = `Hi @[Bob](bob@example.com), see @[Ann](${ANN}) and @[Bob](BOB@example.com) again.`;
	await tool(tools, "outlook_send").execute("m1", { kind: "new", to: [ANN], subject: "s", body }, undefined, undefined, ctx);
	equal("To gains Bob once, Ann stays once", fake.calls("submit")[0].d.to, [{ address: ANN }, { name: "Bob", address: "bob@example.com" }]);
	equal("the built draft has the same To", fake.calls("build")[0].d.to, fake.calls("submit")[0].d.to);
});

await section("U18 the saved signature goes out with agent mail; none set, none sent", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx } = session();
	await tool(tools, "outlook_send").execute("g1", { kind: "new", to: [ANN], subject: "s", body: "b" }, undefined, undefined, ctx);
	equal("no signature file: an empty signature", fake.calls("build")[0].d.signature, "");
	mkdirSync(dirname(SIGNATURE_FILE), { recursive: true });
	writeFileSync(SIGNATURE_FILE, "Best,\n**Alex**\n");
	await tool(tools, "outlook_draft").execute("g2", { kind: "new", to: [ANN], subject: "s", body: "b" }, undefined, undefined, ctx);
	equal("an edited file applies to the next message, no restart", fake.calls("build")[1].d.signature, "Best,\n**Alex**");
	rmSync(SIGNATURE_FILE);
});

await section("U18 outlook_send reply: the To parameter replaces the default; Cc and Subject keep draftFor's", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx } = session();
	const r = await tool(tools, "outlook_send").execute("s2", { kind: "reply", id: "m1", to: [BOB], body: "b" }, undefined, undefined, ctx);
	equal("draftFor is asked for a reply to m1", fake.calls("draftFor")[0], { call: "draftFor", kind: "reply", id: "m1" });
	const sent = fake.calls("submit")[0].d;
	equal("To is the parameter", sent.to, [{ address: BOB }]);
	equal("Cc is draftFor's default", sent.cc, [{ address: CARL }]);
	equal("Subject is draftFor's default", sent.subject, "RE: Quarterly status");
	equal("the draft answers m1 as a reply", [sent.kind, sent.id], ["reply", "m1"]);
	equal("the result names the recipient and the copy", textOf(r), `sent "RE: Quarterly status" to ${BOB} cc ${CARL}`);
});

await section("U18 given cc and subject replace draftFor's defaults too; reply_all reaches Mailbox as replyAll", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx } = session();
	await tool(tools, "outlook_send").execute("s4", { kind: "reply", id: "m1", cc: [], subject: "Changed", body: "b" }, undefined, undefined, ctx);
	equal("an empty cc replaces the default", fake.calls("submit")[0].d.cc, []);
	equal("a given subject replaces the default", fake.calls("submit")[0].d.subject, "Changed");
	await tool(tools, "outlook_send").execute("s5", { kind: "reply_all", id: "m1", body: "b" }, undefined, undefined, ctx);
	equal("draftFor is asked for replyAll", fake.calls("draftFor")[1], { call: "draftFor", kind: "replyAll", id: "m1" });
	equal("the draft is a replyAll", fake.calls("submit")[1].d.kind, "replyAll");
});

await section("U18 a reply or forward without id rejects, naming id, before any Graph call", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx } = session();
	for (const name of ["outlook_send", "outlook_draft"]) {
		for (const kind of ["reply", "reply_all", "forward"]) {
			const e = await caught(() => tool(tools, name).execute("x", { kind, body: "b" }, undefined, undefined, ctx));
			check(`${name} ${kind} names id`, e instanceof Error && /\bid\b/.test(e.message), e?.message ?? "resolved");
		}
	}
	equal("no Mailbox call was made", fake.log.length, 0);
});

await section("U18 a new message without a subject rejects before any Graph call", async () => {
	const fake = composeFakes();
	const tools = await loadTools();
	const { ctx } = session();
	for (const name of ["outlook_send", "outlook_draft"]) {
		const e = await caught(() => tool(tools, name).execute("x", { kind: "new", to: [ANN], body: "b" }, undefined, undefined, ctx));
		check(`${name} new names subject`, e instanceof Error && /subject/.test(e.message), e?.message ?? "resolved");
	}
	equal("no Mailbox call was made", fake.log.length, 0);
});

await section("U18 a refused send: the Graph error reaches the caller; the status says send failed, never sent", async () => {
	const refusal = new GraphError("Graph 400 on /me/sendMail: ErrorInvalidRecipients — The recipient address is not valid.", 400, "{}");
	composeFakes({ refuse: refusal });
	const tools = await loadTools();
	const { ctx, outlookStatus } = session();
	const e = await caught(() => tool(tools, "outlook_send").execute("s3", { kind: "new", to: [ANN], subject: "s", body: "b" }, undefined, undefined, ctx));
	check("the tool rejects with that Graph error", e === refusal, e ? e.message : "resolved");
	check("the status shows send failed ✗", outlookStatus().some((t) => t.includes("send failed ✗")), JSON.stringify(outlookStatus()));
	check("sent ✓ never appears", outlookStatus().every((t) => !t.includes("sent ✓")), JSON.stringify(outlookStatus()));
});

// --- U19: list, search, read, move, mark -------------------------------------

await section("U19 outlook_list: one line per message; ● only when unread, 📎 only with attachments", async () => {
	const asked = [];
	useMailbox({
		list: async (folder, opts) => {
			asked.push({ folder, opts });
			return [UNREAD, READ];
		},
	});
	const tools = await loadTools();
	const { ctx } = session();
	const lines = textOf(await tool(tools, "outlook_list").execute("l1", {}, undefined, undefined, ctx)).split("\n");
	equal("one line per message", lines.length, 2);
	equal("the unread attached line", lines[0], `m1 · ${formatLocal(UNREAD.received)} · Alice <alice@example.com> · Quarterly status ● 📎`);
	equal("the read line has neither mark", lines[1], `m2 · ${formatLocal(READ.received)} · ${BOB} · Lunch?`);
	equal("the defaults ask the inbox for 20, unread or not", asked[0], { folder: "inbox", opts: { unreadOnly: false, top: 20, skip: 0 } });
	await tool(tools, "outlook_list").execute("l2", { folder: "archive", unread_only: true, top: 5 }, undefined, undefined, ctx);
	equal("the arguments reach Mailbox.list", asked[1], { folder: "archive", opts: { unreadOnly: true, top: 5, skip: 0 } });
});

await section("U19 outlook_list and outlook_search: an empty answer says no messages", async () => {
	useMailbox({ list: async () => [], search: async () => [] });
	const tools = await loadTools();
	const { ctx } = session();
	equal("list", textOf(await tool(tools, "outlook_list").execute("l3", {}, undefined, undefined, ctx)), "no messages in Inbox");
	equal("search", textOf(await tool(tools, "outlook_search").execute("q3", { query: "nothing" }, undefined, undefined, ctx)), "no messages");
});

await section("U19 outlook_search: the same lines for the query, 20 by default", async () => {
	const asked = [];
	useMailbox({
		search: async (query, top) => {
			asked.push([query, top]);
			return [READ];
		},
	});
	const tools = await loadTools();
	const { ctx } = session();
	const r = await tool(tools, "outlook_search").execute("q1", { query: "lunch" }, undefined, undefined, ctx);
	equal("the query and the default top reach Mailbox.search", asked[0], ["lunch", 20]);
	equal("the line", textOf(r), `m2 · ${formatLocal(READ.received)} · ${BOB} · Lunch?`);
});

await section("U19 outlook_read: header block, Markdown body, then attachments as name · type · size", async () => {
	const PDF = { filename: "report.pdf", mimeType: "application/pdf", disposition: "attachment", size: 2048, content: Buffer.alloc(2048) };
	let attachments = [PDF];
	useMailbox({
		read: async () => ({
			summary: UNREAD,
			mail: { references: [], subject: "Quarterly status", from: UNREAD.from, to: [{ name: "Me", address: "me@example.com" }], cc: [], attachments },
			markdown: "Status is **green**.\n\n- merged",
			images: [],
		}),
	});
	const tools = await loadTools();
	const { ctx } = session();
	const text = textOf(await tool(tools, "outlook_read").execute("r1", { id: "m1" }, undefined, undefined, ctx));
	const lines = text.split("\n");
	equal("From", lines[0], "From: Alice <alice@example.com>");
	equal("To", lines[1], "To: Me <me@example.com>");
	equal("Cc says none when there is none", lines[2], "Cc: (none)");
	equal("Date is the received time, local", lines[3], `Date: ${formatLocal(UNREAD.received)}`);
	equal("Subject", lines[4], "Subject: Quarterly status");
	equal("id", lines[5], "id: m1");
	check("the Markdown body comes after the header", text.indexOf("Status is **green**.\n\n- merged") > text.indexOf("id: m1"));
	check("the attachments come after the body", text.indexOf("Attachments:") > text.indexOf("- merged"));
	check("the attachment line reads name · type · size", lines.includes("report.pdf · application/pdf · 2.0 KB"), text);
	attachments = [];
	const bare = textOf(await tool(tools, "outlook_read").execute("r2", { id: "m1" }, undefined, undefined, ctx));
	check("no attachments, no Attachments: heading", !bare.includes("Attachments:"), bare);
});

await section("U19 outlook_read attaches the pictures the model can read, and says why it skips the others", async () => {
	const img = (filename, mimeType, size) => ({ filename, mimeType, disposition: "inline", size, content: Buffer.alloc(size, 1) });
	const images = [
		{ label: "image 1: a.png", image: img("a.png", "image/png", 10) },
		{ label: "image 2: b.tiff", image: img("b.tiff", "image/tiff", 10) },
		{ label: "image 3: c.jpg", image: img("c.jpg", "image/jpeg", 4_000_000) },
		{ label: "image 4: d.gif", image: img("d.gif", "image/gif", 10) },
		{ label: "image 5: e.png", image: img("e.png", "image/png", 10) },
	];
	useMailbox({
		read: async () => ({
			summary: UNREAD,
			mail: { references: [], subject: "Quarterly status", from: UNREAD.from, to: [], cc: [], attachments: images.map((m) => m.image) },
			markdown: "Chart: [image 1: a.png]",
			images,
		}),
	});
	const tools = await loadTools();
	const { ctx } = session();
	const r = await tool(tools, "outlook_read").execute("r3", { id: "m1" }, undefined, undefined, ctx);
	const blocks = r.content.filter((c) => c.type === "image");
	equal("the PNG and the GIF are attached, in order", blocks.map((b) => b.mimeType), ["image/png", "image/gif"]);
	equal("the PNG's bytes are its content, base64", blocks[0].data, Buffer.alloc(10, 1).toString("base64"));
	const text = textOf(r);
	check("each attached picture is labelled before it", text.includes("[image 1: a.png]") && text.includes("[image 4: d.gif]"), text);
	check("the TIFF is named as not attached, with the reason", text.includes("[image 2: b.tiff: not attached, image/tiff is not a type the model reads]"), text);
	check("the 4 MB JPEG is named as not attached, with the reason", text.includes("[image 3: c.jpg: not attached, 3.8 MB is over the per-image limit]"), text);
	check("past the first four, the rest are counted", text.includes("[1 more picture(s) not attached]"), text);
});

await section("U35 outlook_read lists the SharePoint/OneDrive files the body links to; ordinary links are not listed", async () => {
	useMailbox({
		read: async () => ({
			summary: UNREAD,
			mail: { references: [], subject: "s", from: UNREAD.from, to: [], cc: [], attachments: [] },
			markdown: "See [the plan](https://contoso.sharepoint.com/:x:/s/team/plan.xlsx) and [docs](https://example.com/docs).",
			images: [],
		}),
	});
	const tools = await loadTools();
	const { ctx } = session();
	const text = textOf(await tool(tools, "outlook_read").execute("lf", { id: "m1" }, undefined, undefined, ctx));
	check("the SharePoint file is listed with its link text", text.includes("Linked files (SharePoint/OneDrive):\nthe plan · https://contoso.sharepoint.com/:x:/s/team/plan.xlsx"), text);
	check("an ordinary link is not a linked file", !text.includes("docs · https://example.com"), text);
});

await section("U35 outlook_download saves the named attachment to ~/Downloads, never over an existing file", async () => {
	const pdf = { filename: "report.pdf", mimeType: "application/pdf", disposition: "attachment", size: 4, content: Buffer.from("%PDF") };
	useMailbox({
		read: async () => ({
			summary: UNREAD,
			mail: { references: [], subject: "s", from: UNREAD.from, to: [], cc: [], attachments: [pdf] },
			markdown: "",
			images: [],
		}),
	});
	const tools = await loadTools();
	const { ctx } = session();
	const dl = (args) => tool(tools, "outlook_download").execute("d", args, undefined, undefined, ctx);
	const first = textOf(await dl({ id: "m1", attachment: "report.pdf" }));
	const downloads = join(cacheHome, "Downloads");
	equal("saved under its own name in ~/Downloads", first, `saved report.pdf (4 B) to ${join(downloads, "report.pdf")}`);
	equal("with its bytes", readFileSync(join(downloads, "report.pdf"), "utf8"), "%PDF");
	const second = textOf(await dl({ id: "m1", attachment: "report.pdf" }));
	check("a second save takes a free name instead of overwriting", second.endsWith(join(downloads, "report (1).pdf")), second);
	writeFileSync(join(downloads, "mine.txt"), "keep me");
	const clash = await caught(() => dl({ id: "m1", attachment: "report.pdf", path: join(downloads, "mine.txt") }));
	check("an explicit path that exists is refused", /already exists; nothing was written/.test(clash?.message ?? ""), clash?.message);
	equal("and the file there keeps its bytes", readFileSync(join(downloads, "mine.txt"), "utf8"), "keep me");
	const explicit = textOf(await dl({ id: "m1", attachment: "report.pdf", path: join(downloads, "sub", "new.pdf") }));
	check("an explicit new path is written", explicit.endsWith(join(downloads, "sub", "new.pdf")), explicit);
	const missing = await caught(() => dl({ id: "m1", attachment: "nope.pdf" }));
	check("an unknown name is refused, listing what there is", /no attachments named "nope.pdf".*report\.pdf/.test(missing?.message ?? ""), missing?.message);
	const both = await caught(() => dl({ id: "m1", attachment: "report.pdf", url: "https://contoso.sharepoint.com/x" }));
	check("attachment and url together are refused", /exactly one/.test(both?.message ?? ""), both?.message);
	const web = await caught(() => dl({ url: "https://example.com/file.pdf" }));
	check("an ordinary web link is refused before any request", /not a SharePoint\/OneDrive link/.test(web?.message ?? ""), web?.message);
	rmSync(downloads, { recursive: true, force: true });
});

await section("U19 outlook_move: Mailbox.move gets the id and folder, then exactly one unread poll", async () => {
	const moved = [];
	let polls = 0;
	useMailbox({
		move: async (id, folder) => {
			moved.push([id, folder]);
		},
		unreadCount: async () => {
			polls++;
			return 2;
		},
	});
	const tools = await loadTools();
	const { ctx, outlookStatus } = session();
	const r = await tool(tools, "outlook_move").execute("mv1", { id: "m1", folder: "archive" }, undefined, undefined, ctx);
	equal("move got the id and folder", moved, [["m1", "archive"]]);
	equal("one unread poll", polls, 1);
	equal("the result names the folder", textOf(r), "moved to Archive");
	equal("the poll reached the status bar", outlookStatus().at(-1), "Outlook: 2 unread");
	await tool(tools, "outlook_move").execute("mv2", { id: "m2", folder: "deleteditems" }, undefined, undefined, ctx);
	equal("deleteditems is the second move", moved[1], ["m2", "deleteditems"]);
	equal("the second move is one more poll", polls, 2);
});

await section("U19 outlook_mark: Mailbox.setRead gets the id and flag, then exactly one unread poll", async () => {
	const marked = [];
	let polls = 0;
	useMailbox({
		setRead: async (id, read) => {
			marked.push([id, read]);
		},
		unreadCount: async () => {
			polls++;
			return 0;
		},
	});
	const tools = await loadTools();
	const { ctx, outlookStatus } = session();
	const r1 = await tool(tools, "outlook_mark").execute("mk1", { id: "m1", read: true }, undefined, undefined, ctx);
	equal("read:true reaches setRead", marked[0], ["m1", true]);
	equal("one unread poll", polls, 1);
	equal("the result for read", textOf(r1), "marked read");
	const r2 = await tool(tools, "outlook_mark").execute("mk2", { id: "m1", read: false }, undefined, undefined, ctx);
	equal("read:false reaches setRead", marked[1], ["m1", false]);
	equal("one more unread poll", polls, 2);
	equal("the result for unread", textOf(r2), "marked unread");
	equal("the poll reached the status bar", outlookStatus().at(-1), "Outlook: 0");
});

// --- U33: every tool refuses without a sign-in -------------------------------

await section("U33 each tool rejects with the sign-in hint, and none answers with a success", async () => {
	// The real Mailbox: its token is the real teams auth, and the cache is empty.
	useMailbox();
	const tools = await loadTools();
	const { ctx } = session();
	const calls = {
		outlook_list: {},
		outlook_folders: {},
		outlook_people: { query: "ann" },
		outlook_search: { query: "x" },
		outlook_read: { id: "m1" },
		outlook_draft: { kind: "new", to: [ANN], subject: "s", body: "b" },
		outlook_send: { kind: "new", to: [ANN], subject: "s", body: "b" },
		outlook_move: { id: "m1", folder: "archive" },
		outlook_mark: { id: "m1", read: true },
	};
	for (const [name, args] of Object.entries(calls)) {
		const e = await caught(() => tool(tools, name).execute("u", args, undefined, undefined, ctx));
		check(`${name} rejects with the hint`, e instanceof Error && e.message.includes(HINT), e ? e.message : "resolved");
	}
	check("no network call was attempted", netCalls.length === 0, netCalls.join(", "));
});

check("no network call was attempted in any section", netCalls.length === 0, netCalls.join(", "));
console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "all ok" : "FAIL");
process.exit(failed === 0 ? 0 : 1);
