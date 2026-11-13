/**
 * The inbox ledger as agent tools: each runs the `inbox` launcher (bin/inbox), the same CLI the omp cards name, so the
 * ledger has one writer whatever harness calls it.
 */
import { execFile } from "node:child_process";
import { Type } from "typebox";
import type { ToolDef } from "../core/tool.ts";
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
		description: "Record a decision or rule seen in Teams: a `teams-fact` log row (no card).",
		parameters: Type.Object(recorded),
		async execute(_id, p) {
			return text(await inbox(["fact", p.text, ...options({ key: p.key, source: p.source, note: p.note, link: p.link })]));
		},
	},
	{
		name: "inbox_facts",
		label: "Inbox Facts",
		description: "Run `inbox facts` with the given arguments: the recorded teams-fact rows, as the inbox CLI reports them.",
		parameters: Type.Object({ args: Type.Optional(Type.Array(Type.String(), { description: "Arguments after `inbox facts`" })) }),
		async execute(_id, p) {
			return text(await inbox(["facts", ...((p.args ?? []) as string[])]));
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
