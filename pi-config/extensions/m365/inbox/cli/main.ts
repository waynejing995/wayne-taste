/**
 * `inbox`: the inbox command line. bin/inbox runs it on plain node; the plugin calls `inbox(args)` in-process.
 *
 * Every command returns its stdout text. A data or usage error is an InboxError: `Error: <message>` on stderr, exit 1.
 */
import { addAgent, listAgents, MUXES, removeAgents } from "./agents.ts";
import { actionLine, checkName, dueJobs, execAction, findJob, finishFire, KINDS, makeDue, needsSession, nextFire, parseAction, readJobs, runDue, validateWhen, widgetLines, writeJobs, type Job } from "./jobs.ts";
import { addEvent, doneRows, InboxError, listRows, places, recordDirect, setRows, stamp, STATES, withRulesLock } from "./ledger.ts";
import { probeAgents } from "./probe.ts";
import { setup } from "./setup.ts";
import { addThen, checkThens, guardDone, openThenLines, thenDone } from "./thens.ts";

function minutes(value: string, flag: string): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) throw new InboxError(`${flag} must be a positive number of minutes`);
	return n;
}

type Opt = { flag?: boolean; many?: boolean; required?: boolean; choices?: string[]; default?: string; help?: string };
type Parsed = { args: string[]; opts: Record<string, string | undefined>; many: Record<string, string[]>; flags: Record<string, boolean> };
interface Command {
	help: string;
	/** Positional names; a trailing `...` takes the rest (at least one). */
	args?: string[];
	opts?: Record<string, Opt>;
	run: (p: Parsed) => string | Promise<string>;
}

const KEY_HELP = "stable id, so recording the same thing twice keeps one row";
const direct = (tag: string, action: string, source: string): Command => ({
	help: tag === "ask-wayne" ? "A question only the user can answer: an `ask-wayne` notify row, open until `done`." : "A decision or rule seen in Teams: a `teams-fact` log row (no card).",
	args: ["text"],
	opts: { key: { required: true, help: KEY_HELP }, source: { default: source }, note: { default: "" }, link: { default: "" } },
	run: (p) => recordDirect(tag, action, p.opts.key!, p.args[0], p.opts.source!, p.opts.note, p.opts.link),
});
const toggle = (enabled: boolean): Command => ({
	help: enabled ? "Turn a job on; it next fires at its next cron minute or one interval from now." : "Turn a job off; it keeps its place in the list.",
	args: ["name"],
	run: (p) =>
		withRulesLock(() => {
			const jobs = readJobs();
			const job = findJob(jobs, p.args[0]);
			job.enabled = enabled;
			job.next_fire = enabled ? stamp(nextFire(job, new Date())) : undefined;
			if (!enabled) delete job.next_fire;
			writeJobs(jobs);
			return `${enabled ? "enabled" : "disabled"} ${job.name}${enabled ? ` next ${job.next_fire}` : ""}`;
		}),
});

