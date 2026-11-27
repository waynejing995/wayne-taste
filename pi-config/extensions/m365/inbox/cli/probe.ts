/**
 * `inbox agent probe`: look at every watched agent session once and record what changed. A schedule job runs it.
 *
 * Per session it looks at three things, nothing in between (probe.sh does the looking, where the pane lives):
 *   - the start: is the pane still there, and is an agent process in it (tern, tmux: a pane back at its shell is gone);
 *   - the end:   has the RESULT file got its status line, and which;
 *   - the middle: is it still producing output. omp: the age of its session jsonl. herdr / hc: the agent state
 *     they report. A pane with no session file: whether the pane text changed since the last run. An agent waiting
 *     for its next prompt is idle, never stalled; idle with no new RESULT means it ended its turn without one.
 *
 * What it saw goes into the watch's record (cli/observed.ts), the same record the event tailer writes, and a row is
 * made when the record changes, so a turn end both sensors see is one row. A watch seen for the first time makes no
 * row but a RESULT version nobody reported.
 *
 * Events (source `agents`, place = the session name):
 *   event=result  state=<status>               one row per RESULT version (sha256 of the newest RESULT*.md)
 *   event=ended   state=gone                   no agent process in the pane any more; the note says how to resume it
 *   event=stalled state=quiet                  working, and no output for --stall-min minutes; once per quiet spell
 *   event=ask     state=<kind>                 the session waits on an answer; recorded on the second sighting
 *   event=idle    state=no-result              a turn ended and made no new result row
 * A session that stops asking has its live ask rows archived. A session whose RESULT says `done` stays on the list.
 * It comes off only by `inbox agent close`: an entry it marked `closing` records only a new RESULT version, and is
 * removed once no agent is left in its pane.
 *
 * Progress digest (every --digest-min minutes): one progress card (`agents`: one row per session, status,
 * idle minutes, the tail behind a tap; sessions that need the user first) for each running session whose entry
 * changed since the last digest sent; an entry is its status plus its line without the `last activity` time, so a
 * session turning to `waiting on question` with the same tail is news. With no channel watched in `mode: personal`
 * it is the one self-chat card listing every changed session. With one, nothing goes to the self-chat: each changed
 * session's card goes to its own thread in that channel — the watch's `thread` field first, then the thread the
 * channel's cursor binds to `agent:<name>`, else a new root post (subject `🤖 <name>`) whose id is bound in that
 * cursor the moment Teams answers, so replies route to the session and a crash between runs never posts a second
 * root. The card is built here and sent through the Teams core's own send, with no model in between: a model asked
 * to copy it could be refused by a content filter or time out after the send. A card send that fails is logged and
 * the same digest goes out as plain text. A digest counts as sent only when Teams accepted it; otherwise the run
 * fails, naming the send, and the next due run sends it again — per thread, so a failed one does not lose the
 * receipts of the threads that succeeded.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { agentFooterText, buildCard, setAgentHarness, type AgentRow, type AgentStatus } from "../../teams/card.ts";
import { escapeHtml } from "../../teams/html.ts";
import type { SendTarget } from "../../teams/types.ts";
import { compareIds, cursorKey, loadCursor, updateCursor, type CursorFile, type ThreadBinding } from "../../teams/cursor-store.ts";
import { askShown, legacyReported, minuteAtLeast, readAgents, recordAgentRow, removeClosed, resolveAsks, type AgentEntry } from "./agents.ts";
import { runProcess } from "./jobs.ts";
import { inboxFile, InboxError, readRulesFile, readTsv } from "./ledger.ts";
import { readObserved, updateObserved, type Observed, type Phase } from "./observed.ts";
import { checkThens } from "./thens.ts";

export interface Probe {
	alive: boolean;
	agent: string;
	state: string;
	session: string;
	smtime: number;
	waiting: boolean;
	text: string;
	rmtime: number;
	/** Path of the newest RESULT*.md in the run directory. Empty when none exists. */
	rfile?: string;
	/** First 16 hex of that file's sha256. Empty when none exists. */
	rhash?: string;
	rstatus?: string;
	ropen?: string;
	ropen_text?: string;
	/** The RESULT block's last `verified:` line. Empty when it has none. */
	rverified?: string;
	rquestions?: boolean;
	/** gzip+base64 of the newest assistant line with a text item. Empty when the session has none. */
	last?: string;
	/** gzip+base64 of the session's last assistant line, when that line is an `ask` call still pending. */
	ask?: string;
	/** tern, tmux: the agent process in the pane, 0 when it holds only shells. Other muxes do not say. */
	agent_pid?: number;
	/** That process's working directory. */
	cwd?: string;
	/** Asked for by `inbox agent add`: how many reporter events the pane's session has in the host's agent-events.jsonl. */
	events?: number;
	now: number;
	kind?: "jsonl" | "pane";
	tail?: string;
}

