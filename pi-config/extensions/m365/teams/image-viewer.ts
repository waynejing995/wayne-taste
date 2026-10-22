/**
 * One picture, full width, in a plain (non-overlay) custom UI. Shared by Teams and Outlook.
 *
 * Not drawn inside an overlay's frame: pi and omp composite overlays line by line
 * and skip or cut lines that carry image control sequences, and an earlier attempt
 * drawn into the Teams overlay ended up in the scrollback. A non-overlay custom UI
 * is rendered the way an image in the transcript is, and pi's Image component owns
 * the row accounting.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Image, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { LoadedImage } from "../core/describe-image.ts";

/**
 * Shows `loaded` under `header` until a key. Resolves with the index to show next
 * (→ / ← step, 1-9 jump, wrapping over `total`), or null when the user closed it.
 */
export async function showImage(
	ctx: ExtensionContext,
	loaded: LoadedImage,
	header: string,
	index: number,
	total: number,
): Promise<number | null> {
	let next: number | null = null;
	await ctx.ui.custom<void>((tui, theme, _kb, finish) => {
		let image: Image | undefined;
		let builtFor = "";

		// pi only turns mouse reporting on in fullscreen mode, so the
		// viewer asks for it itself and puts it back on the way out.
		const write = tui.terminal?.write?.bind(tui.terminal);
		let unhook: (() => void) | undefined;
		if (write && typeof ctx.ui.onTerminalInput === "function") {
			write("\x1b[?1000h\x1b[?1006h");
			unhook = ctx.ui.onTerminalInput((data: string) => {
				if (!/\x1b\[<\d+;\d+;\d+[Mm]/.test(data)) return undefined;
				finish();
				// Swallow it, or the report reaches the editor as junk.
				return { consume: true };
			});
		}

		return {
			render(width: number): string[] {
				// Measured every frame: the window can be resized while the picture is open.
				const rows = tui.terminal?.rows ?? 24;
				const key = `${width}x${rows}`;
				if (!image || builtFor !== key) {
					image = new Image(loaded.base64, loaded.mime, theme, {
						maxWidthCells: Math.max(4, width - 2),
						// Leave room for the header, the footer and the editor pi keeps below a custom component.
						maxHeightCells: Math.max(4, rows - 6),
					});
					builtFor = key;
				}
				const many = total > 1 ? " · ←→ step · 1-9 jump" : "";
				return [
					theme.fg("accent", truncateToWidth(`${header}   image ${index + 1}/${total}`, width)),
					...image.render(width),
					theme.fg("muted", truncateToWidth(`any key closes${many}`, width)),
				];
			},
			handleInput(data: string) {
				const wrap = (n: number) => ((n % total) + total) % total;
				if (matchesKey(data, Key.right)) next = wrap(index + 1);
				else if (matchesKey(data, Key.left)) next = wrap(index - 1);
				else if (/^[1-9]$/.test(data) && Number(data) - 1 < total) next = Number(data) - 1;
				finish();
			},
			invalidate() {
				image = undefined;
			},
			dispose() {
				unhook?.();
				unhook = undefined;
				write?.("\x1b[?1006l\x1b[?1000l");
			},
		};
	});
	return next;
}
