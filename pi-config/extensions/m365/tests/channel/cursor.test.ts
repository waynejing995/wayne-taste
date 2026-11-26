/**
 * The cursor store (teams/cursor-store.ts): the id order, the watermark rule, and the locked update.
 *
 *   bun test tests/channel/cursor.test.ts
 */
import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../../teams/cursor-store.ts";
import type { CursorFile } from "../../teams/cursor-store.ts";

// The preload (tests/channel/preload.ts, wired through bunfig.toml) has already pointed WAYNE_INBOX_DIR at a
// throwaway directory before any test module loads, so the store's module-level INBOX is isolated however
// this file is ordered among the other channel tests in one process. Nothing here may set the env again:
// another file may have loaded the store first.
const inbox = process.env.WAYNE_INBOX_DIR;
if (!inbox) throw new Error("WAYNE_INBOX_DIR is not set: bunfig.toml must load tests/channel/preload.ts first");
const STORE = fileURLToPath(new URL("../../teams/cursor-store.ts", import.meta.url));

const CHAT = "19:fake-channel@thread.skype";
const baseline = (key: string): CursorFile => ({ version: 1, key, watermark: "0", done: [] });

// Canonical digit ids of varying length (Teams ids carry no leading zeros; BigInt compare would tie "01" with "1"),
// with small values included so equal ids come up often.
const digitId = fc.oneof(fc.bigInt({ min: 0n, max: 20n }), fc.bigInt({ min: 0n, max: 10n ** 25n })).map(String);
const isoTimestamp = fc
	.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true })
	.map((d) => d.toISOString());

describe("compareIds", () => {
	for (const [label, gen] of [
		["digit strings", digitId],
		["ISO-8601 timestamps", isoTimestamp],
	] as const) {
		test(`is a strict total order on ${label}`, () => {
			fc.assert(
				fc.property(gen, gen, gen, (a, b, c) => {
					expect(store.compareIds(a, a)).toBe(0);
					expect(store.compareIds(a, b) + store.compareIds(b, a)).toBe(0);
					if (store.compareIds(a, b) === 0) expect(a).toBe(b);
					if (store.compareIds(a, b) < 0 && store.compareIds(b, c) < 0) {
						expect(store.compareIds(a, c)).toBeLessThan(0);
					}
				}),
			);
		});
	}

	test("orders digit strings numerically, not lexically", () => {
		expect(store.compareIds("9", "10")).toBeLessThan(0);
		expect(store.compareIds("1700000000000", "999")).toBeGreaterThan(0);
	});
});

describe("markDone", () => {
	const cursorArb = fc.record({
		version: fc.constant(1),
		key: fc.constant("k"),
		watermark: digitId,
		done: fc.array(digitId, { maxLength: 8 }),
	});
	const idsArb = fc.array(digitId, { maxLength: 8 });
	const above = (id: string, floor: string) => store.compareIds(id, floor) > 0;
	const sorted = (ids: string[]) => [...ids].sort(store.compareIds);

	test("never decreases the watermark, keeps done ids above it, drops those at or below it, never passes a waiting id", () => {
		fc.assert(
			fc.property(cursorArb, idsArb, idsArb, (c, pending, doneIds) => {
				const before = JSON.stringify(c);
				const next = store.markDone(c, pending, doneIds);
				expect(JSON.stringify(c)).toBe(before);

				expect(store.compareIds(next.watermark, c.watermark)).toBeGreaterThanOrEqual(0);
				for (const d of next.done) expect(store.compareIds(d, next.watermark)).toBeGreaterThan(0);

				const handed = new Set([...c.done, ...doneIds]);
				const offered = [...handed].filter((d) => above(d, c.watermark) && above(d, next.watermark));
				expect(sorted(next.done)).toEqual(sorted(offered));

				const waiting = pending.filter((p) => above(p, c.watermark) && !handed.has(p));
				for (const p of waiting) expect(store.compareIds(p, next.watermark)).toBeGreaterThan(0);

				const floor = waiting.length ? sorted(waiting)[0] : undefined;
				const below = [...handed].filter((d) => above(d, c.watermark) && (floor === undefined || store.compareIds(d, floor) < 0));
				const expected = below.length ? sorted(below).at(-1) : c.watermark;
				expect(next.watermark).toBe(expected as string);
			}),
		);
	});

	test("advances to the greatest handed-over id below the first waiting id", () => {
		const c = { version: 1, key: "k", watermark: "5", done: ["7", "6"] } as CursorFile;
		const next = store.markDone(c, ["9"], ["8"]);
		expect(next.watermark).toBe("8");
		expect(next.done).toEqual([]);
	});

	test("holds the watermark below a waiting id and keeps the handed-over ids above it", () => {
		const c = { version: 1, key: "k", watermark: "5", done: [] } as CursorFile;
		const next = store.markDone(c, ["7"], ["6", "8"]);
		expect(next.watermark).toBe("6");
		expect(next.done).toEqual(["8"]);
	});

	test("compares ids numerically: a handed-over 10 moves the watermark past 9", () => {
		const c = { version: 1, key: "k", watermark: "9", done: ["10"] } as CursorFile;
		expect(store.markDone(c, [], []).watermark).toBe("10");
	});
});

