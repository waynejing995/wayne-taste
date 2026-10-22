/**
 * One status-bar row shared by the Teams and Outlook extensions.
 *
 * omp draws one line per status key, so two keys stack as two lines. Each
 * extension instead owns a *part* of this row; the row is rendered under one key.
 *
 * The parts live on globalThis, not in this module: each extension is loaded as
 * its own module graph, so a module-level map would give each one a private copy
 * and they would overwrite each other's row.
 */
export const STATUS_ROW_KEY = "comms";

const PARTS = Symbol.for("wayne.pi-ext.status-row");

type Holder = { [PARTS]?: Map<string, string> };

/** Sets (or, with undefined, removes) this extension's part and redraws the row. Parts sort by name. */
export function setStatusPart(
	ui: { setStatus(key: string, text: string | undefined): void },
	part: string,
	text: string | undefined,
): void {
	const holder = globalThis as Holder;
	const parts = (holder[PARTS] ??= new Map());
	if (text === undefined) parts.delete(part);
	else parts.set(part, text);
	const row = [...parts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, t]) => t)
		.join("  ");
	ui.setStatus(STATUS_ROW_KEY, row || undefined);
}
