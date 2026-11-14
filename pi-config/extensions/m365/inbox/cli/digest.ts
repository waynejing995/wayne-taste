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
import { FACT_KINDS } from "./facts.ts";
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
		"When omp elides the middle of a teams_read result (`Showing lines 1-H and T-N of N; ... elided. Read artifact://N for full output`), read every elided line before you go on, with the `read` tool: `read artifact://N:A-B` (as many reads as it takes, from H+1 to T-1). Reading the artifact through bash (sed, grep, cat) does not count: the run is checked against `read` calls only. The same holds when omp elides the middle of the teams_chats list.",
		"Run each `inbox ask` or `inbox fact` as its own bash call holding only that one plain command (no `;`, `&&`, `|`, `$(...)` or newline), so each result can be checked. A fact the guard refuses as a credential value is dropped on purpose; do not retry it.",
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

type Truncation = { direction?: string; totalLines?: number; outputLines?: number; headRange?: { start?: number; end: number }; tailRange?: { start: number; end?: number }; artifactId?: string };

/** The lines `read artifact://ID:...` calls showed, as [first, last] pairs. A read stops at its "Use :X to continue". */
function artifactReads(all: Call[], id: string): [number, number][] {
	// The read tool's selectors: `:A-B`, `:A+C`, `:A-` / `:A` (from A on); with `:raw`, a bare `:A` is that one line.
	const path = new RegExp(`^artifact://${id}(:raw)?:(\\d+)(?:(-)(\\d*)|\\+(\\d+))?$`);
	const out: [number, number][] = [];
	for (const c of all) {
		if (c.name !== "read" || !c.ok) continue;
		const m = path.exec(String(c.args.path ?? ""));
		if (!m) continue;
		const [, raw, a, dash, b, count] = m;
		const first = Number(a);
		const asked = b ? Number(b) : count ? first + Number(count) - 1 : raw && !dash ? first : Number.POSITIVE_INFINITY;
		// Never past what came back: omp's "Use :N to continue" marks the first line not returned, and the result holds
		// at most as many lines as its text has (notice lines included, so this bound only ever errs long by them).
		const more = /Use :(\d+) to continue\]\s*$/.exec(c.text);
		const returned = first + c.text.replace(/\n$/, "").split("\n").length - 1;
		out.push([first, Math.min(asked, more ? Number(more[1]) - 1 : returned, returned)]);
	}
	return out;
}

/**
 * The lines omp elided from a tool result that no artifact read covered, as a reason; undefined when nothing is
 * missing. Any truncation counts: a middle cut, a head-only result (tail cut) or a tail-only one (head cut).
 */
function unreadMiddle(read: Call, all: Call[]): string | undefined {
	const t = (read.details?.meta as { truncation?: Truncation } | undefined)?.truncation;
	if (!t?.direction) return undefined;
	const total = t.totalLines ?? Number.POSITIVE_INFINITY;
	const from = t.headRange ? t.headRange.end + 1 : 1;
	const to = t.tailRange ? t.tailRange.start - 1 : total;
	if (from > to) return undefined;
	const id = String(t.artifactId ?? "");
	let next = from;
	for (const [a, b] of artifactReads(all, id).sort((x, y) => x[0] - y[0])) if (a <= next && b >= next) next = b + 1;
	if (next > to) return undefined;
	return `lines ${from}-${to} of the ${read.name} output were elided by omp and lines ${next}-${to} never read from artifact://${id}`;
}

/** The text of every `read artifact://ID...` result for the artifact a truncated call spilled to. */
function artifactText(call: Call, all: Call[]): string {
	const id = (call.details?.meta as { truncation?: Truncation } | undefined)?.truncation?.artifactId;
	if (id === undefined) return "";
	const path = new RegExp(`^artifact://${id}(?::|$)`);
	return all.filter((c) => c.name === "read" && c.ok && path.test(String(c.args.path ?? ""))).map((c) => c.text).join("\n");
}

/** One inbox write a bash call ran: the operation, its fact kind (empty for ask), key and the chat its --note names. */
type Write = { op: string; kind: string; key: string; chat: string };

/**
 * Shell words of a plain command, or undefined when it is anything else: a separator, pipe, redirect, substitution or
 * newline outside quotes means more than one command could run, so one exit status would not say how each went.
 */
function plainWords(command: string): string[] | undefined {
	const words: string[] = [];
	let word: string | undefined;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (ch === "'") {
			const end = command.indexOf("'", i + 1);
			if (end < 0) return undefined;
			word = (word ?? "") + command.slice(i + 1, end);
			i = end;
		} else if (ch === '"') {
			const end = command.indexOf('"', i + 1);
			if (end < 0) return undefined;
			const inner = command.slice(i + 1, end);
			if (/[$`\\]/.test(inner)) return undefined;
			word = (word ?? "") + inner;
			i = end;
		} else if (ch === " " || ch === "\t") {
			if (word !== undefined) words.push(word);
			word = undefined;
		} else if (/[;&|<>`$\\\n(){}]/.test(ch)) return undefined;
		else word = (word ?? "") + ch;
	}
	if (word !== undefined) words.push(word);
	return words;
}

