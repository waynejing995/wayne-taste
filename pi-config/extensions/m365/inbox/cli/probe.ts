/**
 * `inbox agent probe`: look at every watched agent session once and record what changed. A schedule job runs it.
 *
 * Per session it looks at three things, nothing in between (probe.sh does the looking, where the pane lives):
 *   - the start: is the pane (and the agent in it) still there;
 *   - the end:   has the RESULT file got its status line, and which;
 *   - the middle: is it still producing output. omp: the age of its session jsonl. herdr / hc: the agent state
 *     they report. tmux / anything else: whether the pane text changed since the last run. An agent waiting for its
 *     next prompt is idle, never stalled; idle with no RESULT means it ended its turn without writing one.
 *
 * Events (source `agents`, place = the session name):
 *   event=result  state=done|partial|blocked   once per RESULT status + open items
 *   event=gone    state=exited                 the pane or agent ended with no RESULT
 *   event=stalled state=quiet                  no output for --stall-min minutes; once per quiet spell
 *   event=blocked state=waiting                herdr or hc says the agent waits, or omp's last message is a pending ask
 *   event=idle    state=no-result              the turn ended and the RESULT has no status line; once per idle spell
 * A session whose RESULT says `done` is taken off the list once its event is recorded. Entries with `push: true`
 * report their own events (the m365 inbox extension tails them); they only get a digest line.
 *
 * Progress digest (every --digest-min minutes): one self-chat progress card, sent by a headless omp or pi through
 * `teams_send` (`agents`: one row per session, status, idle minutes, the tail behind a tap; sessions that need the
 * user first), lists each running session whose entry changed since the last digest sent; an entry is its status
 * plus its line without the `last activity` time, so a session turning to `waiting on question` with the same tail
 * is news. A card send that fails is logged and the same digest goes out as plain text. A send counts only when the
 * agent's JSON event stream shows one successful self-chat `teams_send` with the receipt and the arguments verbatim.
 * Run state is cursors/agent-watch.json, never rules.yaml.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";
import type { AgentRow, AgentStatus } from "../../teams/card.ts";
import { readAgents, removeAgents, type AgentEntry } from "./agents.ts";
import { agentArgv, runProcess } from "./jobs.ts";
import { addEvent, inboxFile, InboxError } from "./ledger.ts";

export interface Probe {
	alive: boolean;
	agent: string;
	state: string;
	session: string;
	smtime: number;
	waiting: boolean;
	text: string;
	rmtime: number;
	rstatus: string;
	ropen?: string;
	now: number;
	kind?: "jsonl" | "pane";
	tail?: string;
}

interface SessionState {
	last_active?: number;
	last_seen?: number;
	alive?: boolean;
	text?: string;
	result_said?: string;
	digested?: string;
}
type State = Record<string, SessionState | { at: number }>;
type Event = { key: string; event: string; state: string; note: string };

export interface ProbeOptions {
	stallMin: number;
	digestMin: number;
	/** No progress digest this run. */
	noDigest?: boolean;
	/** The headless agent the digest is sent through (default as for prompt jobs). */
	agent?: string;
	probe?: (a: AgentEntry, want: boolean) => Promise<Probe>;
	/** Sends the digest: its text and its progress-card rows. */
	post?: (digest: string, rows: AgentRow[]) => Promise<string>;
	now?: () => number;
	log?: (line: string) => void;
}

