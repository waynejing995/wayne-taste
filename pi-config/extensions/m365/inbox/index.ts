/**
 * The inbox, pushed into this session.
 *
 * Watchers (schedule jobs such as the PR watch and the agent probe, the Teams watch, …) classify events by
 * rules.yaml and append the ones worth tracking to ~/.wayne/inbox/ledger.tsv. This file delivers:
 * every new ledger row whose action is `notify` or `do` becomes an `inbox` card in the session that ran
 * `/inbox watch`. A `do` card starts a turn; a `notify` card is shown and waits for the user.
 *
 * Delivery progress is not task state. The ledger's `state` column (open/claimed) and `inbox done`, which
 * moves a finished row out to archive.tsv, stay the handlers' business; how far delivery got is the highest row id in cursors/session-push.id.
 *
 * The CLI rewrites the ledger by renaming a temp file over it, so the directory is watched, not the file:
 * a watch on the file's inode would go deaf after the first rewrite. A slow poll is the backstop.
 *
 * One session delivers at a time: the claim is the same abstract-socket lease the Teams watch uses.
 *
 * The delivering session also watches Outlook: every BACKSTOP_MS it lists the Inbox, and each mail received
 * since cursors/outlook-inbox.since goes through `inbox add --source outlook --place Inbox`, so rules.yaml
 * decides it like any other event. One poller, because only the lease holder polls. No top-level `outlook:` in
 * rules.yaml means mail is not watched at all: no Graph call.
 *
 * The lease holder also tails push-watched agent sessions, locally or over one SSH stream per host.
 * Agent events become inbox rows; their byte cursors and heartbeat state survive restarts.
 * The directory watch and existing backstop drive retries, rule reloads, and dead checks.
 *
 * Every inbox command runs in this process through cli/main.ts, the same code the `bin/inbox` launcher runs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as auth from "../core/auth.ts";
import { card, statusCard, type Row } from "./card.ts";
import { inbox as inboxCli } from "./cli/main.ts";
import { widgetLines } from "./cli/jobs.ts";
import { initInbox, isSetUp } from "./cli/setup.ts";
import { checkThens, openThenLines } from "./cli/thens.ts";
import { AgentTailer } from "./agents.ts";
import { GraphClient } from "../core/graph.ts";
import { setStatusPart } from "../core/status-row.ts";
import { Mailbox } from "../outlook/mailbox.ts";
import { mailSince } from "./mail.ts";
import { claim, describeOwner, type WatchLease } from "../teams/watch.ts";
import { renderSchedule, runSessionJobs } from "./schedule.ts";
import { DIR, LAUNCHER, LEASE_ID, LEDGER, PUSHED, readCursor, readRows, writeCursor } from "./delivery.ts";

/** The scheduler's lease: one job runner per inbox directory, machine and user. */
const SCHED_ID = `wayne-inbox-schedule:${DIR}`;
const MAIL_CURSOR = path.join(DIR, "cursors", "outlook-inbox.since");
const BACKSTOP_MS = 60_000;
const MAIL_PAGE = 50;