/** The write a bash call made: a Write, "mixed" when an inbox ask/fact is not the call's one plain command, or undefined for no write. */
function inboxWrite(command: string, ok: boolean, text = ""): Write | "mixed" | undefined {
	if (!/\binbox\b/.test(command) || !/\b(ask|fact)\b/.test(command)) return undefined;
	const words = plainWords(command);
	if (!words) {
		// A line with a stray quote ("Wayne's") that bash refused as a syntax error ran nothing at all, whatever `;`
		// sits inside its text, so it is one failed write a corrected retry can clear. Anything else stays "mixed".
		const plain = /^inbox (ask|fact) /.exec(command);
		if (ok || !plain || !/syntax error|unexpected EOF while looking for matching/.test(text)) return "mixed";
		const opt = (name: string) => new RegExp(`--${name}\\s+'?([^'\\s,]+)`).exec(command)?.[1] ?? "";
		return { op: plain[1], kind: opt("kind"), key: opt("key"), chat: (/--note\s+'([^,']*)/.exec(command)?.[1] ?? "").trim() || "unknown chat" };
	}
	if (words[0] !== "inbox") return "mixed";
	if (words[1] !== "ask" && words[1] !== "fact") return undefined;
	const end = words.indexOf("--");
	const opts = end < 0 ? words : words.slice(0, end);
	const opt = (name: string) => {
		const at = opts.indexOf(`--${name}`);
		return at < 0 ? "" : (opts[at + 1] ?? "");
	};
	return { op: words[1], kind: opt("kind"), key: opt("key"), chat: opt("note").split(",")[0].trim() || "unknown chat" };
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
	const failed = new Map<string, string>();
	for (const list of lists) {
		const gap = unreadMiddle(list, all);
		if (gap) failed.set("chat list", gap);
		for (const line of `${list.text}\n${artifactText(list, all)}`.split("\n")) {
			const m = CHAT_LINE.exec(line);
			if (m) wanted.set(m[2], m[1]);
		}
	}
	const reads = all.filter((c) => c.name === "teams_read");
	for (const [id, name] of wanted) {
		const mine = reads.filter((c) => (c.args.target === "self" ? SELF.id : c.args.chat_id) === id || (!c.args.chat_id && c.args.chat === name));
		const read = mine.filter((c) => c.ok && covers(c.args.since, boundary) && reaches(c.args.until, end));
		const gaps = read.map((c) => unreadMiddle(c, all));
		if (gaps.some((g) => g === undefined)) continue;
		const err = mine.find((c) => !c.ok);
		failed.set(name, gaps[0] ?? (err ? `teams_read failed: ${err.text.slice(0, 120)}` : mine.length ? `teams_read did not read since ${since} until ${until}` : "never read"));
	}
	// Each inbox write must be its bash call's one plain command, so the call's exit status is that write's result.
	// A failed write counts unless a later call made the same write (op, kind, key) successfully; one the guard
	// refused as a credential value is dropped on purpose, not a gap.
	const writes = all.filter((c) => c.name === "bash").map((c) => ({ c, w: inboxWrite(String(c.args.command ?? ""), c.ok, c.text) }));
	writes.forEach(({ c, w }, i) => {
		if (w === undefined) return;
		if (w === "mixed") {
			const chat = /--note\s+(?:"([^",]*)|'([^',]*)|([^\s,]+))/.exec(String(c.args.command ?? ""));
			const name = (chat?.[1] ?? chat?.[2] ?? chat?.[3] ?? "").trim() || "unknown chat";
			failed.set(name, failed.get(name) ?? "an inbox write was not its bash call's one plain command; run one plain `inbox ask|fact` per bash call so each result can be checked");
			return;
		}
		if (c.ok || /never its value/.test(c.text)) return;
		// The same write is the same op and key, and for a fact the same kind; a fact the CLI refused for a kind it does
		// not know had no kind, so a corrected retry under a real kind counts.
		const kindOk = (kind: string) => w.op !== "fact" || kind === w.kind || !FACT_KINDS.includes(w.kind);
		const same = (x: Write | "mixed" | undefined) => typeof x === "object" && x.op === w.op && x.key === w.key && kindOk(x.kind);
		if (w.key && writes.slice(i + 1).some((later) => later.c.ok && same(later.w))) return;
		failed.set(w.chat, failed.get(w.chat) ?? `inbox write failed: ${c.text.slice(0, 120)}`);
	});
	const text = finalText(evs);
	const receipt = parseReceipt(text);
	for (const f of receipt.failed) if (!failed.has(f.chat)) failed.set(f.chat, f.reason);
	const summary = text.split("\n").slice(0, -1).join("\n").trim() || `read ${wanted.size} chat(s)`;
	return { summary, failed: [...failed].map(([chat, reason]) => ({ chat, reason })) };
}
