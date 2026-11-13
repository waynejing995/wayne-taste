/**
 * Whether a chat counts as active since a boundary.
 *
 * A chat with no `last_at` has no activity to show (a meeting chat whose preview is only system messages),
 * and `NaN < boundary` is false, so the comparison alone would count it as active. It is not.
 */
import { GraphError } from "../core/graph.ts";
import type { ChatRef } from "./compose-overlay.ts";

export function activeSince(chat: ChatRef, boundary: number): boolean {
	const at = new Date(chat.last_at ?? "").getTime();
	return !Number.isNaN(at) && at >= boundary;
}

/**
 * `active_since` walks the whole chat list, one Graph page after another, and a long walk can hit Graph's quota.
 * A throttled page (a GraphError 429/503) waits and is asked again, a few times; still throttled, it fails as
 * before. GraphClient itself never retries, so other callers keep failing fast.
 */
export async function throttledRetry<T>(fn: () => Promise<T>, waitMs = 10_000, retries = 3): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await fn();
		} catch (e) {
			if (i >= retries || !(e instanceof GraphError && e.throttled)) throw e;
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, waitMs);
			await promise;
		}
	}
}
