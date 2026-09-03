/**
 * Runtime harness for the mind-explode DAG panel.
 *
 * Gates, all first-layer:
 *   1. render contracts — no line exceeds the given width, and the panel never
 *      grows past its declared line budget (it steals those lines from the
 *      transcript, so overrunning is not cosmetic);
 *   2. harness integrity — the fixture really parsed and really was attached;
 *   3. the happy path — render the tree with answers, search, filter, detail,
 *      and see append / rewrite / atomic-rename all arrive through the watcher;
 *   4. run selection — attach to the one in-progress run, refuse to guess when
 *      several are, never pick a finished run by recency, and pick up a run
 *      created after start() in a project that had no `.wayne` at all;
 *   5. follow mode — track the newest open node, stop on manual movement,
 *      resume on `g`.
 *
 * Run: node --experimental-strip-types mind-explode-dag.test.ts
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { linkDeps } from "./link-deps.mjs";

// Must run before the subject is imported: it puts pi's own pi-tui and typebox
// where Node will look for them from the extension's real directory.
linkDeps();

const { visibleWidth } = await import("@earendil-works/pi-tui");

const { DagPanel, discoverRuns, activeRuns, parseLog, applyResolution, applyUpsert } = await import("../index.ts");
type DagPanelType = InstanceType<typeof DagPanel>;


/** Must match COMPACT_LINES / EXPANDED_LINES in the subject. */
const COMPACT = 12;
const EXPANDED = 30;

const ROOT = "/tmp/mind-explode-dag-fixture";
const runDir = (topic: string) => join(ROOT, ".wayne", "runs", topic);
const logOf = (topic: string) => join(runDir(topic), "decision-log.jsonl");

const meta = (topic: string, status: string) =>
	JSON.stringify({ type: "meta", topic, status, spec: null, test_matrix: null, frontier_locked: false, written_spec_approved: false, approved_spec_sha256: null });

const LIVE = [
	meta("retry-budget", "in-progress"),
	...[
		{ type: "node", id: "N1", parent: null, kind: "choice", decision: "How the retry budget is bounded", status: "resolved", opens_when: null, resolved_by: "D1" },
		{ type: "node", id: "N2", parent: "N1", kind: "fact", decision: "What the current delivery worker does on failure", status: "resolved", opens_when: null, resolved_by: "D2" },
		{ type: "node", id: "N3", parent: "N1", kind: "choice", decision: "Where the cap is configured, per-queue or global", status: "open", opens_when: null, resolved_by: null },
		{ type: "node", id: "N10", parent: "N3", kind: "choice", decision: "Whether an operator may override the cap at runtime", status: "blocked", opens_when: "N3 resolves to per-queue", resolved_by: null },
		{ type: "node", id: "N4", parent: null, kind: "fact", decision: "Which downstreams observe the retry count today", status: "not-applicable", opens_when: null, resolved_by: null },
		{ type: "decision", id: "D1", question: "How is the retry budget bounded?", decision: "Retry a failed delivery three times, then dead-letter.", rationale: "A fixed small bound is observable and cannot mask a persistent downstream outage the way exponential-forever does.", consequences: "A transient outage longer than three attempts drops to the dead-letter queue and needs an operator replay.", supersedes: [], source: "user", reference: null },
		{ type: "decision", id: "D2", question: "What does the delivery worker do on failure today?", decision: "It re-enqueues with no bound; the row has no attempt counter.", rationale: "Read directly from the worker loop, so the migration must add the counter column before any cap can be enforced.", consequences: null, supersedes: [], source: "codebase", reference: "backend/workers/delivery.py" },
	].map((r) => JSON.stringify(r)),
].join("\n") + "\n";

/** A finished run, written last so it is also the most recently modified. */
const FINISHED = [
	meta("old-topic", "design-approved"),
	JSON.stringify({ type: "node", id: "N1", parent: null, kind: "choice", decision: "Something already settled", status: "resolved", opens_when: null, resolved_by: "D1" }),
	JSON.stringify({ type: "decision", id: "D1", question: "q", decision: "a", rationale: "r", consequences: null, supersedes: [], source: "user", reference: null }),
].join("\n") + "\n";

