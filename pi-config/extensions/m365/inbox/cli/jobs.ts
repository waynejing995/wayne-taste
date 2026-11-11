/**
 * Scheduled jobs: the `schedule` list in rules.yaml, and running them.
 *
 * A fire claims `cursors/schedule-<name>-<fire>.claim`, so two runners (two sessions, or a session and a
 * `inbox schedule run --due` from cron) never run the same fire twice. The rules lock is held only to read or
 * write the list, never while a job runs: a prompt job can run for minutes, and `agent add` must not wait on it.
 *
 * Kinds: `shell` runs a JSON argv (the plugin's bin directory is on PATH, so `inbox …` works); `prompt` runs its
 * text through a headless omp or pi; `tool` calls an extension tool, so it runs only inside a live session.
 * `judge: on` has the session's small model decide whether the output is worth a card; also session only.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { InboxError, inboxDir, inboxFile, recordDirect, stamp, withRulesLock } from "./ledger.ts";
import { readList, SCHEDULE_LIST, writeList } from "./lists.ts";

export type Action = { kind: "shell"; argv: string[] } | { kind: "prompt"; text: string } | { kind: "tool"; name: string; args: Record<string, unknown> };

export interface Job {
	name: string;
	action: Action;
	enabled?: boolean;
	owner?: string;
	judge?: string;
	judge_prompt?: string;
	fires?: number;
	cron?: string;
	every?: number;
	/** Seconds a shell or prompt run may take; default 60 (shell) or 600 (prompt). */
	timeout?: number;
	/** A successful fire records no ledger row (only `last`); a failure still does. For watchers that add their own rows. */
	quiet?: boolean;
	/** prompt only: the tools the headless agent may use (`--tools`); default all. */
	tools?: string[];
	next_fire?: string;
	last?: { status: string; at: string; detail: string };
	/** When the last fire that did not fail started; a prompt's `{{since}}`. */
	last_ok?: string;
}

export type Verdict = { verdict: "INJECT" | "SKIP"; summary: string };

export interface RunOptions {
	/** True inside a live omp or pi session: tool and judged jobs run too. */
	session: boolean;
	/** Calls an extension tool this package owns (`teams_read`) and returns its text. */
	tool?: (name: string, args: Record<string, unknown>) => Promise<string>;
	judge?: (prompt: string, output: string) => Promise<Verdict>;
	/** The headless agent prompt jobs run in: `omp` or `pi`. Default: $INBOX_AGENT, else the first of omp, pi on PATH. */
	agent?: string;
}

const NAMES = /^[a-z][a-z0-9-]{0,40}$/;
export const KINDS = ["prompt", "shell", "tool"];
const CLAIM_STALE_MS = 15 * 60_000;
const OUTPUT_CAP = 4000;
/** Where the `inbox` launcher lives; shell jobs get it on PATH. */
export const BIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin");

export function readJobs(): Job[] {
	return readList(SCHEDULE_LIST) as unknown as Job[];
}

export function writeJobs(jobs: Job[]): void {
	writeList(SCHEDULE_LIST, jobs as unknown as Record<string, unknown>[]);
}

export function findJob(jobs: Job[], name: string): Job {
	const job = jobs.find((j) => j.name === name);
	if (!job) throw new InboxError(`no scheduled job named ${name}`);
	return job;
}

export function checkName(name: string): string {
	if (!NAMES.test(name)) throw new InboxError(`job name must match ${NAMES.source}, got '${name}'`);
	return name;
}

function parseJson(text: string, what: string): unknown {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new InboxError(`${what}: ${(e as Error).message}`);
	}
}

