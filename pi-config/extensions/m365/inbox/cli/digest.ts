/**
 * The teams-digest completion contract: the receipt the prompt asks for, and the check the runner applies.
 *
 * The prompt's `{{receipt}}` is replaced by receiptInstructions(), so the text the agent reads and the shape the
 * runner parses come from RECEIPT_FIELDS here and nowhere else. The receipt is only the agent's claim, so the
 * runner also checks the agent's `--mode json` event stream: every chat `teams_chats active_since` listed, plus the
 * self-chat, needs a successful `teams_read` with `since` at or before the window's start and `until` (if given) at or
 * after its end, and every `inbox` write must have succeeded. A chat the stream does not show as read is a failed
 * chat, whatever the receipt says.
 */
import { InboxError } from "./ledger.ts";

const SELF = { id: "48:notes", name: "self-chat" };

/** The receipt's fields, in the order the prompt shows them. */
const RECEIPT_FIELDS = {
	complete: "true only when every chat was read and every inbox command succeeded",
	chats: "how many chats you read",
	findings: "how many inbox ask and inbox fact commands you ran",
	failed: 'one {"chat": "<chat name>", "reason": "<what failed>"} per chat you could not fully read or record; [] when none',
};

export type FailedChat = { chat: string; reason: string };
export type DigestCheck = { summary: string; failed: FailedChat[] };

/** The text that replaces `{{receipt}}` in the digest prompt. */
export function receiptInstructions(): string {
	const example = JSON.stringify({ complete: true, chats: 3, findings: 2, failed: [] });
	const fields = Object.entries(RECEIPT_FIELDS).map(([name, meaning]) => `\`${name}\`: ${meaning}`).join("; ");
	return [
		`End your reply with the receipt: one line of JSON, nothing after it, for example ${example}`,
		`Fields: ${fields}. If a teams_read or inbox command fails, retry it once; if it still fails, set "complete" to false and name the chat in "failed".`,
		"When omp elides the middle of a teams_read result (`Showing lines 1-H and T-N of N; ... elided. Read artifact://N for full output`), read every elided line before you go on, with `read artifact://N:A-B` (as many reads as it takes, from H+1 to T-1).",
	].join("\n");
}

type Event = Record<string, unknown>;
type Call = { name: string; args: Record<string, unknown>; ok: boolean; text: string; details?: Record<string, unknown> };

/** The `--mode json` stream: one event per line. A line that is not an event means the run was not in JSON mode. */
function events(stdout: string): Event[] {
	const lines = stdout.split("\n").filter((line) => line.trim());
	return lines.map((line) => {
		try {
			return JSON.parse(line) as Event;
		} catch {
			throw new InboxError(`teams digest output is not a --mode json event stream: ${line.slice(0, 120)}`);
		}
	});
}

/** Every finished tool call, with the arguments its start event carried. */
function calls(evs: Event[]): Call[] {
	const args = new Map<unknown, Record<string, unknown>>();
	for (const e of evs) if (e.type === "tool_execution_start") args.set(e.toolCallId, (e.args ?? {}) as Record<string, unknown>);
	return evs
		.filter((e) => e.type === "tool_execution_end")
		.map((e) => {
			const result = e.result as { content?: { text?: string }[]; details?: Record<string, unknown> } | undefined;
			const content = (result?.content ?? []).map((c) => c?.text ?? "").join("");
			return { name: String(e.toolName), args: args.get(e.toolCallId) ?? {}, ok: e.isError !== true, text: content, details: result?.details };
		});
}

/** The last assistant message's text. */
function finalText(evs: Event[]): string {
	const ends = evs.filter((e) => e.type === "message_end" && (e.message as { role?: string } | undefined)?.role === "assistant");
	const content = (ends.at(-1)?.message as { content?: { type?: string; text?: string }[] } | undefined)?.content ?? [];
	return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
}

/** The receipt: the last line of the final text, checked against RECEIPT_FIELDS. */
export function parseReceipt(text: string): { complete: boolean; failed: FailedChat[] } {
	const last = text.trim().split("\n").at(-1)?.trim() ?? "";
	let r: Record<string, unknown>;
	try {
		r = JSON.parse(last.replace(/^`+|`+$/g, ""));
	} catch {
		throw new InboxError("teams digest has no completion receipt");
	}
	const keys = Object.keys(RECEIPT_FIELDS);
	if (!r || typeof r !== "object" || keys.some((k) => !(k in r)) || typeof r.complete !== "boolean" || !Array.isArray(r.failed))
		throw new InboxError(`teams digest receipt needs ${keys.join(", ")}: ${last.slice(0, 200)}`);
	const failed = (r.failed as unknown[]).map((f) => {
		const item = (f && typeof f === "object" ? f : { chat: String(f) }) as Record<string, unknown>;
		return { chat: String(item.chat ?? "unknown chat"), reason: String(item.reason ?? "reported by the agent") };
	});
	if (!r.complete && !failed.length) failed.push({ chat: "unknown chat", reason: "the receipt says incomplete and names no chat" });
	return { complete: r.complete, failed };
}