// ---------------------------------------------------------------- stubs

let renders = 0;
// Real ANSI so the width assertions exercise visibleWidth rather than plain text.
const theme = { fg: (_c: string, t: string) => `\x1b[38;5;110m${t}\x1b[0m`, bg: (_c: string, t: string) => t } as never;

let releases = 0;
/** Presence reports, in order, so the widget-visibility contract is observable. */
let presence: boolean[] = [];
const cb = () => ({ onRelease: () => void releases++, onPresenceChange: (p: boolean) => void presence.push(p) });

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
	if (ok) console.log(`  PASS  ${name}`);
	else {
		console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
		failures.push(name);
	}
};

/** Gate 1a: the one contract pi's TUI enforces on every component. */
const assertWidths = (label: string, panel: DagPanelType) => {
	for (const width of [40, 60, 90, 120, 200]) {
		const over = panel.render(width).filter((l) => visibleWidth(l) > width);
		if (over.length > 0) {
			check(`${label} @${width}`, false, `${over.length} line(s) too wide, worst=${Math.max(...over.map(visibleWidth))}`);
			return;
		}
	}
	check(`${label}: every line fits at 40/60/90/120/200`, true);
};

/** Gate 1b: the panel must not take more rows than it declared. */
const assertHeight = (label: string, panel: DagPanelType, budget: number) => {
	for (const width of [40, 90, 200]) {
		const got = panel.render(width).length;
		if (got > budget) {
			check(`${label} @${width} cols`, false, `rendered ${got} lines, budget ${budget}`);
			return;
		}
	}
	check(`${label}: fits ${budget} lines`, true);
};

const flat = (panel: DagPanelType, width = 90) => panel.render(width).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");

/** The watcher is debounced, so settle on a condition instead of a fixed sleep. */
const until = async (predicate: () => boolean, ms = 4000) => {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline && !predicate()) await new Promise((r) => setTimeout(r, 40));
	return predicate();
};

const cursorOf = (panel: DagPanelType) => (flat(panel).split("\n").find((l) => l.includes("▌")) ?? "").trim();

// ---------------------------------------------------------------- run

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(runDir("retry-budget"), { recursive: true });
writeFileSync(logOf("retry-budget"), LIVE);
mkdirSync(runDir("old-topic"), { recursive: true });
writeFileSync(logOf("old-topic"), FINISHED);

console.log("\n[gate 2] harness integrity");
const parsed = parseLog(LIVE);
check("fixture parses with no errors", parsed.errors.length === 0, parsed.errors.join("; "));
check("5 nodes + 2 decisions + meta", parsed.nodes.size === 5 && parsed.decisions.size === 2 && parsed.meta !== null, `nodes=${parsed.nodes.size} decisions=${parsed.decisions.size}`);
check("both runs are discovered", discoverRuns(ROOT).length === 2);
check("only retry-budget is active", activeRuns(ROOT).map((r) => r.topic).join(",") === "retry-budget");
check("the finished run is the newest on disk", discoverRuns(ROOT)[0]!.topic === "old-topic", "mtime order must make recency the wrong answer");

console.log("\n[gate 4] run selection");
const panel = new DagPanel(theme, cb(), () => void renders++);
panel.start(ROOT);
check("auto-attaches the single in-progress run", panel.attachedTopic === "retry-budget", String(panel.attachedTopic));
check("does not attach the newer finished run", !flat(panel).includes("old-topic"));

console.log("\n[gate 1] render contracts");
assertWidths("compact", panel);
assertHeight("compact", panel, COMPACT);

console.log("\n[gate 5] follow mode");
check("starts on the newest open node", panel.followingId === "N3", String(panel.followingId));
check("the followed node is the cursor", cursorOf(panel).includes("N3"), cursorOf(panel));
check("the title says it is following", flat(panel).includes("· following"));
panel.focused = true;
panel.handleInput("\x1b[A"); // up
check("manual movement stops following", panel.followingId === null);
check("the title drops the follow marker", !flat(panel).includes("· following"));
panel.handleInput("g");
check("g resumes following", panel.followingId === "N3", String(panel.followingId));

