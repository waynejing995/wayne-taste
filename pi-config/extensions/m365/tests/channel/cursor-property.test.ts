import { expect, test } from "bun:test";
import * as fc from "fast-check";
import { planDelivery, type ChannelEvent, type DeliveryEntry } from "../../teams/channel.ts";
import { compareIds, markDone, type CursorFile } from "../../teams/cursor-store.ts";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const SELF = "session:self";
type Action = { arrival: "instruction" | "other" | "email" | "echo" | "none"; pageSize: number; busy: boolean; restart: boolean };
const action = fc.record({
	arrival: fc.constantFrom("instruction", "other", "email", "echo", "none"),
	pageSize: fc.integer({ min: 1, max: 7 }),
	busy: fc.boolean(),
	restart: fc.boolean(),
});

test("U17: cursor and pending entries deliver each non-skipped arrival once across pages and restarts", () => {
	fc.assert(fc.property(fc.array(action, { minLength: 1, maxLength: 80 }), (actions: Action[]) => {
		let cursor: CursorFile = { version: 1, key: "channel:team-1/19:fake-channel@thread.skype", watermark: "0", done: [] };
		const stream: ChannelEvent[] = [];
		let pending: DeliveryEntry[] = [];
		const delivered = new Map<string, number>();
		const skipped = new Set<string>();

		const poll = (pageSize: number, busy: boolean, restart: boolean) => {
			if (restart) {
				cursor = JSON.parse(JSON.stringify(cursor));
				pending = [];
			}
			const oldWatermark = cursor.watermark;
			const waiting = new Set(pending.flatMap((entry) => entry.ids));
			const newest = stream.filter((item) => compareIds(item.id, cursor.watermark) > 0).slice().reverse();
			const fresh: ChannelEvent[] = [];
			for (let offset = 0; offset < newest.length; offset += pageSize) {
				for (const item of newest.slice(offset, offset + pageSize)) {
					if (!cursor.done.includes(item.id) && !waiting.has(item.id)) fresh.push(item);
				}
			}
			const plan = planDelivery(fresh, { mode: "personal", myOid: ME, self: SELF, threads: {} });
			pending.push(...plan.entries);
			for (const id of plan.skipped) skipped.add(id);
			cursor = markDone(cursor, [...pending.flatMap((entry) => entry.ids), ...plan.skipped], plan.skipped);
			expect(compareIds(cursor.watermark, oldWatermark)).toBeGreaterThanOrEqual(0);
			for (const id of pending.flatMap((entry) => entry.ids)) expect(compareIds(cursor.watermark, id)).toBeLessThan(0);
			if (!busy) {
				for (const entry of pending) for (const id of entry.ids) delivered.set(id, (delivered.get(id) ?? 0) + 1);
				const handed = pending.flatMap((entry) => entry.ids);
				cursor = markDone(cursor, handed, handed);
				pending = [];
			}
			expect(compareIds(cursor.watermark, oldWatermark)).toBeGreaterThanOrEqual(0);
			for (const id of pending.flatMap((entry) => entry.ids)) expect(compareIds(cursor.watermark, id)).toBeLessThan(0);
		};

		for (const step of actions) {
			if (step.arrival !== "none") {
				const id = String(stream.length + 1);
				const email = step.arrival === "email";
				const agentEcho = step.arrival === "echo";
				stream.push({ id, threadId: String(1 + (stream.length % 3)), isRoot: false, at: "", authorOid: step.arrival === "other" ? OTHER : ME, author: "Synthetic User", email, agentEcho, text: "data", md: "data" });
			}
			poll(step.pageSize, step.busy, step.restart);
		}
		poll(3, false, false);
		for (const item of stream) {
			if (item.agentEcho) {
				expect(skipped.has(item.id)).toBe(true);
				expect(delivered.has(item.id)).toBe(false);
			} else expect(delivered.get(item.id)).toBe(1);
		}
		const beforeReload = [...delivered.entries()];
		poll(2, false, true);
		expect([...delivered.entries()]).toEqual(beforeReload);
	}), { numRuns: 200 });
});
