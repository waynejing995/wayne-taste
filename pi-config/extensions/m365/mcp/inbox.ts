/**
 * The inbox ledger as agent tools: each runs the `inbox` launcher (bin/inbox), the same CLI the omp cards name, so the
 * ledger has one writer whatever harness calls it.
 */
import { execFile } from "node:child_process";
import { Type } from "typebox";
import type { ToolDef } from "../core/tool.ts";
import { FACT_KINDS } from "../inbox/cli/facts.ts";
import { LAUNCHER } from "../inbox/delivery.ts";

const STATES = ["open", "claimed"];

/** Run `inbox <args>`; a non-zero exit is the tool's error, with the CLI's own message. */
function inbox(args: string[]): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	execFile(LAUNCHER, args, { timeout: 60_000, maxBuffer: 16 << 20 }, (e, stdout, stderr) => {
		if (e) reject(new Error(`inbox ${args[0]}: ${(stderr || stdout || e.message).trim()}`));
		else resolve(stdout.trim() || "(no output)");
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
		async execute(_id, p) {
			const states = ((p.state ?? []) as string[]).flatMap((s) => ["--state", s]);
			return text(await inbox(["ls", ...states, ...options({ owner: p.owner, subject: p.subject })]));
		},
	},
	{
		name: "inbox_ask",
		label: "Inbox Ask",
		description: "Record a question only the user can answer: an `ask-wayne` notify row, open until inbox_done.",
		parameters: Type.Object(recorded),
		async execute(_id, p) {
			return text(await inbox(["ask", p.text, ...options({ key: p.key, source: p.source, note: p.note, link: p.link })]));
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
		async execute(_id, p) {
			return text(await inbox(factArgv(p)));
		},
	},
	{
		name: "inbox_facts",
		label: "Inbox Facts",
		description: "List the standing facts, as `inbox facts` prints them.",
		parameters: Type.Object({ grep: Type.Optional(Type.String({ description: "Only facts that contain this" })) }),
		async execute(_id, p) {
			return text(await inbox(["facts", ...options({ grep: p.grep })]));
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
		async execute(_id, p) {
			return text(await inbox(["set", ...(p.ids as string[]), ...options({ state: p.state as string | undefined, owner: p.owner, note: p.note })]));
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
		async execute(_id, p) {
			return text(await inbox(["done", ...(p.ids as string[]), ...options({ note: p.note }), ...(p.force ? ["--force"] : [])]));
		},
	},
];