export function parseAction(kind: string, text: string): Action {
	if (!KINDS.includes(kind)) throw new InboxError(`--kind must be one of ['prompt', 'shell', 'tool']`);
	if (!text.trim()) throw new InboxError("--action must not be empty");
	if (kind === "prompt") return { kind, text };
	if (kind === "shell") {
		const argv = parseJson(text, "--action for shell must be a JSON argv list");
		if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== "string"))
			throw new InboxError("--action for shell must be a non-empty JSON list of strings");
		return { kind, argv };
	}
	const spec = parseJson(text, "--action for tool must be JSON object with name and args") as { name?: unknown; args?: unknown };
	if (typeof spec !== "object" || spec === null || Array.isArray(spec) || typeof spec.name !== "string" || !spec.name)
		throw new InboxError('--action for tool must be {"name": "<tool>", "args": {...}}');
	const args = spec.args ?? {};
	if (typeof args !== "object" || args === null || Array.isArray(args)) throw new InboxError("tool args must be a JSON object");
	return { kind, name: spec.name, args: args as Record<string, unknown> };
}

/** JSON the way Python's json.dumps wrote it (`", "` and `": "`, non-ASCII escaped), so `schedule ls` reads the same. */
function pyJson(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(pyJson).join(", ")}]`;
	if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${pyJson(k)}: ${pyJson(x)}`).join(", ")}}`;
	return JSON.stringify(v).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function actionLine(action: Action): string {
	if (action.kind === "shell") return `shell ${action.argv.join(" ")}`;
	if (action.kind === "prompt") return `prompt ${action.text}`;
	if (action.kind === "tool") return `tool ${action.name} ${pyJson(action.args ?? {})}`;
	return String((action as { kind: unknown }).kind);
}

/** A tool call and the small-model judge exist only inside a live session. */
export function needsSession(job: Job): boolean {
	return job.action?.kind === "tool" || job.judge === "on";
}

const isDigits = (s: string) => /^\d+$/.test(s);

function cronField(expr: string, value: number, lo: number, hi: number): boolean {
	if (expr === "*") return true;
	for (const part of expr.split(",")) {
		let [span, raw] = part.split("/", 2) as [string, string | undefined];
		let step = 1;
		if (raw !== undefined) {
			if (!isDigits(raw) || Number(raw) < 1) throw new InboxError(`bad cron step in '${expr}'`);
			step = Number(raw);
		}
		let start: number;
		let end: number;
		if (span === "*") [start, end] = [lo, hi];
		else if (span.includes("-")) {
			const [a, b] = span.split("-", 2);
			if (!isDigits(a) || !isDigits(b)) throw new InboxError(`bad cron range in '${expr}'`);
			[start, end] = [Number(a), Number(b)];
		} else {
			if (!isDigits(span)) throw new InboxError(`bad cron field '${expr}'`);
			start = end = Number(span);
		}
		if (!(lo <= start && start <= end && end <= hi)) throw new InboxError(`cron field '${expr}' is outside ${lo}-${hi}`);
		if (start <= value && value <= end && (value - start) % step === 0) return true;
	}
	return false;
}

/**
 * crontab(5) as cronie implements it: a field is a star when its first character is `*`, so `*\/1` is a star.
 * Day-of-month and day-of-week are OR only when neither is a star; otherwise they are AND. 0 or 7 is Sunday.
 */
export function cronMatches(expr: string, when: Date): boolean {
	const fields = expr.split(/\s+/).filter(Boolean);
	if (fields.length !== 5) throw new InboxError(`cron needs 5 fields, got '${expr}'`);
	const [, , day, , weekday] = fields;
	const values = [when.getMinutes(), when.getHours(), when.getDate(), when.getMonth() + 1, when.getDay()];
	const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
	const matched = fields.map((f, i) => cronField(f, values[i], bounds[i][0], bounds[i][1]) || (i === 4 && values[i] === 0 && cronField(f, 7, 0, 7)));
	if (!day.startsWith("*") && !weekday.startsWith("*")) {
		matched[2] = matched[2] || matched[4];
		matched[4] = true;
	}
	return matched.every(Boolean);
}

export function validateWhen(cron: string | undefined, every: number | undefined): void {
	if ((cron === undefined) === (every === undefined)) throw new InboxError("give exactly one of --cron and --every");
	if (cron !== undefined) cronMatches(cron, new Date());
	else if (!Number.isInteger(every) || (every as number) < 1) throw new InboxError("--every must be at least 1 minute");
}

const minute = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes());

export function parseStamp(text: string): Date {
	const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text);
	if (!m) throw new InboxError(`bad time '${text}', expected YYYY-MM-DD HH:MM`);
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/** The next minute this job is due, strictly after `after` (truncated to the minute). */
export function nextFire(job: Job, after: Date): Date {
	const start = minute(after);
	if (job.every) return new Date(start.getTime() + Number(job.every) * 60_000);
	const cron = String(job.cron ?? "");
	const cursor = new Date(start);
	for (let i = 0; i < 366 * 24 * 60; i++) {
		cursor.setMinutes(cursor.getMinutes() + 1);
		if (cronMatches(cron, cursor)) return cursor;
	}
	throw new InboxError(`cron '${cron}' never matches`);
}

export function dueJobs(jobs: Job[], at: Date): Job[] {
	const now = minute(at).getTime();
	return jobs.filter((j) => j.enabled !== false && j.next_fire && parseStamp(String(j.next_fire)).getTime() <= now);
}

export function fireId(job: Job): string {
	return String(job.next_fire ?? "").replace(" ", "T").replaceAll(":", "");
}

function timeoutSec(job: Job): number {
	return Number(job.timeout) || (job.action?.kind === "prompt" ? 600 : 60);
}

function claimPath(name: string, fire: string): string {
	return inboxFile("cursors", `schedule-${name}-${fire}.claim`);
}

/** True when this process owns the fire. A claim older than its job could run belonged to a runner that died. */
function claim(job: Job, fire: string): boolean {
	const file = claimPath(job.name, fire);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const staleMs = Math.max(CLAIM_STALE_MS, (timeoutSec(job) + 60) * 1000);
	for (;;) {
		try {
			fs.writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
			return true;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			let age: number;
			try {
				age = Date.now() - fs.statSync(file).mtimeMs;
			} catch {
				continue;
			}
			if (age <= staleMs) return false;
			fs.rmSync(file, { force: true });
		}
	}
}

function release(name: string, fire: string): void {
	fs.rmSync(claimPath(name, fire), { force: true });
}

/** Run argv with the launcher on PATH; the trimmed stdout, or an error naming the exit and stderr. */
export function runProcess(argv: string[], timeoutS: number, what: string, cwd?: string): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const env = { ...process.env, PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`, WAYNE_INBOX_DIR: inboxDir() };
	const child = spawn(argv[0], argv.slice(1), { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	child.stdout.on("data", (d) => (stdout += d));
	child.stderr.on("data", (d) => (stderr += d));
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, timeoutS * 1000);
	child.on("error", (e) => {
		clearTimeout(timer);
		reject(new InboxError(`${what} failed to start: ${e.message}`));
	});
	child.on("close", (code) => {
		clearTimeout(timer);
		if (timedOut) reject(new InboxError(`${what} timed out after ${timeoutS}s`));
		else if (code !== 0) reject(new InboxError(`${what} exited ${code}: ${(stderr.trim() || stdout.trim()).slice(0, 500)}`));
		else resolve(stdout.trim());
	});
	return promise;
}