console.log("\n[gate 3] the tree");
const tree = flat(panel);
check("counters render", /● 2/.test(tree) && /○ 1/.test(tree) && /◌ 1/.test(tree) && /✕ 1/.test(tree), tree.split("\n")[1]);
check("gates render unlocked", tree.includes("frontier·") && tree.includes("spec·"));
// The panel exists to show what was DECIDED. node.decision is only the question.
check("a resolved node shows its answer", tree.includes("Retry a failed delivery three times"), tree);
check("the answer is attached under its own node", /N1\?.*\n.*↳ Retry a failed delivery/.test(tree), tree);
check("an unresolved node has no answer line", !/N3\?.*\n\s*│?\s*↳/.test(tree), tree);
panel.handleInput("a");
check("'a' collapses answers", !flat(panel).includes("↳"));
panel.handleInput("a");
check("'a' restores answers", flat(panel).includes("↳ Retry a failed delivery"));

console.log("\n[gate 1] expand");
panel.handleInput("e");
assertHeight("expanded", panel, EXPANDED);
assertWidths("expanded", panel);
check("expanded shows more than compact did", flat(panel).split("\n").length > COMPACT);
panel.handleInput("e");
assertHeight("back to compact", panel, COMPACT);

console.log("\n[gate 3] inline search");
// Typed into the widget itself, not a dialog — the dialog took focus and gave
// it back to the editor, which is what made submitting feel like falling out.
const type = (s: string) => {
	panel.handleInput("/");
	for (const ch of s) panel.handleInput(ch);
};
type("dead-letter");
check("the query renders in the panel while typing", flat(panel).includes("/dead-letter"), flat(panel));
check("the caret is drawn in the field", flat(panel).includes("▌"), flat(panel));
assertWidths("search field", panel);
assertHeight("search field", panel, COMPACT);
panel.handleInput("\r");
const searched = flat(panel);
check("submitting keeps the filter and leaves the field", searched.includes("filter /dead-letter"), searched);
check("search reaches through resolved_by into D1's consequences", searched.includes("N1") && !searched.includes("N3"), searched);
check("submitting does not release focus", panel.focused === true);
panel.handleInput("\x7f"); // backspace has no effect outside the field
check("keys outside the field are not appended to the query", flat(panel).includes("filter /dead-letter"));
panel.handleInput("c");

// A CJK commit arrives as one multi-byte chunk, not as separate bytes.
panel.handleInput("/");
panel.handleInput("重试预算");
check("a CJK commit lands in the query whole", flat(panel).includes("/重试预算"), flat(panel));
check("a CJK query that matches nothing says so", flat(panel).includes("no matching nodes"), flat(panel));
assertWidths("CJK query", panel);
panel.handleInput("\x7f");
check("backspace deletes one CJK character, not one byte", flat(panel).includes("/重试预") && !flat(panel).includes("/重试预算"), flat(panel));
panel.handleInput("\x1b");
check("esc clears the query and leaves the field", !flat(panel).includes("/重试预"), flat(panel));
check("esc in the field does not release focus", panel.focused === true);

panel.handleInput("c");
panel.handleInput("f"); // all -> open
const filtered = flat(panel);
check("status filter open keeps only N3", filtered.includes("N3") && !filtered.includes("N10") && !filtered.includes("N2"), filtered);
check("filter line reports the count", /filter open \(1\)/.test(filtered), filtered);
panel.handleInput("c");

console.log("\n[gate 3] detail");
panel.handleInput("g");
panel.handleInput("\r");
// Compact detail is a peek, not the whole record: the budget truncates it and
// says so, which is the behaviour worth pinning rather than working around.
const peek = flat(panel);
check("detail opens on the followed node", peek.includes("N3  choice  open"), peek);
check("a truncated detail reports the remainder", /↑↓ scroll \(\+\d+\)/.test(peek), peek);
assertHeight("detail compact", panel, COMPACT);
assertWidths("detail compact", panel);
panel.handleInput("e");
const detail = flat(panel);
check("expanded detail reaches the unresolved marker", detail.includes("unresolved"), detail);
assertHeight("detail expanded", panel, EXPANDED);
assertWidths("detail expanded", panel);
panel.handleInput("e");

