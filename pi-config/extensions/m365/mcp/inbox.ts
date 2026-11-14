/**
 * The inbox ledger as agent tools, shared by omp (inbox/index.ts registers them) and the MCP server. Each runs the
 * `inbox` launcher (bin/inbox) as an async child process, the same CLI the omp cards name, so the ledger has one
 * writer whatever harness calls it. Never in-process: the ledger lock waits with Atomics.wait, which would freeze omp.
 */
import { execFile } from "node:child_process";
import { Type } from "typebox";
import type { ToolDef } from "../core/tool.ts";
import { FACT_KINDS } from "../inbox/cli/facts.ts";
import { MUXES } from "../inbox/cli/agents.ts";
import { LAUNCHER } from "../inbox/delivery.ts";

const STATES = ["open", "claimed"];

/** Commands that only read: a cancel or the timeout may kill them. Not `agent ls`: it migrates legacy registrations. */
const READ_ONLY = new Set(["ls"]);

/**
 * Run `inbox <args>`; a non-zero exit is the tool's error, with the CLI's own message under the full command name
 * ("inbox agent add: …"). Callers put options first and positionals after `--`, so a value like "--help" is data,
 * never a flag. A call cancelled before it spawns writes nothing. Once spawned, a command that writes is never killed,
 * neither by the cancel nor by a timeout: a kill between its writes (rules.yaml, then thens.json) would leave half a
 * commit and a stale lock. Read-only commands keep the cancel and the timeout. Only newlines are trimmed (an
 * `agent ls` row ends in empty tab-separated fields), and stderr from a successful run comes back as `warning:` lines.
 */
function inbox(args: string[], signal?: AbortSignal): Promise<string> {
	const command = args[0] === "agent" ? `agent ${args[1]}` : args[0];
	if (signal?.aborted) return Promise.reject(new Error(`inbox ${command}: cancelled, nothing written`));
	const readOnly = READ_ONLY.has(command);
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const kill = readOnly ? { timeout: 60_000, signal } : {};
	execFile(LAUNCHER, args, { maxBuffer: 16 << 20, ...kill }, (e, stdout, stderr) => {
		if (e) return reject(new Error(`inbox ${command}: ${(stderr || stdout || e.message).trim()}`));
		const warnings = stderr.split("\n").filter((l) => l.trim()).map((l) => `warning: ${l}`);
		resolve([stdout.replace(/^\n+|\n+$/g, "") || "(no output)", ...warnings].join("\n"));
	});
	return promise;
}

