/**
 * Mail suite for mime.ts: a Markdown draft to MIME (.eml), and a raw message back.
 *
 *   node tests/mime.test.mjs      # run.mjs runs it with the rest of the suite
 *
 * U9  a new draft builds multipart/alternative: the text part is the Markdown and
 *     the HTML part is renderMarkdown's page; parseEml reads the subject, To, Cc
 *     and both parts back. A new draft carries no threading headers.
 * U10 respondDefaults: reply, reply-all and forward recipients (self removed,
 *     case-insensitive, de-duplicated, Reply-To ignored), threading headers,
 *     prefixSubject, and new body -> separator -> original in both parts.
 * U11 the agent footer ends both parts; without one, neither part says so.
 * U12 parseEml: a text-only mail, a 2 048-byte PDF and an inline cid image, a
 *     group address in Cc with no To, and the rules for missing headers and
 *     attachment dispositions.
 * U29 attachments survive a forward and a reply; a related image with no
 *     Content-Disposition parses as inline and is carried by a reply.
 * U30 a built MIME carries the overridden to, cc and subject, not the defaults.
 *
 * Nothing is sent and no Graph call is made: buildEml and parseEml are local.
 */
import { deepStrictEqual } from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti, PI } from "../../tests/host.mjs";
// Resolved paths: importing through the symlink would give a SECOND copy of
// every module, and `instanceof` across the two silently fails. See ext-path.mjs.
import { ext } from "./ext-path.mjs";

const { createDocument } = createRequire(ext("package.json"))("@mixmark-io/domino");

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
const { renderMarkdown } = await jiti.import(ext("render.ts"));
const { htmlToMarkdown } = await jiti.import(ext("convert.ts"));
const { buildEml, parseEml, respondDefaults, prefixSubject, AGENT_FOOTER, withMentioned } = await jiti.import(ext("mime.ts"));

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => parseEml(readFileSync(join(here, "fixtures", name)));

const ME = { name: "Me", address: "me@example.com" };
const SELF = ["me@example.com"];
// The bytes the fixtures encode: a 2 048-byte PDF and a 1x1 PNG.
const PDF = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const emails = (list) => list.map((a) => a.address);
/** A draft with the sender and body filled in, the way the tools hand one to buildEml. */
const compose = (draft, markdown, footer) => buildEml({ ...draft, from: ME, markdown, footer });

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

