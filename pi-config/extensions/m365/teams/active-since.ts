/**
 * Whether a chat counts as active since a boundary.
 *
 * A chat with no `last_at` has no activity to show (a meeting chat whose preview is only system messages),
 * and `NaN < boundary` is false, so the comparison alone would count it as active. It is not.
 */
import type { ChatRef } from "./compose-overlay.ts";

export function activeSince(chat: ChatRef, boundary: number): boolean {
	const at = new Date(chat.last_at ?? "").getTime();
	return !Number.isNaN(at) && at >= boundary;
}