export default function inbox(pi: ExtensionAPI) {
	const mailbox = new Mailbox(new GraphClient(() => auth.getToken({ scopes: auth.GRAPH_SCOPES })));
	let mailInFlight = false;
	let lease: WatchLease | undefined;
	let ctx: ExtensionContext | undefined;
	let dirWatch: fs.FSWatcher | undefined;
	let timer: NodeJS.Timeout | undefined;
	let agents: AgentTailer | undefined;
	let held: Row[] = [];
	let error = "";
	// The scheduler: its own lease, so jobs run in exactly one session per inbox directory, delivering or not.
	let sched: WatchLease | undefined;
	let schedCtx: ExtensionContext | undefined;
	let schedTimer: NodeJS.Timeout | undefined;
	let schedOwner = "";
	let schedError = "";
	const jobFailures = new Map<string, string>();
	let thenError = "";
	let tickInFlight = false;

	function renderStatus(): void {
		const c = ctx ?? schedCtx;
		if (!c?.hasUI) return;
		const t = c.ui.theme;
		const agentStatus = agents?.status() ?? "";
		const problem = [error, schedError, thenError].filter(Boolean).join(" · ");
		const status = `◉inbox${problem ? ` ⚠ ${problem}` : ""}${agentStatus ? ` · ${agentStatus}` : ""}`;
		setStatusPart(c.ui, "inbox", lease || problem ? t.fg(problem || agentStatus.includes("⚠") ? "error" : "dim", status) : undefined);
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

	/**
	 * Inbox mail since the cursor, oldest first, into the ledger; the cursor follows each one recorded.
	 * Never rejects: it runs from a timer, so every failure lands on the status row and in /inbox status.
	 */
	async function pollMail(): Promise<void> {
		if (!lease || mailInFlight) return;
		mailInFlight = true;
		try {
			// No rules.yaml, or no top-level `outlook:` in it, means mail is not watched: no Graph call.
			const rules = path.join(DIR, "rules.yaml");
			if (!fs.existsSync(rules) || !/^outlook:/m.test(fs.readFileSync(rules, "utf8"))) return;
			const since = fs.readFileSync(MAIL_CURSOR, "utf8").trim();
			const fresh = await mailSince((skip) => mailbox.list("inbox", { top: MAIL_PAGE, skip }), since, MAIL_PAGE);
			for (const m of fresh) {
				await inboxCli([
					"add", "--source", "outlook", "--place", "Inbox", "--key", `outlook:${m.id}`,
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
			{ customType: "inbox", content: card(rows, LAUNCHER), display: true, details: { ids: rows.map((r) => r.id) } },
			{ triggerTurn: rows.some((r) => r.action === "do") },
		);
		writeCursor(Math.max(...rows.map((r) => Number(r.id))));
	}

	/**
	 * Then-actions: fire the ones whose trigger row just landed. The delivering session runs this on every inbox
	 * directory change, so a merge or RESULT row becomes a card at once; the scheduler tick adds the time-based
	 * triggers (at:, reminders) and gh-run, which only GitHub knows. Cards are keyed per then, so two checkers make one.
	 */
	let thenInFlight = false;
	let thenAgain = false;
	async function checkThenActions(gh: boolean): Promise<void> {
		if (thenInFlight) {
			thenAgain = true;
			return;
		}
		thenInFlight = true;
		try {
			const failed = (await checkThens({ gh })).filter((l) => l.startsWith("fail "));
			if (failed.length) thenError = failed.join("; ").slice(0, 200);
			else if (gh) thenError = "";
		} catch (e) {
			thenError = `then: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			thenInFlight = false;
			renderStatus();
		}
		if (thenAgain) {
			thenAgain = false;
			await checkThenActions(false);
		}
	}

	async function claimFor(c: ExtensionContext, id: string, label: string): Promise<WatchLease | string> {
		const claimed = await claim({ chatId: id, label, pid: process.pid, sessionId: c.sessionManager.getSessionId(), cwd: c.cwd, since: new Date().toISOString() });
		return "owner" in claimed ? describeOwner(claimed.owner) : claimed.lease;
	}

	/**
	 * One scheduler tick: hold (or try to take) the scheduler lease, check the then-actions, then start every due
	 * job without waiting for it, so a long job (a 15-minute digest) never holds back the next minute's short jobs,
	 * `at:` triggers or reminders. A job's own failure is a ledger row; the last failure per job (and a tick that
	 * cannot run at all) lands on the status row and in /inbox status.
	 */
	async function tick(): Promise<void> {
		if (!schedCtx || tickInFlight) return;
		tickInFlight = true;
		try {
			if (!sched) {
				const got = await claimFor(schedCtx, SCHED_ID, "inbox scheduler");
				if (typeof got === "string") {
					schedOwner = got;
					return;
				}
				sched = got;
				schedOwner = "";
			}
			await checkThenActions(true);
			const c = schedCtx;
			void runSessionJobs(c)
				.then((lines) => {
					for (const line of lines) {
						const name = line.split(" ")[1] ?? "";
						if (line.startsWith("fail ")) jobFailures.set(name, line);
						else jobFailures.delete(name);
					}
					const failed = [...jobFailures.values()];
					schedError = failed.length ? `schedule: ${failed.join("; ").slice(0, 200)}` : "";
				})
				.catch((e) => {
					schedError = `schedule: ${e instanceof Error ? e.message : String(e)}`;
				})
				.finally(() => {
					if (schedCtx === c) renderSchedule(c.hasUI ? c.ui : undefined);
					renderStatus();
				});
		} catch (e) {
			schedError = `schedule: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			tickInFlight = false;
			renderStatus();
		}
	}

	function startScheduler(c: ExtensionContext): void {
		schedCtx = c;
		if (!schedTimer) {
			schedTimer = setInterval(() => void tick(), BACKSTOP_MS);
			schedTimer.unref?.();
		}
		void tick();
	}

	function stopScheduler(): void {
		clearInterval(schedTimer);
		sched?.close();
		sched = schedTimer = undefined;
		schedError = schedOwner = "";
		jobFailures.clear();
		if (schedCtx?.hasUI) setStatusPart(schedCtx.ui, "sched", undefined);
		schedCtx = undefined;
	}

	function schedulerLine(): string {
		if (!isSetUp()) return "Not set up: run /inbox setup.";
		if (sched) return "Scheduler: running here.";
		if (schedOwner) return `Scheduler: runs in another session (${schedOwner}).`;
		return "Scheduler: not running in this session.";
	}

	async function start(c: ExtensionContext): Promise<string> {
		if (lease) return "Inbox is already delivered to this session.";
		if (!isSetUp()) throw new Error(`${DIR} is not set up: run /inbox setup first.`);
		const got = await claimFor(c, LEASE_ID, "wayne inbox");
		if (typeof got === "string") throw new Error(`Inbox is already delivered to another session (${got}). Stop it there first.`);
		lease = got;
		ctx = c;
		try {
			// Cursors start at "now" (first delivery ever: what is already in the ledger is not news); the same init as `inbox setup`.
			initInbox();
			// Any event in the directory rescans: Bun reports a rename by the temp file's name, not ledger.tsv.
			dirWatch = fs.watch(DIR, () => { scan(); void agents?.poke(); void checkThenActions(false); });
			agents = new AgentTailer({ dir: DIR, inbox: inboxCli, onChange: renderStatus });
			agents.start();
			timer = setInterval(() => {
				scan();
				void agents?.poke();
				void agents?.tick();
				void pollMail();
			}, BACKSTOP_MS);
			timer.unref?.();
			scan();
		} catch (e) {
			// A half-started delivery must not keep the lease: `/inbox watch` would then answer "already delivered" forever.
			stop();
			throw e;
		}
		void pollMail();
		startScheduler(c);
		return `Inbox: new notify/do rows in ${LEDGER} are delivered to this session.`;
	}

	function stop(): void {
		dirWatch?.close();
		agents?.stop();
		agents = undefined;
		clearInterval(timer);
		lease?.close();
		dirWatch = timer = lease = undefined;
		held = [];
		error = "";
		if (ctx?.hasUI) setStatusPart(ctx.ui, "inbox", undefined);
		ctx = undefined;
		renderStatus();
	}

	const SUBCOMMANDS = ["status", "setup", "watch", "stop"];
	pi.registerCommand("inbox", {
		description: "Inbox: status | setup (create rules.yaml, check tools) | watch (deliver new notify/do rows here) | stop",
		getArgumentCompletions: (prefix: string) => {
			const items = SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, c) => {
			const arg = args.trim() || "status";
			const here = c as unknown as ExtensionContext;
			try {
				if (arg === "watch") c.ui.notify(await start(here), "info");
				else if (arg === "setup") {
					const out = await inboxCli(["setup"]);
					startScheduler(here);
					c.ui.notify(out, "info");
				} else if (arg === "stop") {
					const had = !!lease;
					stop();
					c.ui.notify(had ? "Inbox delivery stopped." : "This session does not deliver the inbox.", "info");
				} else if (arg === "status") {
					const open = readRows().filter((r) => r.state === "open" || r.state === "claimed");
					const problem = [error, schedError, thenError].filter(Boolean).join(" · ");
					const jobs = isSetUp() ? widgetLines() : [];
					const head = [
						`${lease ? "Delivering here" : "Not delivering here"}; cursor ${readCursor() ?? "unset"}; ${open.length} open/claimed rows.${problem ? ` ⚠ ${problem}` : ""}`,
						schedulerLine(),
						...jobs.map((j) => `- ${j}`),
						...(isSetUp() ? openThenLines().map((l) => `- ${l}`) : []),
						...(agents ? [agents.describe()] : []),
					].join("\n");
					pi.sendMessage({ customType: "inbox-status", content: statusCard(head, open), display: true, details: {} }, { triggerTurn: false });
				} else c.ui.notify(`Unknown: /inbox ${arg}. Use ${SUBCOMMANDS.join(" | ")}.`, "error");
			} catch (e) {
				c.ui.notify(`Inbox: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});

	// Jobs run while a session with a UI is open. Print runs (-p) start nothing, so a headless job never recurses.
	pi.on("session_start", async (_event, c) => {
		if (!c.hasUI) return;
		if (!isSetUp()) {
			c.ui.notify(`Inbox: ${DIR} is not set up, so no jobs run and nothing is delivered. Run /inbox setup.`, "warning");
			return;
		}
		startScheduler(c);
	});
	// omp is not idle yet inside agent_end; look on the next tick, as the Teams watch does.
	pi.on("agent_end", async () => {
		setTimeout(flush, 0);
	});
	pi.on("session_switch", async () => {
		stop();
		stopScheduler();
	});
	pi.on("session_shutdown", async () => {
		stop();
		stopScheduler();
	});
}
