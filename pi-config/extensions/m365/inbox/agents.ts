/**
 * The event sensor of watched agent sessions. Each session's reporter appends events to agent-events.jsonl on its
 * host; this tails that file (the local one directly, each remote one through a long-lived `ssh … tail -F`) and
 * writes what an event says into the watch's record (cli/observed.ts), the same record the probe writes. A row is
 * made when the record changes, so a turn end the probe already saw is not reported again.
 *
 * A watch is its omp session: an event reaches the watch whose record holds that session (see `match`), whatever
 * name or pane it was launched with, and the entry's pane follows the session.
 *
 * Only the byte cursors are this file's own state (cursors/agent-events.json `{ hosts }`), so a restart resumes where
 * it stopped. Everything runs through one promise chain: events are handled strictly in order, and a cursor never
 * moves past a line whose row was not recorded. Every entry of agent_watch in rules.yaml is tailed.
 */
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { followPane, legacyReported, resolveAsks } from "./cli/agents.ts";
import { readObserved, updateObserved, type Observed } from "./cli/observed.ts";
import { resultOf } from "./cli/probe.ts";

export interface Deps {
	dir: string;
	readRules?: typeof fs.readFileSync;
	inbox: (args: string[]) => Promise<string>;
	spawn?: typeof spawnProcess;
	now?: () => number;
	/** First reconnect delay after a dropped ssh stream; doubles up to 60 s. */
	backoffMs?: number;
	onChange?: () => void;
	warn?: (msg: string) => void;
	/** The newest RESULT of a watch. A failure throws, so the event line is retried like a failed `inbox add`. */
	result?: (entry: Entry) => Promise<{ version: string; status: string; open: string; mtime: number }>;
}

/** An agent_watch entry. Fields of older builds (`generation`, `stamped`, `instance`, `push`) are read past. */
interface Entry { name: string; host: string; mux: string; pane: string; since?: string; goal?: string; result?: string; closing?: unknown }
interface Event {
	v: number; ts: string;
	/** WAYNE_AGENT_WATCH of the launch; empty for a pane session nobody named. */
	name: string;
	pid: number; session: string; seq: number; type: string; text?: string;
	sessionFile?: string;
	cwd?: string;
	/** Where the session runs now. Absent from an older reporter, and from a session outside any pane. */
	mux?: string;
	pane?: string;
	ask?: { id?: string; kind: string; question: string; options?: string[] };
	result?: { path?: string; status: string; open?: string; version?: string };
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

const MAX_BACKOFF_MS = 60_000;
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];

/** The remote end: create the file, print `#start <offset> <inode>`, then stream from the offset. */
function remoteCommand(offset: number): string {
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error(`bad remote offset: ${offset}`);
	return `f=\${WAYNE_INBOX_DIR:-$HOME/.wayne/inbox}/agent-events.jsonl; mkdir -p "\${f%/*}"; touch "$f"; o=${offset}; [ "$(stat -c %s "$f")" -lt "$o" ] && o=0; echo "#start $o $(stat -c %i "$f")"; exec tail -c +$((o+1)) -F "$f"`;
}

/** The phase an event puts the session in. `started` keeps the phase unless the session was gone; `hb` (older reporters) and `ended` say none. */
const PHASE: Record<string, Observed["phase"]> = { working: "working", ask: "asking", "ask-resolved": "working", idle: "idle", result: "idle" };

export function readEntries(text: string): Entry[] {
	const list = (YAML.parse(text) ?? {}).agent_watch ?? [];
	if (!Array.isArray(list)) throw new Error("agent_watch must be a list");
	return (list as Entry[]).map((entry) => ({ ...entry, host: entry.host || "local" }));
}