type Event = { key: string; event: string; state: string; note: string; link?: string };

export interface ProbeOptions {
	stallMin: number;
	digestMin: number;
	/** No progress digest this run. */
	noDigest?: boolean;
	probe?: (a: AgentEntry, want: boolean) => Promise<Probe>;
	/** Where the digest goes (default: the Teams core's send to the self-chat). */
	sender?: DigestSender;
	now?: () => number;
	log?: (line: string) => void;
}

const SCRIPT = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "probe.sh"), "utf8");
const EMPTY = createHash("md5").update("").digest("hex").slice(0, 16);
const DIGEST = "_digest";
const CLIP = 300;
const PROBE_TIMEOUT_S = 60;
/** One Teams send of the digest: Graph has no deadline of its own, and a stuck send must fail the run, not hang it. */
const SEND_TIMEOUT_MS = 120_000;

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Run probe.sh where the pane lives. A failed ssh is an error, not a dead pane. `want` asks for the text tail, `events` for the session's reporter event count. */
export async function runProbe(a: AgentEntry, want = false, events = false): Promise<Probe> {
	const host = a.host || "local";
	const local = host === "local";
	const result = local ? (a.result ?? "").replace(/^~(?=\/|$)/, os.homedir()) : (a.result ?? "");
	const args = [a.mux, String(a.pane), result, want ? "1" : "", events ? "1" : ""];
	const argv = local
		? ["bash", "-c", SCRIPT, "probe", ...args]
		: /^(?!-)[A-Za-z0-9._@:-]+$/.test(host)
			? ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, `bash -c ${quote(SCRIPT)} probe ${args.map(quote).join(" ")}`]
			: null;
	if (!argv) throw new InboxError(`bad ssh host: ${host}`);
	const out = await runProcess(argv, PROBE_TIMEOUT_S, `probe on ${host}`);
	const line = out.split("\n").at(-1) ?? "";
	if (!line.startsWith("{")) throw new InboxError(`probe on ${host} printed no JSON: ${out.slice(0, 200)}`);
	const probe = JSON.parse(line) as Probe;
	for (const key of ["agent", "state", "session", "rstatus", "ropen_text", "rverified", "rfile", "cwd"] as const) {
		const value = probe[key];
		if (typeof value === "string") probe[key] = Buffer.from(value, "base64").toString("utf8");
	}
	return probe;
}

/** What the session is doing, from one probe: no agent is left in the pane, it waits on an answer, its turn ended, or it runs. */
export function phaseOf(p: Probe): Phase {
	if (!p.alive || p.agent_pid === 0) return "gone";
	if (p.state === "blocked") return "asking";
	return p.waiting || p.state === "idle" || p.state === "done" ? "idle" : "working";
}

export interface ResultOf {
	version: string;
	status: string;
	open: string;
	file: string;
	mtime: number;
}

/** The newest RESULT*.md of a watch, read where the pane lives. All empty/0 when `result` is unset or no file exists. mux `none` touches no pane. */
export async function resultOf(a: { host?: string; result?: string }): Promise<ResultOf> {
	if (!a.result) return { version: "", status: "", open: "", file: "", mtime: 0 };
	const p = await runProbe({ name: "", mux: "none", pane: "", host: a.host || "local", result: a.result }, false);
	return { version: p.rhash ?? "", status: p.rstatus ?? "", open: p.ropen_text ?? "", file: p.rfile ?? "", mtime: p.rmtime || 0 };
}

/** Whitespace collapsed to single spaces, the newest CLIP characters, with a leading … when cut. */
export function oneLine(text: string): string {
	const t = text.split(/\s+/).filter(Boolean).join(" ");
	return t.length <= CLIP ? t : `\u2026${t.slice(-(CLIP - 1))}`;
}

type Msg = { role?: string; toolName?: string; content?: unknown; details?: { phases?: { tasks?: { status?: string; content?: string }[] }[] } };

/** The newest assistant text in an omp session tail, then the latest todo state. Lines that do not parse are skipped. */
export function latestLine(jsonl: string): string {
	const msgs: Msg[] = [];
	for (const raw of jsonl.split("\n")) {
		try {
			const msg: unknown = JSON.parse(raw)?.message;
			if (msg && typeof msg === "object" && !Array.isArray(msg)) msgs.push(msg as Msg);
		} catch {}
	}
	let text = "";
	for (const msg of msgs.toReversed()) {
		if (msg.role !== "assistant") continue;
		const items = Array.isArray(msg.content) ? msg.content : [];
		text = items
			.filter((i): i is { type: string; text?: string } => !!i && typeof i === "object" && i.type === "text")
			.map((i) => i.text ?? "")
			.filter((t) => t.trim())
			.join(" ");
		if (text) break;
	}
	let out = text ? oneLine(text) : "no text";
	const todo = msgs.findLast((m) => m.role === "toolResult" && m.toolName === "todo");
	if (todo) {
		const tasks = (todo.details?.phases ?? []).flatMap((p) => p.tasks ?? []);
		const done = tasks.filter((t) => t.status === "completed").length;
		const now = tasks.find((t) => t.status === "in_progress")?.content;
		out += ` [todo ${done}/${tasks.length}${now !== undefined ? `, now: ${oneLine(now)}]` : "]"}`;
	}
	return out;
}

