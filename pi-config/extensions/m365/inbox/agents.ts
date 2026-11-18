/**
 * Push-watched agent sessions. Each session's reporter appends events to agent-events.jsonl on its host; this tails
 * that file (the local one directly, each remote one through a long-lived `ssh … tail -F`) and records what matters as
 * inbox rows. Byte cursors and per-name state live in cursors/agent-events.json, so a restart resumes where it stopped.
 *
 * Everything runs through one promise chain: events are handled strictly in order, and a cursor never moves past a
 * line whose row was not recorded. Registrations are the `push: true` entries of agent_watch in rules.yaml.
 */
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { legacyReported, readAgents } from "./cli/agents.ts";
import { resultOf } from "./cli/probe.ts";


export interface Deps {
	dir: string;
	readRules?: typeof fs.readFileSync;
	inbox: (args: string[]) => Promise<string>;
	spawn?: typeof spawnProcess;
	now?: () => number;
	deadSec?: number;
	/** First reconnect delay after a dropped ssh stream; doubles up to 60 s. */
	backoffMs?: number;
	onChange?: () => void;
	warn?: (msg: string) => void;
	/** The newest RESULT of a watch. A failure throws, so the event line is retried like a failed `inbox add`. */
	result?: (entry: Entry) => Promise<{ version: string; status: string; open: string; mtime: number }>;
}

/** `stamped`: added with `--generation`, the id its launch's reporter stamps on every event (WAYNE_AGENT_GENERATION). */
interface Entry { name: string; host: string; mux: string; since?: string; generation?: string; stamped?: boolean; instance?: string; goal?: string; result?: string; push?: boolean }
interface Event {
	v: number; ts: string; name: string; pid: number; session: string; seq: number; type: string; text?: string;
	/** The launch it belongs to, from WAYNE_AGENT_GENERATION. Absent from reporters launched without one. */
	generation?: string;
	/** On `working`: false when no prompt started the turn (an extension's message did). Absent from older reporters. */
	prompted?: boolean;
	ask?: { kind: string; question: string; options?: string[] };
	result?: { path?: string; status: string; open?: string; version?: string };
}
interface NameState {
	state: string;
	lastSeen: number;
	host: string;
	since?: string;
	generation?: string;
	/** The registration's own id (`agent add` writes one per add); entries from older inboxes have none. */
	instance?: string;
	pid?: number;
	session?: string;
	/** The last event's seq in `session`. */
	seq?: number;
	status?: string;
	/** Events that arrived before the name was registered; replayed on registration. */
	pending?: { host: string; event: Event }[];
	/** The name was taken off the list (`agent close`). Later events wait until it is registered again. */
	removed?: boolean;
}
interface Cursor { offset: number; inode?: number }
interface Stream {
	host: string;
	/** Complete lines not yet recorded; the head is the next one. */
	lines: Buffer[];
	/** Remote: bytes of a line still arriving. */
	partial: Buffer;
	/** A line failed to record; it is retried on the next tick. */
	blocked: boolean;
	child?: ChildProcess;
	timer?: NodeJS.Timeout;
	backoff: number;
	started: boolean;
	stderr: string;
}

const PENDING_MAX = 50;
const PRUNE_MS = 24 * 3600 * 1000;
const MAX_BACKOFF_MS = 60_000;
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];

/** The remote end: create the file, print `#start <offset> <inode>`, then stream from the offset. */
function remoteCommand(offset: number): string {
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error(`bad remote offset: ${offset}`);
	return `f=\${WAYNE_INBOX_DIR:-$HOME/.wayne/inbox}/agent-events.jsonl; mkdir -p "\${f%/*}"; touch "$f"; o=${offset}; [ "$(stat -c %s "$f")" -lt "$o" ] && o=0; echo "#start $o $(stat -c %i "$f")"; exec tail -c +$((o+1)) -F "$f"`;
}