export class AgentTailer {
	private readonly eventsFile: string;
	private readonly cursorFile: string;
	private readonly rulesFile: string;
	private readonly inbox: Deps["inbox"];
	private readonly spawn: typeof spawnProcess;
	private readonly now: () => number;
	private readonly backoffMs: number;
	private readonly onChange: () => void;
	private readonly warn: (msg: string) => void;
	private readonly local: Stream;
	private running = false;
	private queue: Promise<void> = Promise.resolve();
	private entries: Entry[] = [];
	private rulesMtime: number | null | undefined;
	private hosts: Record<string, Cursor> = {};
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
		this.entries = [];
		this.rulesMtime = undefined;
		// Lines queued before a stop were never recorded; the cursor re-reads them.
		this.local.lines = [];
		this.local.blocked = false;
		try {
			// `names` in a file an older build wrote is not read: the per-watch state is cli/observed.ts now.
			this.hosts = JSON.parse(fs.readFileSync(this.cursorFile, "utf8")).hosts ?? {};
		} catch (e) {
			// A missing cursor is a fresh start (a line read again makes a row the ledger already knows by key); a broken one is not guessed at.
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

	/** Inbox dir changed, or the backstop: read rules, read the local file. */
	poke(): Promise<void> {
		return this.enqueue(async () => {
			await this.refresh();
			await this.readLocal();
		});
	}

	/** Backstop: retry failed lines, reconnect dropped streams. */
	tick(): Promise<void> {
		return this.enqueue(async () => {
			await this.refresh();
			await this.readLocal();
			for (const stream of this.remotes.values()) {
				await this.drain(stream);
				this.reconnect(stream);
			}
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
		const watches = readObserved().watches;
		for (const entry of this.entries) {
			const seen = watches[entry.name];
			lines.push(`  ${entry.name}@${entry.host}: ${seen ? `${seen.phase}, seen by ${seen.by} at ${new Date(seen.at).toISOString()}` : "not seen yet"}`);
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
		fs.writeFileSync(tmp, `${JSON.stringify({ hosts: this.hosts }, null, 2)}\n`);
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
		try {
			this.entries = readEntries(mtime === null ? "" : (this.deps.readRules ?? fs.readFileSync)(this.rulesFile, "utf8"));
			this.clearError("rules");
		} catch (e) {
			this.fail("rules", e);
			return;
		}
		this.syncStreams();
		this.onChange();
	}

	/** One ssh stream per remote host that has a watched session. */
	private syncStreams(): void {
		const wanted = new Set(this.entries.map((entry) => entry.host));
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
	 * Whose event is it, on this host's stream? (1) The watch whose record holds the event's session. (2) Else the
	 * live watch whose record holds its process: the same omp switched to another session (a gone watch's process
	 * has exited, so its pid names another one). (3) Else the watch of the event's name whose record holds no agent
	 * (not probed yet, or a mux that names no agent process) or whose agent is gone: the name is what a launch gives
	 * before anything saw its session. Anything else is not a watched session's event: a second session launched
	 * under a watched name does not reach the live watch.
	 */
	private match(watches: Record<string, Observed>, ev: Event, host: string): Entry | undefined {
		const here = this.entries.filter((entry) => entry.host === host);
		return (ev.session ? here.find((entry) => watches[entry.name]?.agent?.session === ev.session) : undefined)
			?? here.find((entry) => watches[entry.name]?.phase !== "gone" && watches[entry.name]?.agent?.pid === ev.pid)
			?? (ev.name ? here.find((entry) => entry.name === ev.name && (!watches[entry.name]?.agent || watches[entry.name]!.phase === "gone")) : undefined);
	}

	/**
	 * One event of a watched session: the record's change, and the row that change owes. Throws, changing nothing,
	 * when the row is not recorded. An event that matches no watch is dropped, nothing held: a later registration
	 * does not get it (the probe reports what that session left). An event older than the record is dropped too: a
	 * newer look at the session (the probe's) already told what happened.
	 */
	private async apply(ev: Event, host: string): Promise<void> {
		const phase = PHASE[ev.type];
		if (!phase && ev.type !== "started") return;
		const first = this.match(readObserved().watches, ev, host);
		if (!first) return;
		const at = Date.parse(ev.ts) || this.now();
		const turnEnd = ev.type === "result" || ev.type === "idle";
		// Read before the record's lock is taken: it can wait on ssh. The event's own version only names the RESULT;
		// whether it is new is the ledger key's answer (`seen`).
		const found = !turnEnd ? undefined
			: ev.result?.version ? { version: ev.result.version, status: ev.result.status, open: ev.result.open ?? "", mtime: 0 }
			: await (this.deps.result ?? resultOf)(first);
		await updateObserved(async (state) => {
			// `inbox agent add` bound the records anew while the RESULT was read: the line is read again.
			if (this.match(state.watches, ev, host) !== first) throw new Error(`${first.name}: its session changed while seq ${ev.seq} was read`);
			const entry = first;
			const prev = state.watches[entry.name];
			if (prev && at < prev.at) return;
			const next: Observed = { ...prev, phase: phase ?? (prev && prev.phase !== "gone" ? prev.phase : "idle"), at, by: "event", active: Math.max(prev?.active ?? 0, Math.floor(at / 1000)) };
			// Sightings are the probe's count of an ask it has not recorded; an event's ask is recorded at once.
			delete next.ask;
			const same = prev?.agent?.session === ev.session ? prev.agent : undefined;
			next.agent = { pid: ev.pid, session: ev.session, sessionFile: ev.sessionFile ?? same?.sessionFile ?? "", cwd: ev.cwd ?? same?.cwd ?? "" };
			// The session runs in another pane of its mux now (resumed there): the watch follows it. The reporter names
			// the pane by its id, so an entry written as a tmux target (`work:1.0`) stays as it was typed, and an event
			// of another mux (a session inside tmux inside a tern block names the outer block too) moves nothing.
			if (ev.pane && ev.mux === entry.mux && ev.pane !== String(entry.pane) && (entry.mux !== "tmux" || /^%\d+$/.test(String(entry.pane)))) {
				followPane(entry.name, ev.pane);
				this.warn(`${entry.name}: session ${ev.session} is in ${entry.mux} pane ${ev.pane} now (was ${entry.pane}); the watch follows it`);
				entry.pane = ev.pane;
			}
			if (prev?.phase === "asking" && next.phase !== "asking") resolveAsks(entry.name);
			if (found) {
				const text = (ev.text ?? "").length <= 1500 ? (ev.text ?? "") : `\u2026${(ev.text ?? "").slice(-1499)}`;
				let made = false;
				if (found.status && found.version && !legacyReported(entry.name, found.mtime)) {
					const open = found.open ? ` Open: ${found.open}.` : "";
					const out = await this.add(entry, `agents:${entry.name}:result:${found.version}`, "result", found.status, `RESULT status: ${found.status}.${open} Last output: ${text}`, ev.result?.path ?? "");
					made = out.startsWith("do ") || out.startsWith("notify ");
				}
				// Every turn end that made no result row is one no-result row, but for two cases: the probe wrote the
				// record's `idle` (it saw this turn end first and made the row), and an acknowledged close.
				if (!made && !(prev?.phase === "idle" && prev.by === "probe") && !entry.closing)
					await this.add(entry, `agents:${entry.name}:${ev.session}:idle:${ev.seq}`, "idle", "no-result", `turn ended with no new RESULT. Last output: ${text}`, "");
			} else if (ev.type === "ask" && !entry.closing) {
				const kind = ev.ask?.kind ?? "ask";
				const options = ev.ask?.options?.length ? ` [options: ${ev.ask.options.join(" | ")}]` : "";
				await this.add(entry, `agents:${entry.name}:ask:${ev.ask?.id ?? `${ev.session}:${ev.seq}`}`, "ask", kind, `waiting on ${kind}: ${ev.ask?.question ?? ev.text ?? ""}${options}`, "");
			}
			state.watches[entry.name] = next;
		});
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
}