panel.handleInput("\x1b");
check("esc leaves detail", !flat(panel).includes("esc back"));
// Tree order is N1, its children N2 and N3, so two rows up from N3 is the root.
panel.handleInput("\x1b[A");
panel.handleInput("\x1b[A");
check("the cursor walked up the tree to N1", cursorOf(panel).includes("N1"), cursorOf(panel));
panel.handleInput("\r");

panel.handleInput("e");
const d1 = flat(panel);
check("detail carries the resolving decision record", d1.includes("D1  source:user"), d1);
check("detail carries its rationale", d1.includes("cannot mask a") && d1.includes("exponential-forever"), d1);
check("detail carries its consequences", d1.includes("dead-letter queue"), d1);
panel.handleInput("e");
panel.handleInput("\x1b");

console.log("\n[gate 3] focus is the mode");
check("esc at the top level asks for release", (releases = 0, panel.handleInput("\x1b"), releases === 1), `releases=${releases}`);
panel.onBlurred();
panel.focused = false;
check("the hint invites the reader back when unfocused", flat(panel).includes("/dag or alt+g to browse"), flat(panel));
check("the title drops DAG MODE when unfocused", !flat(panel).includes("DAG MODE"));
panel.focused = true;
check("the title shows DAG MODE when focused", flat(panel).includes("DAG MODE"));


console.log("\n[gate 3] live updates");
panel.handleInput("g");
const before = renders;
appendFileSync(logOf("retry-budget"), JSON.stringify({ type: "node", id: "N11", parent: "N1", kind: "choice", decision: "Whether dead-lettered rows expire", status: "open", opens_when: null, resolved_by: null }) + "\n");
check("append arrives", await until(() => flat(panel).includes("N11")));
check("the push triggered a re-render", renders > before, `${before} -> ${renders}`);
check("follow moved to the new newest open node", panel.followingId === "N11", String(panel.followingId));

// A resolution is a whole-file rewrite under the mind-explode contract, not an
// append: the node line is replaced in place.
const resolved = LIVE.replace(
	'{"type":"node","id":"N3","parent":"N1","kind":"choice","decision":"Where the cap is configured, per-queue or global","status":"open","opens_when":null,"resolved_by":null}',
	'{"type":"node","id":"N3","parent":"N1","kind":"choice","decision":"Where the cap is configured, per-queue or global","status":"resolved","opens_when":null,"resolved_by":"D3"}\n{"type":"decision","id":"D3","question":"Where is the cap configured?","decision":"Per-queue, defaulting to the global value.","rationale":"r","consequences":null,"supersedes":[],"source":"user","reference":null}',
);
writeFileSync(logOf("retry-budget"), resolved);
check("whole-file rewrite arrives (open -> resolved + answer)", await until(() => flat(panel).includes("Per-queue, defaulting to the global value")), flat(panel));

const tmp = logOf("retry-budget") + ".tmp";
writeFileSync(tmp, resolved + JSON.stringify({ type: "node", id: "N12", parent: "N1", kind: "fact", decision: "Whether the default is observable", status: "open", opens_when: null, resolved_by: null }) + "\n");
renameSync(tmp, logOf("retry-budget"));
check("temp-file atomic rename arrives", await until(() => flat(panel).includes("N12")));

console.log("\n[gate 4] ambiguity and pinning");
mkdirSync(runDir("second-topic"), { recursive: true });
writeFileSync(logOf("second-topic"), meta("second-topic", "in-progress") + "\n");
check("a second in-progress run detaches rather than guessing", await until(() => panel.attachedTopic === null), String(panel.attachedTopic));
check("the panel says which state it is in", flat(panel).includes("2 runs are in-progress") && flat(panel).includes("/dag-run"), flat(panel));
assertWidths("ambiguous", panel);
assertHeight("ambiguous", panel, COMPACT);

panel.pin(discoverRuns(ROOT).find((r) => r.topic === "old-topic")!);
check("/dag-run pins a finished run", panel.attachedTopic === "old-topic", String(panel.attachedTopic));
check("a pinned run survives a rescan", await until(() => panel.attachedTopic === "old-topic"));
panel.shutdown();