const SCRIPT = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "probe.sh"), "utf8");
const EMPTY = createHash("md5").update("").digest("hex").slice(0, 16);
const DIGEST = "_digest";
const SELF_RECEIPT = "Sent to self-chat (48:notes).";
const CARD_RECEIPT = "Sent a card to self-chat (48:notes).";
export const CARD_PROMPT = "Call `teams_send` exactly once with exactly the arguments below (JSON), copied verbatim with no edits. Do not call any other tools.\n\n";
const CLIP = 300;
const PROBE_TIMEOUT_S = 60;
const POST_TIMEOUT_S = 600;
const DIGEST_PROMPT =
	"Call `teams_send` exactly once using `target: self`. The message must be the digest below verbatim, with no edits or extra text. Do not call any other tools.\n\n";

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Run probe.sh where the pane lives. A failed ssh is an error, not a dead pane. `want` asks for the text tail. */
export async function runProbe(a: AgentEntry, want = false): Promise<Probe> {
	const host = a.host || "local";
	const local = host === "local";
	const result = local ? (a.result ?? "").replace(/^~(?=\/|$)/, os.homedir()) : (a.result ?? "");
	const args = [a.mux, String(a.pane), result, want ? "1" : ""];
	const argv = local
		? ["bash", "-c", SCRIPT, "probe", ...args]
		: ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, `bash -c ${quote(SCRIPT)} probe ${args.map(quote).join(" ")}`];
	const out = await runProcess(argv, PROBE_TIMEOUT_S, `probe on ${host}`);
	const line = out.split("\n").at(-1) ?? "";
	if (!line.startsWith("{")) throw new InboxError(`probe on ${host} printed no JSON: ${out.slice(0, 200)}`);
	return JSON.parse(line) as Probe;
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

/** One progress-card row (teams_send `agents`). */
export function cardRow(a: AgentEntry, st: SessionState, now: number, status: AgentStatus, tail: string): AgentRow {
	const idle = Math.floor(Math.max(0, now - (st.last_active ?? now)) / 60);
	return { name: a.name, host: a.host || "local", idle_min: idle, status, tail };
}

/** Anything but working or a done RESULT waits on the user: a blocked pane, a turn ended without RESULT, a partial one. */
export function cardStatus(p: Probe): AgentStatus {
	if (p.rstatus === "done") return "done";
	if (p.rstatus || p.waiting || ["blocked", "idle", "done"].includes(p.state)) return "waiting on question";
	return "working";
}

/** A running session's entry, from the probe's tail. The tail may start mid-line; latestLine skips that. */
function sessionEntry(a: AgentEntry, st: SessionState, p: Probe): Entry {
	const text = gunzipSync(Buffer.from(p.tail ?? "", "base64")).toString("utf8");
	const latest = p.kind === "jsonl" ? latestLine(text) : paneLine(text);
	const line = `- ${a.name} \u00b7 ${a.host || "local"} \u00b7 last activity ${hhmm(st.last_active ?? p.now)} \u00b7 ${latest}`;
	return { line, row: cardRow(a, st, p.now, cardStatus(p), latest) };
}

/** What an entry says, minus its `last activity` time: the part compared with the last digest sent. The card status
 * is part of it, so a session turning to `waiting on question` with the same tail is still news. */
export const unchanged = (e: Entry) => `${e.row.status}:${e.line.replace(/ \u00b7 last activity \d\d:\d\d/, "")}`;

/** A send counts only if the agent's own stream shows one successful teams_send with `receipt` and the `want` arguments verbatim. */
export function verifySend(stdout: string, want: Record<string, unknown>, receipt: string): string {
	const events: Record<string, unknown>[] = [];
	for (const line of stdout.split("\n")) {
		try {
			const ev: unknown = JSON.parse(line);
			if (ev && typeof ev === "object") events.push(ev as Record<string, unknown>);
		} catch {}
	}
	const ends = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "teams_send");
	if (ends.length !== 1) throw new InboxError(`teams_send calls: ${ends.length}; expected exactly one`);
	const end = ends[0];
	const result = end.result as { content?: { text?: string }[] } | undefined;
	const text = (result?.content ?? []).map((c) => c?.text ?? "").join("");
	if (end.isError === true) throw new InboxError(`teams_send tool error: ${text || "unknown"}`);
	if (!text.startsWith(receipt)) throw new InboxError(`teams_send receipt is not ${JSON.stringify(receipt)}: ${text || "(empty)"}`);
	const start = events.find((e) => e.type === "tool_execution_start" && e.toolCallId === end.toolCallId);
	const args = (start?.args && typeof start.args === "object" ? start.args : {}) as Record<string, unknown>;
	for (const [key, value] of Object.entries(want)) {
		const got = args[key];
		const same = typeof value === "string" ? String(got ?? "").trim() === value.trim() : isDeepStrictEqual(got, value);
		if (!same) throw new InboxError(`teams_send ${key} differs from the digest`);
	}
	return text;
}

