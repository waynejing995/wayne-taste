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
 *   2. teams_send / teams_read / teams_unread / teams_chats / teams_people.
 *   3. /teams       -- compose box, unread list, login, and the remote channel.
 *
 * Remote channel: with `/teams remote on`, a message you post to your own
 * Teams self-chat starting with `pi:` is executed in this session, and the
 * answer is posted back to the self-chat. It is off by default and guarded
 * by a cross-session lock, because "run whatever arrives over chat" is a
 * capability you should have to ask for out loud.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { marked } from "marked";
import { Type } from "typebox";
import * as auth from "./auth.ts";
import type { Backend, SelfMessage, UnreadItem } from "./backend.ts";
import { ScriptBackend } from "./backend.ts";
import { GraphBackend } from "./graph-backend.ts";
import { GraphClient } from "./graph.ts";
import type { ChatRef, HistoryMessage, LoadedImage, Person, SendTarget } from "./compose-overlay.ts";
import { HISTORY_MESSAGES, openComposeOverlay } from "./compose-overlay.ts";
import { SKYPE_SCOPES, SkypeClient } from "./skype.ts";
import { formatLocal } from "./time.ts";

// ── Config ──────────────────────────────────────────────────────────────────

interface TeamsConfig {
	/**
	 * Who fetches: `script` shells out to fetch_teams.py, `graph` talks to
	 * Microsoft Graph from here. Kept switchable so a bad migration step is a
	 * config edit away from being undone.
	 */
	backend: "script" | "graph";
	/** Path to fetch_teams.py. Used by the `script` backend. */
	script: string;

	/** Seconds between unread scans. Teams is not a chat client; slow is fine. */
	unreadPollSec: number;
	/** Seconds between self-chat polls while the remote channel is armed. */
	remotePollSec: number;
	/** Only self-chat messages starting with this are executed. */
	remotePrefix: string;
	/** Post the agent's answer back to the self-chat after a remote command. */
	remoteReply: boolean;
	/** Hard timeout for one script invocation. */
	execTimeoutMs: number;
}

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "teams.json");

const DEFAULTS: TeamsConfig = {
	// Graph by default since 2026-08-21: the offline suite, a read-only live
	// parity run over 100 chats and ~430 messages, and a tool-level smoke all
	// agree with the script path. Rollback is one line in teams.json --
	// `"backend": "script"` -- and needs no code change.
	backend: "graph",
	// No default: a path to somebody's checkout does not belong in source, and
	// the script backend is a rollback, not the normal path. Set it alongside
	// "backend": "script" if you need it.
	script: "",
	unreadPollSec: 600,
	remotePollSec: 60,
	remotePrefix: "pi:",
	remoteReply: true,
	execTimeoutMs: 150_000,
};

const BACKENDS = ["script", "graph"];

export function loadConfig(): TeamsConfig {
	if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
	let cfg: TeamsConfig;
	try {
		cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
	} catch (e) {
		// Do not fall back silently to defaults on a typo'd config -- the user
		// would spend an hour wondering why their script path is ignored.
		throw new Error(`teams extension: ${CONFIG_PATH} is not valid JSON: ${e}`);
	}
	// A misspelled backend must not quietly resolve to the default: the whole
	// point of the switch is knowing which one is answering.
	if (!BACKENDS.includes(cfg.backend))
		throw new Error(`teams extension: backend must be one of ${BACKENDS.join(" | ")}, got ${JSON.stringify(cfg.backend)}`);
	return cfg;
}

const cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi");
const CHATS_CACHE = path.join(cacheDir, "teams-chats.json");
const REMOTE_LOCK = path.join(cacheDir, "teams-remote.lock");
const REMOTE_CURSOR = path.join(cacheDir, "teams-remote-cursor.json");
const CHATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Below this age the cached chat list is trusted outright; above it, opening
  * the composer triggers one background refresh. */
const CHATS_REVALIDATE_MS = 5 * 60 * 1000;
/** Listing depth for the picker. Wider than the digest's configured cap, which
  * must stay small because that path fetches every listed chat's messages. */
const PICKER_MAX_CHATS = 100;
/** Screenshots are heavy in context; a chat can hold many. Newest win. */
const MAX_IMAGES_PER_READ = 4;
/**
 * Marks a message the agent sent rather than one the user typed.
 *
 * It goes out under the user's own account, so without this the recipient has
 * no way to tell a machine wrote it. Only teams_send adds it: anything composed
 * by hand in /teams was typed by a person and must not claim otherwise.
 *
 * The model is named because "an agent wrote this" and "GPT-5 wrote this" are
 * different amounts of information to the person reading it.
 */