/** The first of the names that is an executable on PATH, or undefined. */
export function onPath(...names: string[]): string | undefined {
	for (const name of names)
		for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
			const file = path.join(dir, name);
			try {
				fs.accessSync(file, fs.constants.X_OK);
				if (fs.statSync(file).isFile()) return file;
			} catch {}
		}
	return undefined;
}

/** The headless agent command for a prompt: omp or pi in print mode, no session file, optionally only `tools`. */
export function agentArgv(agent: string | undefined, prompt: string, tools?: string[]): string[] {
	const name = agent ?? process.env.INBOX_AGENT ?? (onPath("omp") ? "omp" : onPath("pi") ? "pi" : undefined);
	if (!name) throw new InboxError("a prompt job needs omp or pi on PATH");
	const flags = path.basename(name) === "omp" ? ["-p", "--no-session", "--no-title"] : ["-p", "--no-session"];
	if (tools?.length) flags.push("--tools", tools.join(","));
	return [name, ...flags, prompt];
}

type Outcome = { action: string; status: string; detail: string; text: string; error?: string };

async function execute(job: Job, o: RunOptions): Promise<Outcome> {
	const a = job.action;
	if (a.kind === "tool" && a.name !== "teams_read") {
		// Only this package's tools run in-process; any other becomes the user's own dispatch line on a `do` card.
		if (job.judge === "on") throw new InboxError("a tool other than teams_read cannot be judged: its result never comes back");
		const prompt = `call the tool ${a.name} with ${JSON.stringify(a.args ?? {})}`;
		return { action: "do", status: "dispatched", detail: prompt.slice(0, 200), text: prompt };
	}
	let output: string;
	if (a.kind === "shell") output = await runProcess(a.argv, timeoutSec(job), "shell");
	else if (a.kind === "prompt") {
		const since = job.last_ok ?? stamp(new Date(Date.now() - 24 * 3600_000));
		output = await runProcess(agentArgv(o.agent, a.text.replaceAll("{{since}}", since), job.tools), timeoutSec(job), "prompt", inboxDir());
	} else if (a.kind === "tool") {
		if (!o.tool) throw new InboxError("tool jobs run only inside a live omp or pi session");
		output = (await o.tool(a.name, a.args ?? {})).slice(0, OUTPUT_CAP);
	} else throw new InboxError(`unknown action ${JSON.stringify(a)}`);
	if (job.judge !== "on") return { action: "notify", status: "ok", detail: output.slice(0, 200), text: output };
	if (!o.judge) throw new InboxError("judge needs the live session");
	const { verdict, summary } = await o.judge(String(job.judge_prompt ?? ""), output);
	if (verdict === "SKIP") return { action: "log", status: "skip", detail: summary || "judge skipped", text: output };
	return summary ? { action: "notify", status: "ok", detail: summary.slice(0, 200), text: `${summary}\n${output}` } : { action: "notify", status: "ok", detail: output.slice(0, 200), text: output };
}

