/**
 * Renderer suite for render.ts: Markdown -> Outlook-styled HTML.
 *
 *   node tests/render.test.mjs      # run.mjs runs it with the rest of the suite
 *
 * U1  inline styles only: every element inside <body> carries a style attribute,
 *     there is no <style> element and no class attribute, and raw HTML in the
 *     Markdown shows as text instead of becoming elements.
 * U2  style values never contain a double quote, so the attribute cannot break;
 *     the font family is the report's, unbroken.
 * U3  [text]{.tone} spans carry exactly the TONES entry; any other tone stays
 *     literal text.
 * U4  callouts become a one-cell table in the entry's edge and background; any
 *     other quote keeps the plain grey rule.
 * U5  table shapes: a headerless key/value sheet, a headed table, and a
 *     three-column table with blank headers.
 *
 * The HTML is parsed as a DOM by @mixmark-io/domino, the parser turndown uses.
 * This package does not declare it: turndown brings it in, and the test loads it
 * from this package's node_modules. A double quote inside a style attribute (the
 * first probe mail's failure) cuts the value short and leaves junk attribute
 * names; the DOM checks see the junk, and the source check counts the attributes.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "/root/.nvm/versions/node/v22.22.1/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
// Resolved paths: importing through the symlink would give a SECOND copy of
// every module, and `instanceof` across the two silently fails. See ext-path.mjs.
import { ext } from "./ext-path.mjs";

const { createDocument } = createRequire(ext("package.json"))("@mixmark-io/domino");

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
const { renderMarkdown, THEME, TONES, CALLOUTS } = await jiti.import(ext("render.ts"));

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "seed-report.md"), "utf8");
const FONT = "'Segoe UI',Calibri,Arial,sans-serif";

// --- Reading the HTML the renderer emits -------------------------------------

/** The rendered page as a DOM. The renderer writes its own <body>; a page without one fails. */
function parse(html) {
	if (!/<body[\s>]/.test(html) || !html.includes("</body>")) throw new Error("output has no <body>...</body>");
	return createDocument(html);
}

/** Every element under `root`, in document order. */
const elementsOf = (root) => Array.from(root.getElementsByTagName("*"));

