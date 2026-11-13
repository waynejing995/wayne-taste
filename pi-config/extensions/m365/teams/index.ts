/**
 * Microsoft Teams for pi.
 *
 * Two interchangeable backends answer every operation, chosen by `backend` in
 * ~/.pi/agent/teams.json:
 *
 *   graph  (default) -- Microsoft Graph over HTTP, from this process, plus
 *                       chatsvc for the self-chat, which Graph has no API for.
 *                       Its own MSAL token cache; `/teams login` fills it.
 *   script           -- shells out to fetch_teams.py, which owns its own auth.
 *                       Kept as the rollback: one config line, no code change.
 *
 * The two are held to each other by tests/parity.test.mjs, which runs both
 * against the same mailbox and diffs the results.
 *
 * Neither backend degrades quietly: a missing script, an unauthenticated cache
 * or a throttled scan reaches the status bar. See clearErrorOnSuccess() for the
 * one place that indicator is retired.
 *
 * Surfaces:
 *   1. Status bar   -- how many chats hold unread activity (polled, cached).
 *   2. teams_send / teams_read / teams_unread / teams_chats / teams_people / teams_watch.
 *   3. /teams       -- compose box, unread list, login, chat watches.
 *
 * Watches: `/teams watch self` turns notes starting with `omp:` or `pi:` into
 * prompts in this session, ACKs them, and posts the answer back to the self-chat.
 * My own `omp:`/`pi:` messages in any other watched chat do the same.
 */

import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import * as auth from "../core/auth.ts";
import { describeImage } from "../core/describe-image.ts";
import { setStatusPart } from "../core/status-row.ts";
import { setAgentHarness } from "./card.ts";
import { openComposeOverlay } from "./compose-overlay.ts";
import { CHATS_REVALIDATE_MS, createTeams } from "./core.ts";
import { askTurnGate } from "./turn-gate.ts";
import type { ChatsPage } from "./types.ts";

