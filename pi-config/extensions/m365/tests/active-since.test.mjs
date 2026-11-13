/**
 * `active_since` must not treat a chat with no activity as active.
 *
 *   node tests/active-since.test.mjs
 */
import { createJiti } from "./host.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { activeSince } = await jiti.import("../teams/active-since.ts");

let failed = 0;
const check = (label, got, want) => {
	const ok = got === want;
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` (got ${got}, want ${want})`}`);
};

const boundary = new Date("2026-11-13 10:00").getTime();
const chat = (last_at) => ({ id: "19:chat@thread.v2", label: "chat", chat_type: "oneOnOne", last_at });

check("no last_at is not active", activeSince(chat(undefined), boundary), false);
check("last_at before the boundary is not active", activeSince(chat("2026-11-13T09:59:00"), boundary), false);
check("last_at at the boundary is active", activeSince(chat("2026-11-13T10:00:00"), boundary), true);
check("last_at after the boundary is active", activeSince(chat("2026-11-13T10:01:00"), boundary), true);

const { throttledRetry } = await jiti.import("../teams/active-since.ts");
const { GraphError } = await jiti.import("../core/graph.ts");
{
	let calls = 0;
	const got = await throttledRetry(async () => {
		calls++;
		if (calls <= 2) throw new GraphError("Graph 429 on /me/chats: TooManyRequests", 429, "{}");
		return "page";
	}, 1);
	check("a chat list throttled twice still returns the page", `${got}/${calls}`, "page/3");
	const stuck = await throttledRetry(async () => {
		throw new GraphError("Graph 429", 429, "{}");
	}, 1).then(() => 0, (e) => e.status);
	check("a chat list that stays throttled still fails loudly", stuck, 429);
	let other = 0;
	await throttledRetry(async () => {
		other++;
		throw new Error("boom");
	}, 1).catch(() => {});
	check("other errors are not retried", other, 1);
}

process.exitCode = failed ? 1 : 0;