console.log("\n[gate 4] presence — the widget only exists when a run does");
const FRESH = "/tmp/mind-explode-dag-fresh";
rmSync(FRESH, { recursive: true, force: true });
mkdirSync(FRESH, { recursive: true });
presence = [];
const cold = new DagPanel(theme, cb(), () => void renders++);
cold.start(FRESH);
check("starting with no .wayne is not an error", cold.attachedTopic === null);
// The widget costs transcript lines, so an idle project must not be told to
// carry a box that says nothing.
check("it never reports itself present with no run", presence.every((p) => p === false), JSON.stringify(presence));
// The wiring reads this before handing over focus. pi's setFocus accepts an
// unmounted component, so a false positive here is a hung session.
check("it is off screen, so focus must be refused", cold.onScreen === false);
assertWidths("no run", cold);
mkdirSync(join(FRESH, ".wayne", "runs", "late-topic"), { recursive: true });
writeFileSync(join(FRESH, ".wayne", "runs", "late-topic", "decision-log.jsonl"), LIVE.replace('"retry-budget"', '"late-topic"'));
check("a run created later is picked up with no /dag", await until(() => cold.attachedTopic === "late-topic", 6000), String(cold.attachedTopic));
check("and it announces itself present exactly once", presence.filter((p) => p).length === 1, JSON.stringify(presence));
check("and it follows that run's frontier", cold.followingId === "N3", String(cold.followingId));
check("and it is now on screen, so focus is allowed", cold.onScreen === true);

// Finishing the design takes the widget back off screen.
writeFileSync(
	join(FRESH, ".wayne", "runs", "late-topic", "decision-log.jsonl"),
	LIVE.replace('"retry-budget"', '"late-topic"').replace('"status":"in-progress"', '"status":"design-approved"'),
);
check("a finished run takes the widget away again", await until(() => presence[presence.length - 1] === false, 6000), JSON.stringify(presence));
check("and focus is refused again", cold.onScreen === false);
cold.shutdown();


console.log("\n[gate 1] a long DAG");
const BIG = "/tmp/mind-explode-dag-big";
rmSync(BIG, { recursive: true, force: true });
mkdirSync(join(BIG, ".wayne", "runs", "big"), { recursive: true });
writeFileSync(
	join(BIG, ".wayne", "runs", "big", "decision-log.jsonl"),
	[
		meta("big", "in-progress"),
		...Array.from({ length: 80 }, (_, i) => [
			JSON.stringify({ type: "node", id: `N${100 + i}`, parent: null, kind: "fact", decision: `Filler consequence ${i} with enough text to need truncating`, status: "resolved", opens_when: null, resolved_by: `D${100 + i}` }),
			JSON.stringify({ type: "decision", id: `D${100 + i}`, question: `q${i}`, decision: `Answer ${i}, itself long enough to need truncating in a narrow panel`, rationale: "r", consequences: null, supersedes: [], source: "user", reference: null }),
		]).flat(),
	].join("\n") + "\n",
);
const big = new DagPanel(theme, cb(), () => void renders++);
big.start(BIG);
check("the long DAG loaded", flat(big).includes("N100"));
assertHeight("long compact", big, COMPACT);
assertWidths("long compact", big);
check("it reports what is scrolled off", /\+\d+ below/.test(flat(big)), flat(big));
big.focused = true;

// The selected row wraps and the others do not, so the scroll window has to be
// measured with the cursor's real height. Measuring it unwrapped scrolled the
// highlight off the bottom: the row was budgeted at 2 lines and drawn at 5, and
// the cut landed on the one row the reader was looking for.
for (let step = 0; step < 12; step++) {
	big.handleInput("\x1b[B");
	const drawn = flat(big);
	const bars = drawn.split("\n").filter((l) => l.includes("▌"));
	if (bars.length === 0) {
		check(`the highlight is still drawn after ${step + 1} downward moves`, false, drawn);
		break;
	}
	if (step === 11) check("the highlight survives 12 downward moves", true);
}
assertHeight("after scrolling down", big, COMPACT);
// Every line of the selected row carries the bar, including wrapped ones.
const bars = flat(big).split("\n").filter((l) => l.includes("▌"));
check("the gutter marks every line of the selected row", bars.length >= 1, String(bars.length));
check("the highlight is not the last drawn row when more follow", !/▌[^\n]*\n[^\n]*─{10}/.test(flat(big)), flat(big));