describe("cursor files", () => {
	test("cursorKey is the chat id, or channel:<team>/<channel>", () => {
		expect(store.cursorKey({ chatId: CHAT })).toBe(CHAT);
		expect(store.cursorKey({ teamId: "team-1", channelId: CHAT })).toBe(`channel:team-1/${CHAT}`);
	});

	test("cursorPath is <inbox>/cursors/teams-<sha1 of the key>.json", () => {
		const file = store.cursorPath(CHAT);
		expect(dirname(file)).toBe(join(inbox, "cursors"));
		expect(basename(file)).toMatch(/^teams-[0-9a-f]{40}\.json$/);
	});

	test("loadCursor is null when the file is absent", () => {
		expect(store.loadCursor("absent-key")).toBeNull();
	});

	test("loadCursor throws an Error naming the path when the file is not JSON", () => {
		const key = "corrupt-key";
		const file = store.cursorPath(key);
		store.updateCursor(key, (c) => c, () => baseline(key));
		writeFileSync(file, "{not json");
		expect(() => store.loadCursor(key)).toThrow(file);
	});

	test("loadCursor throws an Error naming the path when the version is not 1", () => {
		const key = "future-key";
		const file = store.cursorPath(key);
		store.updateCursor(key, (c) => c, () => baseline(key));
		writeFileSync(file, JSON.stringify({ ...baseline(key), version: 2 }));
		expect(() => store.loadCursor(key)).toThrow(file);
	});

	test("updateCursor without a cursor and without init throws naming the key", () => {
		expect(() => store.updateCursor("missing-key", (c) => c)).toThrow("no cursor for missing-key");
	});

	test("updateCursor with init writes the baseline, then applies the change", () => {
		const key = "init-key";
		const c = store.updateCursor(key, (c) => ({ ...c, watermark: "3" }), () => baseline(key));
		expect(c.watermark).toBe("3");
		expect(store.loadCursor(key)?.watermark).toBe("3");
	});

	test("two processes each apply 50 updateCursor changes to one key: all 100 land", async () => {
		const key = store.cursorKey({ chatId: CHAT });
		store.updateCursor(key, (c) => c, () => baseline(key));
		const spawnWriter = (tag: number) =>
			Bun.spawn(
				[
					process.execPath,
					"-e",
					`(async () => {
	const { updateCursor } = await import(${JSON.stringify(STORE)});
	for (let i = 0; i < 50; i++) {
		const id = String(${tag * 1000} + i);
		updateCursor(${JSON.stringify(key)}, (c) => ({ ...c, done: [...c.done, id] }));
	}
})().catch((e) => { console.error(e); process.exit(1); });`,
				],
				{ env: process.env, stderr: "pipe" },
			);
		const runs = [spawnWriter(1), spawnWriter(2)];
		const outcomes = await Promise.all(runs.map(async (p) => ({ code: await p.exited, err: await new Response(p.stderr).text() })));
		for (const o of outcomes) {
			expect(o.err).toBe("");
			expect(o.code).toBe(0);
		}

		const final = store.loadCursor(key);
		const expected = [1, 2].flatMap((tag) => Array.from({ length: 50 }, (_, i) => String(tag * 1000 + i)));
		expect(final?.done.length).toBe(100);
		expect(new Set(final?.done).size).toBe(100);
		expect([...(final?.done ?? [])].sort()).toEqual(expected.sort());
	});

	test("a lock file aged 11 s is broken and the write succeeds", () => {
		const key = "stale-lock-key";
		store.updateCursor(key, (c) => c, () => baseline(key));
		const lock = `${store.cursorPath(key)}.lock`;
		writeFileSync(lock, "999999");
		const aged = (Date.now() - 11_000) / 1000;
		utimesSync(lock, aged, aged);

		const next = store.updateCursor(key, (c) => ({ ...c, watermark: "2" }));
		expect(next.watermark).toBe("2");
		expect(store.loadCursor(key)?.watermark).toBe("2");
		expect(existsSync(lock)).toBe(false);
	});
});