function agentFooter(model: { name?: string; id?: string } | undefined): string {
	// Both halves matter: that a machine sent it, and which one wrote it.
	const who = model?.name || model?.id || "an unknown model";
	return `\n\n---\n\n*sent by pi agent · generated by ${who}*`;
}
const ALT_CACHE_DIR = path.join(cacheDir, "teams-alt");

// ── Types ───────────────────────────────────────────────────────────────────

// ChatRef / HistoryMessage / SendTarget are owned by ./compose-overlay.ts and
// UnreadItem / SelfMessage by ./backend.ts (both leaf modules), so there is
// exactly one definition of each shape.


export default function (pi: ExtensionAPI) {
	const cfg = loadConfig();

	// ── State (single source of truth for the status bar) ───────────────────
	let unreadCount: number | null = null;
	let unreadItems: UnreadItem[] = [];
	let unreadStale = false;
	/**
	 * The last hard fault from whichever backend is active, or "".
	 *
	 * Backend-wide, not script-specific: it used to be cleared only inside
	 * runScript(), so on the graph backend a single failed poll left "scan
	 * failed" on the status bar forever, through any number of later successes.
	 * Every successful operation must clear it.
	 */
	let backendError = "";
	let transient = ""; // "sending…" / "sent ✓" / "send failed"
	let remoteArmed = false;

	let unreadTimer: ReturnType<typeof setInterval> | undefined;
	let remoteTimer: ReturnType<typeof setInterval> | undefined;
	let unreadInFlight = false;
	let remoteInFlight = false;

	let remotePending = false; // a remote command is mid-flight in this session
	let lastAssistantText = "";
	let statusCtx: ExtensionContext | undefined;

	// ── Status bar ──────────────────────────────────────────────────────────

	function renderStatus(ctx?: ExtensionContext) {
		const c = ctx ?? statusCtx;
		if (!c?.hasUI) return;
		const t = c.ui.theme;
		let s: string;

		if (backendError) {
			s = t.fg("error", `Teams: ${backendError}`);
		} else if (unreadCount === null) {
			s = t.fg("dim", "Teams: …");
		} else if (unreadCount > 0) {
			s = t.fg("warning", `Teams: ${unreadCount} unread`);
		} else {
			s = t.fg("dim", "Teams: 0");
		}
		if (unreadStale) s += t.fg("warning", " ⚠stale");
		if (remoteArmed) s += t.fg("accent", " ⌁remote");
		if (transient) s += t.fg("dim", ` · ${transient}`);

		c.ui.setStatus("teams", s);
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

	// ── Script bridge ───────────────────────────────────────────────────────

	async function runScript(args: string[], timeoutMs = cfg.execTimeoutMs) {
		if (!cfg.script || !fs.existsSync(cfg.script)) {
			backendError = cfg.script ? `script not found: ${cfg.script}` : 'backend "script" needs a "script" path in teams.json';
			renderStatus();
			throw new Error(backendError);
		}
		const r = await pi.exec("uv", ["run", "--quiet", cfg.script, ...args], {
			timeout: timeoutMs,
			cwd: path.dirname(cfg.script),
		});
		if (r.code !== 0) {
			const detail = (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ");
			throw new Error(`fetch_teams.py ${args[0]} failed (exit ${r.code}): ${detail}`);
		}
		return r.stdout;
	}

	/**
	 * Who actually fetches.
	 *
	 * The seam exists so the Graph implementation could land op by op behind a
	 * config switch instead of as one unrevertable rewrite. `backend: "script"`
	 * in ~/.pi/agent/teams.json still restores the subprocess path exactly, with
	 * no code change -- that is the rollback.
	 *
	 * Built once at load: a per-call factory would re-read the token cache and
	 * re-do the chatsvc authz swap on every poll.
	 */
	function makeBackend(): Backend {
		if (cfg.backend === "script") return new ScriptBackend(runScript);
		return new GraphBackend(new GraphClient(() => auth.getToken({ scopes: auth.GRAPH_SCOPES })), {
			// From the signed-in account, never from a constant. See auth.identity().
			whoami: async () => (await auth.identity()).displayName,
			maxChats: PICKER_MAX_CHATS,
			// A different scope, so a different token: the self-chat is chatsvc,
			// not Graph, and a failure there must be attributable to that credential.
			skype: new SkypeClient(() => auth.getToken({ scopes: SKYPE_SCOPES })),
		});
	}

	/**
	 * Wraps a backend so that ANY successful call retires the error indicator.
	 *
	 * This is the choke point the graph backend did not have. The clear used to
	 * live inside runScript(), which meant it existed only for the subprocess
	 * path: on graph, one failed poll pinned "scan failed" to the status bar
	 * through every later success. An indicator that cannot go back to green is
	 * one you learn to ignore.
	 */
	function clearErrorOnSuccess(inner: Backend): Backend {
		return new Proxy(inner, {
			get(target, prop, recv) {
				const value = Reflect.get(target, prop, recv);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					const out = (value as (...a: unknown[]) => unknown).apply(target, args);
					if (out instanceof Promise) {
						return out.then((r) => {
							backendError = "";
							renderStatus();
							return r;
						});
					}
					return out;
				};
			},
		});
	}

	const backend: Backend = clearErrorOnSuccess(makeBackend());

	// ── Unread poll ─────────────────────────────────────────────────────────

	async function pollUnread(ctx: ExtensionContext, force = false) {
		if (unreadInFlight) return;
		unreadInFlight = true;
		try {
			// Let the backend's own disk cache absorb the case of several pi
			// sessions polling at once: only one of them pays for the Graph call.
			const maxAge = force ? 0 : Math.floor(cfg.unreadPollSec * 0.9);
			const data = await backend.unread(maxAge);
			unreadCount = data.unread_chats;
			unreadItems = data.items ?? [];
			unreadStale = Boolean(data.stale);
			// The error indicator is retired by clearErrorOnSuccess(), which wraps
			// every backend call -- not here, or each caller would need its own
			// copy and the graph path would be missed again.
		} catch (e) {
			unreadStale = true;
			// Keep a more specific diagnosis if one exists (e.g. a missing
			// script): overwriting it here would downgrade a hard fault.
			if (!backendError) backendError = "scan failed";
			ctx.ui.notify?.(`Teams unread scan failed: ${e}`, "warning");
		} finally {
			unreadInFlight = false;
			renderStatus(ctx);
		}
	}

	// ── Chat list (for the compose picker) ──────────────────────────────────

	/** Age of the cached chat list in ms, or null when there is no cache. */
	function chatsCacheAgeMs(): number | null {
		if (!fs.existsSync(CHATS_CACHE)) return null;
		return Date.now() - fs.statSync(CHATS_CACHE).mtimeMs;
	}

	async function getChats(force = false): Promise<ChatRef[]> {
		if (!force && fs.existsSync(CHATS_CACHE)) {
			const age = Date.now() - fs.statSync(CHATS_CACHE).mtimeMs;
			if (age < CHATS_CACHE_TTL_MS) {
				return JSON.parse(fs.readFileSync(CHATS_CACHE, "utf8")).chats as ChatRef[];
			}
		}
		const chats = await backend.chats(PICKER_MAX_CHATS);
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(CHATS_CACHE, JSON.stringify({ chats }));
		return chats;
	}

	/** The backend fetches it (it holds the token); the mime is sniffed here. */
	async function loadImage(url: string): Promise<LoadedImage> {
		const buf = await backend.image(url);
		const mime =
			buf[0] === 0x89 && buf[1] === 0x50
				? "image/png"
				: buf[0] === 0xff && buf[1] === 0xd8
					? "image/jpeg"
					: buf[0] === 0x47 && buf[1] === 0x49
						? "image/gif"
						: "application/octet-stream";
		return { base64: buf.toString("base64"), mime };
	}

	/**
	 * One-line description of a picture, produced by the model and cached on disk.
	 *
	 * This terminal cannot draw images -- tty7 implements the Kitty protocol but
	 * leaves placed images behind when the screen scrolls, so anything pi draws
	 * lands in the wrong place. Reading the picture out is the next best thing,
	 * and it should just be there rather than hidden behind a keystroke.
	 */
	async function altText(url: string, ctx: ExtensionContext): Promise<string> {
		fs.mkdirSync(ALT_CACHE_DIR, { recursive: true });
		const file = path.join(ALT_CACHE_DIR, `${createHash("sha256").update(url).digest("hex").slice(0, 32)}.txt`);
		if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");

		const model = ctx.model;
		if (!model) throw new Error("no model selected");
		const { base64, mime } = await loadImage(url);
		// Through the registry, not pi-ai's bare completeSimple: the registry is
		// the facade that resolves the provider and attaches credentials. Calling
		// the raw function skips that and the request comes back unauthenticated
		// with no text at all.
		const reply = await ctx.modelRegistry.complete(model, {
			messages: [
				{
					role: "user",
					timestamp: Date.now(),
					content: [
						{
							type: "text",
							text:
								"Describe this image from a work chat in one or two short lines, for someone " +
								"who cannot see it. Quote any error message, command or short text verbatim. " +
								"No preamble, no markdown, just the description.",
						},
						{ type: "image", data: base64, mimeType: mime },
					],
				},
			],
		});
		const text = reply.content
			.filter((c: { type: string }) => c.type === "text")
			.map((c: { text: string }) => c.text)
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		if (!text) {
			// Report what actually went wrong. A generic "no description" hid an
			// unauthenticated request behind a message that sounded like the model
			// simply had nothing to say.
			const why = reply.errorMessage || `stopReason=${reply.stopReason}`;
			throw new Error(why);
		}
		fs.writeFileSync(file, text);
		return text;
	}

	async function searchPeople(query: string): Promise<Person[]> {
		return backend.people(query);
	}

	// ── Send ────────────────────────────────────────────────────────────────

	function describeTarget(t: SendTarget): string {
		if (t.kind === "self") return "self-chat (48:notes)";
		if (t.kind === "chat") return t.chat ? `chat "${t.chat}"` : `chat ${t.id}`;
		return `#${t.channel} in "${t.team}"`;
	}

	async function send(target: SendTarget, message: string, html: boolean): Promise<string> {
		await backend.send(target, message, html);
		return `Sent to ${describeTarget(target)}.`;
	}

	// ── Markdown → Teams HTML ───────────────────────────────────────────────

	const MAX_REPLY_CHARS = 3500;

	function escapeHtml(s: string): string {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	// breaks:true because a chat message is not a document -- a single
	// newline should be a line break, the way every chat client behaves.
	marked.setOptions({ gfm: true, breaks: true, async: false });

	function mdToHtml(src: string): string {
		return marked.parse(src) as string;
	}

	function truncate(s: string): string {
		return s.length <= MAX_REPLY_CHARS ? s : `${s.slice(0, MAX_REPLY_CHARS)}\n\n…[truncated]`;
	}

	// ── Remote channel ──────────────────────────────────────────────────────

	function pidAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	function acquireRemoteLock(ctx: ExtensionContext) {
		if (fs.existsSync(REMOTE_LOCK)) {
			try {
				const held = JSON.parse(fs.readFileSync(REMOTE_LOCK, "utf8"));
				if (held.pid !== process.pid && pidAlive(held.pid)) {
					throw new Error(
						`remote channel already owned by pid ${held.pid} (${held.cwd}). ` +
							`Run "/teams remote off" there first.`,
					);
				}
			} catch (e) {
				if (e instanceof SyntaxError) fs.rmSync(REMOTE_LOCK, { force: true });
				else throw e;
			}
		}
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(
			REMOTE_LOCK,
			JSON.stringify({ pid: process.pid, cwd: ctx.cwd, at: new Date().toISOString() }),
		);
	}

	function releaseRemoteLock() {
		try {
			const held = JSON.parse(fs.readFileSync(REMOTE_LOCK, "utf8"));
			if (held.pid === process.pid) fs.rmSync(REMOTE_LOCK, { force: true });
		} catch {
			// No lock, or someone else's -- nothing of ours to release.
		}
	}

	function readCursor(): string {
		try {
			return String(JSON.parse(fs.readFileSync(REMOTE_CURSOR, "utf8")).lastId ?? "");
		} catch {
			return "";
		}
	}

	function writeCursor(id: string) {
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(REMOTE_CURSOR, JSON.stringify({ lastId: id }));
	}

	async function readSelfChat(sinceId: string, top = 20): Promise<SelfMessage[]> {
		return backend.selfMessages(sinceId, top);
	}

	async function pollRemote(ctx: ExtensionContext) {
		if (remoteInFlight || !remoteArmed) return;
		remoteInFlight = true;
		try {
			const cursor = readCursor();
			const msgs = await readSelfChat(cursor);
			if (msgs.length === 0) return;

			// Advance the cursor over everything seen, prefixed or not, so a
			// plain note in the self-chat is never re-examined forever.
			writeCursor(msgs[msgs.length - 1].id);

			const prefix = cfg.remotePrefix.toLowerCase();
			for (const m of msgs) {
				const text = m.text.trim();
				if (!text.toLowerCase().startsWith(prefix)) continue;
				const body = text.slice(cfg.remotePrefix.length).trim();
				if (!body) continue;

				ctx.ui.notify(`Teams remote → ${body.slice(0, 80)}`, "info");
				remotePending = true;
				lastAssistantText = "";
				const idle = ctx.isIdle();
				pi.sendUserMessage(body, idle ? undefined : { deliverAs: "followUp" });
			}
		} catch (e) {
			ctx.ui.notify(`Teams remote poll failed: ${e}`, "warning");
		} finally {
			remoteInFlight = false;
		}
	}

	async function armRemote(ctx: ExtensionContext) {
		acquireRemoteLock(ctx);
		try {
			// Baseline first: only messages posted after arming are executed, or
			// turning the channel on would replay your entire note history.
			const msgs = await readSelfChat("", 5);
			if (msgs.length > 0) writeCursor(msgs[msgs.length - 1].id);
		} catch (e) {
			// Never keep a lock we are not actually servicing.
			releaseRemoteLock();
			throw e;
		}
		remoteArmed = true;
		remoteTimer = setInterval(() => void pollRemote(ctx), cfg.remotePollSec * 1000);
		remoteTimer.unref?.();
		renderStatus(ctx);
		ctx.ui.notify(
			`Teams remote ON — post "${cfg.remotePrefix} <task>" to your self-chat ` +
				`(polled every ${cfg.remotePollSec}s, replies ${cfg.remoteReply ? "ON" : "OFF"}).`,
			"info",
		);
	}

	function disarmRemote(ctx?: ExtensionContext) {
		if (remoteTimer) clearInterval(remoteTimer);
		remoteTimer = undefined;
		remoteArmed = false;
		releaseRemoteLock();
		if (ctx) {
			renderStatus(ctx);
			ctx.ui.notify("Teams remote OFF.", "info");
		}
	}

	// ── Reading messages ─────────────────────────────────────────────────

	async function loadHistory(target: SendTarget, limit = HISTORY_MESSAGES): Promise<HistoryMessage[]> {
		if (target.kind === "self") {
			// The self-chat comes from chatsvc, which has no sender field: it is
			// my own notes channel, so every message is mine by definition.
			const msgs = await readSelfChat("", limit);
			// Carry `md` through: dropping it here was why code blocks I sent
			// myself rendered flat while every other chat showed them.
			return msgs.map((m) => ({ sender: "me", at: m.at, text: m.text, md: m.md, mine: true }));
		}
		if (target.kind === "channel") throw new Error("reading channel history is not supported yet");
		// Prefer the id: resolving a name re-fetches the whole chat list.
		const payload = await backend.messages({ id: target.id, name: target.chat }, limit);
		// Carry my own display name on each message so the pane can colour a
		// mention of me differently from a mention of anyone else.
		return payload.messages.map((m) => ({ ...m, me: payload.me }));
	}

	// ── Compose overlay ─────────────────────────────────────────────

	async function compose(ctx: ExtensionContext) {
		let chats: ChatRef[];
		try {
			chats = await getChats();
		} catch (e) {
			ctx.ui.notify(`Cannot load chat list: ${e}`, "error");
			return;
		}
		await openComposeOverlay(ctx, {
			chats,
			loadHistory: (t) => loadHistory(t),
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
			unreadIds: () => unreadItems.map((i) => i.id),
			refreshUnread: () => pollUnread(ctx),
			searchPeople,
			loadImage,
			altText: (url) => altText(url, ctx),
			markRead: async (chatId) => {
				await backend.markRead(chatId);
				// Teams itself now reports this chat as read, so pruning the
				// local list is the derived view catching up, not a second
				// opinion about what "read" means.
				unreadItems = unreadItems.filter((i) => i.id !== chatId);
				unreadCount = unreadItems.length;
				renderStatus(ctx);
			},
		});
	}

	// ── Tools ───────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "teams_send",
		label: "Teams Send",
		description:
			"Send a Microsoft Teams message saying what the user asked you to say. Word it naturally -- " +
			"you are writing on their behalf, so tidy grammar, a greeting, or a clearer phrasing are fine. " +
			"What is NOT fine is padding it with content they did not ask for: summaries of things they " +
			"only referenced, feature lists, background the recipient did not ask for, details you looked " +
			"up yourself. Match their scale: a one-line request becomes a message of a line or two, not " +
			"six sections. Asked to \"tell him PR 229 needs a deploy\", send that -- not a description of " +
			"the PR. If you believe important context is missing, ask the user rather than inventing it. " +
			"Markdown is supported and is converted to rich text; use it when the content genuinely needs " +
			"structure, not to decorate two sentences. " +
			"target='self' posts to the user's own self-chat " +
			"(the normal way to notify them); target='chat' posts to a person or group chat by name; " +
			"target='channel' posts to a team channel. Address a chat by `chat_id` from teams_chats; a " +
			"`chat` name still works but is matched by substring and an ambiguous name is an error. " +
			"Only send when the user asked you to. Every message sent this way is footed with a note that " +
			"an agent wrote it, so do not add your own disclaimer.",
		parameters: Type.Object({
			target: StringEnum(["self", "chat", "channel"], { description: "Where to send" }),
			message: Type.String({
				description:
					"The message body. Say what the user wanted said, phrased well; do not turn it into a " +
					"report about the subject they mentioned. Keep it roughly the size their request " +
					"implies. Markdown is converted to rich text; special characters are escaped.",
			}),
			chat_id: Type.Optional(
				Type.String({ description: "Chat id from teams_chats. Preferred over `chat` when target='chat'." }),
			),
			chat: Type.Optional(
				Type.String({ description: "Chat name, if you have no id. Ambiguous names are an error." }),
			),
			team: Type.Optional(Type.String({ description: "Team name, required when target='channel'" })),
			channel: Type.Optional(Type.String({ description: "Channel name, required when target='channel'" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let target: SendTarget;
			if (params.target === "self") {
				target = { kind: "self" };
			} else if (params.target === "chat") {
				if (!params.chat_id && !params.chat)
					throw new Error("target='chat' requires 'chat_id' (preferred) or 'chat'");
				target = { kind: "chat", chat: params.chat ?? "", id: params.chat_id };
			} else {
				if (!params.team || !params.channel)
					throw new Error("target='channel' requires both 'team' and 'channel'");
				target = { kind: "channel", team: params.team, channel: params.channel };
			}

			flash(ctx as ExtensionContext, "sending…", 30_000);
			try {
				// Rich by default. Markdown rather than raw HTML, because the
				// conversion escapes "<" and "&" -- sending a bare "a < b" as
				// HTML makes Teams swallow it as a tag.
				// One path only. Offering the model a choice of formats produced a real
				// chat message that read as literal "---" and asterisks, because a bare
				// emoji looked to it like something that needed no formatting.
				const payload = mdToHtml(params.message + agentFooter(ctx.model));
				const msg = await send(target, payload, true);
				flash(ctx as ExtensionContext, "sent ✓");
				return { content: [{ type: "text", text: msg }], details: {} };
			} catch (e) {
				flash(ctx as ExtensionContext, "send failed ✗", 8000);
				throw e;
			}
		},
	});

	pi.registerTool({
		name: "teams_read",
		label: "Teams Read",
		description:
			"Read the recent messages of one Microsoft Teams conversation, oldest first. " +
			"target='self' reads the user's own self-chat (48:notes); target='chat' reads a person " +
			"or group chat by name. Chat names are matched by substring and an ambiguous name is an " +
			"error. HTML is already converted to plain text, and messages that contained a picture read " +
			"as [image]. The pictures are attached to the result, so describe what they show instead of " +
			"telling the user to open Teams -- this terminal cannot display them. Use teams_unread first " +
			"when you need to find out which conversation has new activity.",
		parameters: Type.Object({
			target: StringEnum(["self", "chat"], { description: "Which conversation to read" }),
			chat_id: Type.Optional(
				Type.String({ description: "Chat id from teams_chats. Preferred over `chat`." }),
			),
			chat: Type.Optional(Type.String({ description: "Chat name, if you have no id" })),
			images: Type.Optional(
				Type.Boolean({ description: "Attach the pictures themselves so you can describe them (default true)" }),
			),
			limit: Type.Optional(
				Type.Integer({ description: `How many recent messages (default ${HISTORY_MESSAGES})`, minimum: 1, maximum: 50 }),
			),
		}),
		async execute(_id, params) {
			if (params.target === "chat" && !params.chat_id && !params.chat)
				throw new Error("target='chat' requires 'chat_id' (preferred) or 'chat'");
			const target: SendTarget =
				params.target === "self"
					? { kind: "self" }
					: { kind: "chat", chat: params.chat ?? "", id: params.chat_id };

			const msgs = await loadHistory(target, params.limit ?? HISTORY_MESSAGES);
			/**
			 * One line per message, plus a line per shared file.
			 *
			 * The file line carries the URL, because that URL is the argument to
			 * teams_download -- without it the agent can see that a file exists and
			 * still have no way to open it.
			 */
			const render = (m: HistoryMessage) => {
				// A file-only message has no text at all, and "Sender: " with
				// nothing after it reads like something failed to load.
				const who = m.mine ? "me" : m.sender;
				const head = m.text ? `[${formatLocal(m.at)}] ${who}: ${m.text}` : `[${formatLocal(m.at)}] ${who}:`;
				const files = (m.files ?? []).map((f) => `    \u{1f4ce} file: ${f.name}\n       url: ${f.url}`);
				return [head, ...files].join("\n");
			};
			const text = msgs.length === 0 ? "(no messages)" : msgs.map(render).join("\n");

			const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
				{ type: "text", text: `${describeTarget(target)} — ${msgs.length} message(s)\n${text}` },
			];

			// This terminal cannot show pictures, so the model looks at them
			// instead and describes what is there. Bounded: a screenshot is
			// expensive in context and a chat can hold many.
			if (params.images !== false) {
				const urls = msgs.flatMap((m) => m.images ?? []).slice(-MAX_IMAGES_PER_READ);
				for (const [i, url] of urls.entries()) {
					try {
						const { base64, mime } = await loadImage(url);
						content.push({ type: "text", text: `[image ${i + 1} of ${urls.length}]` });
						content.push({ type: "image", data: base64, mimeType: mime });
					} catch (e) {
						// Say so rather than pretending the message had no picture.
						content.push({ type: "text", text: `[image ${i + 1}: could not be fetched: ${e}]` });
					}
				}
			}
			return { content, details: {} };
		},
	});

	pi.registerTool({
		name: "teams_chats",
		label: "Teams Chats",
		description:
			"List the user's Teams conversations, or find one by name. Call this before teams_send or " +
			"teams_read and pass the `id` from here as their `chat_id`: an id is unambiguous and skips " +
			"a name lookup that costs about 2.6 seconds. Without `query` it lists " +
			"everything. Names come back with the user themself removed, so a 1:1 chat reads as the " +
			"other person. If nothing matches, the person may exist without a chat -- try teams_people.",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({ description: "Case-insensitive substring to filter by. Omit to list all." }),
			),
			refresh: Type.Optional(Type.Boolean({ description: "Refetch instead of using the cached list" })),
		}),
		async execute(_id, params) {
			const chats = await getChats(Boolean(params.refresh));
			const q = (params.query ?? "").trim().toLowerCase();
			const hits = q
				? chats.filter((c) => `${c.display ?? ""} ${c.label}`.toLowerCase().includes(q))
				: chats;
			if (hits.length === 0) {
				return {
					content: [{ type: "text", text: q ? `No chat matches "${params.query}".` : "No chats." }],
					details: {},
				};
			}
			const lines = hits.map((c) => `- ${c.display ?? c.label}  [${c.chat_type}]  id: ${c.id}`);
			return {
				content: [{ type: "text", text: `${hits.length} chat(s)\n${lines.join("\n")}` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "teams_download",
		label: "Teams Download",
		description:
			"Download a file someone shared in a Teams chat, and return the local path. Take the url " +
			"from a teams_read line that reads '\u{1f4ce} file: <name>' -- that is a SharePoint/OneDrive " +
			"reference, not something you can fetch without the user's token. Read the saved file with " +
			"your normal file tools afterwards; large logs are better grepped than read whole.",
		parameters: Type.Object({
			url: Type.String({ description: "The file's url, exactly as teams_read reported it" }),
			path: Type.Optional(
				Type.String({ description: "Where to save it. Defaults to a fresh temp directory, keeping the original filename." }),
			),
			max_mb: Type.Optional(
				Type.Number({ description: "Refuse anything larger, in MB. Default 256." }),
			),
		}),
		async execute(_id, params) {
			try {
				const r = await backend.downloadFile(params.url, params.path, {
					maxBytes: params.max_mb ? Math.round(params.max_mb * 1024 * 1024) : undefined,
				});
				const mb = (r.size / (1024 * 1024)).toFixed(1);
				return {
					content: [
						{
							type: "text",
							text: `Saved ${r.name} (${r.size} bytes, ${mb} MB${r.mimeType ? `, ${r.mimeType}` : ""}) to:\n${r.path}`,
						},
					],
					details: { path: r.path, size: r.size },
				};
			} catch (e) {
				// The agent decides what to do next, so the reason has to survive:
				// "too large" and "access denied" call for different next steps.
				return { content: [{ type: "text", text: `Download failed: ${e instanceof Error ? e.message : e}` }], details: {} };
			}
		},
	});

	pi.registerTool({
		name: "teams_people",
		label: "Teams People",
		description:
			"Search the people the user interacts with, for someone who has no chat yet. Returns names " +
			"and email addresses. Note that finding a person does not mean you can message them: " +
			"teams_send needs an existing conversation, so check teams_chats first and tell the user to " +
			"open the chat in Teams once if there is none.",
		parameters: Type.Object({
			query: Type.String({ description: "Name fragment to search for" }),
		}),
		async execute(_id, params) {
			const people = await searchPeople(params.query);
			const text =
				people.length === 0
					? `Nobody matches "${params.query}".`
					: people.map((p) => `- ${p.name}${p.email ? `  <${p.email}>` : ""}${p.title ? `  — ${p.title}` : ""}`).join("\n");
			return { content: [{ type: "text", text }], details: {} };
		},
	});

	pi.registerTool({
		name: "teams_unread",
		label: "Teams Unread",
		description:
			"List Microsoft Teams chats that hold unread activity, with the last message preview. " +
			"Chat-level only: Teams' cheap API gives no per-message or @-mention counts.",
		parameters: Type.Object({
			refresh: Type.Optional(Type.Boolean({ description: "Bypass the disk cache and rescan now" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			await pollUnread(ctx as ExtensionContext, Boolean(params.refresh));
			const text =
				unreadCount === 0
					? "No unread chats."
					: unreadItems
							.map((i) => `- ${i.label} · ${i.sender} · ${formatLocal(i.created_at)}\n  ${i.preview}`)
							.join("\n");
			return {
				content: [{ type: "text", text: `${unreadCount} unread chat(s)${unreadStale ? " (stale)" : ""}\n${text}` }],
				details: {},
			};
		},
	});

	// ── Command ─────────────────────────────────────────────────────────────

	const SUBCOMMANDS = ["compose", "unread", "refresh", "remote on", "remote off", "status", "login", "init", "verify"];

	pi.registerCommand("teams", {
		description: "Teams: compose a message, check unread, arm the self-chat remote channel",
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
						`unread ${unreadCount ?? "?"}${unreadStale ? " (stale)" : ""} · poll ${cfg.unreadPollSec}s\n` +
						`remote ${remoteArmed ? `ON (prefix "${cfg.remotePrefix}", ${cfg.remotePollSec}s)` : "off"}`,
					"info",
				);
				return;
			}

			if (arg === "unread" || arg === "refresh") {
				await pollUnread(ctx as unknown as ExtensionContext, arg === "refresh");
				if (!unreadCount) {
					ctx.ui.notify("No unread Teams chats.", "info");
					return;
				}
				ctx.ui.notify(
					unreadItems.map((i) => `● ${i.label} — ${i.sender}: ${i.preview.slice(0, 90)}`).join("\n"),
					"info",
				);
				return;
			}

			if (arg === "remote on") {
				if (remoteArmed) {
					ctx.ui.notify("Teams remote is already on in this session.", "warning");
					return;
				}
				try {
					await armRemote(ctx as unknown as ExtensionContext);
				} catch (e) {
					ctx.ui.notify(`Cannot arm Teams remote: ${e}`, "error");
				}
				return;
			}

			if (arg === "remote off") {
				disarmRemote(ctx as unknown as ExtensionContext);
				return;
			}

			ctx.ui.notify(`Unknown: /teams ${arg}\nTry: ${SUBCOMMANDS.join(", ")}`, "warning");
		},
	});

	// ── Lifecycle ───────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		statusCtx = ctx;
		if (!ctx.hasUI) return; // no status bar to feed, and -p runs should cost nothing
		renderStatus(ctx);
		void pollUnread(ctx);
		unreadTimer = setInterval(() => void pollUnread(ctx), cfg.unreadPollSec * 1000);
		unreadTimer.unref?.();
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		const content = event.message.content;
		lastAssistantText =
			typeof content === "string"
				? content
				: (content ?? [])
						.filter((p: { type: string }) => p.type === "text")
						.map((p: { text: string }) => p.text)
						.join("\n");
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!remotePending) return;
		remotePending = false;
		if (!cfg.remoteReply || !lastAssistantText.trim()) return;
		try {
			const html = `<b>🤖 pi · ${escapeHtml(path.basename(ctx.cwd))}</b><br><br>${mdToHtml(truncate(lastAssistantText.trim()))}`;
			await send({ kind: "self" }, html, true);
			flash(ctx, "replied ✓");
		} catch (e) {
			ctx.ui.notify(`Teams remote reply failed: ${e}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		if (unreadTimer) clearInterval(unreadTimer);
		unreadTimer = undefined;
		disarmRemote();
	});
}
