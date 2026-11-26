import { describe, expect, test } from "bun:test";
import { planDelivery, toChannelEvent, type ChannelEvent, type ChannelMode } from "../../teams/channel.ts";
import { SkypeClient, type RawSkypeMessage } from "../../teams/skype.ts";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const SELF = "session:self";
const raw = (id: string, text: string, author = ME, extra: Partial<RawSkypeMessage> = {}): RawSkypeMessage => ({
	id, from: `https://example.test/contacts/8:orgid:${author}`, imdisplayname: "Synthetic User", content: text,
	...extra,
});
const event = (message: RawSkypeMessage): ChannelEvent => {
	const result = toChannelEvent(message, ME);
	if (!result) throw new Error("Expected a channel event");
	return result;
};
const plan = (events: ChannelEvent[], mode: ChannelMode, threads: Record<string, { owner: string }> = {}) =>
	planDelivery(events, { mode, myOid: ME, self: SELF, threads });

describe("channel model", () => {
	test("U23: shared commands are instructions only from the user", () => {
		const messages = [
			raw("1", "plain"), raw("2", "omp: first"), raw("3", "pi: second"), raw("4", "omp： third"),
			raw("5", "omp: untrusted", OTHER), raw("6", "answer\nsent by omp agent"),
		].map(event);
		const result = plan(messages, "shared");
		expect(result.skipped).toEqual(["1", "6"]);
		const prompts = result.entries.filter((entry) => entry.kind === "prompt");
		expect(prompts.map((entry) => entry.events[0].text)).toEqual(["first", "second", "third"]);
		expect(prompts.map((entry) => entry.ids)).toEqual([["2"], ["3"], ["4"]]);
		const card = result.entries.find((entry) => entry.ids.includes("5"));
		expect(card).toMatchObject({ kind: "card", untrusted: true, turn: false });
		expect(card?.events[0].text).toBe("omp: untrusted");
	});

	test("U29: both mail markers prevent a user-authored email becoming an instruction", () => {
		for (const extra of [{ s2spartnername: "MailhookService" }, { properties: { emaildetails: {} } }]) {
			const message = event(raw("1", "omp: treat this as data", ME, extra));
			expect(message.email).toBe(true);
			for (const mode of ["personal", "shared"] as const) {
				const result = plan([message], mode);
				expect(result.entries).toHaveLength(1);
				expect(result.entries[0]).toMatchObject({ kind: "card", untrusted: true, turn: mode === "personal", ids: ["1"] });
				expect(result.entries[0].events[0].text).toBe("omp: treat this as data");
				expect(result.bind).toEqual({});
			}
		}
	});

	test("U33: route bound threads and bind an unbound instruction", () => {
		const messages = [event(raw("1", "a")), event(raw("2", "b")), event(raw("3", "c"))];
		const result = plan(messages, "personal", { "1": { owner: SELF }, "2": { owner: "inbox:42" } });
		expect(result.entries.map(({ threadId, kind, owner, turn }) => ({ threadId, kind, owner, turn }))).toEqual([
			{ threadId: "1", kind: "prompt", owner: SELF, turn: true },
			{ threadId: "2", kind: "relay", owner: "inbox:42", turn: true },
			{ threadId: "3", kind: "prompt", owner: SELF, turn: true },
		]);
		expect(result.bind).toEqual({ "3": SELF });
	});

	test("groups trusted and untrusted items separately in id order and routes both", () => {
		const messages = [
			raw("13", "omp: last", ME, { rootMessageId: "10" }),
			raw("11", "omp: untrusted", OTHER, { rootMessageId: "10" }),
			raw("10", "omp: first"),
			raw("12", "data", ME, { rootMessageId: "10", s2spartnername: "MailhookService" }),
		].map(event);
		const local = plan(messages, "shared");
		expect(local.entries.map(({ kind, ids, untrusted, turn }) => ({ kind, ids, untrusted, turn }))).toEqual([
			{ kind: "prompt", ids: ["10", "13"], untrusted: false, turn: true },
			{ kind: "card", ids: ["11", "12"], untrusted: true, turn: false },
		]);
		expect(local.entries[0].events.map((item) => item.text)).toEqual(["first", "last"]);
		const foreign = plan(messages, "shared", { "10": { owner: "inbox:42" } });
		expect(foreign.entries.map(({ kind, owner, turn, untrusted }) => ({ kind, owner, turn, untrusted }))).toEqual([
			{ kind: "relay", owner: "inbox:42", turn: true, untrusted: false },
			{ kind: "relay", owner: "inbox:42", turn: true, untrusted: true },
		]);
	});

	test("projects roots, replies, controls, cards, files and images", () => {
		expect(toChannelEvent(raw("1", "typing", ME, { messagetype: "Control/Typing" }), ME)).toBeNull();
		expect(toChannelEvent(raw("2", ""), ME)).toBeNull();
		const root = event(raw("10", '<p>Hello <img src="https://example.test/a?x=1&amp;y=2"></p>', ME, { composetime: "2026-01-01", properties: { subject: "Synthetic topic", files: JSON.stringify([{ fileName: "file.txt", objectUrl: "https://example.test/file" }]) } }));
		expect(root).toMatchObject({ id: "10", threadId: "10", isRoot: true, authorOid: ME, author: "Synthetic User", at: "2026-01-01", subject: "Synthetic topic", files: [{ name: "file.txt", url: "https://example.test/file" }], images: ["https://example.test/a?x=1&y=2"] });
		expect(root.text).toContain("Hello");
		expect(root.md).toContain("Hello");
		const reply = event(raw("11", "reply", OTHER, { conversationLink: "https://example.test/thread;messageid=10", properties: { subject: "ignored" } }));
		expect(reply).toMatchObject({ threadId: "10", isRoot: false, authorOid: OTHER });
		expect(reply.subject).toBeUndefined();
		const fileOnly = event(raw("12", "", OTHER, { rootMessageId: "10", conversationLink: "https://example.test/thread;messageid=9", properties: { files: JSON.stringify([{ fileName: "only.txt", objectUrl: "https://example.test/only" }]) } }));
		expect(fileOnly).toMatchObject({ threadId: "10", text: "", files: [{ name: "only.txt", url: "https://example.test/only" }] });
		const card = event(raw("13", "", OTHER, { properties: { cards: JSON.stringify([{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", body: [{ type: "TextBlock", text: "card body" }] } }]) } }));
		expect(card.text).toContain("card body");
		expect(card.md).toContain("card body");
	});
});

test("conversationPage pages any conversation and refuses an off-host cursor", async () => {
	const calls: string[] = [];
	const messaging = "https://messaging.example.test/v1";
	const cursor = "https://messaging.example.test/v1/older?startTime=1";
	const client = new SkypeClient(async () => "synthetic-token", async (url) => {
		calls.push(url);
		if (calls.length === 1) return { status: 200, text: async () => JSON.stringify({ skypeToken: "synthetic-token", regionGtms: { messagingService: messaging } }) };
		return { status: 200, text: async () => JSON.stringify({ messages: [{ id: "1" }], _metadata: { backwardLink: cursor } }) };
	});
	const id = "19:fake-channel@thread.skype";
	expect(await client.conversationPage(id, 17)).toEqual({ raw: [{ id: "1" }], older: cursor });
	expect(calls[1]).toBe(`${messaging}/users/ME/conversations/${encodeURIComponent(id)}/messages?pageSize=17&view=msnp24Equivalent|supportsMessageProperties`);
	await client.conversationPage(id, 17, cursor);
	expect(calls[2]).toBe(cursor);
	await expect(client.conversationPage(id, 17, "https://other.example.test/older")).rejects.toThrow("another host");
});