/** True when each needle occurs in `s`, each after the one before it. */
const inOrder = (s, needles) => {
	let at = 0;
	for (const n of needles) {
		const i = s.indexOf(n, at);
		if (i < 0) return false;
		at = i + n.length;
	}
	return true;
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

// --- Checks ------------------------------------------------------------------

await section("U9 a new draft builds multipart/alternative and reads back", async () => {
	const md = "Build **green**: [Merged]{.ok} into main.\n";
	const subject = "测试 [omp] report";
	const raw = await compose(
		{
			kind: "new",
			to: [{ name: "Bob", address: "bob@example.com" }],
			cc: [{ address: "carol@example.com" }],
			subject,
			references: [],
			attachments: [],
		},
		md,
	);
	const head = raw.toString("utf8");
	check("U9 top level is multipart/alternative", /^Content-Type: multipart\/alternative/m.test(head));
	check("U9 a new draft has no In-Reply-To or References header", !/^(In-Reply-To|References):/im.test(head));
	const mail = await parseEml(raw);
	check("U9 subject round-trips", mail.subject === subject, JSON.stringify(mail.subject));
	equal("U9 To round-trips with its name", mail.to, [{ name: "Bob", address: "bob@example.com" }]);
	equal("U9 Cc round-trips", emails(mail.cc), ["carol@example.com"]);
	check("U9 text part is the Markdown", mail.text === md, JSON.stringify(mail.text));
	check("U9 html part is renderMarkdown's page", mail.html === renderMarkdown(md), JSON.stringify(mail.html));
});

await section("U10 respondDefaults recipients, threading and subjects", async () => {
	const orig = await load("mime-original.eml");
	const reply = respondDefaults("reply", orig, SELF);
	const all = respondDefaults("replyAll", orig, SELF);
	const fwd = respondDefaults("forward", orig, SELF);
	equal("U10 reply: To is the sender", emails(reply.to), ["alice@example.com"]);
	equal("U10 reply: Cc is empty", emails(reply.cc), []);
	equal("U10 reply-all: To is the sender and the original To, self removed", emails(all.to), ["alice@example.com", "bob@example.com"]);
	equal("U10 reply-all: Cc is the original Cc, self removed", emails(all.cc), ["carol@example.com"]);
	equal("U10 forward: To is empty", emails(fwd.to), []);
	equal("U10 forward: Cc is empty", emails(fwd.cc), []);
	const own = respondDefaults("reply", { ...orig, from: { address: "me@example.com" } }, SELF);
	equal("U10 a mail from self replied to: To is self", emails(own.to), ["me@example.com"]);
	const withReplyTo = await load("mime-original-reply-to.eml");
	equal("U10 Reply-To ignored: reply goes to the sender", emails(respondDefaults("reply", withReplyTo, SELF).to), ["alice@example.com"]);
	const rta = respondDefaults("replyAll", withReplyTo, SELF);
	equal("U10 Reply-To ignored: reply-all To", emails(rta.to), ["alice@example.com", "bob@example.com"]);
	equal("U10 Reply-To ignored: reply-all Cc", emails(rta.cc), ["carol@example.com"]);
	const dup = respondDefaults(
		"replyAll",
		{
			...orig,
			to: [{ address: "bob@example.com" }, { address: "bob@example.com" }, { address: "ME@Example.com" }],
			cc: [{ address: "Bob@example.com" }, { address: "carol@example.com" }],
		},
		SELF,
	);
	equal("U10 reply-all de-duplicates and drops self case-insensitively: To", emails(dup.to), ["alice@example.com", "bob@example.com"]);
	equal("U10 reply-all: Cc drops an address already in To", emails(dup.cc), ["carol@example.com"]);
	for (const d of [reply, all, fwd]) {
		equal(`U10 ${d.kind}: inReplyTo is the original Message-ID`, d.inReplyTo, "<a@x>");
		equal(`U10 ${d.kind}: references are the original's, then its Message-ID`, d.references, ["<z@x>", "<a@x>"]);
	}
	check("U10 the reply keeps the original as its quote", reply.quote === orig);
	equal("U10 reply subject", reply.subject, "RE: Quarterly status");
	equal("U10 forward subject", fwd.subject, "FW: Quarterly status");
	equal("U10 prefixSubject adds RE:", prefixSubject("RE", "hi"), "RE: hi");
	equal("U10 prefixSubject keeps Re:", prefixSubject("RE", "Re: hi"), "Re: hi");
	equal("U10 prefixSubject adds FW:", prefixSubject("FW", "hi"), "FW: hi");
	equal("U10 prefixSubject keeps FW:", prefixSubject("FW", "FW: hi"), "FW: hi");
	equal("U10 prefixSubject keeps Fwd:", prefixSubject("FW", "Fwd: hi"), "Fwd: hi");
	equal("U10 prefixSubject does not count Re: as FW", prefixSubject("FW", "Re: hi"), "FW: Re: hi");
});

await section("U10 reply and forward bodies: headers, order, quote forms", async () => {
	const orig = await load("mime-original.eml");
	for (const kind of ["reply", "forward"]) {
		const raw = await compose(respondDefaults(kind, orig, SELF), "Looks good.\n");
		const head = raw.toString("utf8");
		check(
			`U10 ${kind}: headers In-Reply-To <a@x> and References <z@x> <a@x>`,
			/^In-Reply-To: <a@x>\r?$/im.test(head) && /^References: <z@x> <a@x>\r?$/im.test(head),
		);
		const mail = await parseEml(raw);
		check(`U10 ${kind}: HTML is new body, separator, original`, inOrder(mail.html ?? "", ["Looks good.", "<hr", "Status is "]));
		check(`U10 ${kind}: text is new body, separator, original`, inOrder(mail.text ?? "", ["Looks good.", "---", "> Status is green."]));
		check(
			`U10 ${kind}: the original's colored span survives`,
			(mail.html ?? "").includes('<span style="color:rgb(26,127,55);font-weight:bold">green</span>'),
		);
	}

	const plain = await load("mime-text-only.eml");
	const pm = await parseEml(await compose(respondDefaults("reply", plain, SELF), "Got it.\n"));
	check(
		"U10 text-only original: HTML holds its text escaped in a pre-wrap div",
		(pm.html ?? "").includes("white-space:pre-wrap") && (pm.html ?? "").includes("Use &lt;b&gt;bold&lt;/b&gt; here, literally."),
	);
	check("U10 text-only original: text part is > prefixed", (pm.text ?? "").includes("> Use <b>bold</b> here, literally."));
	check(
		"U10 text-only original: new body, separator, original in both parts",
		inOrder(pm.html ?? "", ["Got it.", "<hr", "Use &lt;b&gt;"]) && inOrder(pm.text ?? "", ["Got it.", "---", "> Just a plain note."]),
	);

	const htmlOnly = { ...orig, text: undefined, html: '<p><span style="color:rgb(26,127,55);font-weight:bold">Merged</span> into main</p>' };
	const hm = await parseEml(await compose(respondDefaults("reply", htmlOnly, SELF), "Noted.\n"));
	check("U10 HTML-only original: text part holds its Markdown conversion, > prefixed", (hm.text ?? "").includes("> [Merged]{.ok} into main"));

	const fragment = '<div style="color:rgb(9,105,218)">Fragment <b>kept</b> whole</div>';
	const fm = await parseEml(await compose(respondDefaults("reply", { ...orig, text: undefined, html: fragment }, SELF), "Read this.\n"));
	check("U10 HTML fragment without <body>: the whole fragment is in the HTML part", (fm.html ?? "").includes(fragment));
});

await section("U11 agent footer ends both parts", async () => {
	const orig = await load("mime-original.eml");
	const footer = AGENT_FOOTER;
	const mail = await parseEml(await compose(respondDefaults("reply", orig, SELF), "Done.\n", footer));
	const html = mail.html ?? "";
	check(
		"U11 HTML body ends with the footer, after the quoted original",
		createDocument(html).body.textContent.trim().endsWith("sent by omp agent") && inOrder(html, ["Status is ", "sent by omp agent"]),
	);
	const lastLine = (mail.text ?? "").split("\n").filter((l) => l.trim() !== "").at(-1);
	equal("U11 text part's last line is the footer", lastLine, "*sent by omp agent*");
	const bare = await parseEml(await compose(respondDefaults("reply", orig, SELF), "Done.\n"));
	check("U11 without a footer, neither part says sent by omp agent", !(bare.html ?? "").includes("sent by omp agent") && !(bare.text ?? "").includes("sent by omp agent"));
});

await section("U11 a signature follows the body and precedes the quoted original and the footer, in both parts", async () => {
	const orig = await load("mime-original.eml");
	const draft = respondDefaults("reply", orig, SELF);
	const mail = await parseEml(await buildEml({ ...draft, from: ME, markdown: "Done.\n", signature: "Best,\n**Alex Doe**\n", footer: AGENT_FOOTER }));
	const text = createDocument(mail.html ?? "").body.textContent;
	check("U11 HTML: body, signature, original, footer in that order", inOrder(text, ["Done.", "Alex Doe", "Status is ", "sent by omp agent"]), text);
	check("U11 the signature's Markdown is rendered", /<b[^>]*>Alex Doe<\/b>|<strong[^>]*>Alex Doe<\/strong>/.test(mail.html ?? ""), mail.html);
	check("U11 each signature line stays its own line", /Best,<br\s*\/?>\s*<(b|strong)\b/.test(mail.html ?? ""), mail.html);
	check("U11 text: body, signature, original, footer in that order", inOrder(mail.text ?? "", ["Done.", "**Alex Doe**", "Status is ", "sent by omp agent"]), mail.text);
	const blank = await parseEml(await buildEml({ ...draft, from: ME, markdown: "Done.\n", signature: "  \n" }));
	const unsigned = await parseEml(await buildEml({ ...draft, from: ME, markdown: "Done.\n" }));
	equal("U11 a blank signature adds nothing", [blank.text, blank.html], [unsigned.text, unsigned.html]);
});

await section("U11 an @mention is an Outlook mention anchor in HTML; the text part keeps the Markdown", async () => {
	const md = "Ping @[Ann Lee](ann@example.com) and @[Bob](bob@example.com).\n";
	const mail = await parseEml(await compose({ kind: "new", to: [], cc: [], subject: "m", references: [], attachments: [] }, md));
	const anchors = [...(mail.html ?? "").matchAll(/<a id="(OWAAM[0-9A-F]{32}Z)" href="mailto:([^"]+)"[^>]*>@([^<]+)<\/a>/g)];
	equal("U11 one OWAAM anchor per mention: address and @name", anchors.map((m) => [m[2], m[3]]), [["ann@example.com", "Ann Lee"], ["bob@example.com", "Bob"]]);
	check("U11 each anchor id is unique", new Set(anchors.map((m) => m[1])).size === 2);
	check("U11 the text part keeps the Markdown as written", (mail.text ?? "").includes("Ping @[Ann Lee](ann@example.com) and @[Bob](bob@example.com)."), mail.text);
	equal("U11 reading it back gives the mention syntax", htmlToMarkdown(mail.html ?? "").includes("@[Ann Lee](ann@example.com)"), true);
});

await section("U11 only a rendered mention adds a recipient: code and escaped examples add nobody", async () => {
	const draft = { kind: "new", to: [{ address: "ann@example.com" }], cc: [], subject: "m", references: [], attachments: [] };
	const md = [
		"Write a mention as `@[Bob](bob@example.com)`.",
		"",
		"```",
		"@[Carol](carol@example.com)",
		"```",
		"",
		"    @[Dan](dan@example.com)",
		"",
		"Escaped: \\@[Eve](eve@example.com). Real: @[Fay](fay@example.com).",
	].join("\n");
	equal("U11 To gains only the real mention", withMentioned(draft, md).to, [{ address: "ann@example.com" }, { name: "Fay", address: "fay@example.com" }]);
	const html = (await parseEml(await compose(draft, md))).html ?? "";
	equal("U11 and only it is an OWAAM anchor", [...html.matchAll(/<a id="OWAAM[0-9A-F]{32}Z" href="mailto:([^"]+)"/g)].map((m) => m[1]), ["fay@example.com"]);
});

await section("U12 parseEml: text-only, attachments, group addresses", async () => {
	const t = await load("mime-text-only.eml");
	check("U12 text-only mail: text is set and html is undefined", t.text?.includes("Just a plain note.") === true && t.html === undefined);
	const a = await load("mime-attachments.eml");
	equal("U12 both attachments are listed", a.attachments.length, 2);
	const pdf = a.attachments.find((x) => x.filename === "report.pdf");
	equal("U12 PDF: type and disposition", [pdf?.mimeType, pdf?.disposition], ["application/pdf", "attachment"]);
	equal("U12 PDF: no contentId", pdf?.contentId, undefined);
	equal("U12 PDF: size is the decoded 2048 bytes", pdf?.size, 2048);
	check("U12 PDF: content is the decoded bytes", pdf?.content.equals(PDF) === true);
	const png = a.attachments.find((x) => x.filename === "chart.png");
	equal("U12 PNG: type, disposition and contentId without brackets", [png?.mimeType, png?.disposition, png?.contentId], ["image/png", "inline", "img1"]);
	equal("U12 PNG: size is the decoded byte length", png?.size, PNG.byteLength);
	check("U12 PNG: content is the decoded bytes", png?.content.equals(PNG) === true);
	const g = await load("mime-group-cc.eml");
	equal("U12 no To header parses to []", g.to, []);
	equal("U12 a group in Cc lists its members", emails(g.cc), ["carol@example.com", "dave@example.com"]);
});

await section("U12 parseEml: missing headers and attachment dispositions", async () => {
	const bareMime = [
		"From: Dana <dana@example.com>",
		'Content-Type: multipart/mixed; boundary="M"',
		"",
		"--M",
		"Content-Type: text/html; charset=utf-8",
		"",
		'<p>Logo: <img src="cid:img3"> Chart: <img src="cid:img4"></p>',
		"--M",
		'Content-Type: image/png; name="logo.png"',
		"Content-Transfer-Encoding: base64",
		"Content-ID: <img3>",
		"",
		"aGk=",
		"--M",
		'Content-Type: image/png; name="seal.png"',
		"Content-Transfer-Encoding: base64",
		'Content-Disposition: attachment; filename="seal.png"',
		"",
		"aGk=",
		"--M",
		"Content-Type: application/octet-stream",
		"Content-Transfer-Encoding: base64",
		"Content-Disposition: attachment",
		"",
		"aGk=",
		"--M",
		'Content-Type: image/png; name="chart.png"',
		"Content-Transfer-Encoding: base64",
		'Content-Disposition: attachment; filename="chart.png"',
		"Content-ID: <img4>",
		"",
		"aGk=",
		"--M--",
		"",
	].join("\n");
	const bare = await parseEml(Buffer.from(bareMime));
	equal("U12 an absent Subject parses to ''", bare.subject, "");
	equal("U12 absent To and Cc parse to []", [bare.to, bare.cc], [[], []]);
	equal("U12 From is an address with its name", bare.from, { name: "Dana", address: "dana@example.com" });
	equal("U12 attachments are named, else attachment-<n>", bare.attachments.map((x) => x.filename), ["logo.png", "seal.png", "attachment-3", "chart.png"]);
	equal(
		"U12 a cid-referenced part is inline, even when labelled attachment (Exchange); an uncited attachment stays one",
		bare.attachments.map((x) => x.disposition),
		["inline", "attachment", "attachment", "inline"],
	);
	equal("U12 the logo keeps its contentId without brackets", bare.attachments[0]?.contentId, "img3");
	check("U12 the logo's content is the decoded bytes", bare.attachments[0]?.content.equals(Buffer.from("hi")) === true);
});

await section("U29 attachments survive a forward and a reply", async () => {
	const orig = await load("mime-attachments.eml");
	const fwd = respondDefaults("forward", orig, SELF);
	equal("U29 a forward draft carries every attachment", fwd.attachments.map((a) => a.filename).sort(), ["chart.png", "report.pdf"]);
	const mail = await parseEml(await compose(fwd, "FYI, see below.\n"));
	const pdf = mail.attachments.find((a) => a.filename === "report.pdf");
	const png = mail.attachments.find((a) => a.filename === "chart.png");
	equal("U29 forward: the PDF keeps its type, disposition and size", [pdf?.mimeType, pdf?.disposition, pdf?.size], ["application/pdf", "attachment", 2048]);
	check("U29 forward: the PDF bytes are unchanged", pdf?.content.equals(PDF) === true);
	equal("U29 forward: the PNG is inline with contentId img1", [png?.mimeType, png?.disposition, png?.contentId], ["image/png", "inline", "img1"]);
	check("U29 forward: the PNG bytes are unchanged", png?.content.equals(PNG) === true);
	check("U29 forward: the HTML still references cid:img1", mail.html?.includes("cid:img1") === true);

	const reply = respondDefaults("reply", orig, SELF);
	equal("U29 a reply draft carries only the inline PNG", reply.attachments.map((a) => a.filename), ["chart.png"]);
	const rm = await parseEml(await compose(reply, "Thanks.\n"));
	equal("U29 a reply MIME carries only the inline PNG", rm.attachments.map((a) => a.filename), ["chart.png"]);

	const related = await load("mime-related-no-disposition.eml");
	equal(
		"U29 a related PNG with no Content-Disposition parses inline",
		related.attachments.map((a) => [a.filename, a.disposition, a.contentId]),
		[["diagram.png", "inline", "img2"]],
	);
	const rr = respondDefaults("reply", related, SELF);
	equal("U29 a reply carries that PNG with contentId img2", rr.attachments.map((a) => [a.contentId, a.disposition]), [["img2", "inline"]]);
	const rrm = await parseEml(await compose(rr, "Looks right.\n"));
	const back = rrm.attachments[0];
	equal("U29 the reply MIME holds the PNG: contentId img2, inline, its bytes", [back?.contentId, back?.disposition, back?.content.equals(PNG)], ["img2", "inline", true]);
	check("U29 the reply HTML still references cid:img2", rrm.html?.includes("cid:img2") === true);
});

await section("U30 edited fields reach the built MIME", async () => {
	const orig = await load("mime-original.eml");
	const draft = respondDefaults("reply", orig, SELF);
	draft.to = [{ address: "dana@example.com" }];
	draft.cc = [{ name: "Eve", address: "eve@example.com" }];
	draft.subject = "Overridden subject";
	const mail = await parseEml(await compose(draft, "Edited before sending.\n"));
	equal("U30 To is the edited value, not the sender", emails(mail.to), ["dana@example.com"]);
	equal("U30 Cc is the edited value, not the original Cc", mail.cc, [{ name: "Eve", address: "eve@example.com" }]);
	equal("U30 subject is the edited value, not RE:", mail.subject, "Overridden subject");
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "all ok" : "FAIL");
process.exit(failed === 0 ? 0 : 1);