const COMMANDS: Record<string, Command> = {
	add: {
		help: "Classify one event by rules.yaml. Prints `<action> <id> <tag>` when recorded, `skip <reason>` when not.",
		opts: {
			source: { required: true, help: "teams | github | outlook | agents | …" },
			place: { required: true, help: "the chat / repo / folder / session under that source" },
			key: { required: true, help: "source + place + native event id" },
			subject: { required: true },
			field: { many: true, help: "k=v the rules match on (repeatable)" },
			note: { default: "" },
			link: { default: "" },
		},
		run: (p) => addEvent({ source: p.opts.source!, place: p.opts.place!, key: p.opts.key!, subject: p.opts.subject!, fields: p.many.field, note: p.opts.note, link: p.opts.link }),
	},
	set: {
		help: "Edit live rows in place (state, owner, note).",
		args: ["ids..."],
		opts: { state: { choices: STATES }, owner: { help: "who handles it; empty clears" }, note: {} },
		run: (p) => setRows(p.args, { state: p.opts.state, owner: p.opts.owner, note: p.opts.note }),
	},
	then: {
		help: "Attach a deferred action to a live row: when the trigger happens, a `do` card says you owe it. Triggers: pr-merged:<owner/repo>#<n>, gh-run:<owner/repo>:<run-id>, agent-result:<name>, at:<YYYY-MM-DD HH:MM>.",
		args: ["row-id", "action..."],
		opts: { when: { required: true, help: "the trigger" } },
		run: (p) => addThen(p.args[0], p.opts.when!, p.args.slice(1).join(" ")),
	},
	"then check": {
		help: "Fire the then-actions whose trigger happened, remind fired ones left open for 10 minutes (the scheduler runs this every minute).",
		run: async () => (await checkThens({ gh: true })).join("\n"),
	},
	"then-done": {
		help: "Close one then-action (after doing it, or to cancel it).",
		args: ["row-id", "n"],
		opts: { note: { default: "" } },
		run: (p) => thenDone(p.args[0], p.args[1], p.opts.note),
	},
	ask: direct("ask-wayne", "notify", "coordinator"),
	fact: direct("teams-fact", "log", "digest"),
	done: {
		help: "Finish rows: move them from the ledger into archive.tsv.",
		args: ["ids..."],
		opts: { note: { help: "how it ended" }, force: { flag: true, help: "also close the rows' fired, open then-actions (needs --note)" } },
		run: (p) => {
			guardDone(p.args, !!p.flags.force, p.opts.note);
			return doneRows(p.args, p.opts.note);
		},
	},
	ls: {
		help: "Matching live rows as TSV with a header, then one `# then …` line per open then-action.",
		opts: { state: { many: true, choices: STATES }, owner: {}, subject: {} },
		run: (p) => [listRows({ states: p.many.state, owner: p.opts.owner, subject: p.opts.subject }).replace(/\n$/, ""), ...openThenLines().map((l) => `# ${l}`)].join("\n") + "\n",
	},
	places: { help: "The places rules.yaml lists under SOURCE, one per line.", args: ["source"], run: (p) => places(p.args[0]) },
	"agent add": {
		help: "Watch one agent session. A second add of the same name replaces it.",
		args: ["name"],
		opts: {
			mux: { required: true, choices: MUXES },
			pane: { required: true, help: "tern block id, herdr id, hc terminal, or tmux target" },
			host: { default: "local", help: "local, or the ssh host the pane lives on" },
			result: { default: "", help: "the file the session writes its RESULT to" },
			goal: { default: "", help: "one line: what it was asked to do" },
			push: { flag: true, help: "the session reports its own events (omp wayne-agent-report extension)" },
		},
		run: (p) => addAgent({ name: p.args[0], mux: p.opts.mux!, pane: p.opts.pane!, host: p.opts.host, result: p.opts.result, goal: p.opts.goal, push: p.flags.push }),
	},
	"agent rm": { help: "Stop watching agent sessions.", args: ["names..."], run: (p) => removeAgents(p.args) },
	"agent ls": { help: "Watched sessions: name, mux, host, pane, result, since, goal, push.", run: () => listAgents() },
	"agent probe": {
		help: "Probe every watched session once: record result / gone / stalled / blocked / idle events, send the progress digest when due.",
		opts: {
			"stall-min": { default: "30", help: "minutes with no output before a session counts as stalled" },
			"digest-min": { default: "30", help: "minutes between progress digests" },
			"no-digest": { flag: true, help: "skip the progress digest this run" },
		},
		run: (p) => probeAgents({ stallMin: minutes(p.opts["stall-min"]!, "--stall-min"), digestMin: minutes(p.opts["digest-min"]!, "--digest-min"), noDigest: p.flags["no-digest"] }),
	},
	"schedule add": {
		help: "Register a job. It first fires at its next cron minute or one interval from now.",
		args: ["name"],
		opts: {
			cron: { help: "5 fields: minute hour day month weekday (0 or 7 = Sunday)" },
			every: { help: "interval in minutes" },
			kind: { required: true, choices: KINDS },
			action: { required: true, help: "shell: JSON argv; prompt: text; tool: JSON {name,args}" },
			owner: { default: "", help: "label copied onto the ledger row" },
			judge: { default: "off", choices: ["off", "on"] },
			"judge-prompt": { default: "", help: "what the small model should treat as worth a card" },
			timeout: { help: "seconds a shell or prompt run may take (default 60 / 600)" },
			tools: { help: "prompt jobs: comma-separated tools the headless agent may use" },
			quiet: { flag: true, help: "a successful fire records no ledger row (only a failure does)" },
			disabled: { flag: true, help: "register it turned off" },
		},
		run: (p) => {
			const name = checkName(p.args[0]);
			const judgePrompt = p.opts["judge-prompt"]!.trim();
			if (p.opts.judge === "on" && !judgePrompt) throw new InboxError("--judge on needs --judge-prompt");
			if (p.opts.kind === "tool" && !p.opts.action!.includes('"teams_read"') && p.opts.judge === "on")
				throw new InboxError("a tool other than teams_read cannot be judged: its result never comes back");
			const every = p.opts.every === undefined ? undefined : Number(p.opts.every);
			validateWhen(p.opts.cron, every);
			const job: Job = { name, action: parseAction(p.opts.kind!, p.opts.action!), enabled: !p.flags.disabled, owner: p.opts.owner, judge: p.opts.judge, fires: 0 };
			if (p.opts.cron !== undefined) job.cron = p.opts.cron;
			else job.every = every;
			if (p.opts.judge === "on") job.judge_prompt = judgePrompt;
			if (p.flags.quiet) job.quiet = true;
			if (p.opts.tools !== undefined) {
				if (p.opts.kind !== "prompt") throw new InboxError("--tools applies to prompt jobs only");
				job.tools = p.opts.tools.split(",").map((t) => t.trim()).filter(Boolean);
			}
			if (p.opts.timeout !== undefined) {
				job.timeout = Number(p.opts.timeout);
				if (!Number.isInteger(job.timeout) || job.timeout < 1) throw new InboxError("--timeout must be a whole number of seconds");
			}
			if (job.enabled) job.next_fire = stamp(nextFire(job, new Date()));
			withRulesLock(() => {
				const jobs = readJobs();
				if (jobs.some((j) => j.name === name)) throw new InboxError(`${name} is already registered; remove it first`);
				writeJobs([...jobs, job]);
			});
			return job.enabled ? `added ${name} next ${job.next_fire}` : `added ${name} (disabled)`;
		},
	},
	"schedule ls": {
		help: "Jobs: name, when, next fire, last result, action.",
		run: () => {
			const jobs = readJobs();
			if (!jobs.length) return "(no scheduled jobs)";
			return jobs
				.map((j) => {
					const when = j.cron || `every ${j.every}m`;
					const off = j.enabled === false ? "  (disabled)" : "";
					return `${j.name}  ${when}  next ${j.next_fire || "-"}  last ${j.last?.status || "never"}  ${actionLine(j.action ?? ({} as Job["action"]))}${off}`;
				})
				.join("\n");
		},
	},
	"schedule rm": {
		help: "Remove a job.",
		args: ["name"],
		run: (p) =>
			withRulesLock(() => {
				const jobs = readJobs();
				findJob(jobs, p.args[0]);
				writeJobs(jobs.filter((j) => j.name !== p.args[0]));
				return `removed ${p.args[0]}`;
			}),
	},
	"schedule enable": toggle(true),
	"schedule disable": toggle(false),
	"schedule run": {
		help: "Run due shell and prompt jobs (a tool or judged job waits for the live session). --job NAME runs one now.",
		opts: { due: { flag: true }, job: {} },
		run: async (p) => {
			if (p.flags.due === (p.opts.job !== undefined)) throw new InboxError("give exactly one of --due and --job");
			if (p.opts.job !== undefined) makeDue(p.opts.job);
			return (await runDue({ session: false })).join("\n");
		},
	},
	"schedule pending": {
		help: "Due jobs: name, `session` or `timer`, widget line.",
		run: () => dueJobs(readJobs(), new Date()).map((j) => `${j.name}\t${needsSession(j) ? "session" : "timer"}\t${widgetLines([j])[0]}`).join("\n"),
	},
	"schedule show": { help: "One job as JSON.", args: ["name"], run: (p) => JSON.stringify(findJob(readJobs(), p.args[0])) },
	"schedule exec": { help: "Run a shell or prompt action and print its output. Records nothing.", args: ["name"], run: (p) => execAction(p.args[0]) },
	"schedule finish": {
		help: "Record one fire a session already ran, then advance the job.",
		args: ["name"],
		opts: { output: { required: true }, verdict: { choices: ["DISPATCHED", "FAIL", "INJECT", "SKIP"] }, summary: { default: "" }, error: { default: "" } },
		run: (p) => finishFire(p.args[0], { output: p.opts.output!, verdict: p.opts.verdict, summary: p.opts.summary, error: p.opts.error }),
	},
	"schedule widget": { help: "One line per job: name, next fire, last result.", run: () => widgetLines().join("\n") },
	setup: {
		help: "Make the inbox directory usable: rules.yaml from the template if missing, cursors, first fires; fail if an enabled job's tools are missing.",
		run: () => setup(),
	},
};

