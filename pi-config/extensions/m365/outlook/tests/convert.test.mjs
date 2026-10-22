/**
 * Converter suite for convert.ts: mail HTML -> Markdown.
 *
 *   node tests/convert.test.mjs      # run.mjs runs it with the rest of the suite
 *
 * U6  renderMarkdown(seed-report.md) reads back as Markdown: the status table as
 *     a GFM table with its tone spans, the key/value sheet as |  |  |, the summary
 *     as a > [!SUMMARY] quote, the fenced block, the link href and CJK text; a span
 *     in rgb(255,0,255) is plain text.
 * U7  a synthetic Outlook/OWA thread: the layout-table wrapper is unwrapped, the
 *     sensitivity banner and the Office markup are gone, and #1a7f37 and
 *     rgb(26, 127, 55) both read back as {.ok}.
 * U8  <img>: its alt text, else its file name, else [image]; never base64 or cid:.
 *
 * The rest pins the rules the U rows do not reach: every callout kind, the table
 * shapes, colour spellings, Consolas and pre code with their line breaks, and where the banner is dropped.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti, PI } from "../../tests/host.mjs";
// Resolved paths: importing through the symlink would give a SECOND copy of
// every module, and `instanceof` across the two silently fails. See ext-path.mjs.
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
const { renderMarkdown, CALLOUTS } = await jiti.import(ext("render.ts"));
const { htmlToMarkdown } = await jiti.import(ext("convert.ts"));

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, "fixtures", "seed-report.md"), "utf8");
const owa = readFileSync(join(here, "fixtures", "owa-thread.html"), "utf8");

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

// --- Checks ------------------------------------------------------------------

section("U6 the seed reads back as Markdown", () => {
	const md = htmlToMarkdown(renderMarkdown(seed));
	const status = [
		"| # | Change | Status |",
		"|---|---|---|",
		"| 1 | Close gate needs fix verification | [Merged to main (Oct 15)]{.ok} |",
		"| 2 | Drop `trace-done` on merge | [Done]{.ok} |",
		"| 3 | Extra review policy | [To do]{.muted} |",
		"| 4 | Windows host for the reproducer | [Blocked]{.bad} |",
	].join("\n");
	check("U6 the status table reads back as a GFM table", md.includes(status), JSON.stringify(md));
	check("U6 [Done]{.ok} and [Blocked]{.bad} are tone spans", md.includes("[Done]{.ok}") && md.includes("[Blocked]{.bad}"), JSON.stringify(md));
	const sheet = [
		"|  |  |",
		"|---|---|",
		"| Ticket | EXAMPLE-101, assessed, not closed |",
		"| Owner | Alex Example [(since Oct 9)]{.muted} |",
		"| Reproduces | [Yes]{.bad}, intermittent |",
	].join("\n");
	check("U6 the key/value sheet reads back as a headerless |  |  | table", md.includes(sheet), JSON.stringify(md));
	check("U6 the summary reads back as a > [!SUMMARY] quote", md.includes("> [!SUMMARY]\n> Key points\n"), JSON.stringify(md));
	check(
		"U6 the summary's list items keep their tones",
		/^> -\s+The close gate is \[not fixed\]\{\.bad\}; the open change only raises a log level\.$/m.test(md) &&
			/^> -\s+Local validation: \[340 \/ 400 loops passed\]\{\.warn\}\.$/m.test(md),
		JSON.stringify(md),
	);
	check("U6 the fenced code block survives", md.includes("```\nuv run pytest tests/ -k close_gate\n```"), JSON.stringify(md));
	check("U6 the link keeps its href", md.includes("[example tracker](https://tracker.example.com/browse/EXAMPLE-101)"), JSON.stringify(md));
	check("U6 CJK text survives", md.includes("中文测试"), JSON.stringify(md));
	check("U6 the heading reads back as bold text", md.startsWith("**Trace triage status**"), JSON.stringify(md.slice(0, 40)));
	check("U6 no HTML tags are left in the Markdown", !/<\/?[a-z][^>]*>/i.test(md), JSON.stringify(md));
	const magenta = htmlToMarkdown(
		renderMarkdown(seed).replace("</body>", '<p>Magenta: <span style="color:rgb(255,0,255)">plain</span></p></body>'),
	);
	check("U6 a span in rgb(255,0,255) becomes plain text", magenta.split("\n").includes("Magenta: plain") && !magenta.includes("[plain]"), JSON.stringify(magenta));
});

section("U7 an Outlook/OWA thread", () => {
	const md = htmlToMarkdown(owa);
	const expected = "Hello Example Team,\n\nStatus of EXAMPLE-202: [Done]{.ok}.\n\nRetest: [Passed]{.ok}.\n\nThanks,  \nAlex Example";
	check("U7 reads back to exactly the message text", md === expected, JSON.stringify(md));
	check("U7 the sensitivity banner is gone", !md.includes("AMD General"), JSON.stringify(md));
	check("U7 the layout table leaves no table syntax", !/^\|/m.test(md), JSON.stringify(md));
	check("U7 head, style, MSO comments and o:p leave no trace", !/Synthetic thread|elementToProof|MSO-ONLY|o:p/.test(md), JSON.stringify(md));
	check("U7 #1a7f37 and rgb(26, 127, 55) both read as {.ok}", md.includes("[Done]{.ok}") && md.includes("[Passed]{.ok}"), JSON.stringify(md));
});

section("U8 images", () => {
	const md = htmlToMarkdown('<p>See <img src="cid:abc" alt="chart"> and <img src="data:image/png;base64,iVBORw0KGgo="></p>');
	check("U8 a cid: image with alt reads [image: chart]", md.includes("[image: chart]"), JSON.stringify(md));
	check("U8 a data: image with no alt reads [image]", md === "See [image: chart] and [image]", JSON.stringify(md));
	check("U8 no base64 or cid: text in the output", !/base64|cid:/.test(md), JSON.stringify(md));
	check("U8 with no alt, the file name is the label", htmlToMarkdown('<img src="https://example.com/figs/diagram.png">') === "[image: diagram.png]");
	check("U8 with neither alt nor a file name, [image]", htmlToMarkdown('<img src="cid:xyz">') === "[image]");
});

section("callouts and quotes", () => {
	for (const kind of Object.keys(CALLOUTS)) {
		const md = htmlToMarkdown(renderMarkdown(`> [!${kind}]\n> Body for ${kind}.\n`));
		check(`[!${kind}] reads back as a callout quote`, md === `> [!${kind}]\n> Body for ${kind}.`, JSON.stringify(md));
	}
	check("a plain quote stays a plain quote", htmlToMarkdown(renderMarkdown("> plain quote\n")) === "> plain quote");
});

section("tables", () => {
	const headed = htmlToMarkdown(renderMarkdown("| Key | Value |\n|---|---|\n| JIRA status | Assessed |\n"));
	check("a headed two-column table keeps its header row", headed === "| Key | Value |\n|---|---|\n| JIRA status | Assessed |", JSON.stringify(headed));
	check("a pipe in a cell is escaped", htmlToMarkdown("<table><tr><th>Name</th></tr><tr><td>a|b</td></tr></table>") === "| Name |\n|---|\n| a\\|b |");
	check(
		"a tone colour on a cell reads as a toned cell",
		htmlToMarkdown('<table><tr><th>Name</th></tr><tr><td style="color:#1a7f37">ok</td></tr></table>') === "| Name |\n|---|\n| [ok]{.ok} |",
	);
	check(
		"a shorthand-shaded first column is a key/value sheet",
		htmlToMarkdown('<table><tr><td style="background:#F2F2F2">Key</td><td>Value</td></tr></table>') === "|  |  |\n|---|---|\n| Key | Value |",
	);
	check("a single-cell table that is not a callout unwraps", htmlToMarkdown("<table><tr><td><p>Inside</p></td></tr></table>") === "Inside");
	check("two rows of one cell are a table, not a layout", htmlToMarkdown("<table><tr><td>a</td></tr><tr><td>b</td></tr></table>") === "| a |\n|---|\n| b |");
});

section("colours and banner", () => {
	check(
		"hex and spaced rgb spellings read as tones; other colours are plain",
		htmlToMarkdown('<p><span style="color:#1A7F37">ok</span> <span style="color: RGB(207, 34, 46)">bad</span> <span style="color:#ff00ff">plain</span></p>') ===
			"[ok]{.ok} [bad]{.bad} plain",
	);
	check("a font colour attribute reads as a tone", htmlToMarkdown('<font color="#1a7f37">ok</font>') === "[ok]{.ok}");
	check("the banner is dropped when it leads", htmlToMarkdown("<div><span>AMD General</span></div><p>Body</p>") === "Body");
	check("the banner is dropped past a leading comment", htmlToMarkdown("<!-- lead --><div>AMD General</div><p>Body</p>") === "Body");
	check("the banner text is kept when text comes first", htmlToMarkdown("<p>Hi</p><div>AMD General</div>") === "Hi\n\nAMD General");
});

section("tone spans across lines", () => {
	check(
		"a palette span with a hard break keeps its tone on each line",
		htmlToMarkdown('<p><span style="color:#1a7f37">one<br>two</span></p>') === "[one]{.ok}  \n[two]{.ok}",
	);
	check(
		"a hard break between toned lines survives the writer",
		htmlToMarkdown(renderMarkdown("[one]{.ok}  \n[two]{.ok}")).includes("[one]{.ok}  \n[two]{.ok}"),
	);
	check(
		"a palette cell with two paragraphs keeps its tone on each",
		htmlToMarkdown('<table><tr><td style="color:#1a7f37"><p>one</p><p>two</p></td></tr></table>') === "[one]{.ok}\n\n[two]{.ok}",
	);
	check(
		"a palette cell with a list keeps the markers outside the tone",
		htmlToMarkdown('<table><tr><td style="color:#1a7f37"><ul><li>a</li><li>b</li></ul></td></tr></table>') === "-   [a]{.ok}\n-   [b]{.ok}",
	);
	check(
		"a palette cell with a code block leaves the code plain",
		htmlToMarkdown('<table><tr><td style="color:#1a7f37"><pre>uv run</pre></td></tr></table>') === "```\nuv run\n```",
	);
	check(
		"a palette cell with a table leaves the table rows plain",
		htmlToMarkdown('<table><tr><td style="color:#1a7f37"><table><tr><th>h</th></tr><tr><td>v</td></tr></table></td></tr></table>') === "| h |\n|---|\n| v |",
	);
	check(
		"a code line such as '- ```' does not close its fence",
		htmlToMarkdown('<table><tr><td style="color:#1a7f37"><pre>- ```\nkeep</pre></td></tr></table>') === "```\n- ```\nkeep\n```",
	);
	check(
		"a fenced block inside a palette list item keeps its code plain",
		htmlToMarkdown('<table><tr><td style="color:#1a7f37"><ul><li><pre>x</pre></li></ul></td></tr></table>') === "-   ```\n    x\n    ```",
	);
	check(
		"text after a palette code block is toned again",
		htmlToMarkdown('<table><tr><td style="color:#1a7f37"><pre>x</pre><p>after</p></td></tr></table>') === "```\nx\n```\n\n[after]{.ok}",
	);
});

section("code", () => {
	check(
		"consecutive Consolas paragraphs become one fenced block",
		htmlToMarkdown('<p style="font-family:Consolas">one</p><p style="font-family:Consolas">&nbsp;&nbsp;two</p><p>after</p>') === "```\none\n  two\n```\n\nafter",
	);
	check("non-breaking spaces in code read back as spaces", htmlToMarkdown('<p style="font-family:Consolas">a&nbsp;&nbsp;b</p>') === "```\na  b\n```");
	check("a pre block with a fence inside gets a longer fence", htmlToMarkdown("<pre>x\n```\ny</pre>") === "````\nx\n```\ny\n````");
	check("a pre block keeps its language class", htmlToMarkdown('<pre><code class="language-sh">uv run</code></pre>') === "```sh\nuv run\n```");
	const pre = htmlToMarkdown(`<pre class="csg-codeBlock-pre" style="white-space: pre-wrap; font-family: 'SFMono-Medium', 'SF Mono', Consolas, monospace">line one.<br>line two.<br>line three</pre>`);
	check("a br inside a pre block starts a new line of code", pre === "```\nline one.\nline two.\nline three\n```", JSON.stringify(pre));
	const consolas = htmlToMarkdown('<p style="font-family:Consolas">one<br>two</p><p style="font-family:Consolas">three<br></p><p>after</p>');
	check("a br inside a Consolas paragraph starts a new line of code", consolas === "```\none\ntwo\nthree\n```\n\nafter", JSON.stringify(consolas));
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "all ok" : "FAIL");
process.exit(failed === 0 ? 0 : 1);
