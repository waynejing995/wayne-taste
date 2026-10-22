/**
 * The /outlook overlay: U22 (index, pager, search, picker, actions, keys),
 * U23 (compose and prompts), U24 (reply and forward pre-fill), U25 (pager
 * rendering, failed move) and U32 (pager scrolling), at widths 120/100/80/60.
 *
 * The deps are fakes that record every call. The MIME is real: buildEml and
 * parseEml run on the fixtures, so what the overlay submits is what it shows.
 *
 *   node tests/overlay.test.mjs
 */
import { createJiti, PI } from "../../tests/host.mjs";
import { readFileSync } from "node:fs";
// Resolved paths: importing through the symlink would give a second copy of
// every module, and the global theme lives in one of them. See ext-path.mjs.
import { ext } from "./ext-path.mjs";

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
const { openOutlookOverlay } = await jiti.import(ext("overlay.ts"));
const { buildEml, parseEml, respondDefaults } = await jiti.import(ext("mime.ts"));
const { renderMarkdown } = await jiti.import(ext("render.ts"));
const { htmlToMarkdown } = await jiti.import(ext("convert.ts"));
const pc = await jiti.import(`${D}/dist/index.js`);
const { CURSOR_MARKER, visibleWidth } = await jiti.import(`${D}/node_modules/@earendil-works/pi-tui/dist/index.js`);

// pi sets the global theme at startup (main.js calls initTheme), and the Markdown
// palette reads it, so the suite sets it before any overlay opens. A named theme
// keeps the output independent of the terminal background.
pc.initTheme("dark", false);

const WIDTHS = [120, 100, 80, 60];
const SELF = "me@example.com";
const MAIL_TEXT = "Status is green.\nMerged to main.";
const MAIL = await parseEml(readFileSync(ext("tests/fixtures/mime-original.eml")));
const SEED_MD = htmlToMarkdown(renderMarkdown(readFileSync(ext("tests/fixtures/seed-report.md"), "utf8")));

const row = (id, subject, name, address, received, isRead, hasAttachments) => ({
	id,
	subject,
	from: { name, address },
	received,
	isRead,
	hasAttachments,
	preview: "",
});
const ROWS = {
	inbox: [
		row("m1", "Quarterly status", "Alice", "alice@example.com", "2026-10-14T01:30:00Z", false, false),
		row("m2", "Lunch?", "Bob", "bob@example.com", "2026-10-13T08:00:00Z", true, true),
		row("m3", "Build broke", "Carol", "carol@example.com", "2026-10-12T10:00:00Z", false, false),
	],
	archive: [],
	sentitems: [row("s1", "Sent thing", "Me", SELF, "2026-10-01T10:00:00Z", true, false)],
	drafts: [],
	deleteditems: [],
	"f-dri": [row("d1", "[PATCH] drm: fix", "Dave", "dave@example.com", "2026-10-11T10:00:00Z", false, false)],
};
// Graph's tree order: a rule's folder sits under Inbox.
const FOLDER_LIST = [
	{ id: "inbox", path: "Inbox", unread: 2, total: 3 },
	{ id: "f-dri", path: "Inbox/dri-devel", unread: 7, total: 9 },
	{ id: "archive", path: "Archive", unread: 0, total: 0 },
	{ id: "sentitems", path: "Sent Items", unread: 0, total: 1 },
	{ id: "drafts", path: "Drafts", unread: 0, total: 0 },
	{ id: "deleteditems", path: "Deleted Items", unread: 0, total: 0 },
];
const ALL = Object.values(ROWS).flat();
const rowOf = (id) => ({ ...ALL.find((r) => r.id === id) });

// The overlay's theme, with SGR codes as the markers: they have no width, so
// every width check still holds, and the test can see which colour was used.
const SGR = { success: [32, 39], error: [31, 39], warning: [33, 39], dim: [2, 22], accent: [36, 39], muted: [90, 39] };
const theme = {
	fg: (color, text) => (SGR[color] ? `\x1b[${SGR[color][0]}m${text}\x1b[${SGR[color][1]}m` : text),
	bg: (color, text) => (color === "selectedBg" ? `\x1b[44m${text}\x1b[49m` : text),
	bold: (text) => text,
};

let passed = 0;
let failed = 0;
const pass = (label) => {
	passed++;
	console.log(`PASS  ${label}`);
};
const fail = (label, detail = "") => {
	failed++;
	console.log(`FAIL  ${label}${detail ? `  (${detail})` : ""}`);
};
const check = (label, cond, detail = "") => (cond ? pass(label) : fail(label, detail));
const eq = (label, got, want) =>
	check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
// Two screens match only when both have lines and agree line for line: an empty screen proves nothing.
const same = (a, b) => a.length > 0 && a.length === b.length && a.every((r, i) => r === b[i]);
// Every session a scenario opened; its final screens are checked at every width.
const live = [];
async function scenario(label, fn) {
	live.length = 0;
	try {
		await fn();
		for (const s of live) for (const w of WIDTHS) s.lines(w);
	} catch (e) {
		fail(`${label} threw`, String(e?.stack ?? e).split("\n").slice(0, 3).join(" | "));
	}
}