function usage(name: string, cmd: Command): string {
	const args = (cmd.args ?? []).map((a) => a.toUpperCase()).join(" ");
	const opts = Object.entries(cmd.opts ?? {}).map(([k, o]) => {
		const value = o.flag ? "" : o.choices ? ` ${o.choices.join("|")}` : " TEXT";
		const notes = [o.help, o.required && "required", o.many && "repeatable", o.default && `default ${o.default}`].filter(Boolean).join("; ");
		return `  --${k}${value}${notes ? `  ${notes}` : ""}`;
	});
	return [`Usage: inbox ${name}${args ? ` ${args}` : ""}${opts.length ? " [OPTIONS]" : ""}`, "", cmd.help, ...(opts.length ? ["", ...opts] : [])].join("\n");
}

function overview(): string {
	return ["Usage: inbox COMMAND [ARGS]... [OPTIONS]", "", "Commands:", ...Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(18)} ${c.help.split(". ")[0]}`)].join("\n");
}

function parse(name: string, cmd: Command, argv: string[]): Parsed {
	const specs = cmd.opts ?? {};
	const p: Parsed = { args: [], opts: {}, many: {}, flags: {} };
	let rest = false;
	for (let i = 0; i < argv.length; i++) {
		const word = argv[i];
		if (rest || !word.startsWith("--") || word === "-") {
			p.args.push(word);
			continue;
		}
		if (word === "--") {
			rest = true;
			continue;
		}
		const eq = word.indexOf("=");
		const key = word.slice(2, eq < 0 ? undefined : eq);
		const spec = specs[key];
		if (!spec) throw new InboxError(`No such option: --${key} (inbox ${name} --help)`);
		if (spec.flag) {
			p.flags[key] = true;
			continue;
		}
		const value = eq < 0 ? argv[++i] : word.slice(eq + 1);
		if (value === undefined) throw new InboxError(`Option '--${key}' requires an argument.`);
		if (spec.choices && !spec.choices.includes(value)) throw new InboxError(`Invalid value for '--${key}': '${value}' is not one of ${spec.choices.map((c) => `'${c}'`).join(", ")}.`);
		if (spec.many) (p.many[key] ??= []).push(value);
		else p.opts[key] = value;
	}
	for (const [key, spec] of Object.entries(specs)) {
		if (spec.flag || spec.many) continue;
		if (p.opts[key] === undefined && spec.default !== undefined) p.opts[key] = spec.default;
		if (p.opts[key] === undefined && spec.required) throw new InboxError(`Missing option '--${key}'.`);
	}
	const names = cmd.args ?? [];
	const variadic = names.at(-1)?.endsWith("...");
	if (p.args.length < names.length || (!variadic && p.args.length > names.length))
		throw new InboxError(`${name} takes ${variadic ? `at least ${names.length}` : names.length} argument(s): ${names.join(" ") || "none"}, got ${p.args.length}`);
	return p;
}

/** Run one command line; the stdout text, or an InboxError. */
export async function inbox(argv: string[]): Promise<string> {
	const two = argv.slice(0, 2).join(" ");
	const name = COMMANDS[two] ? two : argv[0];
	const cmd = name ? COMMANDS[name] : undefined;
	if (!cmd) {
		if (!name || name === "--help" || name === "-h") return overview();
		throw new InboxError(`No such command '${argv.slice(0, 2).join(" ")}'.\n\n${overview()}`);
	}
	const rest = argv.slice(name.split(" ").length);
	if (rest.includes("--help") && !rest.slice(0, rest.indexOf("--help")).includes("--")) return usage(name, cmd);
	return cmd.run(parse(name, cmd, rest));
}

export async function main(argv: string[]): Promise<number> {
	try {
		const out = await inbox(argv);
		if (out) process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
		return 0;
	} catch (e) {
		if (!(e instanceof InboxError)) throw e;
		process.stderr.write(`Error: ${e.message}\n`);
		return 1;
	}
}
