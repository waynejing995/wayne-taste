/**
 * Wayne Mind Explode — live decision DAG, above the editor.
 *
 * Renders the run-scoped decision log of a `wayne-mind-explode` design run as a
 * panel that sits above the input box, so the frontier is visible while you are
 * being interviewed instead of having to be reconstructed from the transcript.
 *
 * The log is the SSoT and this panel is a pure reader. It never writes, never
 * caches derived state across reads, and never infers a field the contract
 * leaves absent. Schema: `~/.pi/agent/skills/_shared/pipeline-id-contract.md`.
 *
 * Three boundaries worth stating plainly:
 *
 * - **This is a widget, not an overlay, and that is the whole point.** An
 *   overlay paints over the transcript; `setWidget` joins pi's vertical layout,
 *   so the transcript shrinks and nothing is hidden. A non-covering RIGHT rail
 *   is not reachable from an extension: pi builds its fullscreen layout root
 *   from a `transcriptScrollView` it never exposes, so there is no way to wrap
 *   the existing layout in an `HStack` without rebuilding pi's dock by hand.
 * - **`node` and `meta` lines are rewritten in place**, not appended, so an
 *   incremental tail would read a stale frontier. Every change re-reads the
 *   whole file. Append, whole-file rewrite and temp-file rename all arrive.
 * - **Keyboard interaction is explicit.** The panel owns no keys until `/dag`,
 *   and `esc` gives them all back. A passive panel that quietly ate `j` would
 *   be worse than no panel.
 */

import { existsSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const WIDGET_KEY = "mind-explode-dag";
/** Coalesce the burst of inotify events one write event produces. */
const DEBOUNCE_MS = 120;
/** Lines the panel occupies. It steals these from the transcript, so it is small. */
const COMPACT_LINES = 12;
const EXPANDED_LINES = 30;

// ---------------------------------------------------------------- log model

interface MetaRecord {
	type: "meta";
	topic: string;
	status: string;
	spec: string | null;
	test_matrix: string | null;
	frontier_locked: boolean;
	written_spec_approved: boolean;
	approved_spec_sha256: string | null;
}

type NodeStatus = "blocked" | "open" | "resolved" | "not-applicable";

interface NodeRecord {
	type: "node";
	id: string;
	parent: string | null;
	kind: "fact" | "choice";
	decision: string;
	status: NodeStatus;
	opens_when: string | null;
	resolved_by: string | null;
}

interface DecisionRecord {
	type: "decision";
	id: string;
	question: string;
	decision: string;
	rationale: string;
	consequences: string | null;
	supersedes: string[];
	source: string;
	reference: string | null;
}

interface LogState {
	meta: MetaRecord | null;
	nodes: Map<string, NodeRecord>;
	decisions: Map<string, DecisionRecord>;
	/** Malformed lines are surfaced, not swallowed — the log is machine-written. */
	errors: string[];
}

const emptyState = (): LogState => ({ meta: null, nodes: new Map(), decisions: new Map(), errors: [] });

export function parseLog(contents: string): LogState {
	const state = emptyState();
	const lines = contents.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!.trim();
		if (raw === "") continue;
		let rec: unknown;
		try {
			rec = JSON.parse(raw);
		} catch {
			state.errors.push(`line ${i + 1}: not JSON`);
			continue;
		}
		const type = (rec as { type?: unknown }).type;
		// Last occurrence wins per id. The mind-explode contract rewrites node
		// lines in place while the EngAI writer appends and folds; last-wins is
		// the one rule that reads both correctly, and it also means a
		// half-applied rewrite reads as the newer line rather than as both.
		if (type === "meta") state.meta = rec as MetaRecord;
		else if (type === "node") state.nodes.set((rec as NodeRecord).id, rec as NodeRecord);
		else if (type === "decision") state.decisions.set((rec as DecisionRecord).id, rec as DecisionRecord);
		else state.errors.push(`line ${i + 1}: unknown type ${JSON.stringify(type)}`);
	}
	return state;
}