/** The row an event makes (shared-contract.md table). hb, started, working and ask-resolved make none. */
function rowFor(ev: Event): { state: string; note: string } | undefined {
	switch (ev.type) {
		case "ask": {
			const kind = ev.ask?.kind ?? "ask";
			const options = ev.ask?.options?.length ? ` [options: ${ev.ask.options.join(" | ")}]` : "";
			return { state: kind, note: `waiting on ${kind}: ${ev.ask?.question ?? ev.text ?? ""}${options}` };
		}
		case "idle":
			return { state: "no-result", note: `turn ended with no RESULT. Last output: ${ev.text ?? ""}` };
		case "result": {
			const status = ev.result?.status ?? "unknown";
			const open = ev.result?.open ? ` Open: ${ev.result.open}.` : "";
			return { state: status, note: `RESULT status: ${status}.${open} Last output: ${ev.text ?? ""}` };
		}
		case "ended":
			return { state: "exited", note: "omp exited" };
		default:
			return undefined;
	}
}


/**
 * Whose event is it? An event stamped with another launch's id never reaches this registration, so a replaced
 * launch's late event never reaches its replacement. An event with no generation comes from a reporter that cannot
 * stamp (an older clone, e.g. on a remote host that has not pulled): it belongs to its name's registration, stamped
 * or not. Refusing it held every event of such a session, so a running session was reported as never started.
 */
function owns(entry: Entry, ev: Event): boolean {
	return ev.generation === undefined || ev.generation === entry.generation;
}

function hold(state: NameState, host: string, ev: Event, warn: (msg: string) => void): void {
	(state.pending ??= []).push({ host, event: ev });
	if (state.pending.length > PENDING_MAX) {
		state.pending.shift();
		warn(`${ev.name}: more than ${PENDING_MAX} events held; dropped the oldest`);
	}
}

export function readEntries(text: string, dir: string): Entry[] {
	const saved = process.env.WAYNE_INBOX_DIR;
	process.env.WAYNE_INBOX_DIR = dir;
	try {
		const parsed = YAML.parse(text) ?? {};
		const list = parsed.agent_watch ?? [];
		if (!Array.isArray(list)) throw new Error("agent_watch must be a list");
		const entries = list as Entry[];
		const migrated = entries.some((entry) => !entry.generation) ? readAgents() : entries;
		return migrated.filter((entry) => entry.push === true).map((entry) => ({ ...entry, host: entry.host || "local" }));
	} finally {
		if (saved === undefined) delete process.env.WAYNE_INBOX_DIR; else process.env.WAYNE_INBOX_DIR = saved;
	}
}

export class AgentTailer {
	private readonly eventsFile: string;
	private readonly cursorFile: string;
	private readonly rulesFile: string;
	private readonly inbox: Deps["inbox"];
	private readonly spawn: typeof spawnProcess;
	private readonly now: () => number;
	private readonly deadMs: number;
	private readonly backoffMs: number;
	private readonly onChange: () => void;
	private readonly warn: (msg: string) => void;
	private readonly local: Stream;
	private running = false;
	private queue: Promise<void> = Promise.resolve();
	private entries: Entry[] = [];
	private rulesMtime: number | null | undefined;
	private hosts: Record<string, Cursor> = {};
	private names: Record<string, NameState> = {};
	private remotes = new Map<string, Stream>();
	private readonly deps: Deps;
	private connectedSince = new Map<string, number>();
	private linkDown = new Map<string, string>();
	private errors = new Map<string, string>();

	constructor(deps: Deps) {
		this.deps = deps;
		this.eventsFile = path.join(deps.dir, "agent-events.jsonl");
		this.cursorFile = path.join(deps.dir, "cursors", "agent-events.json");
		this.rulesFile = path.join(deps.dir, "rules.yaml");
		this.inbox = deps.inbox;
		this.spawn = deps.spawn ?? spawnProcess;
		this.now = deps.now ?? Date.now;
		this.deadMs = (deps.deadSec ?? (Number(process.env.WAYNE_AGENT_DEAD_SEC) || 300)) * 1000;
		this.backoffMs = deps.backoffMs ?? 5000;
		this.onChange = deps.onChange ?? (() => {});
		this.warn = deps.warn ?? ((msg) => console.warn(`[inbox agents] ${msg}`));
		this.local = { host: "local", lines: [], partial: Buffer.alloc(0), blocked: false, backoff: this.backoffMs, started: false, stderr: "" };
	}