/** `--name value` for each option given. */
function options(opts: Record<string, string | undefined>): string[] {
	return Object.entries(opts).flatMap(([k, v]) => (v === undefined ? [] : [`--${k}`, v]));
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

/** `inbox fact` argv: the CLI requires `--kind` and has no `--link`; `--` keeps text that starts with `-` from reading as an option. */
export function factArgv(p: { text: string; key: string; kind: string; source?: string; note?: string }): string[] {
	return ["fact", ...options({ key: p.key, kind: p.kind, source: p.source, note: p.note }), "--", p.text];
}

const recorded = {
	text: Type.String({ description: "What to record: the row's subject" }),
	key: Type.String({ description: "Stable id, so recording the same thing twice keeps one row" }),
	source: Type.Optional(Type.String({ description: "Who recorded it (default: the command's own)" })),
	note: Type.Optional(Type.String()),
	link: Type.Optional(Type.String()),
};

export const inboxTools: ToolDef[] = [
	{
		name: "inbox_ls",
		label: "Inbox List",
		description: "The user's inbox ledger: live rows as TSV with a header, then one `# then …` line per open then-action.",
		parameters: Type.Object({
			state: Type.Optional(Type.Array(Type.Union(STATES.map((s) => Type.Literal(s))), { description: "Only rows in these states" })),
			owner: Type.Optional(Type.String({ description: "Only rows this owner holds" })),
			subject: Type.Optional(Type.String({ description: "Only rows whose subject contains this" })),
		}),
		async execute(_id, p, signal) {
			const states = ((p.state ?? []) as string[]).flatMap((s) => ["--state", s]);
			return text(await inbox(["ls", ...states, ...options({ owner: p.owner, subject: p.subject })], signal));
		},
	},
	{
		name: "inbox_ask",
		label: "Inbox Ask",
		description: "Record a question only the user can answer: an `ask-wayne` notify row, open until inbox_done.",
		parameters: Type.Object(recorded),
		async execute(_id, p, signal) {
			return text(await inbox(["ask", ...options({ key: p.key, source: p.source, note: p.note, link: p.link }), "--", p.text], signal));
		},
	},
	{
		name: "inbox_fact",
		label: "Inbox Fact",
		description: "Record a standing fact: something that stays true and later work should know (an endpoint, where a credential lives, a decision, something owed). Never record secret values (passwords, tokens, keys); record where they live instead.",
		parameters: Type.Object({
			text: recorded.text,
			key: recorded.key,
			kind: Type.Union(FACT_KINDS.map((k) => Type.Literal(k)), { description: "What sort of fact it is" }),
			source: recorded.source,
			note: Type.Optional(Type.String({ description: "chat, who, and time" })),
		}),
		async execute(_id, p, signal) {
			return text(await inbox(factArgv(p), signal));
		},
	},
	{
		name: "inbox_facts",
		label: "Inbox Facts",
		description: "List the standing facts, as `inbox facts` prints them.",
		parameters: Type.Object({ grep: Type.Optional(Type.String({ description: "Only facts that contain this" })) }),
		async execute(_id, p, signal) {
			return text(await inbox(["facts", ...options({ grep: p.grep })], signal));
		},
	},
	{
		name: "inbox_fact_drop",
		label: "Inbox Fact Drop",
		description: "Remove one standing fact by key, or by kind:key, as `inbox fact-drop` does.",
		parameters: Type.Object({ key: Type.String({ description: "The fact's key, or kind:key" }) }),
		async execute(_id, p) {
			return text(await inbox(["fact-drop", "--", p.key]));
		},
	},
	{
		name: "inbox_set",
		label: "Inbox Set",
		description: "Edit live rows in place: claim a row while working on it (state 'claimed', owner), or change its note.",
		parameters: Type.Object({
			ids: Type.Array(Type.String(), { minItems: 1, description: "Row ids" }),
			state: Type.Optional(Type.Union(STATES.map((s) => Type.Literal(s)))),
			owner: Type.Optional(Type.String({ description: "Who handles it; empty clears" })),
			note: Type.Optional(Type.String()),
		}),
		async execute(_id, p, signal) {
			return text(await inbox(["set", ...options({ state: p.state as string | undefined, owner: p.owner, note: p.note }), "--", ...(p.ids as string[])], signal));
		},
	},
	{
		name: "inbox_done",
		label: "Inbox Done",
		description: "Finish rows: move them from the ledger into archive.tsv. `force` also closes their fired, open then-actions (needs `note`).",
		parameters: Type.Object({
			ids: Type.Array(Type.String(), { minItems: 1, description: "Row ids" }),
			note: Type.Optional(Type.String({ description: "How it ended" })),
			force: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, p, signal) {
			return text(await inbox(["done", ...options({ note: p.note }), ...(p.force ? ["--force"] : []), "--", ...(p.ids as string[])], signal));
		},
	},
	{
		name: "inbox_then",
		label: "Inbox Then",
		description:
			"Attach a deferred action to a live row: when the trigger happens, a `do` card says you owe it. Triggers: pr-merged:<owner/repo>#<n>, gh-run:<owner/repo>:<run-id>, agent-result:<name>, at:<YYYY-MM-DD HH:MM>.",
		parameters: Type.Object({
			row: Type.String({ description: "The live row id" }),
			when: Type.String({ description: "The trigger" }),
			action: Type.String({ description: "What you owe when it fires" }),
		}),
		async execute(_id, p, signal) {
			return text(await inbox(["then", "--when", p.when, "--", p.row, p.action], signal));
		},
	},
	{
		name: "inbox_then_done",
		label: "Inbox Then Done",
		description: "Close one then-action (after doing it, or to cancel it): row id and its number, as inbox_ls shows `then <row>.<n>`.",
		parameters: Type.Object({
			row: Type.String({ description: "The row id" }),
			n: Type.String({ description: "The then-action's number on that row" }),
			note: Type.Optional(Type.String()),
		}),
		async execute(_id, p, signal) {
			return text(await inbox(["then-done", ...options({ note: p.note }), "--", p.row, p.n], signal));
		},
	},
	{
		name: "inbox_agent_add",
		label: "Inbox Agent Add",
		description:
			"Watch one agent session for a live row; its next RESULT fires the `then` plan on that row. A second add of the same name replaces it.\n" +
			"Reuse before you open: run inbox_agent_ls first. If a registered session already owns the same topic or repo, send the new round into its pane and register it again under the same name. " +
			"Every round writes a NEW result file (RESULT-<topic>-rN.md); never rewrite one that is already registered. " +
			"Open a new session only when the topic is unrelated or the old pane is gone.",
		parameters: Type.Object({
			name: Type.String({ description: "The session's name; the same name replaces its registration" }),
			mux: Type.Union(MUXES.map((m) => Type.Literal(m))),
			pane: Type.String({ description: "tern block id, herdr id, hc terminal, or tmux target" }),
			row: Type.String({ description: "The live ledger row this session works for" }),
			then: Type.String({ description: "The plan for its RESULT: what you expect, whom you reply to and how, what you close" }),
			host: Type.Optional(Type.String({ description: "local (default), or the ssh host the pane lives on" })),
			result: Type.Optional(Type.String({ description: "The file the session writes its RESULT to" })),
			goal: Type.Optional(Type.String({ description: "One line: what it was asked to do" })),
			push: Type.Optional(Type.Boolean({ description: "The session reports its own events (omp wayne-agent-report extension)" })),
			generation: Type.Optional(Type.String({ description: "The WAYNE_AGENT_GENERATION the session was launched with" })),
		}),
		async execute(_id, p, signal) {
			const opts = options({ mux: p.mux as string, pane: p.pane, row: p.row, then: p.then, host: p.host, result: p.result, goal: p.goal, generation: p.generation });
			return text(await inbox(["agent", "add", ...opts, ...(p.push ? ["--push"] : []), "--", p.name], signal));
		},
	},
	{
		name: "inbox_agent_rm",
		label: "Inbox Agent Rm",
		description: "Stop watching agent sessions.",
		parameters: Type.Object({
			names: Type.Array(Type.String(), { minItems: 1, description: "Session names" }),
			generation: Type.Optional(Type.String({ description: "Remove only this registration generation" })),
		}),
		async execute(_id, p, signal) {
			return text(await inbox(["agent", "rm", ...options({ generation: p.generation }), "--", ...(p.names as string[])], signal));
		},
	},
	{
		name: "inbox_agent_ls",
		label: "Inbox Agent Ls",
		description: "Watched agent sessions, one per line: name, mux, host, pane, result, since, goal, push.",
		parameters: Type.Object({}),
		async execute(_id, _p, signal) {
			return text(await inbox(["agent", "ls"], signal));
		},
	},
];