big.handleInput("\x1b[F"); // end
assertHeight("long scrolled to end", big, COMPACT);
check("scrolling to the end moves the cursor", cursorOf(big).includes("N179"), cursorOf(big));
check("the highlight is drawn at the end too", flat(big).includes("▌"), flat(big));

big.handleInput("e");
assertHeight("long expanded", big, EXPANDED);
big.shutdown();

console.log("\n[gate 6] the write path");
const BASE = [
	meta("w", "in-progress"),
	JSON.stringify({ type: "node", id: "N1", parent: null, kind: "choice", decision: "Root question", status: "open", opens_when: null, resolved_by: null }),
	JSON.stringify({ type: "node", id: "N2", parent: "N1", kind: "fact", decision: "Already settled", status: "resolved", opens_when: null, resolved_by: "D1" }),
	JSON.stringify({ type: "decision", id: "D1", question: "q", decision: "a", rationale: "r", consequences: null, supersedes: [], source: "user", reference: null }),
].join("\n") + "\n";

const ok = applyResolution(BASE, {
	node_id: "N1",
	question: "How is the budget bounded?",
	decision: "Three attempts, then dead-letter.",
	rationale: "A fixed bound stays observable.",
	consequences: "A long outage needs an operator replay.",
	source: "user",
	opens: [
		{ kind: "choice", decision: "Where the cap is configured" },
		{ kind: "choice", decision: "Whether an operator may override it", status: "blocked", opens_when: "the cap is per-queue" },
	],
});
check("a resolution succeeds", ok.ok === true, ok.ok ? "" : ok.reason);
if (ok.ok) {
	const after = parseLog(ok.text);
	// One write event: the decision, the node flip, and the children together.
	check("it allocates the next consecutive decision id", ok.decisionId === "D2", ok.decisionId);
	check("it rewrites the node in place, not appends a second one", after.nodes.size === 4 && after.nodes.get("N1")!.status === "resolved");
	check("the resolved node names its decision", after.nodes.get("N1")!.resolved_by === "D2");
	check("children are appended as this node's children", ok.childIds.join(",") === "N3,N4" && after.nodes.get("N3")!.parent === "N1");
	check("a blocked child keeps its predicate", after.nodes.get("N4")!.status === "blocked" && after.nodes.get("N4")!.opens_when === "the cap is per-queue");
	check("the rewritten log still parses clean", after.errors.length === 0, after.errors.join("; "));
	check("meta is untouched and still first", ok.text.split("\n")[0] === meta("w", "in-progress"));
	check("the pre-existing decision is carried through byte-exact", ok.text.includes(JSON.stringify({ type: "decision", id: "D1", question: "q", decision: "a", rationale: "r", consequences: null, supersedes: [], source: "user", reference: null })));
}

