/**
 * The Tern layer: the Teams and Outlook overlays described as native Tern
 * nodes instead of drawn as terminal rows.
 *
 * In a Tern pane omp speaks the Tern Surface Protocol (TSP): a component that
 * has `describe(cx)` hands Tern a tree of semantic nodes (lists, markdown,
 * inputs, keycaps), and Tern draws them with its own controls. A component
 * without `describe` is shipped as pre-rendered rows inside a frame Tern
 * labels "fallback". Off Tern, or in pi, nobody calls `describe`: `render()`
 * stays the only path there.
 *
 * Only the drawing moves. Keys still arrive through `handleInput`, so every
 * shortcut works the same. Pointer actions on the native nodes come back
 * through `handleNativeEvent` and are routed to the same code paths as the
 * matching keys.
 *
 * The node shapes are the wire contract of omp 18.13 (`@oh-my-pi/pi-wire`,
 * `tsp.ts`). They are built here as plain objects, so the package needs no
 * omp import and still loads in pi.
 */

/** One styled run: `s` holds space-separated tokens (`muted`, `dim`, `strong`, `accent`, `warning`, `error`, `success`, `mark`, `link`). */
export interface Span {
	t: string;
	s?: string;
	href?: string;
}

export type Text = string | readonly Span[];

/** A described node, as omp's reconciler takes it: kind, props, children, sibling key. */
export interface NativeNode {
	k: string;
	p?: Record<string, unknown>;
	c?: readonly NativeNode[];
	key?: string;
	/** Bump `n` to scroll the scroller holding this node by `by` (TSP `scroll`). */
	scroll?: { by: "line-up" | "line-down" | "page-up" | "page-down" | "start" | "end"; n: number };
	/** Scroll the node into view when it is added, or whenever `n` changes. */
	reveal?: "start" | "end" | "nearest" | { at: "start" | "end" | "nearest"; n: number };
}

/** What omp hands `describe`; only `supports` is used here. */
export interface DescribeContext {
	readonly cols: number;
	supports(kind: string): boolean;
}

/** A pointer action on a described node, routed back by omp. */
export type NativeUiEvent =
	| { type: "select" | "activate"; key: string; item: string }
	| { type: "action"; key: string; act: string }
	| { type: "edit"; key: string; from: number; to: number; text: string; cursor: number; len: number }
	| { type: string; key: string };

/**
 * The `overlay` wrapper's props. `role` must start with `omp.overlay.`: Tern
 * draws those as its glass sheet, so the component must not draw a frame of its
 * own. `size: "full"` spans the pane.
 */
export interface OverlayProps {
	role: string;
	head: Text;
	size: "full";
}

export function overlayProps(name: string, head: Text): OverlayProps {
	return { role: `omp.overlay.${name}`, head, size: "full" };
}

export function span(t: string, s?: string): Span {
	return s === undefined ? { t } : { t, s };
}

export function node(k: string, p?: Record<string, unknown>, c?: readonly NativeNode[], key?: string): NativeNode {
	const n: NativeNode = { k };
	if (p !== undefined) n.p = p;
	if (c !== undefined) n.c = c;
	if (key !== undefined) n.key = key;
	return n;
}

export function text(content: Text, p?: Record<string, unknown>, key?: string): NativeNode {
	return node("text", typeof content === "string" ? { ...p, text: content } : { ...p, spans: content }, undefined, key);
}

export const col = (c: readonly NativeNode[], p?: Record<string, unknown>, key?: string): NativeNode => node("col", p, c, key);
export const row = (c: readonly NativeNode[], p?: Record<string, unknown>, key?: string): NativeNode => node("row", p, c, key);
export const md = (source: string, key?: string): NativeNode => node("md", { text: source }, undefined, key);

/**
 * Markdown with every `$` outside code escaped. Tern's Markdown reads `$…$` as
 * TeX and pi's does not; mail and chat text is never TeX, while `$HOME` in a code
 * span must stay as written (a backslash there is literal).
 */