/** The last non-empty line of a pane capture, or `no text`. */
export function paneLine(text: string): string {
	const lines = text.split("\n").filter((l) => l.trim());
	return lines.length ? oneLine(lines.at(-1)!) : "no text";
}

const hhmm = (epoch: number) => {
	const d = new Date(epoch * 1000);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** A session's digest line and its progress-card row. */
type Entry = { line: string; row: AgentRow };

/** One progress-card row (teams_send `agents`). `active`: epoch seconds of the session's last output, when known. */
export function cardRow(a: AgentEntry, active: number | undefined, now: number, status: AgentStatus, tail: string): AgentRow {
	const idle = Math.floor(Math.max(0, now - (active ?? now)) / 60);
	return { name: a.name, host: a.host || "local", idle_min: idle, status, tail };
}

/**
 * Only a real ask needs the user: a pending ask card or approval (state blocked), or a RESULT blocked with a
 * non-empty open line. Empty values such as none and 无 are not questions. A turn that ended otherwise is idle.
 */
export function cardStatus(p: Probe): AgentStatus {
	const open = p.ropen_text?.trim().toLowerCase().replace(/[.。]+$/u, "") ?? "";
	const question = Boolean(open) && !["none", "n/a", "na", "null", "nil", "-", "no", "无", "没有", "无问题"].includes(open);
	if (p.rstatus === "done") return "done";
	if (p.state === "blocked" || (p.rstatus === "blocked" && question)) return "waiting on question";
	if (p.rstatus || p.waiting || ["idle", "done"].includes(p.state)) return "idle";
	return "working";
}

/** A running session's entry, from the probe's tail. The tail may start mid-line; latestLine skips that. */
function sessionEntry(a: AgentEntry, active: number | undefined, p: Probe): Entry {
	const text = gunzipSync(Buffer.from(p.tail ?? "", "base64")).toString("utf8");
	const latest = p.kind === "jsonl" ? latestLine(text) : paneLine(text);
	const line = `- ${a.name} \u00b7 ${a.host || "local"} \u00b7 last activity ${hhmm(active ?? p.now)} \u00b7 ${latest}`;
	return { line, row: cardRow(a, active, p.now, cardStatus(p), latest) };
}

/** What an entry says, minus its `last activity` time: the part compared with the last digest sent. The card status
 * is part of it, so a session turning to `waiting on question` with the same tail is still news. */
export const unchanged = (e: Entry) => `${e.row.status}:${e.line.replace(/ \u00b7 last activity \d\d:\d\d/, "")}`;

/** Where a channel digest goes: one thread of a personal channel — a reply into `replyTo`, or a root post with `subject`. */
export interface ThreadTarget {
	teamId: string;
	channelId: string;
	/** The thread's root message id: the digest replies inside its thread. */
	replyTo?: string;
	/** A new thread's subject: the digest starts one. */
	subject?: string;
}

/**
 * How the digest reaches Teams. Each call resolves with Teams' receipt once Teams accepted the message, and rejects
 * otherwise. A channel post also answers with the new message's id, so a root send can bind its thread.
 */
export interface DigestSender {
	card(spec: { title: string; agents: AgentRow[] }): Promise<string>;
	text(digest: string): Promise<string>;
	channelCard(target: ThreadTarget, spec: { title: string; text: string; agents: AgentRow[] }): Promise<{ receipt: string; id?: string }>;
	channelText(target: ThreadTarget, digest: string): Promise<{ receipt: string; id?: string }>;
	/** Verifies the personal channel stays private (only the user): refuses routing when it does not. */
	verifyPersonal?(channel: { teamId: string; channelId: string }): Promise<{ ok: boolean; reason: string }>;
}

/** The Teams core's send, as the probe calls it: no images, files or mentions. A channel post answers with the new message's id as well. */
type TeamsSend = (target: SendTarget, message: string, html: boolean, mentions: [], images: [], card?: Record<string, unknown>) => Promise<string | { text: string; id?: string }>;

/** One send's answer: its receipt, and the new message's id when it made one. */
const posted = (r: string | { text: string; id?: string }): { receipt: string; id?: string } =>
	typeof r === "string" ? { receipt: r } : { receipt: r.text, ...(r.id !== undefined ? { id: r.id } : {}) };

/**
 * A DigestSender over the Teams core's `send`: the progress card built by teams/card.ts, or the digest as escaped
 * HTML text ending with the agent footer, so the self-chat watch reads it as the agent's. A digest tail may hold any
 * text; nothing in it is read as a mention. A channel send addresses one thread: a reply (`replyTo`), or a root
 * post (`subject`).
 */
export function teamsSender(send: TeamsSend): DigestSender {
	const asText = (digest: string) => escapeHtml(`${digest}\n\n${agentFooterText()}`).replaceAll("\n", "<br>");
	return {
		card: async (spec) => posted(await send({ kind: "self" }, "", true, [], [], buildCard({ ...spec, text: "" }))).receipt,
		text: async (digest) => posted(await send({ kind: "self" }, asText(digest), true, [], [])).receipt,
		channelCard: (target, spec) => send({ kind: "channel", ...target }, "", true, [], [], buildCard(spec)).then(posted),
		channelText: (target, digest) => send({ kind: "channel", ...target }, asText(digest), true, [], []).then(posted),
	};
}

/** The personal channel the digest routes to, when `rules.yaml` watches one: its team and channel ids, else undefined. */
export function personalChannel(): { teamId: string; channelId: string } | undefined {
	const watch = readRulesFile().teams_watch as { channels?: { channel?: string; team_id?: string; channel_id?: string; mode?: string }[] } | undefined;
	const c = watch?.channels?.find((w) => w.mode === "personal");
	if (!c) return undefined;
	if (!c.team_id || !c.channel_id) throw new InboxError(`rules.yaml teams_watch: the personal channel "${c.channel}" needs team_id and channel_id`);
	return { teamId: c.team_id, channelId: c.channel_id };
}

/**
 * Where one changed session's progress goes in the personal channel: its entry's `thread` first, then the thread the
 * channel's cursor binds to `agent:<name>` (the most recent id when several), else undefined (the caller creates one).
 */
export function boundThread(a: AgentEntry, cursorThreads: Record<string, ThreadBinding>): string | undefined {
	const t = a.thread !== undefined ? String(a.thread).trim() : "";
	if (t) return t;
	const bound = Object.entries(cursorThreads).filter(([, b]) => b.owner === `agent:${a.name}`).map(([id]) => id);
	return bound.sort(compareIds).at(-1);
}

/** Records a new root's thread in the personal channel's cursor, so the next poll and the next digest route to the session. */
export function bindNewThread(key: string, rootId: string, agent: string, subject: string): void {
	updateCursor(key, (c) => ({ ...c, threads: { ...c.threads, [rootId]: { owner: `agent:${agent}`, subject } } }));
}

export function threadSubject(name: string): string {
	return `🤖 ${name}`;
}

/** The Teams core, behind its own send. The footer names the inbox as the sending agent. */
export async function coreSender(): Promise<DigestSender> {
	// Imported only when a digest is due: the core pulls in MSAL and the Graph client, which every other `inbox`
	// command (each a fresh process) would otherwise load for nothing.
	const { createTeams } = await import("../../teams/core.ts");
	setAgentHarness("inbox");
	const teams = createTeams({
		registerTool: () => {},
		exec: async (command, args, options) => {
			try {
				return { code: 0, stdout: await runProcess([command, ...args], Math.ceil((options.timeout ?? 150_000) / 1000), command, options.cwd), stderr: "" };
			} catch (e) {
				return { code: 1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
			}
		},
		sendMessage: () => {
			throw new Error("the probe watches no chat");
		},
		sendUserMessage: () => {
			throw new Error("the probe watches no chat");
		},
	});
	// sendPosted, not send: a channel root post must answer with its id, so the digest can bind the thread it made.
	const sender = teamsSender(async (target, message, html, mentions, images, card) => {
		const { text, post } = await teams.sendPosted(target, message, html, mentions, images, card);
		return post?.id === undefined ? text : { text, id: post.id };
	});
	// verifyPersonal is the same privacy gate the channel watch uses: the digest refuses to route to a channel that
	// is not a private channel whose only member is the user, even though rules.yaml still says mode: personal.
	return { ...sender, verifyPersonal: (channel) => teams.verifyPersonal(channel) };
}

/** `send`, failing with `what` and the cause, or with a timeout after SEND_TIMEOUT_MS. The deadline holds the process open: a send nothing else waits on still ends in an answer. */
async function within<T>(what: string, send: () => Promise<T>): Promise<T> {
	const { promise: deadline, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new Error(`timed out after ${SEND_TIMEOUT_MS / 1000}s`)), SEND_TIMEOUT_MS);
	try {
		return await Promise.race([send(), deadline]);
	} catch (e) {
		throw new InboxError(`${what}: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		clearTimeout(timer);
	}
}

/** The digest to the self-chat: the progress card, else (logged) the same digest as plain text. */
async function postDigest(digest: string, rows: AgentRow[], sender: DigestSender | undefined, log: (line: string) => void): Promise<string> {
	const to = sender ?? (await coreSender());
	try {
		return await within("Teams card send", () => to.card({ title: digest.split("\n")[0]!, agents: rows }));
	} catch (e) {
		log(`progress card not sent, sending the text digest: ${e instanceof Error ? e.message : String(e)}`);
	}
	return within("Teams text send", () => to.text(digest));
}

/**
 * Delivers each changed session's progress to its own thread in the personal channel and returns the names whose
 * send Teams accepted. Fails loudly before posting anything when the channel has no cursor yet, so an unstarted
 * watch never accumulates orphan roots. A session with no bound thread gets a new root, and that root's id is bound
 * in the cursor the moment Teams answers, before any other send. Sessions sharing a thread go in one card (with
 * plain-text fallback if the card send fails). A failed send is reported through `fail` and leaves its sessions
 * unrecorded, so the next due run owes them again; the others are unaffected.
 */
async function sendToThreads(
	fresh: [string, Entry][],
	channel: { teamId: string; channelId: string },
	sender: DigestSender | undefined,
	log: (line: string) => void,
	fail: (name: string, e: unknown) => void,
): Promise<Set<string>> {
	const key = cursorKey({ teamId: channel.teamId, channelId: channel.channelId });
	let cursor: CursorFile | null;
	try {
		cursor = loadCursor(key);
	} catch (e) {
		fail("progress digest not sent", e);
		return new Set();
	}
	if (!cursor) {
		fail("progress digest not sent", new InboxError(`personal channel ${channel.channelId} has no cursor yet; start teams_watch on it first`));
		return new Set();
	}
	let to: DigestSender;
	try {
		to = sender ?? (await coreSender());
	} catch (e) {
		fail("progress digest not sent", e);
		return new Set();
	}
	if (to.verifyPersonal) {
		// The channel's privacy is re-checked before any post: rules.yaml may still say personal after a live watch
		// refused or downgraded the channel, and routing agent progress into a shared channel would leak it.
		try {
			const check = await to.verifyPersonal({ teamId: channel.teamId, channelId: channel.channelId });
			if (!check.ok) {
				fail("progress digest not sent", new InboxError(`personal channel ${channel.channelId} failed its privacy check: ${check.reason}`));
				return new Set();
			}
		} catch (e) {
			fail("progress digest not sent", e);
			return new Set();
		}
	}
	const agents = readAgents();
	const cursorThreads = cursor.threads ?? {};
	const sent = new Set<string>();
	const byThread = new Map<string, [string, Entry][]>();
	const unbound: [AgentEntry, Entry][] = [];
	for (const [name, e] of fresh) {
		const a = agents.find((x) => x.name === name);
		if (!a) continue;
		const threadId = boundThread(a, cursorThreads);
		if (threadId === undefined) unbound.push([a, e]);
		else byThread.set(threadId, [...(byThread.get(threadId) ?? []), [name, e]]);
	}
	const sendChannel = async (target: ThreadTarget, spec: { title: string; text: string; agents: AgentRow[] }, digestText: string) => {
		try {
			return await within("Teams channel card send", () => to.channelCard(target, spec));
		} catch (e) {
			log(`progress card not sent, sending the text digest: ${e instanceof Error ? e.message : String(e)}`);
		}
		return within("Teams channel text send", () => to.channelText(target, digestText));
	};
	for (const [threadId, group] of byThread) {
		try {
			const title = group.map(([n, e]) => `${n} · ${e.row.status}`).join(" · ");
			const digestText = `${title}\n${group.map(([, e]) => e.line).join("\n")}`;
			const { receipt } = await sendChannel(
				{ teamId: channel.teamId, channelId: channel.channelId, replyTo: threadId },
				{ title, text: "", agents: group.map(([, e]) => e.row) },
				digestText,
			);
			log(`progress to thread ${threadId}: ${receipt}`);
			for (const [n] of group) sent.add(n);
		} catch (e) {
			for (const [n] of group) fail(n, e);
		}
	}
	for (const [a, e] of unbound) {
		try {
			const subject = threadSubject(a.name);
			const goal = a.goal ? `Goal: ${a.goal}` : "";
			const digestText = [subject, ...(goal ? [goal] : []), e.line].join("\n");
			const posted = await sendChannel(
				{ teamId: channel.teamId, channelId: channel.channelId, subject },
				{ title: subject, text: goal, agents: [e.row] },
				digestText,
			);
			if (posted.id === undefined) throw new Error("Teams did not return the new thread's id");
			// Bound before anything else: a crash after this point cannot post a second root for this session.
			bindNewThread(key, posted.id, a.name, subject);
			log(`progress to new thread ${posted.id} for ${a.name}: ${posted.receipt}`);
			sent.add(a.name);
		} catch (e) {
			fail(a.name, e);
		}
	}
	return sent;
}

const LAST_CAP = 1500;

/** The session's last assistant text: the newest LAST_CAP characters, with a leading … when cut. None is `no text`. */
function lastOutput(p: Probe): string {
	if (!p.last) return "no text";
	const raw = gunzipSync(Buffer.from(p.last, "base64")).toString("utf8");
	const text = latestLine(raw).replace(/ \[todo .*$/, "");
	return text.length <= LAST_CAP ? text : `\u2026${text.slice(-(LAST_CAP - 1))}`;
}

/** The pending ask a probe saw: the tool call's id and its question (omp `ask`: `questions[0]`, or the text of `html`). */
function askOf(p: Probe): { id?: string; question?: string; options: string[] } {
	if (!p.ask) return { options: [] };
	const message = JSON.parse(gunzipSync(Buffer.from(p.ask, "base64")).toString("utf8"))?.message as { content?: unknown } | undefined;
	const items = (Array.isArray(message?.content) ? message.content : []) as { type?: string; name?: string; id?: string; arguments?: { html?: unknown; questions?: unknown } }[];
	const call = items.findLast((item) => item?.type === "toolCall" && item.name === "ask");
	const first = (Array.isArray(call?.arguments?.questions) ? call.arguments.questions[0] : undefined) as { question?: unknown; options?: unknown } | undefined;
	const html = call?.arguments?.html;
	const question = typeof first?.question === "string" ? first.question : typeof html === "string" ? html.replace(/<[^>]*>/g, " ") : "";
	const options = (Array.isArray(first?.options) ? first.options : [])
		.map((o) => (typeof o === "string" ? o : String((o as { label?: unknown } | null)?.label ?? "")))
		.filter(Boolean);
	return { id: call?.id, question: oneLine(question) || undefined, options };
}

/** The agent process a probe found in the pane, with the id in its omp session file name (`<time>_<id>.jsonl`). Undefined when the mux names none, or the pane holds only shells. */
export function agentOf(p: Probe): Observed["agent"] {
	if (!p.agent_pid) return undefined;
	return { pid: p.agent_pid, session: path.basename(p.session, ".jsonl").split("_").at(-1) ?? "", sessionFile: p.session, cwd: p.cwd ?? "" };
}

/**
 * One probe against the watch's record: the record as it is after this probe, and the events the change owes.
 * `prev` undefined is a first observation: it owes nothing but a RESULT version nobody reported.
 */
function observe(a: AgentEntry, prev: Observed | undefined, p: Probe, stallS: number): { next: Observed; events: Event[] } {
	const now = p.now;
	const phase = phaseOf(p);
	const next: Observed = { ...prev, phase, at: now * 1000, by: "probe" };
	const events: Event[] = [];
	let active = p.smtime || 0;
	// A pane with no session file shows life only as changed text. An empty capture hashes the same every time and says nothing.
	if (!p.session && p.text && p.text !== EMPTY && p.text !== prev?.text) {
		active = Math.max(active, now);
		next.text = p.text;
	}
	if (p.state === "working") active = Math.max(active, now);
	active = Math.max(prev?.active ?? now, active);
	next.active = active;
	// Kept when the agent is gone: the resume line needs it.
	const agent = agentOf(p);
	if (agent) next.agent = agent;
	const version = p.rhash ?? "";
	const settled = phase !== "working" || (!p.session && !p.state);
	if (p.rstatus && version && settled && !legacyReported(a.name, p.rmtime)) {
		const file = p.rfile && p.rfile !== (a.result ?? "") ? ` File: ${p.rfile}.` : "";
		const open = p.ropen_text ? ` Open: ${p.ropen_text}.` : "";
		events.push({ key: `result:${version}`, event: "result", state: p.rstatus, note: `RESULT status: ${p.rstatus}.${open}${file}`, link: p.rfile || a.result || "" });
	}
	if (phase !== "asking") delete next.ask;
	// Asking with no sightings: the event tailer recorded this ask when it happened.
	else if (!(prev?.phase === "asking" && !prev.ask)) {
		const ask = askOf(p);
		// A mux that only says "blocked" names no ask: the spell is one ask, from its first sighting.
		const id = ask.id ?? prev?.ask?.id ?? String(active);
		const sightings = prev?.ask?.id === id ? prev.ask.sightings + 1 : 1;
		next.ask = { id, sightings };
		// The second sighting: an ask answered between two probes is no row.
		if (sightings === 2) {
			const options = ask.options.length ? ` [options: ${ask.options.join(" | ")}]` : "";
			events.push(ask.question
				? { key: `ask:${id}`, event: "ask", state: "ask", note: `waiting on ask: ${ask.question}${options}` }
				: { key: `ask:${id}`, event: "ask", state: "approval", note: `waiting on approval: ${a.mux} says the agent waits on an approval or a question. Last output: ${lastOutput(p)}` });
		}
	}
	if (!prev) return { next, events };
	if (phase === "gone" && prev.phase !== "gone") {
		const agent = next.agent;
		const resume = agent?.session
			? ` Resume: ${agent.cwd ? `cd ${agent.cwd} && ` : ""}omp --resume ${agent.session}, then inbox agent add ${a.name} --mux ${a.mux} --pane <new pane>`
			: "";
		events.push({ key: `gone:${agent?.pid ?? a.since ?? ""}`, event: "ended", state: "gone", note: `no agent process in ${a.mux} pane ${a.pane} on ${a.host || "local"}. RESULT status: ${p.rstatus || "none"}.${resume}` });
	}
	const quiet = now - active;
	if (phase === "working" && quiet >= stallS)
		events.push({ key: `stalled:${active}`, event: "stalled", state: "quiet", note: `no output for ${Math.floor(quiet / 60)} min` });
	// A turn end: the session was running or asking, or (a session with no reporter, whose turn began and ended
	// between two probes) it was idle and has produced output since. It is read and given a verdict, so it is never
	// silent; the caller drops this event when the pass made a result row.
	if (phase === "idle" && (prev.phase === "working" || prev.phase === "asking" || (prev.phase === "idle" && prev.by === "probe" && active > (prev.active ?? 0))))
		events.push({ key: `idle:${active}`, event: "idle", state: "no-result", note: `turn ended with no new RESULT. Last output: ${lastOutput(p)}` });
	return { next, events };
}

/** Stall and turn-end rows carry the session, so the same second of another session of the name is another row. */
function record(a: AgentEntry, session: string, e: Event): string {
	const own = (e.event === "stalled" || e.event === "idle") && session ? `${session}:` : "";
	return recordAgentRow({
		source: "agents",
		place: a.name,
		key: `agents:${a.name}:${own}${e.key}`,
		subject: `agent ${a.name}`,
		note: a.goal ? `${e.note.replace(/\.$/, "")}. Goal: ${a.goal}` : e.note,
		link: e.link || a.result || "",
		fields: [`event=${e.event}`, `state=${e.state}`, `mux=${a.mux}`, `host=${a.host || "local"}`],
	});
}

/** A row of this quiet spell exists under a key an older build made (`agents:<name>:<launch id>:stalled:<n>`): a deploy does not report the stall again. */
function stallShown(name: string, key: string): boolean {
	return [...readTsv(inboxFile("ledger.tsv")), ...readTsv(inboxFile("archive.tsv"))].some((row) => row.key.startsWith(`agents:${name}:`) && row.key.endsWith(`:${key}`));
}

/**
 * A no-result row of the session was made at or after its last output: a tailer that does not write the record (a
 * coordinator still running an older build) already reported this turn end. The tag finds a row whose note a
 * verdict rewrote; the note finds it under rules that tag it otherwise.
 */
function turnEndShown(name: string, active: number): boolean {
	return [...readTsv(inboxFile("ledger.tsv")), ...readTsv(inboxFile("archive.tsv"))].some((row) =>
		row.source === "agents" && row.key.startsWith(`agents:${name}:`) && (row.tag === "agent-no-result" || row.note.startsWith("turn ended with no ")) && minuteAtLeast(row.first_seen, active));
}

/** One probe pass over every watched session. Returns the log lines; throws when anything failed. */
export async function probeAgents(o: ProbeOptions): Promise<string> {
	const probe = o.probe ?? runProbe;
	const out: string[] = [];
	const log = o.log ?? ((l: string) => out.push(l));
	const agents = readAgents();
	const before = readObserved();
	const now = Math.floor((o.now ?? Date.now)() / 1000);
	const last = before.digest?.at;
	const digestDue = !o.noDigest && (last === undefined || now - last >= o.digestMin * 60);
	const lines: [string, Entry][] = [];
	const errors: string[] = [];
	const fail = (name: string, e: unknown) => errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
	// Probes run side by side (each can wait on ssh); events are recorded in list order.
	const probed = await Promise.all(
		agents.map(async (a) => {
			try {
				return { a, p: await probe(a, digestDue) };
			} catch (e) {
				return { a, error: e };
			}
		}),
	);
	for (const r of probed) {
		const { a } = r;
		if (!("p" in r)) {
			fail(a.name, r.error);
			if (digestDue) {
				const cause = String(r.error instanceof Error ? r.error.message : r.error).slice(0, 200);
				const line = `- ${a.name} \u00b7 ${a.host || "local"} \u00b7 probe failed: ${cause}`;
				lines.push([a.name, { line, row: cardRow(a, before.watches[a.name]?.active, now, "probe failed", cause) }]);
			}
			continue;
		}
		const { p } = r;
		try {
			// The record changes and its rows are written under the record's lock, and the record is saved only when
			// every row was: a failed row is owed again on the next pass, and the tailer cannot report the same change.
			const seen = await updateObserved((state) => {
				const prev = state.watches[a.name];
				// An event newer than this probe already told what happened since.
				if (prev && prev.at > p.now * 1000) return { made: [], recorded: false, active: prev.active };
				const { next, events } = observe(a, prev, p, o.stallMin * 60);
				const made: string[] = [];
				let recorded = false;
				let resultNew = false;
				if (prev?.phase === "asking" && next.phase !== "asking") {
					const ids = resolveAsks(a.name);
					if (ids.length) made.push(`${a.name}: ask resolved -> archived ${ids.join(" ")}`);
				}
				const add = (e: Event) => {
					const reply = record(a, next.agent?.session ?? "", e);
					if (/^(do|notify) /.test(reply)) {
						recorded = true;
						if (e.event === "result") resultNew = true;
					}
					made.push(`${a.name}: ${e.event} ${e.state} -> ${reply}`);
				};
				// An acknowledged close owes nothing but a RESULT version it has not reported yet.
				const owed = (a.closing ? events.filter((e) => e.event === "result") : events)
					.filter((e) => !(e.event === "ask" && askShown(a.name)) && !(e.event === "idle" && turnEndShown(a.name, next.active ?? 0)) && !(e.event === "stalled" && stallShown(a.name, e.key)));
				for (const e of owed.filter((event) => event.event !== "idle")) add(e);
				if (!resultNew) for (const e of owed.filter((event) => event.event === "idle")) add(e);
				state.watches[a.name] = next;
				return { made, recorded, active: next.active };
			});
			if (digestDue && p.alive) {
				try {
					lines.push([a.name, sessionEntry(a, seen.active, p)]);
				} catch (e) {
					fail(`${a.name}: digest line`, e);
				}
			}
			if (a.closing && phaseOf(p) === "gone" && removeClosed(a)) seen.made.push(`${a.name}: closed, pane gone -> watch removed`);
			for (const line of seen.made) log(line);
			if (seen.recorded) {
				// The probe child runs this build. A coordinator that has not restarted runs an older then checker, which
				// would not fire on a version row, so the then is checked here, in this process.
				for (const line of await checkThens()) log(line);
			}
		} catch (e) {
			fail(a.name, e);
		}
	}
	// Only new information goes out: an entry equal to the one last sent for that session is dropped.
	const fresh = lines.filter(([name, e]) => unchanged(e) !== before.watches[name]?.digested);
	let personal: { teamId: string; channelId: string } | undefined;
	let routingFailed = false;
	try {
		personal = digestDue && fresh.length ? personalChannel() : undefined;
	} catch (e) {
		// A malformed teams_watch block is a routing failure, not a reason to fall back to the self-chat digest: the
		// run fails below, the state cleanup still runs, and the next due run owes the sessions again.
		routingFailed = true;
		fail("progress digest not sent", e);
		personal = undefined;
	}
	if (personal || routingFailed) {
		// Per-thread delivery: each session's receipt is recorded alone, so a failed thread is owed again on its own.
		const sentNames = personal ? await sendToThreads(fresh, personal, o.sender, log, fail) : new Set<string>();
		await updateObserved((state) => {
			const watched = new Set(readAgents().map((a) => a.name));
			for (const name of Object.keys(state.watches)) if (!watched.has(name)) delete state.watches[name];
			if (sentNames.size) state.digest = { at: now };
			for (const [name, e] of fresh) if (sentNames.has(name) && state.watches[name]) state.watches[name].digested = unchanged(e);
		});
		if (errors.length) throw new InboxError([...out, ...errors].join("\n"));
		return out.join("\n");
	}
	let sent = false;
	if (digestDue && lines.length && !fresh.length) {
		log("progress digest due, nothing changed since the last one; not sent");
		sent = true;
	} else if (digestDue && fresh.length) {
		const digest = `agent progress ${hhmm(now)} \u00b7 ${fresh.length} changed\n${fresh.map(([, e]) => e.line).join("\n")}`;
		try {
			log(`progress digest: ${await postDigest(digest, fresh.map(([, e]) => e.row), o.sender, log)}`);
			sent = true;
		} catch (e) {
			fail("progress digest not sent", e);
		}
	}
	await updateObserved((state) => {
		// A record of a name that is no longer watched is dropped here; the list is read again, for an add made meanwhile.
		const watched = new Set(readAgents().map((a) => a.name));
		for (const name of Object.keys(state.watches)) if (!watched.has(name)) delete state.watches[name];
		if (!sent) return;
		state.digest = { at: now };
		for (const [name, e] of fresh) if (state.watches[name]) state.watches[name].digested = unchanged(e);
	});
	if (errors.length) throw new InboxError([...out, ...errors].join("\n"));
	return out.join("\n");
}