/** A style attribute as a property map. */
const styleOf = (el) => {
	const map = {};
	for (const decl of (el.getAttribute("style") ?? "").split(";")) {
		const i = decl.indexOf(":");
		if (i > 0) map[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
	}
	return map;
};

/** Rows of the tables under `root`, each the list of its cell elements. */
const rowsOf = (root) =>
	Array.from(root.getElementsByTagName("tr")).map((tr) => Array.from(tr.children).filter((c) => c.localName === "td" || c.localName === "th"));

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

/** An exception inside a section fails that section; the other sections still run. */
function section(title, run) {
	console.log(`\n== ${title} ==`);
	try {
		run();
	} catch (e) {
		check(`${title}: ran to the end`, false, e instanceof Error ? e.message : String(e));
	}
}

section("U1 inline styles only; raw HTML is text", () => {
	const html = renderMarkdown(fixture);
	const doc = parse(html);
	const elements = elementsOf(doc.body);
	check("U1 fixture: <body> has elements", elements.length > 0);
	const unstyled = elements.filter((el) => !el.hasAttribute("style")).map((el) => el.localName);
	check("U1 fixture: every element inside <body> carries a style attribute", unstyled.length === 0, `unstyled: ${unstyled.join(", ")}`);
	for (const [what, name] of [["heading", "b"], ["list", "ul"], ["list item", "li"], ["codespan", "code"], ["fenced code", "pre"], ["link", "a"], ["table", "table"]]) {
		check(`U1 fixture covers a ${what} (<${name}>)`, doc.body.getElementsByTagName(name).length > 0);
	}
	check("U1 fixture: no <style> element", !html.includes("<style") && doc.getElementsByTagName("style").length === 0);
	check("U1 fixture: no class= in the output", !html.includes("class="));
	check("U1 fixture: no element has a class attribute", elementsOf(doc).every((el) => !el.hasAttribute("class")));

	const raw = renderMarkdown('Inline <span style="color:#f00">x</span> here.\n\n<div class="c">y</div>\n');
	const rawDoc = parse(raw);
	const shown = rawDoc.body;
	const all = elementsOf(rawDoc);
	check("U1 raw <span> does not become an element", shown.getElementsByTagName("span").length === 0);
	check("U1 raw <div> does not become an element", shown.getElementsByTagName("div").length === 0);
	check("U1 raw HTML adds no class attribute", all.every((el) => !el.hasAttribute("class")));
	check("U1 raw HTML adds no <style> element", rawDoc.getElementsByTagName("style").length === 0);
	check("U1 raw HTML adds no style attribute containing #f00", all.every((el) => !(el.getAttribute("style") ?? "").includes("#f00")));
	check("U1 raw HTML shows as visible text", shown.textContent.includes('<span style="color:#f00">x</span>') && shown.textContent.includes('<div class="c">y</div>'), shown.textContent);
	check("U1 the source escapes it (&lt;span, &lt;div)", raw.includes("&lt;span") && raw.includes("&lt;div"));
});

section("U2 style values never break the attribute", () => {
	const html = renderMarkdown(fixture);
	const doc = parse(html);
	const styled = elementsOf(doc).filter((el) => el.hasAttribute("style"));
	const styles = styled.map((el) => el.getAttribute("style"));
	check("U2 styled elements are present", styles.length > 0);
	check('U2 no style value contains a double quote', styles.length > 0 && styles.every((s) => !s.includes('"')));
	// A quote inside a value cuts the value short and turns the rest into attribute names.
	const junk = elementsOf(doc).flatMap((el) => Array.from(el.attributes, (a) => a.name)).filter((name) => !/^[a-z][a-z-]*$/.test(name));
	check("U2 every attribute name is plain", junk.length === 0, `${junk.length} junk, e.g. ${junk.slice(0, 2).join(" | ")}`);
	// A value cut short has no double quote left, so the source is counted too: each style="…" must close at its own quote, and the DOM must hold one style attribute per occurrence.
	const opened = html.match(/\sstyle="/g)?.length ?? 0;
	const closed = html.match(/\sstyle="[^"]*"(?=[\s/>])/g)?.length ?? 0;
	check('U2 every style="…" closes at its own quote', opened > 0 && closed === opened, `${opened - closed} not closed`);
	check("U2 the DOM and the source agree on the style attributes", styled.length === opened, `DOM ${styled.length}, source ${opened}`);
	const families = new Set(styled.map((el) => styleOf(el)["font-family"]).filter((f) => f !== undefined));
	check(`U2 the report font reads ${FONT}`, families.has(FONT), [...families].join(" | "));
	check("U2 the only font families are the report font and the code font", families.size > 0 && [...families].every((f) => f === FONT || f === "Consolas,monospace"), [...families].join(" | "));
	check("U2 no stray < in the visible text", !doc.body.textContent.includes("<"), doc.body.textContent);
});

section("U3 tones", () => {
	const names = Object.keys(TONES).sort().join(",");
	check("U3 the palette is ok, bad, warn, muted, info", names === "bad,info,muted,ok,warn", names);
	for (const [label, tone] of [["Done", "ok"], ["x", "bad"], ["x", "warn"], ["x", "muted"], ["x", "info"]]) {
		const html = renderMarkdown(`[${label}]{.${tone}}\n`);
		const spans = Array.from(parse(html).body.getElementsByTagName("span"));
		const exact = spans.length === 1 && spans[0].getAttribute("style") === TONES[tone] && spans[0].textContent === label;
		check(`U3 [${label}]{.${tone}} is one span carrying the ${tone} entry`, exact, `spans: ${spans.length}`);
	}
	const pink = parse(renderMarkdown("[x]{.pink}\n")).body;
	check("U3 [x]{.pink} stays the literal text", pink.textContent.includes("[x]{.pink}") && pink.getElementsByTagName("span").length === 0, pink.textContent);
});

section("U4 callouts", () => {
	for (const kind of ["SUMMARY", "NOTE", "TIP", "WARNING", "CAUTION"]) {
		const { edge, bg } = CALLOUTS[kind] ?? {};
		const body = parse(renderMarkdown(`> [!${kind}]\n> Body for ${kind}.\n`)).body;
		const rows = rowsOf(body);
		const cells = rows.flat();
		const tables = body.getElementsByTagName("table").length;
		check(`U4 [!${kind}] renders a one-cell table`, tables === 1 && rows.length === 1 && cells.length === 1 && cells[0].localName === "td", `tables ${tables}, rows ${rows.length}, cells ${cells.length}`);
		const style = cells.length === 1 ? styleOf(cells[0]) : {};
		check(`U4 [!${kind}] carries its edge and background`, style["border-left"] === `4px solid ${edge}` && style["background-color"] === bg, `want ${edge} on ${bg}`);
		check(`U4 [!${kind}] hides the marker and keeps the body`, !body.textContent.includes("[!") && body.textContent.includes(`Body for ${kind}.`), body.textContent);
	}
	for (const [md, shown] of [["> [!note] x\n", "[!note] x"], ["> [!UNKNOWN] x\n", "[!UNKNOWN] x"], ["> plain quote\n", "plain quote"]]) {
		const body = parse(renderMarkdown(md)).body;
		const rule = elementsOf(body).some((el) => styleOf(el)["border-left"] === `3px solid ${THEME.border}`);
		const callout = body.getElementsByTagName("td").length > 0;
		check(`U4 ${JSON.stringify(md.trim())} is a plain quote with the grey rule`, rule && !callout && body.textContent.includes(shown), body.textContent);
	}
	const hard = parse(renderMarkdown("> [!NOTE]  \n> Hard break for NOTE.\n")).body;
	check("U4 [!NOTE] with a hard line break hides the marker and the break", !hard.textContent.includes("[!") && hard.getElementsByTagName("br").length === 0 && hard.textContent.includes("Hard break for NOTE."), hard.textContent);
	check("U4 [!NOTE] with a hard line break renders a callout table", hard.getElementsByTagName("td").length > 0, hard.textContent);
});

section("U5 table shapes", () => {
	const kv = rowsOf(parse(renderMarkdown("|  |  |\n|---|---|\n| JIRA status | Assessed |\n| Owner | Alex Example |\n")).body);
	check("U5 headerless two-column table: two body rows and no <th>", kv.length === 2 && kv.flat().every((c) => c.localName === "td"), `rows ${kv.length}`);
	check("U5 headerless table: first cells shaded, bold and nowrap", kv.length === 2 && kv.every(([key]) => {
		const s = styleOf(key);
		return s["background-color"] !== undefined && s["font-weight"] === "bold" && s["white-space"] === "nowrap";
	}));
	check("U5 headerless table: second cells are not shaded", kv.length === 2 && kv.every(([, value]) => styleOf(value)["background-color"] === undefined));

	const headed = rowsOf(parse(renderMarkdown("| Key | Value |\n|---|---|\n| JIRA status | Assessed |\n")).body);
	check("U5 headed table: a header row of shaded <th> cells", headed.length === 2 && headed[0].length === 2 && headed[0].every((c) => c.localName === "th" && styleOf(c)["background-color"] !== undefined));
	const firstBody = headed[1]?.[0];
	check("U5 headed table: first column is not shaded", !!firstBody && styleOf(firstBody)["background-color"] === undefined);

	const blank = rowsOf(parse(renderMarkdown("|   |   |   |\n|---|---|---|\n| a | b | c |\n")).body);
	check("U5 three columns with empty headers keep a blank header row", blank.length === 2 && blank[0].length === 3 && blank[0].every((c) => c.localName === "th" && c.textContent === ""), `rows ${blank.length}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "all ok" : "FAIL");
process.exit(failed === 0 ? 0 : 1);