/** Numeric order on the `N<number>` / `D<number>` id, so N10 sorts after N9. */
function idOrder(id: string): number {
	const n = Number.parseInt(id.slice(1), 10);
	return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

interface Row {
	node: NodeRecord;
	depth: number;
}

/**
 * Depth-first walk of the `parent` edges.
 *
 * A node whose parent is missing from the log is emitted as a root rather than
 * dropped: losing it silently would hide exactly the record that proves the log
 * is malformed.
 */
export function buildTree(nodes: Map<string, NodeRecord>): Row[] {
	const children = new Map<string, NodeRecord[]>();
	const roots: NodeRecord[] = [];
	for (const node of nodes.values()) {
		if (node.parent === null || !nodes.has(node.parent)) {
			roots.push(node);
			continue;
		}
		const bucket = children.get(node.parent);
		if (bucket) bucket.push(node);
		else children.set(node.parent, [node]);
	}
	const bySeq = (a: NodeRecord, b: NodeRecord) => idOrder(a.id) - idOrder(b.id);
	roots.sort(bySeq);
	for (const bucket of children.values()) bucket.sort(bySeq);

	const rows: Row[] = [];
	const seen = new Set<string>();
	const walk = (node: NodeRecord, depth: number) => {
		if (seen.has(node.id)) return; // a cycle is a producer bug, not a hang
		seen.add(node.id);
		rows.push({ node, depth });
		for (const child of children.get(node.id) ?? []) walk(child, depth + 1);
	};
	for (const root of roots) walk(root, 0);
	return rows;
}

// ------------------------------------------------------------- run discovery

export interface RunHandle {
	topic: string;
	dir: string;
	logPath: string;
	mtimeMs: number;
	status: string;
}

export function discoverRuns(cwd: string): RunHandle[] {
	const runsDir = join(cwd, ".wayne", "runs");
	if (!existsSync(runsDir)) return [];
	const found: RunHandle[] = [];
	for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(runsDir, entry.name);
		const logPath = join(dir, "decision-log.jsonl");
		if (!existsSync(logPath)) continue;
		let status = "unknown";
		try {
			const first = readFileSync(logPath, "utf8").split("\n", 1)[0] ?? "";
			const meta = JSON.parse(first) as Partial<MetaRecord>;
			if (typeof meta.status === "string") status = meta.status;
		} catch {
			// A log too broken to read its meta line still deserves to be listed;
			// the panel shows the parse errors once it is selected.
		}
		found.push({ topic: entry.name, dir, logPath, mtimeMs: statSync(logPath).mtimeMs, status });
	}
	return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * The runs a design interview could currently be happening in.
 *
 * Recency is not the test. A `design-approved` run keeps its directory and can
 * easily be the most recently touched one, so picking by mtime silently pins
 * the panel to a finished design — which looks exactly like a live one.
 */
export function activeRuns(cwd: string): RunHandle[] {
	return discoverRuns(cwd).filter((r) => r.status === "in-progress");
}

// -------------------------------------------------------------- the component

type Mode = "list" | "search" | "detail";
type StatusFilter = "all" | "open" | "blocked" | "resolved" | "not-applicable";
type KindFilter = "all" | "choice" | "fact";
type Selection = { mode: "auto" | "manual"; topic: string | null };

const STATUS_CYCLE: StatusFilter[] = ["all", "open", "blocked", "resolved", "not-applicable"];
const KIND_CYCLE: KindFilter[] = ["all", "choice", "fact"];

const GLYPH: Record<NodeStatus, string> = {
	resolved: "●",
	open: "○",
	blocked: "◌",
	"not-applicable": "✕",
};

const STATUS_COLOR: Record<NodeStatus, "success" | "warning" | "error" | "dim"> = {
	resolved: "success",
	open: "warning",
	blocked: "error",
	"not-applicable": "dim",
};

export interface DagPanelCallbacks {
	/** Hand the keyboard back to whatever had it before the panel took focus. */
	onRelease: () => void;
	/**
	 * Whether the panel currently has anything worth occupying the screen with.
	 *
	 * The widget takes its lines out of the transcript, so a permanent "no run"
	 * box is a standing tax for saying nothing. Called only when the answer
	 * changes; the wiring registers or clears the widget in response.
	 */
	onPresenceChange: (present: boolean) => void;
}


export class DagPanel implements Component, Focusable {
	/**
	 * Set by the TUI when it focuses this panel. It is the browse mode: there is
	 * no second flag to drift from it, and no raw input listener to leave armed
	 * after focus has moved on.
	 */
	focused = false;

	private readonly theme: Theme;
	private readonly callbacks: DagPanelCallbacks;
	private readonly requestRender: () => void;

	private cwd = process.cwd();
	private run: RunHandle | null = null;
	private selection: Selection = { mode: "auto", topic: null };
	/** In-progress runs at the last scan. More than one is the ambiguous state. */
	private activeCount = 0;
	/** Last reported presence, so the wiring is only told when it flips. */
	private present = false;
	private state: LogState = emptyState();
	private rootWatcher: FSWatcher | null = null;
	private runsWatcher: FSWatcher | null = null;
	private debounce: ReturnType<typeof setTimeout> | null = null;

	private mode: Mode = "list";
	private query = "";
	private statusFilter: StatusFilter = "all";
	private kindFilter: KindFilter = "all";
	private showAnswers = true;
	private expanded = false;
	/**
	 * Keep the newest open node selected as the frontier moves.
	 *
	 * The log has no "currently being asked" field — the contract records only
	 * that several nodes are `open` — so this follows the highest canonical
	 * `N<number>` that is still open. That is the newest question raised, which
	 * is usually but not provably the one on screen. Any manual move turns it
	 * off, because the cursor then means what the reader chose, not a guess.
	 */
	private follow = true;
	private cursorId: string | null = null;
	private scroll = 0;
	private detailScroll = 0;

	constructor(theme: Theme, callbacks: DagPanelCallbacks, requestRender: () => void) {
		this.theme = theme;
		this.callbacks = callbacks;
		this.requestRender = requestRender;
	}

	// -- data ---------------------------------------------------------------

	/**
	 * Start following `<cwd>/.wayne/runs`.
	 *
	 * The directory usually does not exist yet: a design run creates it. So this
	 * also watches `cwd` for `.wayne` appearing and rebinds — without that, a run
	 * started mid-session never shows up on its own and the panel silently stays
	 * empty for the whole session it was meant to narrate.
	 */
	start(cwd: string): void {
		this.cwd = cwd;
		this.closeWatchers();
		if (existsSync(cwd)) {
			this.rootWatcher = watch(cwd, () => this.schedule());
		}
		this.bindRunsWatcher();
		this.rescan();
	}

	private bindRunsWatcher(): void {
		const runsDir = join(this.cwd, ".wayne", "runs");
		if (this.runsWatcher || !existsSync(runsDir)) return;
		// Recursive: one watcher covers both a write inside the selected run's
		// log and a brand new run directory appearing beside it.
		this.runsWatcher = watch(runsDir, { recursive: true }, () => this.schedule());
	}

	private schedule(): void {
		if (this.debounce) clearTimeout(this.debounce);
		this.debounce = setTimeout(() => {
			this.debounce = null;
			this.bindRunsWatcher();
			this.rescan();
		}, DEBOUNCE_MS);
	}

	/** Pin the panel to one run; `/dag-run` is the only caller. */
	pin(run: RunHandle): void {
		this.selection = { mode: "manual", topic: run.topic };
		this.rescan();
	}

	/**
	 * Re-decide which run the panel shows, then reload it.
	 *
	 * An `auto` selection attaches only when exactly one run is `in-progress`.
	 * Zero and many are both rendered as themselves rather than resolved by a
	 * tiebreak: a panel silently pinned to the wrong design is worse than one
	 * that says it does not know which you mean.
	 */
	private rescan(): void {
		const all = discoverRuns(this.cwd);
		const active = all.filter((r) => r.status === "in-progress");
		this.activeCount = active.length;

		const next =
			this.selection.mode === "manual"
				? (all.find((r) => r.topic === this.selection.topic) ?? null)
				: active.length === 1
					? active[0]!
					: null;

		if (next?.topic !== this.run?.topic) {
			this.mode = "list";
			this.cursorId = null;
			this.scroll = 0;
			this.detailScroll = 0;
			this.follow = true;
			if (this.selection.mode === "auto") this.selection.topic = next?.topic ?? null;
		}
		this.run = next;
		this.state = next ? this.read(next) : emptyState();
		this.applyFollow();

		// Ambiguity counts as present: two live runs is something you need to be
		// told, and it is the one state a hidden panel could not report.
		const present = next !== null || this.activeCount > 1;
		if (present !== this.present) {
			this.present = present;
			this.callbacks.onPresenceChange(present);
		}
		this.requestRender();
	}


	private read(run: RunHandle): LogState {
		try {
			return parseLog(readFileSync(run.logPath, "utf8"));
		} catch (err) {
			return { ...emptyState(), errors: [`cannot read log: ${(err as Error).message}`] };
		}
	}

	/** The newest still-open question, which is the frontier follow mode tracks. */
	private newestOpen(): string | null {
		let best: NodeRecord | null = null;
		for (const node of this.state.nodes.values()) {
			if (node.status !== "open") continue;
			if (!best || idOrder(node.id) > idOrder(best.id)) best = node;
		}
		return best?.id ?? null;
	}

	private applyFollow(): void {
		if (this.follow) {
			const target = this.newestOpen();
			if (target) this.cursorId = target;
		}
		// A cursor pointing at a row the current filter hides is a cursor the
		// reader cannot see or move off, so fall back to the first visible row.
		const rows = this.visibleRows();
		if (rows.length === 0) {
			this.cursorId = null;
			return;
		}
		if (!rows.some((r) => r.node.id === this.cursorId)) this.cursorId = rows[0]!.node.id;
	}

	/**
	 * Whether the widget is on screen.
	 *
	 * Focus must never be handed to this panel while it is false. pi's `setFocus`
	 * does not check that a component is mounted, so focusing a cleared widget
	 * routes every keystroke into something nobody can see — the editor stops
	 * responding and the session looks hung.
	 */
	get onScreen(): boolean {
		return this.present;
	}

	get attachedTopic(): string | null {
		return this.run?.topic ?? null;
	}

	get followingId(): string | null {
		return this.follow ? this.cursorId : null;
	}

	/**
	 * Called by the write tools so a resolution lands without waiting on inotify.
	 *
	 * It deliberately takes no node to select. Moving the cursor here and then
	 * letting the watcher's rescan move it again a moment later is the "jumping
	 * around" this panel must not do — and worse, it would overrule a reader who
	 * had parked the cursor somewhere on purpose. A write only refreshes; where
	 * the cursor belongs is `applyFollow`'s single answer, which both this call
	 * and the watcher compute identically, so it settles once. What changed is
	 * reported in the header instead, where it costs no movement.
	 */
	refreshNow(): void {
		this.rescan();
	}


	// -- selection ----------------------------------------------------------

	private get filtering(): boolean {
		return this.query !== "" || this.statusFilter !== "all" || this.kindFilter !== "all";
	}

	private matches(node: NodeRecord): boolean {
		if (this.statusFilter !== "all" && node.status !== this.statusFilter) return false;
		if (this.kindFilter !== "all" && node.kind !== this.kindFilter) return false;
		if (this.query === "") return true;
		const q = this.query.toLowerCase();
		if (node.id.toLowerCase().includes(q)) return true;
		if (node.decision.toLowerCase().includes(q)) return true;
		if (node.opens_when?.toLowerCase().includes(q)) return true;
		// Search reaches through `resolved_by` into the answer itself, which is
		// where the words you remember usually live.
		const d = node.resolved_by ? this.state.decisions.get(node.resolved_by) : undefined;
		if (!d) return false;
		return [d.question, d.decision, d.rationale, d.consequences ?? "", d.reference ?? ""]
			.join("\n")
			.toLowerCase()
			.includes(q);
	}

	/**
	 * Filtered results render flat, unfiltered results render as the tree.
	 *
	 * Indenting a filtered list would draw parent/child edges between rows that
	 * are only adjacent because everything between them was filtered out.
	 */
	private visibleRows(): Row[] {
		const rows = buildTree(this.state.nodes);
		if (!this.filtering) return rows;
		return rows.filter((r) => this.matches(r.node)).map((r) => ({ node: r.node, depth: 0 }));
	}

	private cursorIndex(rows: Row[]): number {
		const i = rows.findIndex((r) => r.node.id === this.cursorId);
		return i === -1 ? 0 : i;
	}

	private selected(): NodeRecord | null {
		const rows = this.visibleRows();
		return rows[this.cursorIndex(rows)]?.node ?? null;
	}

	// -- input --------------------------------------------------------------

	/**
	 * Keys arrive here because the TUI focused this panel, not because a raw
	 * input listener guessed. That is what makes the mode sticky: focus is held
	 * until something gives it back, so browsing does not silently lapse between
	 * keystrokes and `esc` inside a sub-view can mean "back" instead of "quit".
	 */
	handleInput(data: string): void {
		// How tall the panel is belongs to the panel, not to whichever view is
		// showing: a detail too long to read is exactly when you reach for `e`.
		if (data === "e" && this.mode !== "search") this.expanded = !this.expanded;
		else if (this.mode === "search") this.searchKey(data);
		else if (this.mode === "detail") this.detailKey(data);
		else this.listKey(data);
		this.requestRender();
	}


	private move(delta: number): void {
		const rows = this.visibleRows();
		if (rows.length === 0) return;
		const next = Math.min(rows.length - 1, Math.max(0, this.cursorIndex(rows) + delta));
		this.cursorId = rows[next]!.node.id;
		// Moving by hand means the reader chose this row; following would yank
		// it away on the next append.
		this.follow = false;
	}

	private listKey(data: string): void {
		// `j`/`k` are not a vim affectation, they are the reliable path. An
		// extension input listener runs BEFORE the focused component, and
		// pi-goal-x consumes plain arrows on the assumption that "the editor owns
		// ↑/↓" — true until another widget holds focus, which is exactly this
		// panel. Letters reach a focused component whatever else is loaded.
		if (matchesKey(data, Key.up) || data === "k") return this.move(-1);
		if (matchesKey(data, Key.down) || data === "j") return this.move(1);
		if (matchesKey(data, "pageUp") || data === "K") return this.move(-8);
		if (matchesKey(data, "pageDown") || data === "J") return this.move(8);
		if (matchesKey(data, Key.home) || data === "<") return this.move(-1e6);
		if (matchesKey(data, Key.end) || data === ">") return this.move(1e6);

		if (matchesKey(data, Key.enter)) {
			if (!this.selected()) return;
			this.mode = "detail";
			this.detailScroll = 0;
			return;
		}
		if (data === "/") {
			this.mode = "search";
			return;
		}
		if (data === "f") {
			this.statusFilter = STATUS_CYCLE[(STATUS_CYCLE.indexOf(this.statusFilter) + 1) % STATUS_CYCLE.length]!;
			return this.applyFollow();
		}
		if (data === "t") {
			this.kindFilter = KIND_CYCLE[(KIND_CYCLE.indexOf(this.kindFilter) + 1) % KIND_CYCLE.length]!;
			return this.applyFollow();
		}
		if (data === "a") {
			this.showAnswers = !this.showAnswers;
			return;
		}
		if (data === "g") {
			this.follow = true;
			return this.applyFollow();
		}
		if (data === "c") {
			this.query = "";
			this.statusFilter = "all";
			this.kindFilter = "all";
			return this.applyFollow();
		}
		// Only the top level gives the keyboard back, so `esc` in a sub-view can
		// mean "back" — which is what it means everywhere else.
		if (matchesKey(data, Key.escape)) this.callbacks.onRelease();
	}

	/**
	 * The search field lives in this widget rather than in a dialog.
	 *
	 * A dialog takes focus, and handing it back on submit lands it in the editor
	 * rather than here — you type a query and then find yourself outside the
	 * panel. Editing in place keeps one focus owner for the whole interaction.
	 */
	private searchKey(data: string): void {
		if (matchesKey(data, Key.enter)) {
			this.mode = "list";
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.query = "";
			this.mode = "list";
			return this.applyFollow();
		}
		if (matchesKey(data, Key.backspace)) {
			this.query = [...this.query].slice(0, -1).join("");
			return this.applyFollow();
		}
		// Anything printable, including a multi-byte CJK commit from an IME.
		if (data.length > 0 && data.charCodeAt(0) >= 32 && !data.startsWith("\x1b")) {
			this.query += data;
			this.follow = false;
			return this.applyFollow();
		}
	}

	private detailKey(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
			this.mode = "list";
			this.detailScroll = 0;
			return;
		}
		// Same reason as the list: an input listener elsewhere may swallow arrows.
		if (matchesKey(data, Key.up) || data === "k") this.detailScroll = Math.max(0, this.detailScroll - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.detailScroll += 1;
		else if (matchesKey(data, "pageUp") || data === "K") this.detailScroll = Math.max(0, this.detailScroll - 8);
		else if (matchesKey(data, "pageDown") || data === "J") this.detailScroll += 8;

	}

	/** Called when focus leaves, so a half-typed query does not sit there stale. */
	onBlurred(): void {
		this.mode = "list";
		this.requestRender();
	}


	// -- render -------------------------------------------------------------

	private get budget(): number {
		return this.expanded ? EXPANDED_LINES : COMPACT_LINES;
	}

	render(width: number): string[] {
		if (width < 24) return [truncateToWidth("dag", width)];
		const inner = width - 4;
		if (!this.run) return this.frame("mind-explode", this.renderNoRun(inner), width);
		const body = this.mode === "detail" ? this.renderDetail(inner) : this.renderList(inner);
		return this.frame(this.title(), body, width);
	}

	private title(): string {
		const bits = [this.run!.topic];
		if (this.focused) bits.push("· DAG MODE");
		if (this.follow) bits.push("· following");
		return bits.join(" ");
	}

	/**
	 * What the panel says when it is not showing a run.
	 *
	 * Ambiguity is reported as ambiguity. The alternative — pick the newest and
	 * hope — is the one failure mode a passive panel cannot recover from, since
	 * a wrong DAG reads exactly like a right one.
	 */
	private renderNoRun(inner: number): string[] {
		const th = this.theme;
		const wrap = (s: string) => wrapTextWithAnsi(s, inner).map((l) => th.fg("dim", l));
		if (this.activeCount > 1) {
			return [
				th.fg("warning", truncateToWidth(`${this.activeCount} runs are in-progress`, inner)),
				...wrap("Pick one with /dag-run — guessing would show you the wrong design."),
			];
		}
		if (this.selection.mode === "manual") return wrap(`Run "${this.selection.topic}" is gone. /dag-run to pick another.`);
		return wrap("No in-progress run. Start a wayne-mind-explode design, or /dag-run to open a finished one.");
	}

	private renderList(inner: number): string[] {
		const th = this.theme;
		const rows = this.visibleRows();
		const out: string[] = [this.headerLine(inner)];

		if (this.state.errors.length > 0) out.push(th.fg("error", truncateToWidth(`! ${this.state.errors[0]}`, inner)));
		if (this.mode === "search") {
			// CURSOR_MARKER tells the TUI where to park the hardware cursor, which
			// is what an IME anchors its candidate window to. It only works
			// because the panel really holds focus — which is also why the field
			// can live here instead of in a dialog that would take focus away.
			const caret = this.focused ? CURSOR_MARKER : "";
			const typed = truncateToWidth(`/${this.query}`, Math.max(4, inner - 12));
			out.push(th.fg("accent", typed) + caret + th.fg("accent", "▌") + th.fg("dim", `  (${rows.length})`));
		} else if (this.filtering) {
			const bits = [
				this.query ? `/${this.query}` : "",
				this.statusFilter !== "all" ? this.statusFilter : "",
				this.kindFilter !== "all" ? this.kindFilter : "",
			].filter(Boolean);
			out.push(th.fg("accent", truncateToWidth(`filter ${bits.join(" ")} (${rows.length})`, inner)));
		}

		out.push(th.fg("borderMuted", "─".repeat(inner)));

		// `out` so far, plus a separator and a hint, inside two border rows.
		const listBudget = Math.max(2, this.budget - out.length - 4);
		const cursor = this.cursorIndex(rows);
		// Half the window at most per field, so the selected row can wrap without
		// becoming the entire view and hiding the rows that give it context.
		const cap = Math.max(1, Math.floor((listBudget - 1) / 2));

		// Measured exactly as they will be drawn. Measuring the selected row
		// unwrapped and then drawing it wrapped is what pushed the highlight off
		// the bottom of the window: the budget said 2 lines, the render took 5.
		const heights = rows.map((r, i) => this.rowLines(r, inner, i === cursor, cap).length);

		// Extend backwards from the cursor while the window still fits, holding
		// back one line so the highlighted row is never flush against the hint
		// bar — a cursor on the last drawn line reads as a cursor that is gone.
		const lookahead = cursor < rows.length - 1 ? 1 : 0;
		const window = Math.max(1, listBudget - lookahead);
		let used = heights[cursor] ?? 0;
		let first = cursor;
		while (first > 0 && used + heights[first - 1]! <= window) {
			first--;
			used += heights[first]!;
		}
		this.scroll = Math.min(first, cursor);

		if (rows.length === 0) out.push(th.fg("dim", truncateToWidth("no matching nodes", inner)));
		let spent = 0;
		for (let i = this.scroll; i < rows.length; i++) {
			const lines = this.rowLines(rows[i]!, inner, i === cursor, cap);
			// Never emit half a row: a lone answer line reads as a decision with
			// no question attached.
			if (spent + lines.length > listBudget && spent > 0) break;
			for (const line of lines) out.push(line);
			spent += lines.length;
		}
		const drawn = this.countRows(rows, inner, listBudget, cursor, cap);
		const hidden = Math.max(0, rows.length - this.scroll - Math.max(1, drawn));
		out.push(th.fg("borderMuted", "─".repeat(inner)));
		out.push(this.hintLine(inner, hidden));
		return out;
	}

	/**
	 * How many rows actually fit, used only to report what is scrolled off.
	 *
	 * Takes the same `cursor` and `cap` the render used, because the selected row
	 * is a different height from the others and counting it wrong makes the
	 * "+N below" figure lie about how much is left.
	 */
	private countRows(rows: Row[], inner: number, budget: number, cursor: number, cap: number): number {
		let spent = 0;
		let n = 0;
		for (let i = this.scroll; i < rows.length; i++) {
			const h = this.rowLines(rows[i]!, inner, i === cursor, cap).length;
			if (spent + h > budget && spent > 0) break;
			spent += h;
			n++;
		}
		return n;
	}


	private headerLine(inner: number): string {
		const th = this.theme;
		const tally: Record<NodeStatus, number> = { resolved: 0, open: 0, blocked: 0, "not-applicable": 0 };
		for (const node of this.state.nodes.values()) tally[node.status]++;
		// A space between glyph and count: `●42` reads as one token at a glance,
		// and the whole point of the line is that the four numbers are separate.
		const counts = (Object.keys(tally) as NodeStatus[]).map((s) => th.fg(STATUS_COLOR[s], `${GLYPH[s]} ${tally[s]}`)).join("   ");
		const meta = this.state.meta;
		const gate = (label: string, on: boolean) => (on ? th.fg("success", `${label}✓`) : th.fg("dim", `${label}·`));
		const right = meta
			? `${gate("frontier", meta.frontier_locked)} ${gate("spec", meta.written_spec_approved)} ${th.fg("muted", meta.status)}`
			: th.fg("error", "no meta record");

		// The newest decision id, read from the log rather than remembered from a
		// tool call — this is how a write announces itself without moving the
		// cursor. Derived from the SSoT, so it is right after any kind of write.
		let newest = "";
		for (const id of this.state.decisions.keys()) {
			if (newest === "" || idOrder(id) > idOrder(newest)) newest = id;
		}
		const last = newest === "" ? "" : th.fg("dim", `   last ${newest}`);
		return truncateToWidth(`${counts}   ${right}${last}`, inner);

	}

	/**
	 * The answer a resolved node settled on, or null when there is none to show.
	 *
	 * `node.decision` names the QUESTION — the contract calls it "the unresolved
	 * fact or choice". The answer lives in the resolving `decision` record, so a
	 * tree built from node text alone shows every question this design asked and
	 * not one thing it decided, which is the opposite of what the panel is for.
	 * `resolved_by` may also cite another living spec as `<slug>:D<n>`, whose
	 * record is not in this log; that citation is shown as itself.
	 */
	private answerOf(node: NodeRecord): string | null {
		if (!node.resolved_by) return null;
		const local = this.state.decisions.get(node.resolved_by);
		if (local) return local.decision;
		return node.resolved_by.includes(":") ? `cited from ${node.resolved_by}` : `${node.resolved_by} missing from this log`;
	}

	/**
	 * One tree row: the question, and beneath it the answer when there is one.
	 *
	 * @param cap the most lines either field may wrap to. The caller derives it
	 * from the space left in the panel, so one very long question can never eat
	 * the whole view and hide the frontier it was supposed to be showing.
	 */
	private rowLines(row: Row, inner: number, selected = false, cap = 3): string[] {
		const th = this.theme;
		const { node, depth } = row;
		const kind = node.kind === "choice" ? "?" : "·";

		// A one-column bar on EVERY line of the selected row, not a marker on its
		// first. Once a row wraps, a marker that only appears on line one leaves
		// the continuation lines indistinguishable from the next node's — which
		// is exactly where a deep indent makes you lose the cursor.
		const bar = selected ? th.fg("accent", "▌") : " ";
		// Guides rather than blank indent, so depth stays traceable when the text
		// beside it is wrapping.
		const guidePlain = "│ ".repeat(Math.min(depth, 6));
		const guide = guidePlain === "" ? "" : th.fg("borderMuted", guidePlain);
		const headPlain = `${GLYPH[node.status]} ${node.id}${kind} `;
		const headWidth = 1 + visibleWidth(guidePlain) + visibleWidth(headPlain);
		const tone = selected ? "accent" : "text";

		// Wrap the row you are actually reading; leave the rest one line each.
		// Wrapping all 43 nodes of a real log would leave three of them on
		// screen, which trades the thing the panel is for against the thing it
		// was already doing well.
		const wrapping = selected || this.expanded;

		/** Wrapped and capped, with the cut marked so a clipped row admits it. */
		const fit = (value: string, width: number): string[] => {
			if (!wrapping) return [truncateToWidth(value, width, "…")];
			const all = wrapTextWithAnsi(value, width);
			if (all.length <= cap) return all;
			const kept = all.slice(0, cap);
			kept[cap - 1] = truncateToWidth(`${kept[cap - 1]} …`, width);
			return kept;
		};

		const lines: string[] = [];
		const question = fit(node.decision, Math.max(8, inner - headWidth));
		lines.push(truncateToWidth(bar + guide + th.fg(STATUS_COLOR[node.status], headPlain) + th.fg(tone, question[0] ?? ""), inner));
		for (const cont of question.slice(1)) {
			lines.push(truncateToWidth(bar + " ".repeat(headWidth - 1) + th.fg(tone, cont), inner));
		}

		if (!this.showAnswers) return lines;
		const answer = this.answerOf(node);
		if (answer === null) return lines;
		const stemPlain = `${guidePlain}  ↳ `;
		const stemWidth = 1 + visibleWidth(stemPlain);
		const body = fit(answer, Math.max(8, inner - stemWidth));
		lines.push(truncateToWidth(bar + guide + th.fg("dim", "  ↳ ") + th.fg("success", body[0] ?? ""), inner));
		for (const cont of body.slice(1)) {
			lines.push(truncateToWidth(bar + " ".repeat(stemWidth - 1) + th.fg("success", cont), inner));
		}
		return lines;


	}

	private hintLine(inner: number, hidden: number): string {
		const th = this.theme;
		const more = hidden > 0 ? th.fg("muted", `  +${hidden} below`) : "";
		if (!this.focused) return truncateToWidth(th.fg("dim", "/dag or alt+g to browse") + more, inner);
		if (this.mode === "search") return truncateToWidth(th.fg("dim", "↵ apply  esc clear") + more, inner);
		const keys = `↑↓ move  ↵ detail  / search  f status  t kind  a answers${this.showAnswers ? "✓" : "·"}  g follow  e ${this.expanded ? "shrink" : "expand"}  c clear  esc type`;
		return truncateToWidth(th.fg("dim", keys) + more, inner);
	}

	private renderDetail(inner: number): string[] {
		const th = this.theme;
		const node = this.selected();
		if (!node) return [th.fg("dim", "nothing selected")];

		const lines: string[] = [];
		const field = (label: string, value: string | null) => {
			if (value === null || value === "") return;
			lines.push(th.fg("accent", label));
			for (const l of wrapTextWithAnsi(value, inner)) lines.push(th.fg("text", l));
			lines.push("");
		};

		lines.push(th.fg(STATUS_COLOR[node.status], `${GLYPH[node.status]} ${node.id}  ${node.kind}  ${node.status}`));
		lines.push("");
		field("node", node.decision);
		field("parent", node.parent);
		field("opens when", node.opens_when);

		if (node.resolved_by) {
			const d = this.state.decisions.get(node.resolved_by);
			if (!d) lines.push(th.fg("error", `resolved_by ${node.resolved_by} — not in this log`));
			else {
				lines.push(th.fg("borderMuted", "─".repeat(inner)));
				lines.push(th.fg("accent", `${d.id}  source:${d.source}`));
				lines.push("");
				field("question", d.question);
				field("decision", d.decision);
				field("rationale", d.rationale);
				field("consequences", d.consequences);
				field("reference", d.reference);
				field("supersedes", d.supersedes.length > 0 ? d.supersedes.join(", ") : null);
			}
		} else lines.push(th.fg("warning", "unresolved"));

		const viewport = Math.max(2, this.budget - 4);
		this.detailScroll = Math.min(this.detailScroll, Math.max(0, lines.length - viewport));
		const page = lines.slice(this.detailScroll, this.detailScroll + viewport);
		page.push(th.fg("borderMuted", "─".repeat(inner)));
		const left = Math.max(0, lines.length - this.detailScroll - viewport);
		page.push(th.fg("dim", truncateToWidth(`↑↓ scroll${left > 0 ? ` (+${left})` : ""}  esc back`, inner)));
		return page;
	}

	/**
	 * Draw the border.
	 *
	 * `render()` must not emit a line wider than `width`, so padding is computed
	 * from `visibleWidth` and every line is truncated as a backstop — one
	 * miscounted glyph would otherwise corrupt the whole transcript.
	 */
	private frame(title: string, body: string[], width: number): string[] {
		const th = this.theme;
		const inner = width - 4;
		const clipped = truncateToWidth(title, Math.max(4, inner - 4));
		// ┌ ─ SPACE title SPACE fill ┐  =  5 + title + fill
		const fill = Math.max(0, width - 5 - visibleWidth(clipped));
		const out = [th.fg("border", "┌─ ") + th.fg("borderAccent", clipped) + th.fg("border", ` ${"─".repeat(fill)}┐`)];
		for (const line of body) {
			const fit = visibleWidth(line) > inner ? truncateToWidth(line, inner) : line;
			out.push(`${th.fg("border", "│")} ${fit}${" ".repeat(Math.max(0, inner - visibleWidth(fit)))} ${th.fg("border", "│")}`);
		}
		out.push(th.fg("border", `└${"─".repeat(width - 2)}┘`));
		return out;
	}

	invalidate(): void {}

	private closeWatchers(): void {
		this.rootWatcher?.close();
		this.runsWatcher?.close();
		this.rootWatcher = null;
		this.runsWatcher = null;
	}

	/**
	 * Deliberately empty.
	 *
	 * pi calls `dispose()` every time the widget is cleared, and the widget is
	 * cleared whenever there is no run to show. Releasing the watcher here would
	 * mean the panel goes away the first time it is idle and never notices the
	 * run that starts afterwards. Teardown is `shutdown()`, on session end.
	 */
	dispose(): void {}

	shutdown(): void {
		if (this.debounce) clearTimeout(this.debounce);
		this.closeWatchers();
	}

}

// ------------------------------------------------------------- the write path

/**
 * Serialisers.
 *
 * Key order follows the contract's table. Nothing else in the file is touched
 * by a write: unrelated lines are carried through byte-exact, so a rewrite can
 * never quietly reformat a record it did not mean to change.
 */
const nodeLine = (n: NodeRecord): string =>
	JSON.stringify({ type: "node", id: n.id, parent: n.parent, kind: n.kind, decision: n.decision, status: n.status, opens_when: n.opens_when, resolved_by: n.resolved_by });

const decisionLine = (d: DecisionRecord): string =>
	JSON.stringify({ type: "decision", id: d.id, question: d.question, decision: d.decision, rationale: d.rationale, consequences: d.consequences, supersedes: d.supersedes, source: d.source, reference: d.reference });

const nextId = (prefix: string, ids: Iterable<string>): string => {
	let max = 0;
	for (const id of ids) {
		const n = idOrder(id);
		if (n !== Number.MAX_SAFE_INTEGER && n > max) max = n;
	}
	return `${prefix}${max + 1}`;
};

/** `null` for the sources that already locate their own answer; required otherwise. */
const SELF_LOCATING_SOURCES = new Set(["user", "constraint", "default"]);

export interface OpenedChild {
	kind: "fact" | "choice";
	decision: string;
	status?: "open" | "blocked";
	opens_when?: string | null;
}

export interface ResolveInput {
	node_id: string;
	question: string;
	decision: string;
	rationale: string;
	consequences?: string | null;
	supersedes?: string[];
	source: string;
	reference?: string | null;
	opens?: OpenedChild[];
}

export type WriteResult = { ok: true; text: string; decisionId: string; childIds: string[] } | { ok: false; reason: string };

/**
 * Resolve one node as a single write event.
 *
 * The contract is explicit that appending the decision, rewriting the node, and
 * appending the children it opened are ONE event — so this produces the whole
 * new file contents and the caller renames it into place. Doing it as three
 * writes would leave the log readable in a state the design never passed
 * through: a decision recorded against a node still marked open.
 */
/**
 * Refuse to write a log that already breaks the contract.
 *
 * The reader is deliberately forgiving — last line wins per id, so a
 * half-applied rewrite still renders. A writer cannot inherit that: "every
 * `D<number>` and every `N<number>` appears at most once" is the invariant the
 * next write's id allocation depends on, and rewriting "the" node line when
 * there are two of them silently picks one meaning out of an ambiguous file.
 */
function contractViolation(raw: string): string | null {
	const seen = new Map<string, number>();
	const lines = raw.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i]!.trim();
		if (trimmed === "") continue;
		let rec: { type?: string; id?: string };
		try {
			rec = JSON.parse(trimmed) as { type?: string; id?: string };
		} catch {
			return `line ${i + 1} is not JSON`;
		}
		if (rec.type === "meta") {
			if (i !== 0) return `a meta record on line ${i + 1}; it belongs on the first line and nowhere else`;
			continue;
		}
		if (typeof rec.id !== "string") continue;
		const key = `${rec.type}:${rec.id}`;
		const first = seen.get(key);
		if (first !== undefined) return `${rec.id} appears on both line ${first} and line ${i + 1}; ids are unique`;
		seen.set(key, i + 1);
	}
	return null;
}