	/** Test seam: replace the rules reader without copying private state. */
	setRulesReader(readRules: Deps["readRules"]): void {
		this.deps.readRules = readRules;
	}

	start(): void {
		if (this.running) return;
		this.hosts = {};
		this.names = {};
		this.entries = [];
		this.rulesMtime = undefined;
		// Lines queued before a stop were never recorded; the cursor re-reads them.
		this.local.lines = [];
		this.local.blocked = false;
		try {
			const saved = JSON.parse(fs.readFileSync(this.cursorFile, "utf8"));
			this.hosts = saved.hosts ?? {};
			this.names = saved.names ?? {};
		} catch (e) {
			// A missing cursor is a fresh start (replayed rows dedup by key); a broken one is not guessed at.
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		}
		this.running = true;
		this.cursor("local");
		this.connectedSince.set("local", this.now());
		void this.poke();
	}

	stop(): void {
		this.running = false;
		for (const stream of this.remotes.values()) {
			clearTimeout(stream.timer);
			stream.child?.kill();
		}
		this.remotes.clear();
		this.connectedSince.clear();
		this.linkDown.clear();
		this.errors.clear();
	}

	/** Inbox dir changed, or the backstop: read rules, replay pending, read the local file. */
	poke(): Promise<void> {
		return this.enqueue(async () => {
			await this.refresh();
			await this.replayPending();
			await this.readLocal();
		});
	}

	/** Backstop: retry failed lines, reconnect dropped streams, expire silent sessions. */
	tick(): Promise<void> {
		return this.enqueue(async () => {
			await this.refresh();
			await this.replayPending();
			await this.readLocal();
			for (const stream of this.remotes.values()) {
				await this.drain(stream);
				this.reconnect(stream);
			}
			this.prune();
			await this.checkDead();
		});
	}

	status(): string {
		const parts = this.entries.length > 0 ? [`${this.entries.length} agents`] : [];
		for (const host of this.linkDown.keys()) parts.push(`⚠ ${host} link down`);
		for (const message of this.errors.values()) parts.push(`⚠ ${message}`);
		return parts.join(" · ");
	}

	describe(): string {
		const lines = ["Agent watches:"];
		for (const stream of [this.local, ...this.remotes.values()]) {
			const since = this.connectedSince.get(stream.host);
			const link = since !== undefined
				? `connected since ${new Date(since).toISOString()}`
				: `disconnected${this.linkDown.has(stream.host) ? ` (${this.linkDown.get(stream.host)})` : ""}`;
			lines.push(`  ${stream.host}: offset ${this.hosts[stream.host]?.offset ?? 0}, ${link}`);
		}
		for (const [name, state] of Object.entries(this.names)) {
			lines.push(`  ${name}@${state.host}: ${state.state}${state.status ? ` (${state.status})` : ""}, last seen ${new Date(state.lastSeen).toISOString()}`);
		}
		for (const message of this.errors.values()) lines.push(`  ⚠ ${message}`);
		return lines.join("\n");
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		this.queue = this.queue
			.then(() => (this.running ? task() : undefined))
			.catch((e) => { this.fail("tailer", e); });
		return this.queue;
	}

	private fail(key: string, error: unknown): void {
		const message = `${key}: ${error instanceof Error ? error.message : String(error)}`;
		if (this.errors.get(key) !== message) this.warn(message);
		this.errors.set(key, message);
		this.onChange();
	}

	private clearError(key: string): void {
		if (this.errors.delete(key)) this.onChange();
	}

	private cursor(host: string): Cursor {
		this.hosts[host] ??= { offset: 0 };
		return this.hosts[host];
	}

	private save(): void {
		fs.mkdirSync(path.dirname(this.cursorFile), { recursive: true });
		const tmp = `${this.cursorFile}.tmp`;
		fs.writeFileSync(tmp, `${JSON.stringify({ hosts: this.hosts, names: this.names }, null, 2)}\n`);
		fs.renameSync(tmp, this.cursorFile);
	}

