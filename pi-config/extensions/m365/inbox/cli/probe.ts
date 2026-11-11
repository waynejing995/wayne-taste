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
 * Progress digest (every --digest-min minutes): one self-chat message, sent by a headless omp or pi through
 * `teams_send`, lists each running session whose line changed since the last digest sent. It counts as sent only
 * when the agent's JSON event stream shows one successful self-chat `teams_send` carrying the digest verbatim.
 * Run state is cursors/agent-watch.json, never rules.yaml.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
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
	post?: (digest: string) => Promise<string>;
	now?: () => number;
	log?: (line: string) => void;
}

const SCRIPT = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "probe.sh"), "utf8");
const EMPTY = createHash("md5").update("").digest("hex").slice(0, 16);
const DIGEST = "_digest";
const SELF_RECEIPT = "Sent to self-chat (48:notes).";
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

function sessionEntry(a: AgentEntry, st: SessionState, p: Probe): string {
	const text = gunzipSync(Buffer.from(p.tail ?? "", "base64")).toString("utf8");
	const latest = p.kind === "jsonl" ? latestLine(text) : paneLine(text);
	return `- ${a.name} \u00b7 ${a.host || "local"} \u00b7 last activity ${hhmm(st.last_active ?? p.now)} \u00b7 ${latest}`;
}

/** What a digest line says, minus its `last activity` time: the part compared with the last digest sent. */
export const unchanged = (line: string) => line.replace(/ \u00b7 last activity \d\d:\d\d/, "");

/** The digest counts as sent only if the agent's own stream shows one successful self-chat teams_send carrying it verbatim. */
export function verifyDigest(stdout: string, digest: string): string {
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
	if (!text.startsWith(SELF_RECEIPT)) throw new InboxError(`teams_send receipt is not the self-chat receipt: ${text || "(empty)"}`);
	const start = events.find((e) => e.type === "tool_execution_start" && e.toolCallId === end.toolCallId);
	const args = (start?.args && typeof start.args === "object" ? start.args : {}) as { message?: unknown; target?: unknown };
	if (String(args.message ?? "").trim() !== digest.trim()) throw new InboxError("teams_send message differs from the digest");
	if (args.target !== "self") throw new InboxError(`teams_send target is ${JSON.stringify(args.target)}, expected self`);
	return text;
}

async function postDigest(digest: string, agent?: string): Promise<string> {
	const argv = agentArgv(agent, DIGEST_PROMPT + digest, ["teams_send"]);
	argv.splice(1, 0, "--mode", "json");
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-digest-"));
	try {
		return verifyDigest(await runProcess(argv, POST_TIMEOUT_S, "digest agent", tmp), digest);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
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
	const post = o.post ?? ((d: string) => postDigest(d, o.agent));
	const out: string[] = [];
	const log = o.log ?? ((l: string) => out.push(l));
	const stateFile = inboxFile("cursors", "agent-watch.json");
	const agents = readAgents();
	const state: State = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
	const now = Math.floor((o.now ?? Date.now)() / 1000);
	const last = (state[DIGEST] as { at?: number } | undefined)?.at;
	const digestDue = !o.noDigest && (last === undefined || now - last >= o.digestMin * 60);
	const sessions = (name: string) => (state[name] ??= {}) as SessionState;
	const finished: string[] = [];
	const lines: [string, string][] = [];
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
					return { a, line: p.alive ? sessionEntry(a, st, p) : undefined };
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
			if (digestDue) lines.push([a.name, `- ${a.name} \u00b7 ${a.host || "local"} \u00b7 probe failed: ${String(r.error instanceof Error ? r.error.message : r.error).slice(0, 200)}`]);
			continue;
		}
		if ("line" in r) {
			if (r.line) lines.push([a.name, r.line]);
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
	// Only new information goes out: a line equal to the one last sent for that session is dropped.
	const fresh = lines.filter(([name, line]) => unchanged(line) !== sessions(name).digested);
	if (digestDue && lines.length && !fresh.length) {
		log("progress digest due, nothing changed since the last one; not sent");
		state[DIGEST] = { at: now };
	} else if (digestDue && fresh.length) {
		const digest = `agent progress ${hhmm(now)} \u00b7 ${fresh.length} changed\n${fresh.map(([, l]) => l).join("\n")}`;
		try {
			log(`progress digest: ${await post(digest)}`);
			state[DIGEST] = { at: now };
			for (const [name, line] of fresh) sessions(name).digested = unchanged(line);
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