/** One ledger row for this fire; recordDirect dedups by key, so the same fire writes one row. A quiet job's success writes none. */
function record(job: Job, fire: string, out: Outcome): string {
	if (job.quiet && !out.error) return `quiet ${job.name}:${fire}`;
	const subject = (out.error ? `${job.name} ${fire} FAILED` : `${job.name} ${fire}`).slice(0, 200);
	recordDirect("schedule", out.action, `${job.name}:${fire}`, subject, "schedule", (out.error ?? out.text).slice(0, OUTPUT_CAP), "", job.owner || "wayne");
	return `${out.action} ${job.name}:${fire}`;
}

function advance(job: Job, at: Date, out: Outcome): void {
	job.next_fire = stamp(nextFire(job, at));
	job.last = { status: out.status, at: stamp(at), detail: out.detail.slice(0, 200) };
	if (!out.error) job.last_ok = stamp(at);
	job.fires = Number(job.fires ?? 0) + 1;
}

/** Record the outcome and advance the job, if it is still at this fire. */
function settle(name: string, fire: string, at: Date, out: Outcome): string {
	const line = record(findJob(readJobs(), name), fire, out);
	withRulesLock(() => {
		const jobs = readJobs();
		const job = jobs.find((j) => j.name === name);
		if (!job || fireId(job) !== fire) return;
		advance(job, at, out);
		writeJobs(jobs);
	});
	return line;
}

function failed(e: unknown): Outcome {
	const message = e instanceof Error ? e.message : String(e);
	return { action: "notify", status: "fail", detail: message, text: "", error: message };
}