export function mdNoMath(source: string): string {
	return source
		.split(/(```[\s\S]*?```|`[^`\n]*`)/)
		.map((part, i) => (i % 2 === 1 ? part : part.replace(/\$/g, "\\$")))
		.join("");
}

/** A node key for an arbitrary identity: keys join into `/` keypaths, so identities are hashed (as omp's own `stableKey`). */
export function stableKey(identity: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < identity.length; i++) h = Math.imul(h ^ identity.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(36);
}

/**
 * A selectable list: click selects, double-click activates. `selected` is the
 * key of the highlighted item; Tern scrolls it into view.
 */
export function selectList(key: string, items: readonly NativeNode[], selected: string | null, p?: Record<string, unknown>): NativeNode {
	return node("list", { ...p, selected, actions: { click: "select", dblclick: "activate" } }, items, key);
}

export function item(key: string, p: { label: Text; detail?: Text; value?: Text; icon?: string; tone?: string }): NativeNode {
	return node("item", p, undefined, key);
}

/**
 * A footer strip of keycaps with muted labels. `keys` are pi key ids
 * (`"ctrl+f"`, `"escape"`); Tern draws its own glyphs for them.
 */
export function hints(list: readonly { keys: readonly string[]; label: string }[], key = "hints"): NativeNode {
	return node(
		"row",
		{ gap: "md", wrap: true, role: "omp.overlay.hints" },
		list.map(({ keys, label }) =>
			row([...keys.map((k) => node("kbd", { keys: k === "+" ? ["+"] : k.split("+") })), text([span(label, "muted")])], {
				gap: "xs",
				align: "center",
			}),
		),
		key,
	);
}

/** A button: a click sends `act` back as an `action` event, routed to the same path as its key. */
export function button(label: string, act: string, keys?: string): NativeNode {
	const c: NativeNode[] = [text(label)];
	if (keys) c.push(node("kbd", { keys: keys.split("+") }));
	return node("row", { role: "omp.btn", gap: "xs", align: "center", actions: { click: act }, title: label }, c, act);
}

/**
 * A text field. The caret is a UTF-16 offset into `value`. Tern draws the caret
 * and the IME, and focuses the first field a focused overlay describes, so keys
 * typed while it is focused still reach `handleInput`.
 */
export function input(value: string, cursor: number, p?: { placeholder?: Text; prompt?: Text }, key = "input"): NativeNode {
	return node("input", { text: value, cursor, sendable: false, ...p }, undefined, key);
}

/** A multi-line text field (the composer). */
export function editor(value: string, cursor: number, p?: { placeholder?: Text; prompt?: Text; maxLines?: number }, key = "editor"): NativeNode {
	return node("editor", { text: value, cursor, sendable: false, ...p }, undefined, key);
}

/** UTF-16 offset of the `chars`-th code point of `s`: the extensions count carets in code points, TSP in UTF-16 units. */
export function utf16Offset(s: string, chars: number): number {
	let off = 0;
	let n = 0;
	for (const ch of s) {
		if (n === chars) break;
		off += ch.length;
		n++;
	}
	return off;
}

/** Code-point index of the UTF-16 offset `off` in `s` (the inverse of {@link utf16Offset}). */
export function charIndex(s: string, off: number): number {
	let o = 0;
	let n = 0;
	for (const ch of s) {
		if (o >= off) break;
		o += ch.length;
		n++;
	}
	return n;
}

/**
 * A memo for `describe`: omp's reconciler skips a component whose node is the
 * same object as last frame, so rebuild only when `sig` changed.
 */
export function memo(): (sig: string, build: () => NativeNode) => NativeNode {
	let lastSig: string | undefined;
	let last: NativeNode | undefined;
	return (sig, build) => {
		if (last && sig === lastSig) return last;
		lastSig = sig;
		last = build();
		return last;
	};
}
