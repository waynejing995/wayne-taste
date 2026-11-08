/**
 * Wayne's inbox, pushed into this session.
 *
 * The wayne-inbox skill's watchers (watch-prs.sh on a timer, the Teams watch, …) classify events by
 * rules.yaml and append the ones worth tracking to ~/.wayne/inbox/ledger.tsv. This file only delivers:
 * every new ledger row whose action is `notify` or `do` becomes an `inbox` card in the session that ran
 * `/inbox watch`. A `do` card starts a turn; a `notify` card is shown and waits for the user.
 *
 * Delivery progress is not task state. The ledger's `state` column (open/claimed) and `inbox.py done`, which
 * moves a finished row out to archive.tsv, stay the handlers' business; how far delivery got is the highest row id in cursors/session-push.id.
 *
 * inbox.py rewrites the ledger by renaming a temp file over it, so the directory is watched, not the file:
 * a watch on the file's inode would go deaf after the first rewrite. A slow poll is the backstop.
 *
 * One session delivers at a time: the claim is the same abstract-socket lease the Teams watch uses.
 *
 * The delivering session also watches Outlook: every BACKSTOP_MS it lists the Inbox, and each mail received
 * since cursors/outlook-inbox.since goes through `inbox.py add --source outlook --place Inbox`, so rules.yaml
 * decides it like any other event. One poller, because only the lease holder polls. No top-level `outlook:` in
 * rules.yaml means mail is not watched at all: no Graph call.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as auth from "../core/auth.ts";
import { CHIEF_NOTE } from "../core/chief.ts";
import { GraphClient } from "../core/graph.ts";
import { setStatusPart } from "../core/status-row.ts";
import { Mailbox } from "../outlook/mailbox.ts";
import { mailSince } from "./mail.ts";
import { claim, describeOwner, type WatchLease } from "../teams/watch.ts";

const DIR = process.env.WAYNE_INBOX_DIR ?? path.join(os.homedir(), ".wayne", "inbox");
const LEDGER = path.join(DIR, "ledger.tsv");
const CURSOR = path.join(DIR, "cursors", "session-push.id");
/** The lease name: one deliverer per inbox directory, machine and user, whatever chat the Teams watch holds. */
const LEASE_ID = `wayne-inbox:${DIR}`;
const INBOX_PY = path.join(process.env.WAYNE_SKILLS_DIR ?? "/mnt/share/wayne-skills", "wayne-inbox", "scripts", "inbox.py");
const MAIL_CURSOR = path.join(DIR, "cursors", "outlook-inbox.since");
const BACKSTOP_MS = 60_000;
const MAIL_PAGE = 50;
const PUSHED = new Set(["notify", "do"]);

type Row = Record<string, string>;

function readRows(): Row[] {
	if (!fs.existsSync(LEDGER)) return [];
	const [header, ...lines] = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean);
	const cols = header.split("\t");
	return lines.map((l) => {
		const cells = l.split("\t");
		return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
	});
}

function maxId(rows: Row[]): number {
	return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
}

function readCursor(): number | null {
	if (!fs.existsSync(CURSOR)) return null;
	const n = Number(fs.readFileSync(CURSOR, "utf8").trim());
	if (!Number.isInteger(n) || n < 0) throw new Error(`${CURSOR} does not hold a row id`);
	return n;
}

function writeCursor(id: number): void {
	fs.mkdirSync(path.dirname(CURSOR), { recursive: true });
	const tmp = `${CURSOR}.tmp`;
	fs.writeFileSync(tmp, `${id}\n`);
	fs.renameSync(tmp, CURSOR);
}

function card(rows: Row[]): string {
	const lines = rows.map((r) => {
		const head = `#${r.id} [${r.action}] ${r.tag} · ${r.subject}`;
		const owner = r.owner ? ` · owner ${r.owner}` : "";
		return `- ${head}${owner}${r.note ? `\n  ${r.note}` : ""}${r.link ? `\n  ${r.link}` : ""}`;
	});
	return `Inbox: ${rows.length} new\n${lines.join("\n")}\n\n${CHIEF_NOTE}\n\nHandle a row: inbox.py set <id> --state claimed --owner <who> while working, inbox.py done <id> --note <outcome> when finished (removes it from the ledger). inbox.py is ${INBOX_PY}.`;
}

/** One `inbox.py add`; rejects with its stderr, so a bad rules.yaml stops the mail cursor where it is. */
function inboxAdd(args: string[]): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile("uv", ["run", "--quiet", INBOX_PY, "add", ...args], (err, stdout, stderr) =>
			err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim()),
		),
	);
}