/** True when `value` is a time (local `YYYY-MM-DD HH:MM` or ISO-8601, as the Teams tools take it) at or before `boundary`. */
function covers(value: unknown, boundary: number): boolean {
	return typeof value === "string" && new Date(value).getTime() <= boundary;
}

/** True when a read's `until` reaches `end`: no `until` reads to now. */
function reaches(value: unknown, end: number): boolean {
	return value === undefined || (typeof value === "string" && new Date(value).getTime() >= end);
}

type Truncation = { direction?: string; headRange?: { end: number }; tailRange?: { start: number }; artifactId?: string };

/** The lines `read artifact://ID:...` calls showed, as [first, last] pairs. A read stops at its "Use :X to continue". */
function artifactReads(all: Call[], id: string): [number, number][] {
	const path = new RegExp(`^artifact://${id}(?::raw)?:(\\d+)(?:-(\\d+)|\\+(\\d+))?$`);
	const out: [number, number][] = [];
	for (const c of all) {
		if (c.name !== "read" || !c.ok) continue;
		const m = path.exec(String(c.args.path ?? ""));
		if (!m) continue;
		const first = Number(m[1]);
		const more = /Use :(\d+) to continue\]\s*$/.exec(c.text);
		const last = more ? Number(more[1]) - 1 : m[2] ? Number(m[2]) : m[3] ? first + Number(m[3]) - 1 : Number.POSITIVE_INFINITY;
		out.push([first, last]);
	}
	return out;
}

/** The elided middle of a read that no artifact read covered, as a reason; undefined when nothing is missing. */
function unreadMiddle(read: Call, all: Call[]): string | undefined {
	const t = (read.details?.meta as { truncation?: Truncation } | undefined)?.truncation;
	if (t?.direction !== "middle" || !t.headRange || !t.tailRange) return undefined;
	const id = String(t.artifactId ?? "");
	const from = t.headRange.end + 1;
	const to = t.tailRange.start - 1;
	let next = from;
	for (const [a, b] of artifactReads(all, id).sort((x, y) => x[0] - y[0])) if (a <= next && b >= next) next = b + 1;
	if (next > to) return undefined;
	return `lines ${from}-${to} of the teams_read output were elided by omp and lines ${next}-${to} never read from artifact://${id}`;
}

const CHAT_LINE = /^- (.*)  \[[^\]]*\]  id: (\S+)$/;

/** Check one digest run's event stream against the contract for the window `since`..`until`. Throws when the run cannot be judged at all. */
export function checkDigest(stdout: string, since: string, until: string): DigestCheck {
	const boundary = new Date(since).getTime();
	const end = new Date(until).getTime();
	if (!Number.isFinite(boundary) || !Number.isFinite(end)) throw new InboxError(`teams digest window is not a time: ${since} to ${until}`);
	const evs = events(stdout);
	const all = calls(evs);
	const lists = all.filter((c) => c.name === "teams_chats" && c.ok && covers(c.args.active_since, boundary));
	if (!lists.length) throw new InboxError(`teams digest never listed the chats active since ${since}`);
	const wanted = new Map<string, string>([[SELF.id, SELF.name]]);
	for (const list of lists)
		for (const line of list.text.split("\n")) {
			const m = CHAT_LINE.exec(line);
			if (m) wanted.set(m[2], m[1]);
		}
	const reads = all.filter((c) => c.name === "teams_read");
	const failed = new Map<string, string>();
	for (const [id, name] of wanted) {
		const mine = reads.filter((c) => (c.args.target === "self" ? SELF.id : c.args.chat_id) === id || (!c.args.chat_id && c.args.chat === name));
		const read = mine.filter((c) => c.ok && covers(c.args.since, boundary) && reaches(c.args.until, end));
		const gaps = read.map((c) => unreadMiddle(c, all));
		if (gaps.some((g) => g === undefined)) continue;
		const err = mine.find((c) => !c.ok);
		failed.set(name, gaps[0] ?? (err ? `teams_read failed: ${err.text.slice(0, 120)}` : mine.length ? `teams_read did not read since ${since} until ${until}` : "never read"));
	}
	for (const c of all.filter((c) => c.name === "bash" && !c.ok && /\binbox\s+(ask|fact)\b/.test(String(c.args.command ?? "")))) {
		const note = /--note\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(String(c.args.command));
		const chat = (note?.[1] ?? note?.[2] ?? note?.[3] ?? "").split(",")[0].trim() || "unknown chat";
		failed.set(chat, failed.get(chat) ?? `inbox write failed: ${c.text.slice(0, 120)}`);
	}
	const text = finalText(evs);
	const receipt = parseReceipt(text);
	for (const f of receipt.failed) if (!failed.has(f.chat)) failed.set(f.chat, f.reason);
	const summary = text.split("\n").slice(0, -1).join("\n").trim() || `read ${wanted.size} chat(s)`;
	return { summary, failed: [...failed].map(([chat, reason]) => ({ chat, reason })) };
}