/** stdout of one headless `--mode json` agent turn that may call only teams_send. */
async function runSend(prompt: string, agent?: string): Promise<string> {
	const argv = agentArgv(agent, prompt, ["teams_send"]);
	argv.splice(1, 0, "--mode", "json");
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-digest-"));
	try {
		return await runProcess(argv, POST_TIMEOUT_S, "digest agent", tmp);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

/** The digest to the self-chat: the progress card, else (logged) the same digest as plain text. */
async function postDigest(digest: string, rows: AgentRow[], agent: string | undefined, log: (line: string) => void): Promise<string> {
	const card = { target: "self", title: digest.split("\n")[0], message: "", agents: rows };
	try {
		return verifySend(await runSend(CARD_PROMPT + JSON.stringify(card), agent), card, CARD_RECEIPT);
	} catch (e) {
		log(`progress card not sent, sending the text digest: ${e instanceof Error ? e.message : String(e)}`);
	}
	return verifySend(await runSend(DIGEST_PROMPT + digest, agent), { message: digest, target: "self" }, SELF_RECEIPT);
}

/** The events this run owes one session, and its probe. Updates `st` in place. */
async function check(a: AgentEntry, st: SessionState, stallS: number, want: boolean, probe: NonNullable<ProbeOptions["probe"]>): Promise<{ events: Event[]; p: Probe; said?: string }> {
	const p = await probe(a, want);
	const now = p.now;
	const events: Event[] = [];
	let active = p.smtime || 0;
	// An empty capture (omp panes in tern give none) hashes the same every time and says nothing.
	if (p.text && p.text !== EMPTY && p.text !== st.text) {
		active = Math.max(active, now);
		st.text = p.text;
	}
	if (p.state === "working") active = Math.max(active, now);
	st.last_active = Math.max(st.last_active ?? now, active);
	let said: string | undefined;
	if (p.rmtime && p.rstatus) {
		// A RESULT rewritten with the same status and open items is not news; mtime alone never makes a card.
		said = `${p.rstatus}:${p.ropen ?? ""}`;
		if (said !== st.result_said) events.push({ key: `result:${p.rmtime}`, event: "result", state: p.rstatus, note: `RESULT status: ${p.rstatus}` });
	} else if (!p.alive) events.push({ key: "gone", event: "gone", state: "exited", note: "the pane ended with no RESULT" });
	else if (p.state === "blocked") events.push({ key: `blocked:${st.last_active}`, event: "blocked", state: "waiting", note: `${a.mux}: waiting on an approval or a question` });
	const quiet = now - st.last_active;
	const waiting = p.waiting || p.state === "idle" || p.state === "done";
	if (p.alive && !p.rstatus && p.state !== "blocked" && !waiting && quiet >= stallS)
		events.push({ key: `stalled:${st.last_active}`, event: "stalled", state: "quiet", note: `no output for ${Math.floor(quiet / 60)} min` });
	if (p.alive && !p.rstatus && p.state !== "blocked" && waiting)
		events.push({ key: `idle:${st.last_active}`, event: "idle", state: "no-result", note: "turn ended with no RESULT block" });
	st.last_seen = now;
	st.alive = p.alive;
	return { events, p, said };
}

function record(a: AgentEntry, e: Event): string {
	return addEvent({
		source: "agents",
		place: a.name,
		key: `agents:${a.name}:${e.key}`,
		subject: `agent ${a.name}`,
		note: a.goal ? `${e.note}. Goal: ${a.goal}` : e.note,
		link: a.result ?? "",
		fields: [`event=${e.event}`, `state=${e.state}`, `mux=${a.mux}`, `host=${a.host || "local"}`],
	});
}

/** One probe pass over every watched session. Returns the log lines; throws (after saving state) when anything failed. */
export async function probeAgents(o: ProbeOptions): Promise<string> {
	const probe = o.probe ?? runProbe;
	const out: string[] = [];
	const log = o.log ?? ((l: string) => out.push(l));
	const post = o.post ?? ((d: string, rows: AgentRow[]) => postDigest(d, rows, o.agent, log));
	const stateFile = inboxFile("cursors", "agent-watch.json");
	const agents = readAgents();
	const state: State = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
	const now = Math.floor((o.now ?? Date.now)() / 1000);
	const last = (state[DIGEST] as { at?: number } | undefined)?.at;
	const digestDue = !o.noDigest && (last === undefined || now - last >= o.digestMin * 60);
	const sessions = (name: string) => (state[name] ??= {}) as SessionState;
	const finished: string[] = [];
	const lines: [string, Entry][] = [];
	const errors: string[] = [];
	const fail = (name: string, e: unknown) => errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
	// Probes run side by side (each can wait on ssh); events are recorded in list order.
	const probed = await Promise.all(
		agents.map(async (a) => {
			const st = sessions(a.name);
			try {
				if (a.push) {
					if (!digestDue) return { a };
					const p = await probe(a, true);
					st.last_active = Math.max(st.last_active ?? 0, p.smtime || 0) || p.now;
					st.last_seen = p.now;
					return { a, entry: p.alive ? sessionEntry(a, st, p) : undefined };
				}
				return { a, ...(await check(a, st, o.stallMin * 60, digestDue, probe)) };
			} catch (e) {
				return { a, error: e };
			}
		}),
	);
	for (const r of probed) {
		const { a } = r;
		const st = sessions(a.name);
		if ("error" in r) {
			fail(a.name, r.error);
			if (digestDue) {
				const cause = String(r.error instanceof Error ? r.error.message : r.error).slice(0, 200);
				const line = `- ${a.name} \u00b7 ${a.host || "local"} \u00b7 probe failed: ${cause}`;
				lines.push([a.name, { line, row: cardRow(a, st, now, "probe failed", cause) }]);
			}
			continue;
		}
		if ("entry" in r) {
			if (r.entry) lines.push([a.name, r.entry]);
			continue;
		}
		if (!("events" in r) || !r.events || !r.p) continue;
		if (digestDue && r.p.alive && !r.events.some((e) => e.event === "result" && e.state === "done")) {
			try {
				lines.push([a.name, sessionEntry(a, st, r.p)]);
			} catch (e) {
				fail(`${a.name}: digest line`, e);
			}
		}
		try {
			for (const e of r.events) {
				log(`${a.name}: ${e.event} ${e.state} -> ${record(a, e)}`);
				if (e.event === "result") st.result_said = r.said;
				if (e.event === "result" && e.state === "done") finished.push(a.name);
			}
		} catch (e) {
			fail(a.name, e);
		}
	}
	// Only new information goes out: an entry equal to the one last sent for that session is dropped.
	const fresh = lines.filter(([name, e]) => unchanged(e) !== sessions(name).digested);
	if (digestDue && lines.length && !fresh.length) {
		log("progress digest due, nothing changed since the last one; not sent");
		state[DIGEST] = { at: now };
	} else if (digestDue && fresh.length) {
		const digest = `agent progress ${hhmm(now)} \u00b7 ${fresh.length} changed\n${fresh.map(([, e]) => e.line).join("\n")}`;
		try {
			log(`progress digest: ${await post(digest, fresh.map(([, e]) => e.row))}`);
			state[DIGEST] = { at: now };
			for (const [name, e] of fresh) sessions(name).digested = unchanged(e);
		} catch (e) {
			fail("progress digest not sent", e);
		}
	}
	const keep = new Set([...agents.map((a) => a.name), DIGEST]);
	const saved = Object.fromEntries(Object.entries(state).filter(([k]) => keep.has(k) && !finished.includes(k)));
	fs.mkdirSync(path.dirname(stateFile), { recursive: true });
	fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(saved, null, 1));
	fs.renameSync(`${stateFile}.tmp`, stateFile);
	if (finished.length) {
		removeAgents(finished);
		log(`done, no longer watched: ${finished.join(" ")}`);
	}
	if (errors.length) throw new InboxError([...out, ...errors].join("\n"));
	return out.join("\n");
}