const plain = (s = "") => s.replace(/\x1b\[[0-9;]*m/g, "").split(CURSOR_MARKER).join("");
// A content row is framed as "│ " + row + " │": two columns on each side.
const inside = (L) => L.map((l) => plain(l).slice(2, -2));
const contentRaw = (L) => inside(L).slice(1, -3);
const contentRows = (L) => contentRaw(L).map((r) => r.trimEnd());
const titleOf = (L) => plain(L[0] ?? "");
const statusOf = (L) => (L.length >= 3 ? inside(L)[L.length - 3].trim() : "");
const hiText = (L) => {
	const i = L.findIndex((l) => l.includes("\x1b[44m"));
	return i < 0 ? "" : plain(L[i]);
};
const LABELS = ["To:", "Cc:", "Subject:", "Body:"];
// The focused field: the label above the caret. Field lines are labelled at
// column 0 and their continuation lines are indented by the nine-column label.
function caretField(L) {
	const at = L.findIndex((l) => l.includes(CURSOR_MARKER));
	if (at < 1) return "none";
	const rows = contentRaw(L);
	for (let i = at - 1; i >= 0; i--) {
		const label = LABELS.find((x) => rows[i].startsWith(x));
		if (label) return label.slice(0, -1).toLowerCase();
	}
	return "none";
}
// The text of a labelled field, its continuation lines included.
function fieldText(L, label) {
	const rows = contentRaw(L);
	const at = rows.findIndex((r) => r.startsWith(label));
	if (at < 0) return undefined;
	const out = [rows[at].slice(9).trimEnd()];
	for (let i = at + 1; i < rows.length && rows[i].startsWith("         "); i++) out.push(rows[i].slice(9).trimEnd());
	return out.join("\n");
}
function tablesOf(L) {
	const blocks = [];
	let cur = null;
	for (const r of contentRows(L)) {
		if (r.startsWith("┌")) cur = [];
		if (cur) cur.push(r);
		if (cur && r.startsWith("└")) {
			blocks.push(cur);
			cur = null;
		}
	}
	return blocks;
}
const alignedBlock = (rows) => new Set(rows.map((r) => visibleWidth(r))).size === 1;

// A fake host: custom() runs the factory the way the TUI does and returns the
// promise that done() resolves. Every deps call is recorded as [name, ...args].
function deps(log, impl = {}) {
	const rec = (name, fn) => async (...args) => {
		log.push([name, ...args]);
		return (impl[name] ?? fn)(...args);
	};
	return {
		list: rec("list", async (folder) => (ROWS[folder] ?? []).map((r) => ({ ...r }))),
		search: rec("search", async () => ROWS.inbox.map((r) => ({ ...r }))),
		read: rec("read", async (id) => ({ summary: rowOf(id), mail: MAIL, markdown: MAIL_TEXT, images: [] })),
		draftFor: rec("draftFor", async (kind, id) =>
			kind === "new"
				? { kind, to: [], cc: [], subject: "", references: [], attachments: [] }
				: { ...respondDefaults(kind, MAIL, [SELF]), id },
		),
		build: rec("build", async (d) => buildEml({ ...d, from: { name: "Me", address: SELF } })),
		submit: rec("submit", async () => undefined),
		saveDraft: rec("saveDraft", async () => "draft-1"),
		move: rec("move", async () => undefined),
		setRead: rec("setRead", async () => undefined),
		refreshUnread: rec("refreshUnread", async () => undefined),
		signature: impl.signature ?? (() => ""),
		folders: rec("folders", async () => FOLDER_LIST.map((f) => ({ ...f }))),
		describe: rec("describe", async (image) => `a picture of ${image.filename}`),
		saveAttachment: rec("saveAttachment", async (a) => `/home/me/Downloads/${a.filename}`),
		saveLink: rec("saveLink", async () => "/home/me/Downloads/plan.xlsx"),
	};
}

function session(impl = {}) {
	const log = [];
	const tui = { terminal: { rows: 40, cols: 120 }, requestRender() {} };
	let component;
	let finish;
	const closed = new Promise((r) => (finish = r));
	const ctx = {
		ui: {
			custom(factory) {
				component = factory(tui, theme, {}, () => finish());
				return closed;
			},
		},
	};
	const opened = openOutlookOverlay(ctx, deps(log, impl));
	const lines = (w = 100) => {
		const L = component.render(w);
		const over = L.find((l) => visibleWidth(l) > w);
		if (over !== undefined) fail(`no rendered line wider than ${w}`, JSON.stringify(plain(over)));
		return L;
	};
	const api = {
		log,
		tui,
		closed,
		opened,
		press: (...keys) => {
			for (const k of keys) component.handleInput(k);
		},
		type: (text) => {
			for (const ch of text) component.handleInput(ch);
		},
		tick: () => new Promise((r) => setTimeout(r, 20)),
		lines,
		text: (w = 100) => lines(w).map(plain).join("\n"),
		calls: (name) => log.filter((c) => c[0] === name),
	};
	live.push(api);
	return api;
}

// Opens compose on a new draft and fills every field.
async function fillNew(s) {
	s.press("m");
	await s.tick();
	s.type("x@y");
	s.press("\t", "\t");
	s.type("Hi");
	s.press("\t");
	s.type("Body text");
}

// ---------- U22: index, pager, search, picker, actions, keys ----------
await scenario("U22 index: load, j/k move the highlight, unread marks", async () => {
	const s = session();
	await s.tick();
	eq("U22 open lists the inbox", s.calls("list").map((c) => c[1]), ["inbox"]);
	let L = s.lines(100);
	check("U22 title counts the unread rows", titleOf(L).includes("Inbox (2 unread)"), titleOf(L));
	check("U22 unread rows carry the dot", inside(L).some((r) => r.startsWith("● ") && r.includes("Quarterly status")));
	check("U22 the first row is highlighted", hiText(L).includes("Quarterly status"), hiText(L));
	s.press("j");
	await s.tick();
	L = s.lines(100);
	check("U22 j moves the highlight to the next row", hiText(L).includes("Lunch?"), hiText(L));
	s.press("k");
	await s.tick();
	L = s.lines(100);
	check("U22 k moves the highlight back", hiText(L).includes("Quarterly status"), hiText(L));
	s.press("k");
	await s.tick();
	L = s.lines(100);
	check("U22 k at the top leaves the highlight", hiText(L).includes("Quarterly status"), hiText(L));
	for (const w of WIDTHS) s.lines(w);
});

await scenario("U22 Enter opens the pager, reads, marks read, refreshes unread; q returns to the same row", async () => {
	const s = session();
	await s.tick();
	s.press("\r");
	await s.tick();
	s.lines(100);
	check("U22 Enter opens the pager with the From header", s.text(100).includes("From: Alice <alice@example.com>"));
	check("U22 the pager shows the body", s.text(100).includes("Status is green."));
	eq("U22 Enter reads the highlighted message", s.calls("read").map((c) => c[1]), ["m1"]);
	eq("U22 Enter marks it read", s.calls("setRead").map((c) => c.slice(1)), [["m1", true]]);
	eq("U22 Enter refreshes the unread count", s.calls("refreshUnread").length, 1);
	s.press("q");
	await s.tick();
	const L = s.lines(100);
	check("U22 pager q returns to the index on the same row", hiText(L).includes("Quarterly status"), hiText(L));
	check("U22 the read row leaves the unread count", titleOf(L).includes("Inbox (1 unread)"), titleOf(L));
	for (const w of WIDTHS) s.lines(w);
});

await scenario("U22 search: / then Enter runs search(query, 50); / then Esc reloads the folder", async () => {
	const s = session();
	await s.tick();
	s.press("/");
	s.type("seed");
	await s.tick();
	check("U22 / shows the query prompt", statusOf(s.lines(100)).includes("/seed"), statusOf(s.lines(100)));
	s.press("\r");
	await s.tick();
	eq("U22 Enter searches the query for 50 results", s.calls("search").map((c) => c.slice(1)), [["seed", 50]]);
	check("U22 the title shows the query", titleOf(s.lines(100)).includes("search: seed"), titleOf(s.lines(100)));
	s.press("/");
	await s.tick();
	s.press("\x1b");
	await s.tick();
	eq("U22 / then Esc lists the current folder again", s.calls("list").map((c) => c[1]), ["inbox", "inbox"]);
	check("U22 the reload drops the query from the title", titleOf(s.lines(100)).includes("Inbox (2 unread)"), titleOf(s.lines(100)));
	for (const w of WIDTHS) s.lines(w);
});

await scenario("U22 picker: every folder, subfolders indented with unread; j/k/↑/↓ move, Enter lists, Esc keeps", async () => {
	const s = session();
	await s.tick();
	s.press("c");
	await s.tick();
	eq("U22 c fetches the folders", s.calls("folders").length, 1);
	check("U22 c opens the picker with Inbox highlighted", hiText(s.lines(100)).includes("Inbox"), hiText(s.lines(100)));
	check("U22 a rule's folder is listed, indented under Inbox, with its unread count", contentRows(s.lines(100)).includes("    dri-devel  (7)"), s.text(100));
	s.press("j");
	await s.tick();
	check("U22 j highlights the subfolder", hiText(s.lines(100)).includes("dri-devel"), hiText(s.lines(100)));
	s.press("\x1b[B", "\x1b[B");
	await s.tick();
	check("U22 ↓, ↓ highlights Sent Items", hiText(s.lines(100)).includes("Sent Items"), hiText(s.lines(100)));
	s.press("\r");
	await s.tick();
	eq("U22 Enter in the picker lists sentitems", s.calls("list").at(-1)[1], "sentitems");
	check("U22 the title names the folder", titleOf(s.lines(100)).includes("Sent Items"), titleOf(s.lines(100)));
	s.press("c");
	await s.tick();
	check("U22 the picker opens on the folder listed now", hiText(s.lines(100)).includes("Sent Items"), hiText(s.lines(100)));
	s.press("k");
	await s.tick();
	check("U22 k moves up", hiText(s.lines(100)).includes("Archive"), hiText(s.lines(100)));
	s.press("\x1b[A");
	await s.tick();
	check("U22 ↑ moves up", hiText(s.lines(100)).includes("dri-devel"), hiText(s.lines(100)));
	s.press("\x1b");
	await s.tick();
	eq("U22 Esc in the picker keeps the folder", s.calls("list").length, 2);
	check("U22 Esc returns to the index on Sent Items", titleOf(s.lines(100)).includes("Sent Items"), titleOf(s.lines(100)));
	s.press("c");
	await s.tick();
	s.press("k", "k", "\r");
	await s.tick();
	eq("U22 a subfolder lists by its id", s.calls("list").at(-1)[1], "f-dri");
	check("U22 its title is its path", titleOf(s.lines(100)).includes("Inbox/dri-devel"), titleOf(s.lines(100)));
	check("U22 its messages are listed", s.text(100).includes("[PATCH] drm: fix"));
});

await scenario("U22 a archives and d deletes the highlighted row; each refreshes unread", async () => {
	const s = session();
	await s.tick();
	check("U22 the highlighted row is listed before a", s.text(100).includes("Quarterly status"));
	s.press("a");
	await s.tick();
	eq("U22 a moves the highlighted message to archive", s.calls("move").map((c) => c.slice(1)), [["m1", "archive"]]);
	check("U22 a removes the row", !s.text(100).includes("Quarterly status"));
	check("U22 a reports archived", statusOf(s.lines(100)) === "archived", statusOf(s.lines(100)));
	check("U22 the next row is listed before d", s.text(100).includes("Lunch?"));
	s.press("d");
	await s.tick();
	eq("U22 d moves the next message to deleteditems", s.calls("move").at(-1).slice(1), ["m2", "deleteditems"]);
	check("U22 d removes that row too", !s.text(100).includes("Lunch?"));
	check("U22 d reports deleted", statusOf(s.lines(100)) === "deleted", statusOf(s.lines(100)));
	eq("U22 a and d each refresh unread", s.calls("refreshUnread").length, 2);
});

await scenario("U22 N toggles read on the highlighted message", async () => {
	const s = session();
	await s.tick();
	s.press("N");
	await s.tick();
	eq("U22 N marks an unread message read", s.calls("setRead").map((c) => c.slice(1)), [["m1", true]]);
	s.press("N");
	await s.tick();
	eq("U22 N again marks it unread", s.calls("setRead").at(-1).slice(1), ["m1", false]);
	eq("U22 N refreshes unread each time", s.calls("refreshUnread").length, 2);
});

await scenario("U22 q resolves the overlay promise", async () => {
	const s = session();
	await s.tick();
	s.press("q");
	const outcome = await Promise.race([s.opened.then(() => "closed"), new Promise((r) => setTimeout(() => r("open"), 100))]);
	eq("U22 q closes the overlay", outcome, "closed");
});

await scenario("U22 arrow keys move like j/k, → opens like Enter, Esc closes like q", async () => {
	const s = session();
	await s.tick();
	s.press("\x1b[B");
	await s.tick();
	check("U22 ↓ moves the highlight down", hiText(s.lines(100)).includes("Lunch?"), hiText(s.lines(100)));
	s.press("\x1b[A");
	await s.tick();
	check("U22 ↑ moves it back up", hiText(s.lines(100)).includes("Quarterly status"), hiText(s.lines(100)));
	s.press("\x1b[C");
	await s.tick();
	check("U22 → opens the pager", s.text(100).includes("Status is green."));
	s.press("\x1b[D");
	await s.tick();
	check("U22 ← in the pager returns to the index", titleOf(s.lines(100)).includes("Inbox"), titleOf(s.lines(100)));
	s.press("\r");
	await s.tick();
	s.press("\x1b");
	await s.tick();
	check("U22 Esc in the pager returns to the index", titleOf(s.lines(100)).includes("Inbox"), titleOf(s.lines(100)));
	const before = s.text(100);
	const n = s.log.length;
	s.press("\t", " ", "\x7f", "x", "y");
	await s.tick();
	check("U22 keys with no binding leave the screen unchanged", s.text(100) === before);
	eq("U22 keys with no binding make no deps calls", s.log.length, n);
	s.press("\x1b");
	const outcome = await Promise.race([s.opened.then(() => "closed"), new Promise((r) => setTimeout(() => r("open"), 50))]);
	eq("U22 Esc on the index closes the overlay", outcome, "closed");
});

await scenario("U22 reaching the last row of a full page fetches the next page below it", async () => {
	const many = Array.from({ length: 50 }, (_, i) => row(`p${i}`, `Message ${i}`, "Zed", "zed@example.com", "2026-10-01T10:00:00Z", true, false));
	const next = [row("p50", "Message 50", "Zed", "zed@example.com", "2026-09-01T10:00:00Z", true, false)];
	const s = session({ list: async (_folder, opts) => (opts.skip ? next : many).map((r) => ({ ...r })) });
	await s.tick();
	for (let i = 0; i < 48; i++) s.press("j");
	await s.tick();
	eq("U22 short of the last row, nothing more is fetched", s.calls("list").length, 1);
	s.press("j");
	await s.tick();
	eq("U22 the last row fetches the page after it", s.calls("list").at(-1)[2], { top: 50, skip: 50 });
	s.press("j");
	await s.tick();
	check("U22 the next page's row is reachable", hiText(s.lines(100)).includes("Message 50"), hiText(s.lines(100)));
	s.press("j");
	await s.tick();
	eq("U22 a short page means no further fetch", s.calls("list").length, 2);
});

await scenario("U22 the pager replaces a picture's label with its description once it lands", async () => {
	const png = { filename: "chart.png", mimeType: "image/png", disposition: "inline", contentId: "c1", size: 3, content: Buffer.from("abc") };
	const log = { file: { filename: "log.png", mimeType: "image/png", disposition: "attachment", size: 3, content: Buffer.from("def") } };
	let release;
	const gate = new Promise((r) => (release = r));
	const s = session({
		read: async (id) => ({
			summary: rowOf(id),
			mail: { ...MAIL, attachments: [png, log.file] },
			markdown: "Chart: [image 1: chart.png]",
			images: [
				{ label: "image 1: chart.png", image: png },
				{ label: "image 2: log.png", image: log.file },
			],
		}),
		describe: async (image) => {
			await gate;
			if (image.filename === "log.png") throw new Error("model said no");
			return "a rising line";
		},
	});
	await s.tick();
	s.press("\r");
	await s.tick();
	check("U22 while describing, the label says so", s.text(120).includes("[image 1: chart.png — describing…]"), s.text(120));
	check("U22 an attached picture the body does not show is listed under Attachments", s.text(120).includes("📎 log.png · image/png · image 2: log.png — describing…"), s.text(120));
	release();
	await s.tick();
	check("U22 the description replaces describing…", s.text(120).includes("[image 1: chart.png — a rising line]"), s.text(120));
	check("U22 a failure says why, not nothing", s.text(120).includes("image 2: log.png — (could not be described: model said no)"), s.text(120));
});

// ---------- U34: three panes when the frame is wide ----------
const WIDE = 160;
// Each body row of a wide frame, cut into its folders | messages | reading columns.
const panesOf = (L) => {
	const cols = contentRaw(L).map((r) => r.split(" │ "));
	return { folders: cols.map((c) => (c[0] ?? "").trimEnd()), list: cols.map((c) => (c[1] ?? "").trimEnd()), read: cols.map((c) => (c[2] ?? "").trimEnd()) };
};
const settle = () => new Promise((r) => setTimeout(r, 300));

await scenario("U34 a wide frame is folders | messages | reading pane; the pane follows the highlight without marking read", async () => {
	const s = session();
	await s.tick();
	s.lines(WIDE);
	await settle();
	let P = panesOf(s.lines(WIDE));
	eq("U34 the three pane headers", [P.folders[0], P.list[0]], ["Folders", "Messages"]);
	check("U34 a rule's folder is listed indented, its unread count at the right edge", P.folders.some((r) => /^ {2}dri-devel +7$/.test(r)), P.folders.join("|"));
	check("U34 a message is three lines: sender and time, subject, preview", P.list[2].startsWith("● Alice") && P.list[3].includes("Quarterly status"), P.list.slice(2, 5).join("|"));
	check("U34 the reading pane shows the highlighted message", P.read.includes("From: Alice <alice@example.com>") && P.read.some((r) => r.includes("Status is green.")), P.read.join("|"));
	eq("U34 the preview read it once and did not mark it read", [s.calls("read").map((c) => c[1]), s.calls("setRead").length], [["m1"], 0]);
	s.press("j");
	s.lines(WIDE);
	await settle();
	P = panesOf(s.lines(WIDE));
	eq("U34 j moves the reading pane to the next message", P.read[0], "Lunch?");
	s.press("\r");
	await s.tick();
	eq("U34 Enter marks it read without reading it again", [s.calls("read").map((c) => c[1]), s.calls("setRead").map((c) => c.slice(1))], [["m1", "m2"], [["m2", true]]]);
	check("U34 the reading pane has the keys", inside(s.lines(WIDE)).at(-2).includes("tab folders"), inside(s.lines(WIDE)).at(-2));
	s.press("\x1b[D", "\x1b[D");
	await s.tick();
	check("U34 ← twice reaches the folders pane", inside(s.lines(WIDE)).at(-2).includes("enter open folder"), inside(s.lines(WIDE)).at(-2));
	s.press("j", "\r");
	await s.tick();
	eq("U34 Enter on a folder lists it", s.calls("list").at(-1)[1], "f-dri");
	P = panesOf(s.lines(WIDE));
	check("U34 its messages fill the messages pane", P.list.some((r) => r.includes("[PATCH] drm: fix")), P.list.join("|"));
	check("U34 the title is its path", titleOf(s.lines(WIDE)).includes("Inbox/dri-devel"), titleOf(s.lines(WIDE)));
	check("U34 a narrow frame is one pane again", !contentRows(s.lines(100))[0].includes("Folders"), contentRows(s.lines(100))[0]);
});

await scenario("U34 PgDn and PgUp in the messages pane page by what it shows: no message is skipped", async () => {
	const many = Array.from({ length: 50 }, (_, i) => row(`p${i}`, `Message ${String(i).padStart(2, "0")}`, "Zed", "zed@example.com", "2026-10-01T10:00:00Z", true, false));
	const s = session({ list: async (_folder, opts) => (opts.skip ? [] : many.map((r) => ({ ...r }))) });
	await s.tick();
	const shown = () => panesOf(s.lines(WIDE)).list.map((r) => /Message (\d\d)/.exec(r)?.[1]).filter(Boolean).map(Number);
	const seen = new Set(shown());
	let previous = shown();
	check("U34 the first screen starts at the newest", previous[0] === 0 && previous.length > 1, String(previous));
	for (let page = 0; page < 10 && !seen.has(49); page++) {
		s.press("\x1b[6~");
		await s.tick();
		const now = shown();
		check(`U34 PgDn ${page + 1} continues right after the last screen`, now[0] <= previous.at(-1) + 1, `${previous} -> ${now}`);
		for (const n of now) seen.add(n);
		previous = now;
	}
	eq("U34 paging down shows every message", seen.size, 50);
	s.press("\x1b[5~");
	await s.tick();
	const up = shown();
	check("U34 PgUp goes back one screen", up.at(-1) >= previous[0] - 1 && up[0] < previous[0], `${previous} -> ${up}`);
});

// ---------- U35: saving files, only when asked ----------
await scenario("U35 s lists the attachments and linked files; Enter saves only the highlighted one", async () => {
	const pdf = { filename: "report.pdf", mimeType: "application/pdf", disposition: "attachment", size: 2048, content: Buffer.from("x") };
	const png = { filename: "chart.png", mimeType: "image/png", disposition: "inline", contentId: "c1", size: 3, content: Buffer.from("abc") };
	const s = session({
		read: async (id) => ({
			summary: rowOf(id),
			mail: { ...MAIL, attachments: [pdf, png] },
			markdown: "Plan: [the plan](https://contoso.sharepoint.com/:x:/s/t/plan.xlsx) and [docs](https://example.com/d). [image 1: chart.png]",
			images: [{ label: "image 1: chart.png", image: png }],
		}),
	});
	await s.tick();
	s.press("\r");
	await s.tick();
	eq("U35 reading a mail saves nothing", [s.calls("saveAttachment").length, s.calls("saveLink").length], [0, 0]);
	s.press("s");
	await s.tick();
	const rows = contentRows(s.lines(100));
	check("U35 s lists both attachments and the SharePoint file, not the ordinary link", rows.some((r) => r.includes("📎 report.pdf")) && rows.some((r) => r.includes("📎 chart.png")) && rows.some((r) => r.includes("🔗 the plan")) && !rows.some((r) => r.includes("docs")), rows.join("|"));
	s.press("j", "j", "\r");
	await s.tick();
	eq("U35 Enter downloads the highlighted linked file, nothing else", [s.calls("saveLink").map((c) => c[1]), s.calls("saveAttachment").length], [["https://contoso.sharepoint.com/:x:/s/t/plan.xlsx"], 0]);
	check("U35 the status says where it went", statusOf(s.lines(100)) === "saved to /home/me/Downloads/plan.xlsx", statusOf(s.lines(100)));
});

// ---------- U23: compose and prompts ----------
await scenario("U23 m opens an empty compose with the caret in To", async () => {
	const s = session();
	await s.tick();
	s.press("m");
	await s.tick();
	const L = s.lines(100);
	eq("U23 m asks for a new draft", s.calls("draftFor").map((c) => c[1]), ["new"]);
	check("U23 the compose title is New message", titleOf(L).startsWith("╭─ New message ─"), titleOf(L));
	eq("U23 every field starts empty", [fieldText(L, "To:"), fieldText(L, "Cc:"), fieldText(L, "Subject:"), fieldText(L, "Body:")], ["", "", "", ""]);
	eq("U23 the caret starts in To", caretField(L), "to");
	for (const w of WIDTHS) s.lines(w);
});

await scenario("U23 Tab cycles To, Cc, Subject, Body, To", async () => {
	const s = session();
	await s.tick();
	s.press("m");
	await s.tick();
	const seen = [];
	for (let i = 0; i < 5; i++) {
		seen.push(caretField(s.lines(100)));
		s.press("\t");
	}
	eq("U23 Tab cycles the focus", seen, ["to", "cc", "subject", "body", "to"]);
});

await scenario("U23 Enter in To, Cc and Subject changes neither text nor focus", async () => {
	const s = session();
	await s.tick();
	s.press("m");
	await s.tick();
	s.type("a@x");
	s.press("\r");
	await s.tick();
	let L = s.lines(100);
	eq("U23 Enter in To keeps its text", fieldText(L, "To:"), "a@x");
	eq("U23 Enter in To keeps the focus", caretField(L), "to");
	s.press("\t", "\r");
	L = s.lines(100);
	eq("U23 Enter in Cc adds no text", fieldText(L, "Cc:"), "");
	eq("U23 Enter in Cc keeps the focus", caretField(L), "cc");
	s.press("\t", "\r");
	L = s.lines(100);
	eq("U23 Enter in Subject adds no text", fieldText(L, "Subject:"), "");
	eq("U23 Enter in Subject keeps the focus", caretField(L), "subject");
	eq("U23 the To text survives the Tabs", fieldText(L, "To:"), "a@x");
});

await scenario("U23 typing in Body inserts the letters, calls no deps; Enter in Body adds a line", async () => {
	const s = session();
	await s.tick();
	s.press("m");
	await s.tick();
	s.press("\t", "\t", "\t");
	const before = s.log.length;
	s.type("qrgfad");
	await s.tick();
	eq("U23 typing qrgfad in Body inserts those letters", fieldText(s.lines(100), "Body:"), "qrgfad");
	eq("U23 typing in Body calls no deps", s.log.length, before);
	s.press("\r");
	s.type("c");
	const L = s.lines(100);
	eq("U23 Enter in Body starts a new line", fieldText(L, "Body:"), "qrgfad\nc");
	eq("U23 the caret stays in Body", caretField(L), "body");
});

await scenario("U23 Ctrl+S asks; n returns to compose with the fields intact", async () => {
	const s = session();
	await s.tick();
	await fillNew(s);
	await s.tick();
	s.press("\x13");
	await s.tick();
	check("U23 Ctrl+S shows Send? (y/n)", s.text(100).includes("Send? (y/n)"));
	s.press("n");
	await s.tick();
	const L = s.lines(100);
	check("U23 n hides the prompt", !s.text(100).includes("Send? (y/n)"));
	eq("U23 n keeps To", fieldText(L, "To:"), "x@y");
	eq("U23 n keeps Subject", fieldText(L, "Subject:"), "Hi");
	eq("U23 n keeps Body", fieldText(L, "Body:"), "Body text");
	eq("U23 n submits nothing", s.calls("submit").length, 0);
});

await scenario("U23 y submits an EML without the agent footer; sent shows only after submit resolves", async () => {
	let release;
	const s = session({ submit: () => new Promise((r) => (release = r)) });
	await s.tick();
	await fillNew(s);
	await s.tick();
	s.press("\x13");
	s.press("y");
	await s.tick();
	eq("U23 y calls submit once", s.calls("submit").length, 1);
	check("U23 sent is not shown while submit is pending", !/\bsent\b/.test(s.text(100)), statusOf(s.lines(100)));
	const [, draft, eml] = s.calls("submit")[0];
	eq("U23 the submitted draft carries the edited To", draft.to.map((a) => a.address), ["x@y"]);
	check("U23 the build call has no footer", s.calls("build")[0][1].footer === undefined);
	check("U23 the EML has no agent footer", !eml.toString("utf8").includes("sent by omp agent"));
	release();
	await s.tick();
	check("U23 sent is shown after submit resolves", statusOf(s.lines(100)) === "sent", statusOf(s.lines(100)));
	check("U23 a successful send returns to the index", titleOf(s.lines(100)).includes("Inbox"), titleOf(s.lines(100)));
});

await scenario("U23 a set signature shows under the body in compose and goes out with the mail", async () => {
	const s = session({ signature: () => "Best,\n**Alex**" });
	await s.tick();
	await fillNew(s);
	await s.tick();
	const rows = contentRows(s.lines(100));
	const body = rows.findIndex((r) => r.startsWith("Body:"));
	eq("U23 the signature lines follow the body, after a blank", rows.slice(body + 1, body + 4), ["", "Best,", "**Alex**"]);
	s.press("\x13", "y");
	await s.tick();
	eq("U23 the build call carries the signature", s.calls("build")[0][1].signature, "Best,\n**Alex**");
});

await scenario("U23 a rejected submit keeps compose with the text and never says sent", async () => {
	const s = session({
		submit: async () => {
			throw new Error("graph 503");
		},
	});
	await s.tick();
	await fillNew(s);
	await s.tick();
	s.press("\x13");
	s.press("y");
	await s.tick();
	const L = s.lines(100);
	check("U23 a failed send keeps compose open", titleOf(L).startsWith("╭─ New message ─"), titleOf(L));
	eq("U23 a failed send keeps the body", fieldText(L, "Body:"), "Body text");
	check("U23 a failed send shows the error in the status line", statusOf(L).includes("graph 503"), statusOf(L));
	check("U23 a failed send never shows sent", !/\bsent\b/.test(s.text(100)));
	for (const w of WIDTHS) s.lines(w);
});

await scenario("U23 Ctrl+P saves the draft and returns to the index with draft saved", async () => {
	const s = session();
	await s.tick();
	await fillNew(s);
	await s.tick();
	s.press("\x10");
	await s.tick();
	eq("U23 Ctrl+P calls saveDraft once", s.calls("saveDraft").length, 1);
	const L = s.lines(100);
	check("U23 Ctrl+P returns to the index with draft saved", statusOf(L) === "draft saved" && titleOf(L).includes("Inbox"), `${statusOf(L)} | ${titleOf(L)}`);
});

await scenario("U23 Esc on empty fields returns to the index with no prompt", async () => {
	const s = session();
	await s.tick();
	s.press("m");
	await s.tick();
	s.press("\x1b");
	await s.tick();
	const L = s.lines(100);
	check("U23 Esc on an empty draft returns to the index", titleOf(L).includes("Inbox (2 unread)"), titleOf(L));
	check("U23 Esc on an empty draft shows no prompt", !s.text(100).includes("Discard draft?"));
});

await scenario("U23 Esc on a filled draft asks; n keeps it; y discards with no save and no send", async () => {
	const s = session();
	await s.tick();
	s.press("m");
	await s.tick();
	s.type("x");
	await s.tick();
	s.press("\x1b");
	await s.tick();
	check("U23 Esc on a filled draft shows Discard draft? (y/n)", s.text(100).includes("Discard draft? (y/n)"));
	s.press("n");
	await s.tick();
	check("U23 n keeps the filled draft in compose", !s.text(100).includes("Discard draft?") && fieldText(s.lines(100), "To:") === "x");
	s.press("\x1b");
	await s.tick();
	s.press("y");
	await s.tick();
	const L = s.lines(100);
	check("U23 y returns to the index", titleOf(L).includes("Inbox"), titleOf(L));
	eq("U23 y saves nothing and sends nothing", s.calls("saveDraft").length + s.calls("submit").length, 0);
});

// ---------- U24: reply and forward pre-fill ----------
await scenario("U24 r from the index pre-fills a reply to the sender", async () => {
	const s = session();
	await s.tick();
	s.press("r");
	await s.tick();
	const L = s.lines(100);
	eq("U24 r asks for a reply to the highlighted message", s.calls("draftFor").at(-1).slice(1, 3), ["reply", "m1"]);
	check("U24 r titles the compose Reply", titleOf(L).startsWith("╭─ Reply ─"), titleOf(L));
	eq("U24 r pre-fills To with the sender", fieldText(L, "To:"), "alice@example.com");
	eq("U24 r pre-fills the RE: subject", fieldText(L, "Subject:"), "RE: Quarterly status");
	for (const w of WIDTHS) s.lines(w);
});

await scenario("U24 g titles Reply all with the reply-all recipients", async () => {
	const s = session();
	await s.tick();
	s.press("g");
	await s.tick();
	const L = s.lines(100);
	check("U24 g titles the compose Reply all", titleOf(L).startsWith("╭─ Reply all ─"), titleOf(L));
	eq("U24 g To holds the sender and the other To recipient", fieldText(L, "To:"), "alice@example.com, bob@example.com");
	eq("U24 g Cc holds the other Cc recipient", fieldText(L, "Cc:"), "carol@example.com");
});

await scenario("U24 f titles Forward, leaves To empty and pre-fills FW:", async () => {
	const s = session();
	await s.tick();
	s.press("f");
	await s.tick();
	const L = s.lines(100);
	check("U24 f titles the compose Forward", titleOf(L).startsWith("╭─ Forward ─"), titleOf(L));
	eq("U24 f leaves To empty", fieldText(L, "To:"), "");
	eq("U24 f pre-fills the FW: subject", fieldText(L, "Subject:"), "FW: Quarterly status");
});

await scenario("U24 r from the pager pre-fills the same reply", async () => {
	const s = session();
	await s.tick();
	s.press("\r");
	await s.tick();
	s.press("r");
	await s.tick();
	const L = s.lines(100);
	eq("U24 pager r asks for a reply to the same message", s.calls("draftFor").at(-1).slice(1, 3), ["reply", "m1"]);
	eq("U24 pager r pre-fills To with the sender", fieldText(L, "To:"), "alice@example.com");
});

await scenario("U24 g from the pager titles Reply all, fills its recipients, and y submits a replyAll", async () => {
	const s = session();
	await s.tick();
	s.press("\r");
	await s.tick();
	s.press("g");
	await s.tick();
	const L = s.lines(100);
	check("U24 pager g titles the compose Reply all", titleOf(L).startsWith("╭─ Reply all ─"), titleOf(L));
	eq("U24 pager g To holds the sender and the other To recipient", fieldText(L, "To:"), "alice@example.com, bob@example.com");
	eq("U24 pager g Cc holds the other Cc recipient", fieldText(L, "Cc:"), "carol@example.com");
	eq("U24 pager g pre-fills the RE: subject", fieldText(L, "Subject:"), "RE: Quarterly status");
	s.press("\x13", "y");
	await s.tick();
	eq("U24 pager g, Ctrl+S, y submits a replyAll", s.calls("submit").map((c) => c[1].kind), ["replyAll"]);
});

await scenario("U24 f from the pager titles Forward, leaves To empty, and y submits a forward", async () => {
	const s = session();
	await s.tick();
	s.press("\r");
	await s.tick();
	s.press("f");
	await s.tick();
	const L = s.lines(100);
	check("U24 pager f titles the compose Forward", titleOf(L).startsWith("╭─ Forward ─"), titleOf(L));
	eq("U24 pager f leaves To empty", fieldText(L, "To:"), "");
	eq("U24 pager f pre-fills the FW: subject", fieldText(L, "Subject:"), "FW: Quarterly status");
	s.press("\x13", "y");
	await s.tick();
	eq("U24 pager f, Ctrl+S, y submits a forward", s.calls("submit").map((c) => c[1].kind), ["forward"]);
});

await scenario("U24 the reply shows the original's From, Sent, To, Cc, Subject, then its body", async () => {
	const s = session();
	await s.tick();
	s.press("r");
	await s.tick();
	const rows = contentRows(s.lines(100));
	const at = rows.findIndex((r) => r.startsWith("From: "));
	check("U24 the quoted block begins with From", at > 0, JSON.stringify(rows));
	eq("U24 quoted From line", rows[at], "From: Alice <alice@example.com>");
	eq("U24 quoted Sent line", rows[at + 1], "Sent: 2026-10-14T01:30:00.000Z");
	eq("U24 quoted To line", rows[at + 2], "To: me@example.com; bob@example.com");
	eq("U24 quoted Cc line", rows[at + 3], "Cc: carol@example.com; me@example.com");
	eq("U24 quoted Subject line", rows[at + 4], "Subject: Quarterly status");
	check("U24 the quoted body follows the header lines", rows.slice(at + 5).some((r) => r.includes("Status is [green]{.ok}.")));
});

await scenario("U24 the compose quote is the original's Markdown table and tone, not its plain-text part", async () => {
	const both = { ...MAIL, text: "Plain text part only.", html: renderMarkdown("| Item | Status |\n|---|---|\n| Build | [Done]{.ok} |") };
	const s = session({ draftFor: async (kind, id) => ({ ...respondDefaults(kind, both, [SELF]), id }) });
	await s.tick();
	s.press("r");
	await s.tick();
	const rows = contentRows(s.lines(100));
	const at = rows.indexOf("> | Item | Status |");
	eq("U24 the quote shows the table as Markdown rows", rows.slice(at, at + 3), ["> | Item | Status |", "> |---|---|", "> | Build | [Done]{.ok} |"]);
	check("U24 the quote does not show the plain-text part", !rows.some((r) => r.includes("Plain text part")), JSON.stringify(rows));
});

await scenario("U24 editing To, then Ctrl+S, y submits reply, replyAll and forward with the edited To", async () => {
	for (const [key, kind] of [
		["r", "reply"],
		["g", "replyAll"],
		["f", "forward"],
	]) {
		const s = session();
		await s.tick();
		s.press(key);
		await s.tick();
		const current = fieldText(s.lines(100), "To:") ?? "";
		s.press(...Array(current.length).fill("\x7f"));
		s.type("x@y");
		s.press("\x13");
		s.press("y");
		await s.tick();
		const sent = s.calls("submit");
		eq(`U24 ${key} submits once`, sent.length, 1);
		eq(`U24 ${key} submits a ${kind} draft`, sent[0]?.[1].kind, kind);
		eq(`U24 ${key} submits To as [x@y]`, sent[0]?.[1].to.map((a) => a.address), ["x@y"]);
	}
});

// ---------- U25: pager rendering and a failed move ----------
await scenario("U25 pager renders the seed: aligned tables, colours, wrapped paragraph at every width", async () => {
	const s = session({ read: async (id) => ({ summary: rowOf(id), mail: MAIL, markdown: SEED_MD, images: [] }) });
	s.tui.terminal.rows = 120;
	await s.tick();
	s.press("\r");
	await s.tick();
	for (const w of WIDTHS) {
		const L = s.lines(w);
		const tables = tablesOf(L);
		check(`U25 @${w} the status tables have aligned borders`, tables.length === 2 && tables.every(alignedBlock), `${tables.length} tables`);
		check(`U25 @${w} Done is wrapped in the success colour`, L.some((l) => l.includes("\x1b[32mDone\x1b[39m")));
		check(`U25 @${w} Blocked is wrapped in the error colour`, L.some((l) => l.includes("\x1b[31mBlocked\x1b[39m")));
		const rows = contentRows(L);
		const start = rows.findIndex((r) => r.includes("This paragraph"));
		const end = rows.findIndex((r) => r.includes("first."));
		check(`U25 @${w} the paragraph's last word is present`, end >= 0, `first. not found`);
		if (w === 60) check("U25 @60 the paragraph wraps onto a continuation line", start >= 0 && end > start, `${start} ${end}`);
	}
	s.press("q");
});

await scenario("U25 a failed move shows its error in the status line and keeps the row", async () => {
	const s = session({
		move: async () => {
			throw new Error("archive refused");
		},
	});
	await s.tick();
	s.press("\r");
	await s.tick();
	s.press("q");
	await s.tick();
	s.press("a");
	await s.tick();
	const L = s.lines(100);
	check("U25 a failed move shows the error in the status line", statusOf(L).includes("archive refused"), statusOf(L));
	check("U25 the error is in the error colour", L[L.length - 3].includes("\x1b[31m"));
	check("U25 a failed move leaves the row in place", s.text(100).includes("Quarterly status"));
});

// ---------- U32: pager scrolling ----------
await scenario("U32 pager: j and k move one line, k at the top does nothing, Space moves one screen and stops at the end", async () => {
	const body = Array.from({ length: 40 }, (_, i) => `Line ${String(i + 1).padStart(2, "0")} is a short line.`).join("\n\n");
	for (const w of WIDTHS) {
		const s = session({ read: async (id) => ({ summary: rowOf(id), mail: MAIL, markdown: body, images: [] }) });
		s.tui.terminal.rows = 30;
		await s.tick();
		s.press("\r");
		await s.tick();
		const view = () => {
			const L = s.lines(w);
			return L.slice(1, L.length - 3);
		};
		const top = view();
		const B = top.length;
		check(`U32 @${w} the pager shows a screen of body lines`, B > 5 && B < 40, `B=${B}`);
		s.press("j");
		await s.tick();
		check(`U32 @${w} j moves the first visible line down by one`, same(view().slice(0, B - 1), top.slice(1)));
		s.press("k");
		await s.tick();
		check(`U32 @${w} k moves it back up by one`, same(view(), top));
		s.press("k");
		await s.tick();
		check(`U32 @${w} k at the top does nothing`, same(view(), top));
		for (let i = 0; i < B; i++) s.press("j");
		await s.tick();
		const byLines = view();
		for (let i = 0; i < 80; i++) s.press("k");
		await s.tick();
		s.press(" ");
		await s.tick();
		check(`U32 @${w} Space moves down one screen`, same(view(), byLines));
		for (let i = 0; i < 40; i++) s.press(" ");
		await s.tick();
		const end = view();
		s.press(" ");
		await s.tick();
		check(`U32 @${w} Space stops at the last screen`, same(view(), end));
		check(`U32 @${w} the last screen reaches the last paragraph`, end.some((r) => r.includes("Line 40")));
	}
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