export function applyResolution(raw: string, input: ResolveInput): WriteResult {
	const state = parseLog(raw);
	if (state.errors.length > 0) return { ok: false, reason: `log has malformed lines: ${state.errors.join("; ")}` };
	if (!state.meta) return { ok: false, reason: "log has no meta record" };
	const violation = contractViolation(raw);
	if (violation) return { ok: false, reason: `refusing to write: ${violation}` };


	const node = state.nodes.get(input.node_id);
	if (!node) return { ok: false, reason: `no node ${input.node_id} in this log` };
	if (node.status === "resolved") {
		// Reversing a settled decision is a new record naming the old one in
		// `supersedes`, never a silent re-resolve of the same node.
		return { ok: false, reason: `${node.id} is already resolved by ${node.resolved_by}; reverse it with a new decision that supersedes it` };
	}

	const reference = input.reference ?? null;
	if (!SELF_LOCATING_SOURCES.has(input.source) && reference === null) {
		return { ok: false, reason: `source=${input.source} must cite a reference; only user, constraint and default locate their own answer` };
	}
	if (input.source === "web" && !/^https?:\/\//.test(reference ?? "")) {
		return { ok: false, reason: "a web decision must carry a reopenable http(s) URL" };
	}
	const supersedes = input.supersedes ?? [];
	for (const id of supersedes) {
		if (!state.decisions.has(id)) return { ok: false, reason: `supersedes names ${id}, which is not in this log` };
	}

	const decision: DecisionRecord = {
		type: "decision",
		id: nextId("D", state.decisions.keys()),
		question: input.question,
		decision: input.decision,
		rationale: input.rationale,
		consequences: input.consequences ?? null,
		supersedes,
		source: input.source,
		reference,
	};

	const children: NodeRecord[] = [];
	const takenNodeIds = new Set(state.nodes.keys());
	for (const child of input.opens ?? []) {
		const id = nextId("N", takenNodeIds);
		takenNodeIds.add(id);
		children.push({
			type: "node",
			id,
			parent: node.id,
			kind: child.kind,
			decision: child.decision,
			status: child.status ?? "open",
			opens_when: child.opens_when ?? null,
			resolved_by: null,
		});
	}

	const resolvedNode: NodeRecord = { ...node, status: "resolved", resolved_by: decision.id };
	const lines = raw.split("\n");
	let replaced = false;
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i]!.trim();
		if (trimmed === "") continue;
		try {
			const rec = JSON.parse(trimmed) as { type?: string; id?: string };
			if (rec.type === "node" && rec.id === node.id) {
				lines[i] = nodeLine(resolvedNode);
				replaced = true;
			}
		} catch {
			return { ok: false, reason: `line ${i + 1} is not JSON; refusing to rewrite a log it cannot read` };
		}
	}
	if (!replaced) return { ok: false, reason: `node ${node.id} parsed but its line was not found; log is inconsistent` };

	const body = lines.filter((l, i) => l.trim() !== "" || i < lines.length - 1).join("\n").replace(/\n+$/, "");
	const appended = [decisionLine(decision), ...children.map(nodeLine)];
	return { ok: true, text: `${[body, ...appended].join("\n")}\n`, decisionId: decision.id, childIds: children.map((c) => c.id) };
}

