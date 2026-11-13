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

process.exitCode = failed ? 1 : 0;