/** Run one due job if this caller can. Returns one line; leaves the job due when it cannot run it. */
async function one(job: Job, at: Date, o: RunOptions): Promise<string> {
	const fire = fireId(job);
	if (needsSession(job) && !o.session) return `skip ${job.name}: needs a live omp or pi session`;
	if (!claim(job, fire)) return `skip ${job.name}: another runner holds ${fire}`;
	try {
		// Another runner may have finished this fire between our read and our claim.
		const current = readJobs().find((j) => j.name === job.name);
		if (!current || fireId(current) !== fire) return `skip ${job.name}: ${fire} already ran`;
		let out: Outcome;
		try {
			out = await execute(current, o);
		} catch (e) {
			out = failed(e);
		}
		const line = settle(job.name, fire, at, out);
		return `${out.status} ${job.name} ${fire}: ${line}${out.error ? ` (${out.error})` : ""}`;
	} finally {
		release(job.name, fire);
	}
}

/** Jobs this process is running now. A later tick starts the other due jobs, not these again. */
const running = new Set<string>();

/**
 * Claim and run every due job this caller can run, side by side. One line per job. A job this process is still
 * running (a 15-minute prompt job) is left out, so a caller that does not wait for the last call (the plugin's
 * minute tick) keeps starting the short jobs; the fire claim stops another process from running it twice.
 */
export async function runDue(o: RunOptions, at: Date = new Date()): Promise<string[]> {
	const now = minute(at);
	const due = dueJobs(readJobs(), now).filter((j) => !running.has(j.name));
	return Promise.all(
		due.map(async (job) => {
			running.add(job.name);
			try {
				return await one(job, now, o);
			} finally {
				running.delete(job.name);
			}
		}),
	);
}

/** `inbox schedule run --job NAME`: make it due now, then run what is due. */
export function makeDue(name: string): void {
	withRulesLock(() => {
		const jobs = readJobs();
		const job = findJob(jobs, name);
		job.next_fire = stamp(minute(new Date()));
		writeJobs(jobs);
	});
}

/** `inbox schedule finish`: record one fire a session ran outside runDue, then advance the job. */
export function finishFire(name: string, f: { output: string; verdict?: string; summary?: string; error?: string }): string {
	const at = minute(new Date());
	const job = findJob(readJobs(), name);
	if (!dueJobs([job], at).length) throw new InboxError(`${name} is not due`);
	const fire = fireId(job);
	release(name, fire); // a runner's claim, if one noticed this job first
	const summary = f.summary ?? "";
	let out: Outcome;
	if (f.error) out = failed(new Error(f.error));
	else if (f.verdict === "FAIL") out = { action: "notify", status: "fail", detail: summary || f.output, text: f.output };
	else if (f.verdict === "DISPATCHED") out = { action: "do", status: "dispatched", detail: summary || "prompt card sent", text: f.output };
	else if (f.verdict === "SKIP") out = { action: "log", status: "skip", detail: summary || "judge skipped", text: f.output };
	else if (summary) out = { action: "notify", status: "ok", detail: summary, text: `${summary}\n${f.output}` };
	else out = { action: "notify", status: "ok", detail: f.output, text: f.output };
	const line = settle(name, fire, at, out);
	return `${out.status} ${name} ${fire}: ${line}`;
}

/** `inbox schedule exec`: run a shell or prompt action and return its output. Records nothing. */
export async function execAction(name: string, agent?: string): Promise<string> {
	const job = findJob(readJobs(), name);
	if (job.action?.kind === "tool") throw new InboxError("a tool action runs inside the omp or pi session");
	const out = await execute({ ...job, judge: "off" }, { session: false, agent });
	return out.text;
}

export function widgetLines(jobs: Job[] = readJobs()): string[] {
	return jobs.map((j) => `${j.name} ${j.enabled === false ? "disabled" : `next ${j.next_fire || "-"}`} last ${j.last?.status || "never"}`);
}