export interface UpsertInput {
	id?: string;
	parent?: string | null;
	kind: "fact" | "choice";
	decision: string;
	status?: "open" | "blocked" | "not-applicable";
	opens_when?: string | null;
}

/** Create or amend one unresolved frontier node. Resolution is the other tool. */
export function applyUpsert(raw: string, input: UpsertInput): WriteResult {
	const state = parseLog(raw);
	if (state.errors.length > 0) return { ok: false, reason: `log has malformed lines: ${state.errors.join("; ")}` };
	if (!state.meta) return { ok: false, reason: "log has no meta record" };
	const violation = contractViolation(raw);
	if (violation) return { ok: false, reason: `refusing to write: ${violation}` };

	const parent = input.parent ?? null;
	if (parent !== null && !state.nodes.has(parent)) return { ok: false, reason: `parent ${parent} is not in this log` };

	const existing = input.id ? state.nodes.get(input.id) : undefined;
	if (input.id && !existing) return { ok: false, reason: `no node ${input.id} to amend; omit id to create one` };
	if (existing?.status === "resolved") return { ok: false, reason: `${existing.id} is resolved; a resolved node is never silently reopened` };

	const node: NodeRecord = {
		type: "node",
		id: existing?.id ?? nextId("N", state.nodes.keys()),
		parent,
		kind: input.kind,
		decision: input.decision,
		status: input.status ?? "open",
		opens_when: input.opens_when ?? null,
		resolved_by: null,
	};

	const lines = raw.split("\n");
	let replaced = false;
	if (existing) {
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i]!.trim();
			if (trimmed === "") continue;
			try {
				const rec = JSON.parse(trimmed) as { type?: string; id?: string };
				if (rec.type === "node" && rec.id === existing.id) {
					lines[i] = nodeLine(node);
					replaced = true;
				}
			} catch {
				return { ok: false, reason: `line ${i + 1} is not JSON; refusing to rewrite a log it cannot read` };
			}
		}
		if (!replaced) return { ok: false, reason: `node ${existing.id} parsed but its line was not found` };
	}

	const body = lines.join("\n").replace(/\n+$/, "");
	const text = existing ? `${body}\n` : `${body}\n${nodeLine(node)}\n`;
	return { ok: true, text, decisionId: "", childIds: [node.id] };
}


