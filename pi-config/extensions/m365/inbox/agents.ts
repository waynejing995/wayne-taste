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

export interface Deps {
	dir: string;
	inbox: (args: string[]) => Promise<string>;
	spawn?: typeof spawnProcess;
	now?: () => number;
	deadSec?: number;
	/** First reconnect delay after a dropped ssh stream; doubles up to 60 s. */
	backoffMs?: number;
	onChange?: () => void;
	warn?: (msg: string) => void;
}

interface Entry { name: string; host: string; mux: string; since?: string; generation?: string; goal?: string; result?: string; push?: boolean }
interface Event {
	v: number; ts: string; name: string; pid: number; session: string; seq: number; type: string; text?: string;
	/** On `working`: false when no prompt started the turn (an extension's message did). Absent from older reporters. */
	prompted?: boolean;
	ask?: { kind: string; question: string; options?: string[] };
	result?: { path?: string; status: string; open?: string };
}
interface NameState {
	state: string;
	lastSeen: number;
	host: string;
	since?: string;
	generation?: string;
	pid?: number;
	session?: string;
	status?: string;
	/** Events that arrived before the name was registered; replayed on registration. */
	pending?: { host: string; event: Event }[];
	/** Retired by `result done` → `agent rm`: later events for this name make no rows until it is registered again. */
	removed?: boolean;
	/**
	 * The `result done` that retired the name. That session's later events are its finished round settling and exiting,
	 * never rows, unless a prompt starts a new round (`working` not marked `prompted: false`, `resumed`): a follow-up
	 * sent to it, delivered once the name is registered again. A turn an extension started (an advisor message) is the
	 * same round going on, so its `result done` repeats the one that retired the name. A new session reporting under
	 * the name (`superseded`) makes the old session a finished run for good.
	 */
	retiredAt?: { session: string; seq: number; said?: string; unmarked?: boolean; checked?: boolean; resumed?: boolean; superseded?: boolean };
	/** What the last card added for this name said (rowSays with type and state); an identical next card is skipped. */
	lastCard?: string;
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

/** What a card says, minus incidental wording: the question and options, or the RESULT status and open items, or the output. */
function rowSays(ev: Event): string {
	if (ev.type === "ask") return `${ev.ask?.question ?? ev.text ?? ""}\n${(ev.ask?.options ?? []).join("\n")}`;
	if (ev.type === "result") return ev.result?.open ?? "";
	return ev.text ?? "";
}

/** The push entries of rules.yaml. A file that does not parse throws; the caller keeps the previous list. */
function readEntries(text: string): Entry[] {
	const list = (YAML.parse(text) ?? {}).agent_watch ?? [];
	if (!Array.isArray(list)) throw new Error("agent_watch must be a list");
	return list.filter((e: Entry) => e?.push === true).map((e: Entry) => ({ ...e, host: e.host || "local" }));
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
	private connectedSince = new Map<string, number>();
	private linkDown = new Map<string, string>();
	private errors = new Map<string, string>();

	constructor(deps: Deps) {
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

	private async refresh(): Promise<void> {
		let mtime: number | null = null;
		try {
			mtime = fs.statSync(this.rulesFile).mtimeMs;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
				this.fail("rules", e);
				return;
			}
		}

		this.rulesMtime = mtime;
		const previous = this.entries;
		try {
			this.entries = readEntries(mtime === null ? "" : fs.readFileSync(this.rulesFile, "utf8"));
			this.clearError("rules");
		} catch (e) {
			this.fail("rules", e);
			return;
		}
		for (const gone of previous) {
			if (this.entries.some((entry) => entry.name === gone.name)) continue;
			// Pending is kept: a follow-up read in the same batch as the `result done` that removed the entry waits here.
			const state = this.names[gone.name];
			if (state) state.removed = true;
		}
		for (const entry of this.entries) {
			const old = this.names[entry.name];
			if (old && old.since === entry.since && (entry.generation ?? old.generation) === old.generation) continue;
			const pending = (old?.pending ?? []).filter((item) => item.host === entry.host);
			if (pending.length < (old?.pending?.length ?? 0)) this.warn(`${entry.name}: dropped events from another host that arrived before registration`);
			this.names[entry.name] = {
				state: "registered", lastSeen: this.now(), host: entry.host, since: entry.since, generation: entry.generation,
				...(pending.length > 0 ? { pending } : {}),
				...(old?.retiredAt ? { retiredAt: old.retiredAt } : {}),
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
	 */
	private async apply(ev: Event, host: string, held = false): Promise<void> {
		const entry = this.entries.find((item) => item.name === ev.name);
		if (entry && entry.host !== host) return;
		const seen = Date.parse(ev.ts) || this.now();
		const current: NameState = this.names[ev.name] ?? { state: "registered", lastSeen: seen, host };
		const row = rowFor(ev);
		// No repeats: a card saying what the last card for this name said (same question, same RESULT status and open items,
		// same idle output) carries no new information. `ended` always goes out.
		const said = row && ev.type !== "ended" ? `${ev.type}\n${row.state}\n${rowSays(ev)}` : undefined;
		const retiredAt = current.retiredAt;
		if (retiredAt && ev.session !== retiredAt.session) retiredAt.superseded = true;
		const newRound = ev.type === "working" && ev.prompted !== false;
		if (retiredAt && ev.session === retiredAt.session && ev.seq > retiredAt.seq && newRound) {
			retiredAt.resumed = true;
			if (ev.prompted === undefined) retiredAt.unmarked = true;
		}
		// A reporter older than `prompted` cannot tell a follow-up from an advisor's continuation. The continuation comes
		// first, held until the next registration, and shows itself by repeating the `result done` that retired the name
		// with nothing said in between. Only the first held result is checked, and an ask or idle before it marks a real
		// round, so the follow-up's own result, saying the same, still counts.
		const after = retiredAt !== undefined && ev.session === retiredAt.session && ev.seq > retiredAt.seq;
		if (after && row && ev.type !== "result" && ev.type !== "ended") retiredAt.checked = true;
		const firstHeldResult = held && after && ev.type === "result" && retiredAt.unmarked === true && retiredAt.checked !== true;
		if (firstHeldResult) retiredAt.checked = true;
		const repeatsRetired = firstHeldResult && said === retiredAt.said;
		const finished = retiredAt !== undefined && ev.session === retiredAt.session
			&& (retiredAt.superseded === true || ev.seq <= retiredAt.seq || retiredAt.resumed !== true || repeatsRetired);
		// Its exit (`ended`) is expected; anything else it says is dropped, and said so.
		if (finished && row && ev.type !== "ended") this.warn(`${ev.name}: ${ev.type} seq ${ev.seq} belongs to the round that retired the name at seq ${retiredAt.seq}; not added`);
		// `entries` is re-read only between batches: a `result done` earlier in this batch already retired the name.
		const live = entry !== undefined && !current.removed ? entry : undefined;
		let retire = false;
		const repeat = said !== undefined && said === current.lastCard;
		if (repeat && live && !finished) this.warn(`${ev.name}: ${ev.type} seq ${ev.seq} repeats the last card; not added`);
		const generation = live?.generation;
		if (live && row && !finished && !repeat) {
			await this.add(live, `agents:${ev.name}:${ev.session}:${ev.seq}`, ev.type, row.state, row.note, ev.result?.path ?? "");
			current.lastCard = said;
			if (ev.type === "result" && row.state === "done") {
				retire = true;
				try {
					await this.refresh();
					const currentEntry = this.entries.find((item) => item.name === ev.name);
					if (currentEntry) Object.assign(current, { generation: currentEntry.generation, since: currentEntry.since });
					if (generation && currentEntry?.generation === generation) await this.inbox(["agent", "rm", ev.name, "--generation", generation]);
					this.clearError(`rm:${ev.name}`);
				} catch (e) {
					this.fail(`rm:${ev.name}`, e);
				}
			}
		}
		const dead = current.state === "dead";
		// A superseded run's exit says nothing about the session now under this name.
		const supersededRun = retiredAt?.superseded === true && ev.session === retiredAt.session;
		if (!supersededRun && !(dead && seen <= current.lastSeen)) {
			current.lastSeen = seen;
			current.host = host;
			current.pid = ev.pid;
			current.session = ev.session;
			if (ev.type !== "hb") {
				current.state = ev.type;
				current.status = ev.type === "result" ? ev.result?.status : undefined;
			} else if (dead || current.state === "registered") current.state = "working";
		}
		this.names[ev.name] = current;
		if (retire && current.generation === generation) {
			current.removed = true;
			current.retiredAt = { session: ev.session, seq: ev.seq, said };
			delete current.pending;
		} else if (!live && ev.type !== "hb" && !finished) {
			// Not registered (yet, or again after retiring): kept until the name is registered, then recorded in order.
			(current.pending ??= []).push({ host, event: ev });
			if (current.pending.length > PENDING_MAX) {
				current.pending.shift();
				this.warn(`${ev.name}: more than ${PENDING_MAX} events before registration; dropped the oldest`);
			}
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
			if (state.state === "ended" || state.state === "dead" || (state.state === "result" && state.status === "done")) continue;
			const never = state.state === "registered";
			const note = never
				? `reporter never started (WAYNE_AGENT_WATCH not set at launch, or wayne-agent-report.ts not linked on ${entry.host})`
				: `no heartbeat for ${Math.round((now - state.lastSeen) / 1000)} s (last event ${state.state} at ${new Date(state.lastSeen).toISOString()})`;
			try {
				await this.add(entry, `agents:${entry.name}:dead:${state.lastSeen}`, "dead", never ? "never-started" : "no-heartbeat", note, "");
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