export default function (pi: ExtensionAPI) {
	// The agent's sends are footed "sent by omp agent"; the echo guard knows this footer, and only this one.
	setAgentHarness("omp");
	let transient = ""; // "sending…" / "sent ✓" / "send failed"

	let unreadTimer: ReturnType<typeof setInterval> | undefined;
	let statusCtx: ExtensionContext | undefined;

	// The tools, the watch engine and the backends: shared with the MCP server. What stays here is omp's UI.
	const teams = createTeams({
		registerTool: (tool) => pi.registerTool(tool as Parameters<ExtensionAPI["registerTool"]>[0]),
		exec: (command, args, options) => pi.exec(command, args, options),
		sendMessage: (message, options) => pi.sendMessage(message, options),
		sendUserMessage: (text, options) => pi.sendUserMessage(text, options),
		renderStatus: (ctx) => renderStatus(ctx as ExtensionContext | undefined),
		flash: (ctx, text, holdMs) => flash(ctx as ExtensionContext, text, holdMs),
		gate: (ctx, policy, messages) => askTurnGate(ctx as ExtensionContext, policy, messages),
	});
	const { cfg, backend, getChats, loadHistoryPage, send, mdToHtml, chatsCacheAgeMs, pollUnread, searchPeople, loadImage } = teams;
	const { watchList, setWatchInterval, startWatch, unwatch, stopAllWatches, replyToSelf, flushCards } = teams;

	// ── Status bar ──────────────────────────────────────────────────────────

	function renderStatus(ctx?: ExtensionContext) {
		const c = ctx ?? statusCtx;
		if (!c?.hasUI) return;
		const t = c.ui.theme;
		let s: string;

		if (teams.backendError) {
			s = t.fg("error", `Teams: ${teams.backendError}`);
		} else if (teams.unreadCount === null) {
			s = t.fg("dim", "Teams: …");
		} else if (teams.unreadCount > 0) {
			s = t.fg("warning", `Teams: ${teams.unreadCount} unread`);
		} else {
			s = t.fg("dim", "Teams: 0");
		}
		if (teams.unreadStale) s += t.fg("warning", " ⚠stale");
		if (teams.watches.size > 0) {
			const failing = [...teams.watches.values()].some((w) => w.error);
			s += t.fg(failing ? "warning" : "accent", ` ◉watch ${teams.watches.size}${failing ? " ⚠" : ""}`);
		}
		if (transient) s += t.fg("dim", ` · ${transient}`);

		setStatusPart(c.ui, "teams", s);
	}

	function flash(ctx: ExtensionContext, text: string, holdMs = 4000) {
		transient = text;
		renderStatus(ctx);
		setTimeout(() => {
			if (transient === text) {
				transient = "";
				renderStatus(ctx);
			}
		}, holdMs).unref?.();
	}
	// ── Compose overlay ─────────────────────────────────────────────

	async function compose(ctx: ExtensionContext) {
		let first: ChatsPage;
		try {
			first = await getChats();
		} catch (e) {
			ctx.ui.notify(`Cannot load chat list: ${e}`, "error");
			return;
		}
		await openComposeOverlay(ctx, {
			chats: first,
			loadChats: (cursor) => backend.chatsPage(cursor),
			loadHistory: (t, cursor) => loadHistoryPage(t, cursor),
			send: (t, message, html) => send(t, message, html),
			mdToHtml,
			refreshChats: () => getChats(true),
			revalidateChats: async () => {
				const age = chatsCacheAgeMs();
				if (age !== null && age < CHATS_REVALIDATE_MS) return null;
				return getChats(true);
			},
			// Callbacks, not a copy: unreadItems is owned by the poll loop, and a
			// snapshot handed to the overlay would drift the moment it refreshes.
			unreadIds: () => teams.unreadItems.map((i) => i.id),
			refreshUnread: () => pollUnread(ctx),
			searchPeople,
			loadImage,
			altText: (url, source) => describeImage(ctx, url, () => loadImage(url, source), source ?? ""),
			markRead: async (chatId) => {
				// Teams itself now reports this chat as read, so pruning the
				// local list is the derived view catching up, not a second
				// opinion about what "read" means.
				await teams.markRead(chatId);
				renderStatus(ctx);
			},
		});
	}
	// ── Command ─────────────────────────────────────────────────────────────

	const SUBCOMMANDS = ["compose", "unread", "refresh", "watch", "watch-interval", "unwatch", "watches", "status", "login", "init", "verify"];

	pi.registerCommand("teams", {
		description: "Teams: compose a message, check unread, watch chats",
		getArgumentCompletions: (prefix: string) => {
			const items = SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const arg = args.trim();

			if (arg === "" || arg === "compose") return compose(ctx as unknown as ExtensionContext);

			/**
			 * Log in, then PROVE it. A login that only says "saved" defers the real
			 * discovery -- missing licence, refused scope, wrong audience -- to the
			 * first background poll, where it surfaces as "Teams is broken".
			 */
			if (arg === "init" || arg === "login") {
				try {
					// The only interactive auth path in the extension. Everything else
					// takes a silent token or fails loud; see auth.ts.
					const r = await auth.init({ onPrompt: (m) => ctx.ui.notify(m, "info") });
					const v = await auth.verify(await auth.getToken({ scopes: auth.GRAPH_SCOPES }));
					if (!v.ok) {
						ctx.ui.notify(
							v.transient
								? `Teams: signed in as ${r.username}, but could NOT verify — Graph is unavailable (HTTP ${v.status}): ${v.error}. Run /teams verify shortly.`
								: `Teams login stored a token that does NOT work: ${v.error ?? `HTTP ${v.status}`}`,
							v.transient ? "warning" : "error",
						);
						return;
					}
					ctx.ui.notify(
						`Teams: logged in as ${v.displayName ?? r.username} <${v.upn ?? r.username}>\n` +
							`verified: GET /me ${v.status} · aud ${v.aud}\ncache: ${r.cache}`,
						"info",
					);
				} catch (e) {
					ctx.ui.notify(`Teams login failed: ${e}`, "error");
				}
				return;
			}

			/** Same proof, without a new login: is the cached token still good? */
			if (arg === "verify") {
				try {
					const v = await auth.verify(await auth.getToken({ scopes: auth.GRAPH_SCOPES }));
					// Throttled is not rejected. Saying "REJECTED" on a 429 sends the
					// user to re-authenticate over something that clears by itself.
					const message = v.ok
						? `Teams token OK — ${v.displayName} <${v.upn}> · GET /me ${v.status} · aud ${v.aud}`
						: v.transient
							? `Teams token NOT CHECKED — Graph is unavailable right now (HTTP ${v.status}): ${v.error}. The token itself is untouched; try again shortly.`
							: `Teams token REJECTED: ${v.error ?? `HTTP ${v.status}`}`;
					ctx.ui.notify(message, v.ok ? "info" : v.transient ? "warning" : "error");
				} catch (e) {
					ctx.ui.notify(`Teams token unusable: ${e}`, "error");
				}
				return;
			}

			if (arg === "status") {
				const authState = fs.existsSync(auth.cachePath()) ? `cache ${auth.cachePath()}` : "NOT authenticated (/teams init)";
				ctx.ui.notify(
					`Teams · backend ${cfg.backend} · script ${cfg.script}\n` +
						`auth ${authState}\n` +
						`unread ${teams.unreadCount ?? "?"}${teams.unreadStale ? " (stale)" : ""} · poll ${cfg.unreadPollSec}s\n` +
						`self-chat replies ${cfg.selfReply ? "ON" : "OFF"}\n` +
						`watch ${teams.watches.size > 0 ? [...teams.watches.values()].map((w) => w.owner.label).join(", ") : "none"} (${teams.watchPollSec}s)`,
					"info",
				);
				return;
			}

			if (arg === "watches") {
				try {
					ctx.ui.notify(await watchList(), "info");
				} catch (e) {
					ctx.ui.notify(`Teams watch list failed: ${e}`, "error");
				}
				return;
			}

			if (/^watch-interval\b/.test(arg)) {
				try {
					const warn = setWatchInterval(Number(arg.split(/\s+/)[1]));
					ctx.ui.notify(`Teams watches now poll every ${teams.watchPollSec}s in this session.${warn}`, warn ? "warning" : "info");
				} catch (e) {
					ctx.ui.notify(`Teams watch-interval failed: ${e instanceof Error ? e.message : e}`, "error");
				}
				return;
			}

			if (/^(un)?watch\b/.test(arg)) {
				const [verb, ...rest] = arg.split(/\s+/);
				// `/teams watch <chat> --policy <text>`: the policy is the rest of the line, quotes optional.
				const m = rest.join(" ").match(/^(.*?)\s*--policy(?:\s+(.*))?$/s);
				const key = m ? m[1] : rest.join(" ");
				const policy = m ? (m[2] ?? "").replace(/^(["'])(.*)\1$/s, "$2") : undefined;
				try {
					ctx.ui.notify(verb === "watch" ? await startWatch(ctx as unknown as ExtensionContext, undefined, key, policy) : unwatch(key), "info");
				} catch (e) {
					ctx.ui.notify(`Teams ${verb} failed: ${e instanceof Error ? e.message : e}`, "error");
				}
				return;
			}

			if (arg === "unread" || arg === "refresh") {
				await pollUnread(ctx as unknown as ExtensionContext, arg === "refresh");
				if (!teams.unreadCount) {
					ctx.ui.notify("No unread Teams chats.", "info");
					return;
				}
				ctx.ui.notify(
					teams.unreadItems.map((i) => `● ${i.label} — ${i.sender}: ${i.preview.slice(0, 90)}`).join("\n"),
					"info",
				);
				return;
			}

			ctx.ui.notify(`Unknown: /teams ${arg}\nTry: ${SUBCOMMANDS.join(", ")}`, "warning");
		},
	});

	// ── Lifecycle ───────────────────────────────────────────────────────────
	// omp replaces the session in place on /new, /resume and /fork and says so with session_switch; pi has no such
	// event (it shuts the old session down instead), so its declarations lack it. A watch belongs to the session that
	// started it, so both events end every watch and drop the queued cards.
	const onSessionSwitch = (pi.on as unknown as (event: "session_switch", handler: () => Promise<void> | void) => void).bind(pi);
	onSessionSwitch("session_switch", () => stopAllWatches());

	pi.on("session_start", async (_event, ctx) => {
		statusCtx = ctx;
		if (!ctx.hasUI) return; // no status bar to feed, and -p runs should cost nothing
		renderStatus(ctx);
		void pollUnread(ctx);
		unreadTimer = setInterval(() => void pollUnread(ctx), cfg.unreadPollSec * 1000);
		unreadTimer.unref?.();
	});

	pi.on("message_end", async (event) => {
		const msg = event.message as { role: string; customType?: string; details?: { chatId: string; ids: string[] } };
		// A card is in the conversation once its message ends: the last step of the card log.
		if (msg.role === "custom" && msg.customType === "teams-watch" && msg.details?.ids) teams.logCard("delivered", msg.details);
		if (event.message.role !== "assistant") return;
		const content = event.message.content;
		teams.noteAssistantText(content.filter((p): p is TextContent => p.type === "text").map((p) => p.text).join("\n"));
	});

	// pi says when the agent is done; omp has no agent_settled, so agent_end checks too (idle on the next tick).
	pi.on("agent_settled", async (_event, ctx) => {
		teams.turnEnded();
		await replyToSelf(ctx);
	});

	// A card held back during a turn goes in once the agent is idle. omp is not idle yet inside agent_end
	// (the prompt is still settling), so look again on the next tick; the poll timer is the backstop.
	pi.on("agent_end", async (_event, ctx) => {
		teams.turnEnded();
		setTimeout(() => {
			void replyToSelf(ctx);
			flushCards();
		}, 0);
	});

	pi.on("session_shutdown", async () => {
		if (unreadTimer) clearInterval(unreadTimer);
		unreadTimer = undefined;
		stopAllWatches();
	});
}