// ------------------------------------------------------------------ wiring

export default function mindExplodeDagExtension(pi: ExtensionAPI) {
	let panel: DagPanel | null = null;
	let renderer: TUI | null = null;
	/** What had the keyboard before the panel took it, so it can be handed back. */
	let previousFocus: Component | null = null;

	/**
	 * `getFocusedComponent` is on the concrete TUI base rather than the `TUI`
	 * interface — pi's own mode switch calls it the same way. Checked once, here,
	 * because a panel that can take focus but not give it back would strand the
	 * editor, and that is worth refusing at mount rather than discovering later.
	 */
	const focusOwner = (tui: TUI): Component | null => {
		const get = (tui as unknown as { getFocusedComponent?: () => Component | null }).getFocusedComponent;
		if (typeof get !== "function") throw new Error("dag panel: this pi build cannot report the focused component; refusing to steal focus");
		return get.call(tui);
	};

	const release = () => {
		panel?.onBlurred();
		renderer?.setFocus(previousFocus);
		previousFocus = null;
	};

	/**
	 * Register or clear the widget without ever rebuilding the panel.
	 *
	 * The same instance goes back in every time, because it owns the watcher and
	 * the cursor. pi disposes whatever it holds when a widget is cleared, so a
	 * factory that constructed a fresh panel here would restart the watcher and
	 * lose your place every time a run finished.
	 */
	const setPresence = (ctx: ExtensionContext, present: boolean) => {
		if (!present && panel?.focused) release();
		ctx.ui.setWidget(WIDGET_KEY, present && panel ? () => panel! : undefined, { placement: "aboveEditor" });
	};

	const mount = (ctx: ExtensionContext) => {
		if (panel) return panel;
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui: TUI, theme: Theme) => {
				renderer = tui;
				panel = new DagPanel(
					theme,
					{ onRelease: release, onPresenceChange: (present) => setPresence(ctx, present) },
					() => tui.requestRender(),
				);
				return panel;
			},
			// Above the editor, which puts it in pi's vertical layout: the
			// transcript shrinks by exactly these lines instead of being covered.
			{ placement: "aboveEditor" },
		);
		// Nothing has been scanned yet, so the panel would render its "no run"
		// state. Clear it now and let the first presence report put it back.
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return panel;
	};


	/** Toggle browse mode. Focus IS the mode, so there is no second flag. */
	const toggle = (ctx: ExtensionContext) => {
		const p = mount(ctx);
		if (!p) throw new Error("dag panel: widget factory did not run");
		if (!renderer) throw new Error("dag panel: no renderer");
		if (p.focused) return release();
		// Refuse rather than focus a widget that is not on screen. pi's setFocus
		// accepts an unmounted component, and the result is a session that eats
		// every keystroke with nothing visible to explain why.
		if (!p.onScreen) {
			ctx.ui.notify("No in-progress mind-explode run to browse. /dag-run opens a finished one.", "warning");
			return;
		}
		previousFocus = focusOwner(renderer);
		renderer.setFocus(p);
		renderer.requestRender();
	};


	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		// Mount unconditionally to obtain the renderer and start watching, then
		// let the panel's own presence report decide whether it stays on screen.
		// `.wayne/runs` usually does not exist yet — the design run creates it.
		const p = mount(ctx);
		p?.start(ctx.cwd);
	});

	pi.on("session_shutdown", () => {
		// The real teardown. `dispose()` cannot do it: pi disposes the component
		// every time the widget is hidden, and the watcher has to outlive that.
		panel?.shutdown();
	});

	pi.registerShortcut("alt+g", {
		description: "Browse the mind-explode decision DAG",
		handler: (ctx) => toggle(ctx),
	});

	pi.registerCommand("dag", {
		description: "Browse the mind-explode decision DAG (esc returns to typing)",
		handler: async (_args, ctx) => toggle(ctx),
	});

	pi.registerCommand("dag-run", {
		description: "Pin the DAG panel to a specific mind-explode run",
		handler: async (_args, ctx) => {
			const runs = discoverRuns(ctx.cwd);
			if (runs.length === 0) {
				ctx.ui.notify("No .wayne/runs/<topic>/decision-log.jsonl found", "warning");
				return;
			}
			const labels = runs.map((r) => `${r.topic}  [${r.status}]`);
			const picked = await ctx.ui.select("Mind-explode run", labels);
			if (picked === undefined) return;
			const run = runs[labels.indexOf(picked)];
			if (!run) return;
			const p = mount(ctx);
			p?.pin(run);
		},
	});

	// -- write tools --------------------------------------------------------

	/**
	 * Which log a write targets.
	 *
	 * The same rule the panel shows: exactly one `in-progress` run, or whatever
	 * `/dag-run` pinned. Ambiguity is refused rather than resolved — writing a
	 * decision into the wrong design is not recoverable by reading the error.
	 */
	const targetRun = (cwd: string): { run: RunHandle } | { error: string } => {
		const pinned = panel?.attachedTopic;
		if (pinned) {
			const run = discoverRuns(cwd).find((r) => r.topic === pinned);
			if (run) return { run };
		}
		const active = activeRuns(cwd);
		if (active.length === 1) return { run: active[0]! };
		if (active.length === 0) return { error: "no in-progress mind-explode run in this project; seed .wayne/runs/<topic>/decision-log.jsonl first" };
		return { error: `${active.length} runs are in-progress (${active.map((r) => r.topic).join(", ")}); pin one with /dag-run before recording decisions` };
	};

	/**
	 * Write the whole file, then rename it over the original.
	 *
	 * The contract calls a resolution ONE write event. A reader that catches the
	 * file mid-append would see a decision recorded against a node still marked
	 * open — a state the design never passed through. Rename is atomic within a
	 * directory, so the temp file is created beside the log rather than in /tmp.
	 */
	const commit = (logPath: string, text: string) => {
		const tmp = `${logPath}.${process.pid}.tmp`;
		writeFileSync(tmp, text, "utf8");
		renameSync(tmp, logPath);
		panel?.refreshNow();
	};

	/**
	 * A rejection is thrown, not returned.
	 *
	 * `AgentToolResult` has no error flag; pi's convention is to throw, and the
	 * agent reads the message and corrects itself inside the same turn. That
	 * feedback loop is the whole reason these writes go through a tool — the
	 * enforcement that matters is still the server re-validating the log.
	 */
	// The explicit annotation is load-bearing: TypeScript only narrows past a
	// never-returning call when the declaration itself is typed.
	const reject: (reason: string) => never = (reason) => {
		throw new Error(`rejected: ${reason}`);
	};
	const accepted = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

	pi.registerTool({
		name: "wayne_resolve_decision",
		label: "Resolve decision",
		description:
			"Resolve one open node of the wayne-mind-explode decision DAG as a single atomic write: append the next " +
			"consecutive decision record, rewrite that node to resolved naming it, and append every child question the " +
			"answer opened. Allocates the D and N numbers itself — never pass them. Reversing an already-resolved node " +
			"is a NEW call on a new node naming the old decision in `supersedes`, never a re-resolve.",
		promptSnippet: "Record one resolved wayne-mind-explode decision and the questions it opened",
		promptGuidelines: [
			"Use wayne_resolve_decision to record every decision of a wayne-mind-explode design run; never write, edit, or shell-append to decision-log.jsonl by hand once the run's log exists, because the id allocation and the single-write-event rule live in the tool.",
			"Use wayne_upsert_decision_node to seed a root question or add an unresolved one; wayne_resolve_decision is only for answering a node that already exists.",
			"When calling wayne_resolve_decision, put every consequence the answer opened into `opens` in the same call — a child added by a later separate call was not part of that write event.",
		],
		parameters: Type.Object({
			node_id: Type.String({ description: "The N<number> being resolved. It must exist and must not already be resolved." }),
			question: Type.String({ description: "What was being decided." }),
			decision: Type.String({ description: "The answer." }),
			rationale: Type.String({ description: "Why this answer beat the alternative." }),
			consequences: Type.Union([Type.String(), Type.Null()], {
				description: "The cost this decision accepts — what it makes harder, slower or irreversible. Never a restatement of rationale, and never the follow-up questions (those are `opens`). null only when it truly accepts no cost, which is rare.",
			}),
			source: Type.Union(
				[Type.Literal("user"), Type.Literal("codebase"), Type.Literal("web"), Type.Literal("constraint"), Type.Literal("default"), Type.Literal("review")],
				{ description: "Where the answer came from." },
			),
			reference: Type.Optional(
				Type.Union([Type.String(), Type.Null()], {
					description: "Where to reopen the answer: a repo-relative path for codebase, an http(s) URL for web, a report for review. Only user, constraint and default may leave it null.",
				}),
			),
			supersedes: Type.Optional(Type.Array(Type.String(), { description: "D<number>s this reverses. Each must already exist in the log." })),
			opens: Type.Optional(
				Type.Array(
					Type.Object({
						kind: Type.Union([Type.Literal("fact"), Type.Literal("choice")]),
						decision: Type.String({ description: "Names the unresolved fact or choice. Never empty." }),
						status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("blocked")])),
						opens_when: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "The activation predicate only, for a blocked child." })),
					}),
					{ description: "Questions this answer made reachable. They become children of the resolved node." },
				),
			),
		}),
		executionMode: "sequential",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const target = targetRun(ctx.cwd);
			if ("error" in target) reject(target.error);
			const raw = readFileSync(target.run.logPath, "utf8");
			const result = applyResolution(raw, params as ResolveInput);
			if (!result.ok) reject(result.reason);
			commit(target.run.logPath, result.text);
			const opened = result.childIds.length > 0 ? `; opened ${result.childIds.join(", ")}` : "";
			return accepted(`${result.decisionId} recorded, ${(params as ResolveInput).node_id} resolved${opened}`);
		},
	});

	pi.registerTool({
		name: "wayne_upsert_decision_node",
		label: "Upsert question node",
		description:
			"Create or amend ONE unresolved node of the wayne-mind-explode decision DAG. Omit `id` to create, pass it to " +
			"amend. It is a GRAPH: a question raised while answering another sets `parent` to that node, and leaving " +
			"parent unset everywhere flattens it into a list, losing the one thing a later reader cannot reconstruct — " +
			"which question led to which. Resolving is wayne_resolve_decision; this tool never resolves.",
		promptSnippet: "Create or amend one unresolved wayne-mind-explode question node",
		parameters: Type.Object({
			id: Type.Optional(Type.String({ description: "N<number> to amend. Omit to create a new node; the number is allocated for you." })),
			parent: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "The node this question was raised while answering. null for a root." })),
			kind: Type.Union([Type.Literal("fact"), Type.Literal("choice")], {
				description: "`fact` is answerable from evidence; `choice` needs the user because it concerns intent, priority, risk, scope or a trade-off.",
			}),
			decision: Type.String({ description: "Names the unresolved fact or choice. Never empty." }),
			status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("blocked"), Type.Literal("not-applicable")])),
			opens_when: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "The activation predicate only, when the node is blocked." })),
		}),
		executionMode: "sequential",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const target = targetRun(ctx.cwd);
			if ("error" in target) reject(target.error);
			const raw = readFileSync(target.run.logPath, "utf8");
			const result = applyUpsert(raw, params as UpsertInput);
			if (!result.ok) reject(result.reason);
			commit(target.run.logPath, result.text);
			return accepted(`node ${result.childIds[0]} is now ${(params as UpsertInput).status ?? "open"}`);
		},
	});
}