	private async refresh(force = false): Promise<void> {
		let mtime: number | null = null;
		try {
			mtime = fs.statSync(this.rulesFile).mtimeMs;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
				this.fail("rules", e);
				return;
			}
		}
		if (!force && mtime !== null && mtime === this.rulesMtime) return;
		this.rulesMtime = mtime;
		const previous = this.entries;
		try {
			this.entries = readEntries(mtime === null ? "" : (this.deps.readRules ?? fs.readFileSync)(this.rulesFile, "utf8"), path.dirname(this.rulesFile));
			this.clearError("rules");
		} catch (e) {
			this.fail("rules", e);
			return;
		}
		for (const gone of previous) {
			if (this.entries.some((entry) => entry.name === gone.name)) continue;
			// Pending is kept: a follow-up read in the same batch as the removal waits here.
			const state = this.names[gone.name];
			if (state) state.removed = true;
		}
		for (const entry of this.entries) {
			const old = this.names[entry.name];
			// The same registration as before only when its own id matches too: a launch removed after its RESULT and
			// added again within the same second has the same since and generation, and must still be watched again.
			if (old && old.since === entry.since && old.generation === entry.generation && old.instance === entry.instance) continue;
			if (old && old.since === entry.since && !old.generation && entry.generation) {
				old.generation = entry.generation;
				continue;
			}
			const sameHost = (old?.pending ?? []).filter((item) => item.host === entry.host);
			if (sameHost.length < (old?.pending?.length ?? 0)) this.warn(`${entry.name}: dropped events from another host that arrived before registration`);
			const owned = sameHost.filter((item) => owns(entry, item.event));
			if (owned.length < sameHost.length) this.warn(`${entry.name}: dropped ${sameHost.length - owned.length} held events of another launch than registration ${entry.generation}`);
			// Held events replay on registration, so a session that finished before `agent add` still reports.
			this.names[entry.name] = {
				state: "registered", lastSeen: this.now(), host: entry.host, since: entry.since, generation: entry.generation,
				...(entry.instance ? { instance: entry.instance } : {}),
				...(owned.length > 0 ? { pending: owned } : {}),
			};
		}
		this.syncStreams();
		this.save();
		this.onChange();
	}

	/** One ssh stream per remote host that has a registered or retired name; a retired name is kept until prune() drops it. */
	private syncStreams(): void {
		const retired = Object.values(this.names).filter((state) => state.removed).map((state) => state.host);
		const wanted = new Set([...this.entries.map((entry) => entry.host), ...retired]);
		for (const [host, stream] of this.remotes) {
			if (wanted.has(host)) continue;
			clearTimeout(stream.timer);
			stream.child?.kill();
			this.remotes.delete(host);
			this.connectedSince.delete(host);
			this.linkDown.delete(host);
			this.clearError(`stream:${host}`);
		}
		for (const host of wanted) {
			if (host === "local" || this.remotes.has(host)) continue;
			const stream: Stream = { host, lines: [], partial: Buffer.alloc(0), blocked: false, backoff: this.backoffMs, started: false, stderr: "" };
			this.remotes.set(host, stream);
			this.connect(stream);
		}
	}

	/** Events that arrived before their name was registered. Each is recorded once its entry exists, in order. */
	private async replayPending(): Promise<void> {
		for (const entry of this.entries) {
			const state = this.names[entry.name];
			if (!state?.pending) continue;
			const due = state.pending;
			delete state.pending;
			for (let i = 0; i < due.length; i++) {
				try {
					await this.apply(due[i].event, due[i].host, true);
				} catch (e) {
					// apply() changes nothing when `inbox add` fails, so this event and the rest wait, in order.
					state.pending = due.slice(i);
					this.fail(`pending:${entry.name}`, e);
					break;
				}
			}
			this.save();
		}
	}

	private async readLocal(): Promise<void> {
		await this.drain(this.local);
		if (this.local.blocked) return;
		let fd: number | undefined;
		try {
			fd = fs.openSync(this.eventsFile, "r");
			const { ino, size } = fs.fstatSync(fd);
			const cursor = this.cursor("local");
			if ((cursor.inode !== undefined && cursor.inode !== ino) || size < cursor.offset) {
				this.warn("local event file replaced or truncated; restarting at offset 0");
				cursor.offset = 0;
			}
			cursor.inode = ino;
			const unread = size - cursor.offset;
			if (unread > 0) {
				const bytes = Buffer.alloc(unread);
				const read = fs.readSync(fd, bytes, 0, unread, cursor.offset);
				this.queueLines(this.local, bytes.subarray(0, read), false);
				await this.drain(this.local);
			}
			if (!this.local.blocked) this.clearError("stream:local");
		} catch (e) {
			// A file not written yet is no error; anything else is.
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") this.fail("stream:local", e);
		} finally {
			if (fd !== undefined) fs.closeSync(fd);
		}
	}

	/** Splits a chunk into complete lines; with keepPartial, the trailing bytes wait for the rest of their line. */
	private queueLines(stream: Stream, chunk: Buffer, keepPartial: boolean): void {
		const bytes = keepPartial ? Buffer.concat([stream.partial, chunk]) : chunk;
		let from = 0;
		for (let nl = bytes.indexOf(10, from); nl !== -1; nl = bytes.indexOf(10, from)) {
			stream.lines.push(bytes.subarray(from, nl));
			from = nl + 1;
		}
		stream.partial = keepPartial ? bytes.subarray(from) : Buffer.alloc(0);
	}

	/** Records lines from the head; the cursor moves only past lines recorded. A failure blocks the stream at that line. */
	private async drain(stream: Stream): Promise<void> {
		stream.blocked = false;
		const cursor = this.cursor(stream.host);
		let moved = false;
		try {
			while (stream.lines.length > 0) {
				const line = stream.lines[0];
				const event = this.parse(line, stream.host);
				if (event) {
					await this.refresh();
					await this.apply(event, stream.host);
				}
				cursor.offset += line.length + 1;
				stream.lines.shift();
				moved = true;
			}
			this.clearError(`stream:${stream.host}`);
		} catch (e) {
			stream.blocked = true;
			this.fail(`stream:${stream.host}`, e);
		} finally {
			if (moved) this.save();
		}
	}

	private parse(line: Buffer, host: string): Event | undefined {
		let ev: Event;
		try {
			ev = JSON.parse(line.toString("utf8"));
		} catch {
			this.warn(`${host}: skipped a line that is not JSON`);
			return undefined;
		}
		if (ev?.v !== 1 || typeof ev.name !== "string") {
			this.warn(`${host}: skipped a line that is not a v1 event`);
			return undefined;
		}
		return ev;
	}

	/**
	 * One event: its row if it makes one, then the name's state. Throws, changing nothing, when the row is not recorded.
	 * A name registered on another host is that host's business: this stream's events for it are ignored.
	 * `held`: the event arrived while the name was not registered and is replayed now that it is.
	 * A `result done` does not remove the watch. The registration stays until `agent close`.
	 */
	private async apply(ev: Event, host: string, held = false): Promise<void> {
		const entry = this.entries.find((item) => item.name === ev.name);
		if (entry && entry.host !== host) return;
		const seen = Date.parse(ev.ts) || this.now();
		if (entry && !owns(entry, ev)) {
			// Another launch's event: never this registration's row or state. It may be a newer launch reporting
			// before its own `agent add`, so it is held; a registration it does not belong to drops it (refresh).
			const state: NameState = this.names[ev.name] ?? { state: "registered", lastSeen: seen, host, since: entry.since, generation: entry.generation };
			if (!held && ev.type !== "hb") this.warn(`${ev.name}: ${ev.type} seq ${ev.seq} from ${ev.generation ? `launch ${ev.generation}` : "a reporter with no generation"} is not registration ${entry.generation}; held until a registration it belongs to`);
			// A heartbeat says nothing to hold (as for an unregistered name); held, a replaced launch's heartbeats would
			// fill the queue and push out a newer launch's early events.
			if (ev.type !== "hb") hold(state, host, ev, this.warn);
			this.names[ev.name] = state;
			return;
		}
		const current: NameState = this.names[ev.name] ?? { state: "registered", lastSeen: seen, host };
		const row = rowFor(ev);
		// `entries` is re-read only between batches. An explicit removal (`agent close`) sets `removed`.
		const live = entry !== undefined && !current.removed ? entry : undefined;
		if (live && (ev.type === "result" || ev.type === "idle")) {
			// The event's own version only names the RESULT; whether it is new is the ledger key's answer (`seen`).
			const found = ev.result?.version ? { version: ev.result.version, status: ev.result.status, open: ev.result.open ?? "", mtime: 0 } : await (this.deps.result ?? resultOf)(live);
			const text = (ev.text ?? "").length <= 1500 ? (ev.text ?? "") : `\u2026${(ev.text ?? "").slice(-1499)}`;
			let made = false;
			if (found.status && found.version && !legacyReported(live.name, found.mtime)) {
				const open = found.open ? ` Open: ${found.open}.` : "";
				const out = await this.add(live, `agents:${ev.name}:result:${found.version}`, "result", found.status, `RESULT status: ${found.status}.${open} Last output: ${text}`, ev.result?.path ?? "");
				made = out.startsWith("do ") || out.startsWith("notify ");
			}
			if (!made) await this.add(live, `agents:${ev.name}:${live.generation}:${ev.session}:${ev.seq}`, "idle", "no-result", `turn ended with no new RESULT. Last output: ${text}`, "");
		} else if (live && row) {
			await this.add(live, `agents:${ev.name}:${live.generation}:${ev.session}:${ev.seq}`, ev.type, row.state, row.note, ev.result?.path ?? "");
		}
		const dead = current.state === "dead";
		// An event only ever moves liveness forward: a replayed held event carries the time it happened, and rewinding
		// `lastSeen` to it would let `checkDead` fire on a session that has been heard from since.
		if (!(dead && seen <= current.lastSeen)) {
			current.lastSeen = Math.max(current.lastSeen, seen);
			current.host = host;
			current.pid = ev.pid;
			current.session = ev.session;
			current.seq = ev.seq;
			if (ev.type !== "hb") {
				current.state = ev.type;
				current.status = ev.type === "result" ? ev.result?.status : undefined;
			} else if (dead || current.state === "registered") current.state = "working";
		}
		this.names[ev.name] = current;
		if (!live && ev.type !== "hb") {
			// Not registered (yet, or again after `agent close`): kept until the name is registered, then recorded in order.
			hold(current, host, ev, this.warn);
		}
	}

	private async add(entry: Entry, key: string, event: string, state: string, note: string, link: string): Promise<string> {
		const full = entry.goal ? `${note}. Goal: ${entry.goal}` : note;
		return this.inbox(["add", "--source", "agents", "--place", entry.name, "--key", key, "--subject", `agent ${entry.name}`,
			"--note", full, "--link", entry.result || link, "--field", `event=${event}`, "--field", `state=${state}`,
			"--field", `mux=${entry.mux}`, "--field", `host=${entry.host}`]);
	}

	/** Starts one ssh tail for the stream's host; its first line tells us where the remote file really starts. */
	private connect(stream: Stream): void {
		if (stream.child || this.remotes.get(stream.host) !== stream) return;
		const offset = this.cursor(stream.host).offset;
		stream.lines = [];
		stream.partial = Buffer.alloc(0);
		stream.blocked = false;
		stream.started = false;
		stream.stderr = "";
		let child: ChildProcess;
		try {
			if (!/^(?!-)[A-Za-z0-9._@:-]+$/.test(stream.host)) throw new Error(`bad ssh host: ${stream.host}`);
			child = this.spawn("ssh", [...SSH_OPTS, "--", stream.host, remoteCommand(offset)]);
		} catch (e) {
			this.warn(`ssh did not start: ${e instanceof Error ? e.message : String(e)}`);
			this.onChange();
			this.reconnect(stream);
			return;
		}
		stream.child = child;
		let finished = false;
		child.stdout?.on("data", (chunk: Buffer) => void this.enqueue(() => this.onRemoteData(stream, child, chunk)));
		child.stderr?.on("data", (chunk: Buffer) => { stream.stderr = (stream.stderr + chunk.toString()).slice(-4096); });
		const finish = (reason: string) => {
			if (finished) return;
			finished = true;
			void this.enqueue(async () => this.onRemoteEnd(stream, child, reason));
		};
		child.on("error", (e) => finish(`error ${e.message}`));
		child.on("close", (code, signal) => finish(`exit ${code ?? signal}`));
	}

	private async onRemoteData(stream: Stream, child: ChildProcess, chunk: Buffer): Promise<void> {
		if (this.remotes.get(stream.host) !== stream || stream.child !== child) return;
		this.queueLines(stream, chunk, true);
		if (!stream.started) {
			const header = stream.lines.shift();
			if (header === undefined) return;
			const text = header.toString("utf8");
			const match = /^#start (\d+) (\d+)$/.exec(text);
			if (!match) {
				stream.lines = [];
				this.fail(`stream:${stream.host}`, new Error(`expected a #start line, got ${JSON.stringify(text.slice(0, 200))}`));
				child.kill();
				return;
			}
			const cursor = this.cursor(stream.host);
			const start = Number(match[1]);
			if (start < cursor.offset) this.warn(`${stream.host}: event file truncated; restarting at offset ${start}`);
			cursor.offset = start;
			cursor.inode = Number(match[2]);
			this.save();
			stream.started = true;
			this.connectedSince.set(stream.host, this.now());
			this.linkDown.delete(stream.host);
			this.clearError(`stream:${stream.host}`);
			this.onChange();
		}
		// A blocked stream keeps its lines for the next tick; new data does not retry the same failure.
		if (!stream.blocked) await this.drain(stream);
	}

	private onRemoteEnd(stream: Stream, child: ChildProcess, reason: string): void {
		if (this.remotes.get(stream.host) !== stream || stream.child !== child) return;
		stream.child = undefined;
		const since = this.connectedSince.get(stream.host);
		if (since !== undefined && this.now() - since > 60_000) stream.backoff = this.backoffMs;
		this.connectedSince.delete(stream.host);
		const last = stream.stderr.trim().split("\n").pop();
		this.linkDown.set(stream.host, `${reason}${last ? `: ${last}` : ""}`);
		this.onChange();
		this.reconnect(stream);
	}

	private reconnect(stream: Stream): void {
		if (!this.running || stream.child || stream.timer || this.remotes.get(stream.host) !== stream) return;
		const delay = stream.backoff;
		stream.backoff = Math.min(delay * 2, MAX_BACKOFF_MS);
		stream.timer = setTimeout(() => {
			stream.timer = undefined;
			void this.enqueue(async () => this.connect(stream));
		}, delay);
		stream.timer.unref();
	}

	/** Expires a session silent for longer than the window, on a stream that has been connected at least that long. */
	private async checkDead(): Promise<void> {
		const now = this.now();
		for (const entry of this.entries) {
			const state = this.names[entry.name];
			const connected = this.connectedSince.get(entry.host);
			if (!state || connected === undefined || now - connected <= this.deadMs || now - state.lastSeen <= this.deadMs) continue;
			if (state.state === "ended" || state.state === "dead") continue;
			const never = state.state === "registered";
			const note = never
				? `reporter never started (WAYNE_AGENT_WATCH not set at launch, or wayne-agent-report.ts not linked on ${entry.host})`
				: `no heartbeat for ${Math.round((now - state.lastSeen) / 1000)} s (last event ${state.state} at ${new Date(state.lastSeen).toISOString()})`;
			try {
				await this.add(entry, `agents:${entry.name}:${entry.generation}:dead:${state.lastSeen}`, "dead", never ? "never-started" : "no-heartbeat", note, "");
			} catch (e) {
				this.fail(`dead:${entry.name}`, e);
				continue;
			}
			state.state = "dead";
			this.clearError(`dead:${entry.name}`);
			this.save();
		}
	}

	/** Drops unregistered names (never registered, or retired) silent for a day, with their pending events and their host's stream. */
	private prune(): void {
		const cutoff = this.now() - PRUNE_MS;
		let pruned = false;
		for (const [name, state] of Object.entries(this.names)) {
			if (state.lastSeen >= cutoff || this.entries.some((entry) => entry.name === name)) continue;
			const held = state.pending ?? [];
			if (held.length > 0) this.warn(`${name}: dropped ${held.length} events held for a registration that never came (seq ${held.map((item) => item.event.seq).join(", ")})`);
			delete this.names[name];
			pruned = true;
		}
		if (!pruned) return;
		this.syncStreams();
		this.save();
	}
}