export default function inbox(pi: ExtensionAPI) {
	const mailbox = new Mailbox(new GraphClient(() => auth.getToken({ scopes: auth.GRAPH_SCOPES })));
	let mailInFlight = false;
	let lease: WatchLease | undefined;
	let ctx: ExtensionContext | undefined;
	let dirWatch: fs.FSWatcher | undefined;
	let timer: NodeJS.Timeout | undefined;
	let held: Row[] = [];
	let error = "";

	function renderStatus(): void {
		if (!ctx?.hasUI) return;
		const t = ctx.ui.theme;
		setStatusPart(ctx.ui, "inbox", lease ? (error ? t.fg("error", `◉inbox ⚠ ${error}`) : t.fg("dim", "◉inbox")) : undefined);
	}

	/** New pushed rows past the cursor go into the held queue; the cursor moves only once they are sent. */
	function scan(): void {
		if (!lease) return;
		try {
			const cursor = readCursor() ?? 0;
			const known = Math.max(cursor, ...held.map((r) => Number(r.id)));
			const fresh = readRows().filter((r) => Number(r.id) > known && PUSHED.has(r.action));
			held.push(...fresh);
			if (!error.startsWith("Outlook")) error = "";
		} catch (e) {
			error = String(e instanceof Error ? e.message : e);
		}
		renderStatus();
		flush();
	}

	/** Inbox mail since the cursor, oldest first, into the ledger; the cursor follows each one recorded. */
	async function pollMail(): Promise<void> {
		if (!lease || mailInFlight || !/^outlook:/m.test(fs.readFileSync(path.join(DIR, "rules.yaml"), "utf8"))) return;
		mailInFlight = true;
		try {
			const since = fs.readFileSync(MAIL_CURSOR, "utf8").trim();
			const fresh = await mailSince((skip) => mailbox.list("inbox", { top: MAIL_PAGE, skip }), since, MAIL_PAGE);
			for (const m of fresh) {
				await inboxAdd([
					"--source", "outlook", "--place", "Inbox", "--key", `outlook:${m.id}`,
					"--subject", m.subject || "(no subject)", "--note", `${m.from?.name ?? m.from?.address ?? "?"}: ${m.preview.slice(0, 160)}`,
					"--field", `from=${m.from?.address?.toLowerCase() ?? ""}`, "--field", `flagged=${m.flagged ? "yes" : "no"}`,
				]);
				fs.writeFileSync(MAIL_CURSOR, `${m.received}\n`);
			}
			if (error.startsWith("Outlook")) error = "";
		} catch (e) {
			error = `Outlook: ${e instanceof Error ? e.message : e}`;
		} finally {
			mailInFlight = false;
			renderStatus();
		}
	}

	/** Cards go in while the agent is idle; a busy agent gets them when its turn ends. */
	function flush(): void {
		if (!ctx || held.length === 0 || !ctx.isIdle()) return;
		const rows = held;
		held = [];
		pi.sendMessage(
			{ customType: "inbox", content: card(rows), display: true, details: { ids: rows.map((r) => r.id) } },
			{ triggerTurn: rows.some((r) => r.action === "do") },
		);
		writeCursor(Math.max(...rows.map((r) => Number(r.id))));
	}

	async function start(c: ExtensionContext): Promise<string> {
		if (lease) return "Inbox is already delivered to this session.";
		const claimed = await claim({
			chatId: LEASE_ID,
			label: "wayne inbox",
			pid: process.pid,
			sessionId: c.sessionManager.getSessionId(),
			cwd: c.cwd,
			since: new Date().toISOString(),
		});
		if ("owner" in claimed) throw new Error(`Inbox is already delivered to another session (${describeOwner(claimed.owner)}). Stop it there first.`);
		lease = claimed.lease;
		ctx = c;
		// First delivery ever: what is already in the ledger is not news.
		if (readCursor() === null) writeCursor(maxId(readRows()));
		fs.mkdirSync(DIR, { recursive: true });
		// Any event in the directory rescans: Bun reports a rename by the temp file's name, not ledger.tsv.
		dirWatch = fs.watch(DIR, () => scan());
		// Mail before this watch is not news.
		if (!fs.existsSync(MAIL_CURSOR)) fs.writeFileSync(MAIL_CURSOR, `${new Date().toISOString().replace(/\.\d+Z$/, "Z")}\n`);
		timer = setInterval(() => {
			scan();
			void pollMail();
		}, BACKSTOP_MS);
		timer.unref?.();
		scan();
		void pollMail();
		return `Inbox: new notify/do rows in ${LEDGER} are delivered to this session.`;
	}

	function stop(): void {
		dirWatch?.close();
		clearInterval(timer);
		lease?.close();
		dirWatch = timer = lease = undefined;
		held = [];
		error = "";
		if (ctx?.hasUI) setStatusPart(ctx.ui, "inbox", undefined);
		ctx = undefined;
	}

	pi.registerCommand("inbox", {
		description: "Wayne's inbox: watch (deliver new notify/do rows here) | stop | status",
		getArgumentCompletions: (prefix: string) => {
			const items = ["watch", "stop", "status"].filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, c) => {
			const arg = args.trim() || "status";
			try {
				if (arg === "watch") c.ui.notify(await start(c as unknown as ExtensionContext), "info");
				else if (arg === "stop") {
					const had = !!lease;
					stop();
					c.ui.notify(had ? "Inbox delivery stopped." : "This session does not deliver the inbox.", "info");
				} else if (arg === "status") {
					const open = readRows().filter((r) => r.state === "open" || r.state === "claimed");
					c.ui.notify(`${lease ? "Delivering here" : "Not delivering here"}; cursor ${readCursor() ?? "unset"}; ${open.length} open/claimed rows.${error ? ` ⚠ ${error}` : ""}`, "info");
				} else c.ui.notify(`Unknown: /inbox ${arg}. Use watch | stop | status.`, "error");
			} catch (e) {
				c.ui.notify(`Inbox: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	// omp is not idle yet inside agent_end; look on the next tick, as the Teams watch does.
	pi.on("agent_end", async () => {
		setTimeout(flush, 0);
	});
	pi.on("session_switch", async () => stop());
	pi.on("session_shutdown", async () => stop());
}
