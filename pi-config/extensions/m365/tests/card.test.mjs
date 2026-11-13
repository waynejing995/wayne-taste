/**
 * teams_send cards, offline: what the card builder refuses and lays out, how a card is posted to Graph, and that
 * the agent's own card, read back through either the Graph path or chatsvc (the self-chat), is recognised as the
 * agent's send, so the self-chat watch never answers its own card.
 *
 *   node tests/card.test.mjs
 */
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { realpathSync } from "node:fs";
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
const { buildCard, cardText, cardMentions, isAgentSend, idleLabel, sortAgents, CARD_CONTENT_TYPE, agentFooterText, footerTextFor, setAgentHarness } =
	await jiti.import(join(ROOT, "teams", "card.ts"));
// The harness omp names when the extension loads; every footer below is this one.
setAgentHarness("omp");
const FOOTER = agentFooterText();
const { GraphBackend, msgText } = await jiti.import(join(ROOT, "teams", "graph-backend.ts"));
const { GraphClient } = await jiti.import(join(ROOT, "core", "graph.ts"));
const { SkypeClient } = await jiti.import(join(ROOT, "teams", "skype.ts"));

let failed = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.message}`);
	}
}

const DECISION = {
	question: "Which branch ships?",
	context: "release/1.2 has the hotfix; main also carries the untested proxy refactor.",
	options: [{ label: "main", consequence: "ships the refactor untested" }, { label: "release/1.2", consequence: "hotfix only, CI green" }, { label: "wait" }],
	recommended: 1,
	reason: "CI is green there",
};

await check("a card opens with the agent badge and ends with the footer line", () => {
	const lines = cardText(buildCard({ title: "Build 412", text: "It is **green**." })).split("\n");
	deepStrictEqual(lines, ["🤖 pi agent", "Build 412", "It is **green**.", FOOTER]);
});

await check("a decision keeps its context, every option with its consequence, marks only the recommended one with the reason", () => {
	const text = cardText(buildCard({ text: "", decision: DECISION }));
	ok(text.includes("Which branch ships?"));
	ok(text.includes("untested proxy refactor"), "context");
	ok(text.includes("**1.** main") && text.includes("**3.** wait"));
	ok(text.includes("→ ships the refactor untested") && text.includes("→ hotfix only, CI green"), "consequences");
	ok(text.includes("**2. release/1.2**"), "recommended option is bold");
	equal(text.match(/★ Recommended/g)?.length, 1);
	ok(text.includes("★ Recommended: CI is green there"));
});

await check("a decision with one option or a recommended index out of range is refused before sending", () => {
	throws(() => buildCard({ text: "", decision: { question: "q", options: [{ label: "only" }] } }), /at least 2 options/);
	throws(() => buildCard({ text: "", decision: { ...DECISION, recommended: 3 } }), /must index options/);
	throws(() => buildCard({ text: "", decision: { ...DECISION, recommended: -1 } }), /must index options/);
});

await check("a non-https link is refused; an https one becomes a button whose URL reads back before the footer", () => {
	throws(() => buildCard({ text: "x", links: [{ title: "PR", url: "javascript:alert(1)" }] }), /https URL/);
	const card = buildCard({ text: "x", links: [{ title: "PR", url: "https://github.com/a/b/pull/1" }] });
	deepStrictEqual(card.actions, [{ type: "Action.OpenUrl", title: "PR", url: "https://github.com/a/b/pull/1" }]);
	const lines = cardText(card).split("\n");
	deepStrictEqual(lines.slice(-2), ["[PR](https://github.com/a/b/pull/1)", FOOTER]);
});

await check("facts keep their order and colour their value by tone", () => {
	const card = buildCard({ text: "", facts: [{ name: "CI", value: "green", tone: "good" }, { name: "Owner", value: "Ann" }] });
	const json = JSON.stringify(card);
	ok(json.indexOf('"CI"') < json.indexOf('"Owner"'));
	ok(/"text":"green"[^}]*"color":"Good"/.test(json));
	ok(!/"text":"Ann"[^}]*"color"/.test(json), "no tone, no colour");
});

await check("a fact with detail opens its own hidden, tone-accented panel when its row is tapped", () => {
	const card = buildCard({
		text: "",
		facts: [
			{ name: "CI", value: "red", tone: "attention", detail: "**3 tests** failed in `probe`" },
			{ name: "Owner", value: "Ann" },
			{ name: "Risk", value: "low", detail: "only docs" },
		],
	});
	const rows = card.body.find((e) => e.type === "Container" && e.items?.some((i) => i.type === "ColumnSet")).items;
	const toggles = rows.filter((r) => r.selectAction);
	deepStrictEqual(toggles.map((r) => r.selectAction), [
		{ type: "Action.ToggleVisibility", targetElements: ["fact-detail-0"] },
		{ type: "Action.ToggleVisibility", targetElements: ["fact-detail-2"] },
	]);
	ok(JSON.stringify(toggles[0]).includes("▸"), "a row with detail shows ▸");
	ok(!JSON.stringify(rows.find((r) => JSON.stringify(r).includes('"Owner"'))).includes("▸"), "a row without detail has no ▸");
	const panels = rows.filter((r) => typeof r.id === "string" && r.id.startsWith("fact-detail-"));
	deepStrictEqual(panels.map((p) => [p.id, p.isVisible, p.style]), [["fact-detail-0", false, "emphasis"], ["fact-detail-2", false, "emphasis"]]);
	const accents = panels.map((p) => p.items[0].columns[0].style);
	deepStrictEqual(accents, ["attention", "accent"], "the accent bar takes the tone; no tone, the neutral accent");
	const header = panels[0].items[0].columns[1].items[0];
	deepStrictEqual([header.text, header.weight, header.size, header.color], ["CI: red", "Bolder", "Medium", "Attention"]);
	ok(!JSON.stringify(panels).includes("isSubtle"), "no subtle text in a detail panel");
	const back = cardText(card);
	ok(back.includes("**3 tests** failed in `probe`") && back.includes("only docs"), "detail reads back");
	throws(() => buildCard({ text: "", facts: [{ name: "x", value: "y", detail: " " }] }), /fact "x" has an empty detail/);
});

await check("details are hidden behind a Details toggle and still read back", () => {
	const card = buildCard({ text: "x", details: "long log" });
	ok(card.actions.some((a) => a.type === "Action.ToggleVisibility" && a.targetElements[0] === "details"));
	ok(cardText(card).includes("long log"));
});

await check("idle timer turns yellow at 10 min and red at 30, and reads hours past 60", () => {
	deepStrictEqual([9, 10, 29, 30].map((m) => idleLabel(m).tone), ["good", "warning", "warning", "attention"]);
	equal(idleLabel(125).label, "idle 2 h 05 min");
	equal(idleLabel(7.9).label, "idle 7 min");
});

await check("a working agent quiet under 10 min reads 'working', not 'idle 0 min'; quieter ones keep the timer", () => {
	const row = (status, idle_min) => JSON.stringify(buildCard({ text: "x", agents: [{ name: "a", host: "local", idle_min, status }] }));
	ok(row("working", 0).includes('"working"') && !row("working", 0).includes("idle 0 min"));
	ok(row("working", 12).includes("idle 12 min"));
	ok(row("done", 0).includes("idle 0 min"));
});

await check("agents that need the user come first, longest idle first within a status", () => {
	const rows = [
		{ name: "a", host: "h", idle_min: 1, status: "working" },
		{ name: "b", host: "h", idle_min: 5, status: "done" },
		{ name: "c", host: "h", idle_min: 2, status: "waiting on question" },
		{ name: "d", host: "h", idle_min: 40, status: "probe failed" },
		{ name: "e", host: "h", idle_min: 9, status: "waiting on question" },
		{ name: "f", host: "h", idle_min: 30, status: "idle" },
	];
	deepStrictEqual(sortAgents(rows).map((r) => r.name), ["e", "c", "d", "f", "b", "a"]);
	const text = cardText(buildCard({ text: "", agents: rows }));
	ok(text.includes("3 need you · 3 other"), "an idle agent is not one that needs you");
	throws(() => buildCard({ text: "", agents: [{ name: "x", host: "h", idle_min: 1, status: "sleeping" }] }), /unknown status/);
});

await check("a tail is collapsed behind its row and still reads back", () => {
	const card = buildCard({ text: "", agents: [{ name: "a", host: "h", idle_min: 1, status: "working", tail: "compiling 3/9" }] });
	ok(/"text":"compiling 3\/9","wrap":true,"id":"tail-0","isVisible":false/.test(JSON.stringify(card)));
	ok(cardText(card).includes("compiling 3/9"));
});

await check("card mentions show as bold names in the card and come back in order; code is not a mention", () => {
	const { text, mentions } = cardMentions("ping @[Ann Lee](ann@x.com) and @[Bo](bo@x.com), not `@[Cy](cy@x.com)`");
	equal(text, "ping **Ann Lee** and **Bo**, not `@[Cy](cy@x.com)`");
	deepStrictEqual(mentions, [{ name: "Ann Lee", email: "ann@x.com" }, { name: "Bo", email: "bo@x.com" }]);
});

// ── the Graph send ───────────────────────────────────────────────────────────

function graphBackend(people = {}) {
	const seen = [];
	const doFetch = async (url, init) => {
		seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
		const m = /\$search=([^&]+)/.exec(url);
		const address = m ? decodeURIComponent(m[1]).replaceAll('"', "") : "";
		const value = people[address]
			? [{ id: people[address], personType: { subclass: "OrganizationUser" }, scoredEmailAddresses: [{ address }] }]
			: [];
		return { status: 201, text: async () => JSON.stringify(m ? { value } : { id: "1" }) };
	};
	return { seen, b: new GraphBackend(new GraphClient(async () => "T", doFetch), { whoami: async () => "Me" }) };
}

await check("a card goes to Graph as one attachment the body points at, with the mentions beside it", async () => {
	const { seen, b } = graphBackend({ "ann@x.com": "oid-ann" });
	const card = buildCard({ text: "**Ann Lee** please pick", decision: DECISION });
	await b.send({ kind: "chat", chat: "", id: "19:abc@thread.v2" }, "ZZTEAMSMENTIONZZ0ZZ", true, [{ name: "Ann Lee", email: "ann@x.com" }], [], card);
	const post = seen.at(-1);
	equal(post.url, "https://graph.microsoft.com/v1.0/chats/19:abc@thread.v2/messages");
	const [att] = post.body.attachments;
	equal(att.contentType, CARD_CONTENT_TYPE);
	deepStrictEqual(JSON.parse(att.content), card);
	equal(post.body.body.content, `<at id="0">Ann Lee</at><attachment id="${att.id}"></attachment>`);
	deepStrictEqual(post.body.mentions[0].mentioned.user.id, "oid-ann");
});

await check("a self card goes through Graph to 48:notes, not chatsvc", async () => {
	const { seen, b } = graphBackend();
	await b.send({ kind: "self" }, "", true, [], [], buildCard({ text: "hi" }));
	equal(seen.at(-1).url, "https://graph.microsoft.com/v1.0/chats/48:notes/messages");
});

await check("a missing image beside a card is refused before anything is posted", async () => {
	const { seen, b } = graphBackend();
	let err = "";
	await b.send({ kind: "self" }, "", true, [], ["/nonexistent.png"], buildCard({ text: "x" })).catch((e) => (err = e.message));
	ok(/ENOENT/.test(err), err);
	equal(seen.length, 0);
});

// ── the echo guard ───────────────────────────────────────────────────────────

const sent = buildCard({ title: "Ship?", text: "**Ann Lee** please pick", decision: DECISION, links: [{ title: "PR", url: "https://x.com/1" }], details: "log" });

await check("the agent's card read back through Graph is the agent's send", () => {
	// What Graph returns: the body holds only the attachment tag (and any mentions); the card is a JSON string.
	const text = msgText({
		body: { contentType: "html", content: '<at id="0">Ann Lee</at><attachment id="a1"></attachment>' },
		attachments: [{ id: "a1", contentType: CARD_CONTENT_TYPE, content: JSON.stringify(sent) }],
	});
	ok(text.startsWith("Ann Lee\n🤖 pi agent\nShip?"), text);
	ok(isAgentSend(text), text);
});

await check("the agent's card read back from the self-chat (chatsvc properties.cards) is the agent's send", async () => {
	// The shape chatsvc stored for a real Graph card send to 48:notes (2026-11-11).
	const raw = {
		id: "1794392610073",
		composetime: "2026-11-11T10:23:30.000Z",
		messagetype: "RichText/Html",
		content: '<span itemid="a1" itemscope="" itemtype="http://schema.skype.com/InputExtension"><span itemprop="cardId"></span></span>',
		properties: { cards: JSON.stringify([{ cardClientId: "a1", content: sent, contentType: CARD_CONTENT_TYPE }]) },
	};
	const doFetch = async (url) => ({
		status: 200,
		text: async () =>
			JSON.stringify(
				url.includes("authsvc")
					? { tokens: { skypeToken: "S" }, regionGtms: { messagingService: "https://amer.ng.msg.teams.microsoft.com/v1" } }
					: { messages: [raw] },
			),
	});
	const [m] = await new SkypeClient(async () => "AAD", doFetch).selfMessages("1", 20);
	ok(m, "the card is not dropped as an empty message");
	ok(m.text.includes("Which branch ships?"), m.text);
	ok(isAgentSend(m.text), m.text);
});

await check("a person's message is not the agent's send, even one quoting the footer mid-text", () => {
	ok(!isAgentSend("can you check build 412?"));
	ok(!isAgentSend("why does it say sent by omp agent at the bottom?"));
	ok(isAgentSend("PONG\n\n*sent by omp agent*"), "a text send's italic footer");
	ok(isAgentSend("shot\nsent by omp agent\n[draft-owner.png]"), "a text send with an image");
	ok(!isAgentSend("PONG\n> sent by omp agent"), "a quoted forward of it");
});

// ── the footer names the harness ─────────────────────────────────────────────

await check("the footer is 'sent by <harness> agent', the name cut to [a-z0-9-], and 'sent by agent' without one", () => {
	deepStrictEqual(
		[footerTextFor("omp"), footerTextFor("claude-code"), footerTextFor("Cursor IDE"), footerTextFor("codex_cli/1.2"), footerTextFor(undefined), footerTextFor("  ")],
		["sent by omp agent", "sent by claude-code agent", "sent by cursor-ide agent", "sent by codex-cli-1-2 agent", "sent by agent", "sent by agent"],
	);
	equal(FOOTER, "sent by omp agent");
});

await check("the echo guard knows only this process's footer: not another harness's, not the old 'sent by pi agent'", () => {
	ok(!isAgentSend("PONG\n\n*sent by pi agent*"), "the old pi footer");
	ok(!isAgentSend("PONG\n\n*sent by claude-code agent*"), "another harness's footer");
	ok(!isAgentSend("PONG\n\n*sent by agent*"), "the unnamed footer");
	setAgentHarness("claude-code");
	try {
		ok(isAgentSend("PONG\n\n*sent by claude-code agent*"), "claude-code's own footer once it is the harness");
		ok(!isAgentSend("PONG\n\n*sent by omp agent*"), "omp's footer is now someone else's");
		ok(cardText(buildCard({ text: "x" })).endsWith("sent by claude-code agent"), "cards carry it too");
	} finally {
		setAgentHarness("omp");
	}
});

console.log(failed === 0 ? "\nall green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