// Rejections. Each is a state the contract forbids, and a writer that accepted
// it would produce a log the next write reasons about wrongly.
const reasons = (r: ReturnType<typeof applyResolution>) => (r.ok ? "ACCEPTED" : r.reason);
const base = { question: "q", decision: "d", rationale: "r", consequences: null, source: "user" as const };
check("resolving an unknown node is refused", !applyResolution(BASE, { ...base, node_id: "N99" }).ok, reasons(applyResolution(BASE, { ...base, node_id: "N99" })));
check("re-resolving a resolved node is refused", !applyResolution(BASE, { ...base, node_id: "N2" }).ok, reasons(applyResolution(BASE, { ...base, node_id: "N2" })));
check(
	"a codebase decision with no reference is refused",
	!applyResolution(BASE, { ...base, node_id: "N1", source: "codebase" }).ok,
	reasons(applyResolution(BASE, { ...base, node_id: "N1", source: "codebase" })),
);
check(
	"a web decision without a URL is refused",
	!applyResolution(BASE, { ...base, node_id: "N1", source: "web", reference: "docs/foo.md" }).ok,
	reasons(applyResolution(BASE, { ...base, node_id: "N1", source: "web", reference: "docs/foo.md" })),
);
check(
	"a web decision with a URL is accepted",
	applyResolution(BASE, { ...base, node_id: "N1", source: "web", reference: "https://example.com/x" }).ok,
);
check(
	"superseding a decision that is not in the log is refused",
	!applyResolution(BASE, { ...base, node_id: "N1", supersedes: ["D9"] }).ok,
	reasons(applyResolution(BASE, { ...base, node_id: "N1", supersedes: ["D9"] })),
);
// The reader is last-wins on purpose; the writer must not inherit that, because
// id allocation and "rewrite the node line" both assume uniqueness.
const dupe = BASE + JSON.stringify({ type: "node", id: "N1", parent: null, kind: "choice", decision: "Root question again", status: "open", opens_when: null, resolved_by: null }) + "\n";
check("a log with a duplicate id is refused", !applyResolution(dupe, { ...base, node_id: "N1" }).ok, reasons(applyResolution(dupe, { ...base, node_id: "N1" })));
check("the reader still tolerates that same log", parseLog(dupe).nodes.get("N1")!.decision === "Root question again");

const up = applyUpsert(BASE, { kind: "choice", decision: "A new root", parent: null });
check("upsert creates the next node id", up.ok && up.childIds[0] === "N3", up.ok ? up.childIds.join(",") : up.reason);
check("upsert refuses an unknown parent", !applyUpsert(BASE, { kind: "fact", decision: "x", parent: "N42" }).ok);
check("upsert refuses to reopen a resolved node", !applyUpsert(BASE, { id: "N2", kind: "fact", decision: "x" }).ok);
check("upsert refuses to amend a node that is not there", !applyUpsert(BASE, { id: "N42", kind: "fact", decision: "x" }).ok);

// A write must not move a cursor the reader placed by hand.
const W = "/tmp/mind-explode-dag-write";
rmSync(W, { recursive: true, force: true });
mkdirSync(join(W, ".wayne", "runs", "w"), { recursive: true });
writeFileSync(join(W, ".wayne", "runs", "w", "decision-log.jsonl"), BASE);
const wp = new DagPanel(theme, cb(), () => void renders++);
wp.start(W);
check("the write fixture attached", wp.attachedTopic === "w", String(wp.attachedTopic));
wp.focused = true;
// N2 is N1's child, so it is BELOW it in the tree; `j` walks down onto it and
// turns follow off, which is the state a write must not disturb.
wp.handleInput("j");
const parked = cursorOf(wp);
check("the cursor was parked by hand", wp.followingId === null && parked.includes("N2"), parked);
const written = applyResolution(readFileSync(join(W, ".wayne", "runs", "w", "decision-log.jsonl"), "utf8"), {
	...base,
	node_id: "N1",
	opens: [{ kind: "choice", decision: "A brand new frontier node" }],
});
if (written.ok) writeFileSync(join(W, ".wayne", "runs", "w", "decision-log.jsonl"), written.text);
wp.refreshNow();
check("a write does not move a hand-placed cursor", cursorOf(wp).includes("N2"), cursorOf(wp));
check("the write is still visible in the header", flat(wp).includes("last D2"), flat(wp));
// With follow on it tracks the frontier, and lands there exactly once.
wp.handleInput("g");
const followed = wp.followingId;
wp.refreshNow();
check("follow tracks the new frontier node", followed === "N3" && wp.followingId === "N3", `${followed} -> ${wp.followingId}`);
check("a second refresh does not move it again", (wp.refreshNow(), wp.followingId === "N3"));
wp.shutdown();
rmSync(W, { recursive: true, force: true });


rmSync(ROOT, { recursive: true, force: true });
rmSync(FRESH, { recursive: true, force: true });
rmSync(BIG, { recursive: true, force: true });

console.log(`\n${failures.length === 0 ? "ALL GATES PASS" : `${failures.length} FAILED: ${failures.join(", ")}`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
