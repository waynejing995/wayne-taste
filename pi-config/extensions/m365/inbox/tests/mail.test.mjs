/**
 * mailSince: no mail is lost to the page size or to a shared received second.
 *
 *   node --experimental-strip-types inbox/tests/mail.test.mjs
 */
import { deepStrictEqual } from "node:assert/strict";
import { mailSince } from "../mail.ts";

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

const t = (n) => `2026-11-04T00:${String(n).padStart(2, "0")}:00Z`;
/** An Inbox newest first, paged as Graph pages it. */
const inbox = (mails) => async (skip) => mails.slice(skip, skip + 3);
const ids = (ms) => ms.map((m) => m.id);

await check("more new mail than one page: every one, oldest first", async () => {
	const mails = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => ({ id: `m${n}`, received: t(n) }));
	deepStrictEqual(ids(await mailSince(inbox(mails), t(2), 3)), ["m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"]);
});

await check("two mails in the cursor's second: both read again, so a failed second one is retried", async () => {
	const mails = [
		{ id: "late", received: t(6) },
		{ id: "b", received: t(5) },
		{ id: "a", received: t(5) },
		{ id: "old", received: t(4) },
	];
	deepStrictEqual(ids(await mailSince(inbox(mails), t(5), 3)), ["a", "b", "late"]);
});

await check("stops at the first page that reaches past the cursor", async () => {
	let pages = 0;
	const mails = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => ({ id: `m${n}`, received: t(n) }));
	const page = async (skip) => (pages++, mails.slice(skip, skip + 3));
	await mailSince(page, t(8), 3);
	deepStrictEqual(pages, 1);
});

console.log(failed === 0 ? "\nall ok" : `\nFAIL ${failed}`);
process.exit(failed ? 1 : 0);
