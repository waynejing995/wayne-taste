/**
 * Two-pane floating Teams composer.
 *
 *   ╭─ teams ────────────────────────────────────────────╮
 *   │ CHATS          │ Family, Given                     │
 *   │ ▸ Family, Given│  06:28 me       ok                │
 *   │   [Team] Sync  │  06:49 Other    ok                │
 *   │ filter: fam    │ ───────────────────────────────── │
 *   │                │ > draft▌                          │
 *   ╰────────────────────────────────────────────────────╯
 *
 * Left picks the chat, right shows the last messages and the draft. One
 * window, no dialog chain.
 */

import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Markdown,
	getCapabilities,
	Image,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatLocal } from "./time.ts";

/** Recent messages shown in the history pane, and the default for teams_read. */
export const HISTORY_MESSAGES = 20;

export interface Person {
	name: string;
	email: string;
	title: string;
}

export interface ChatRef {
	id: string;
	/** Member addresses, lowercased. Used to match a searched person to a chat. */
	emails?: string[];
	label: string;
	display?: string;
	chat_type: string;
}

export interface HistoryMessage {
	sender: string;
	at: string;
	/** Flattened text. Kept for tools and for anything that cannot render. */
	text: string;
	/** Same message as Markdown: bold, code, quotes, links, replies, forwards. */
	md?: string;
	mine: boolean;
	mentions_me?: boolean;
	/** My own display name, for telling my mentions from other people's. */
	me?: string;
	/** hostedContents URLs. They need the bearer token, so only we can fetch them. */
	images?: string[];
	/**
	 * Files shared in this message: a name and the SharePoint URL behind it.
	 *
	 * Structured rather than left inside `md`, because `teams_download` needs the
	 * URL and parsing it back out of rendered Markdown would be a second encoding
	 * of a fact we already have.
	 */
	files?: { name: string; url: string }[];
}

export interface LoadedImage {
	base64: string;
	mime: string;
}

export type SendTarget =
	| { kind: "self" }
	// `chat` is the name the script matches on; `id` skips that lookup, which
	// costs ~2.6s of the ~4.3s a name-addressed call takes.
	| { kind: "chat"; chat: string; id?: string }
	| { kind: "channel"; team: string; channel: string };

export interface ComposeDeps {
	chats: ChatRef[];
	/** Last messages of one chat, oldest first. */
	loadHistory: (target: SendTarget) => Promise<HistoryMessage[]>;
	send: (target: SendTarget, message: string, html: boolean) => Promise<string>;
	mdToHtml: (src: string) => string;
	/** Re-fetch the chat list, bypassing the cache. Bound to ^r. */
	refreshChats: () => Promise<ChatRef[]>;
	/**
	 * Called once on open. Resolves to a fresher list, or null when the cached
	 * one is new enough to leave alone. This is what keeps opening instant while
	 * still noticing chats created since the cache was written.
	 */
	revalidateChats: () => Promise<ChatRef[] | null>;
	/**
	 * Chat ids holding unread activity. Read on every render rather than copied
	 * in, so the picker always reflects the extension's own scan state instead
	 * of a snapshot that silently goes stale.
	 */
	unreadIds: () => string[];
	/** Refresh that scan. Honors the disk cache, so calling it on open is cheap. */
	refreshUnread: () => Promise<void>;
	/**
	 * Move the real Teams read watermark for a chat, then drop it from the
	 * unread set. Opening a conversation here counts as reading it, exactly as
	 * it would in the Teams client -- the badge is not merely hidden locally.
	 */
	markRead: (chatId: string) => Promise<void>;
	/** Search the people I interact with, for someone not in the chat list. */
	searchPeople: (query: string) => Promise<Person[]>;
	/** Download and read one hostedContents image. Cached by the script. */
	loadImage: (url: string) => Promise<LoadedImage>;
	/**
	 * Hand a picture to the model and ask what it shows. Used when the terminal
	 * cannot draw images, which is the case in tty7 today: it implements the
	 * Kitty protocol but leaves placed images behind when the screen scrolls, so
	 * anything pi draws ends up in the wrong place.
	 */
	/** Model-written description of a picture, cached. Called automatically. */
	altText: (url: string) => Promise<string>;
}

const SELF_ROW_KEY = "\u0000self";
const FORMATS = ["md → html", "raw html", "plain text"] as const;
/** A wrapped status can grow, but must not eat the whole history pane. */
const MAX_STATUS_LINES = 4;
/** Lines moved by PgUp/PgDn in the history pane. */
const HIST_PAGE = 10;

/**
 * Wrap the draft into display lines and report where the caret lands.
 *
 * Hand-rolled rather than wrapTextWithAnsi() because the caret is an index
 * into the text, and mapping that index onto a wrapped line is only possible
 * if the same pass produces both. The draft is plain user text with no ANSI,
 * so this only has to handle newlines and wide (CJK) characters.
 */
export function layoutDraft(
	text: string,
	w: number,
	caret: number,
): { lines: string[]; caretLine: number; caretIndex: number } {
	const lines: string[] = [];
	let cur: string[] = [];
	let curW = 0;
	let caretLine = 0;
	let caretIndex = 0;
	const chars = Array.from(text);

	for (let i = 0; i <= chars.length; i++) {
		if (i === caret) {
			caretLine = lines.length;
			caretIndex = cur.length;
		}
		if (i === chars.length) break;
		const ch = chars[i];
		if (ch === "\n") {
			lines.push(cur.join(""));
			cur = [];
			curW = 0;
			continue;
		}
		const cw = Math.max(1, visibleWidth(ch));
		if (curW + cw > w && cur.length > 0) {
			lines.push(cur.join(""));
			cur = [];
			curW = 0;
			if (i === caret) {
				// The caret sat at the break: it belongs on the new line.
				caretLine = lines.length;
				caretIndex = 0;
			}
		}
		cur.push(ch);
		curW += cw;
	}
	lines.push(cur.join(""));
	return { lines, caretLine, caretIndex };
}

/** Reverse-video the character under the caret, with the IME cursor marker. */
function withCaret(line: string, index: number): string {
	const a = Array.from(line);
	const before = a.slice(0, index).join("");
	const at = a[index] ?? " ";
	const after = a.slice(index + 1).join("");
	return `${before}${CURSOR_MARKER}\x1b[7m${at}\x1b[27m${after}`;
}

interface Row {
	key: string;
	id: string;
	display: string;
	type: string;
	target: SendTarget;
}

export function openComposeOverlay(ctx: ExtensionContext, deps: ComposeDeps): Promise<void> {
	return ctx.ui.custom<void>(
		(tui: TUI, theme, _keybindings, done) => {
			let chats = deps.chats;
			let pane: "list" | "composer" = "list";
			let filter = "";
			let sel = 0;
			let target: SendTarget = { kind: "self" };
			/** id of the chat currently open in the right pane, if any. */
			let openChatId: string | undefined;
			/** The left pane lists either my chats or people I searched for. */
			let mode: "chats" | "people" = "chats";
			let people: Person[] = [];
			/** False while `filter` is a query nobody has run yet. */
			let peopleSearched = false;
			let searching = false;
			/** True while the picture viewer owns the screen. */
			let imageView = false;
			let imageIndex = 0;
			/** Unsubscribe for the raw-input hook that watches for a click. */
			let mouseOff: (() => void) | undefined;
			let targetName = "Self-chat (48:notes)";
			let history: HistoryMessage[] = [];
			let historyError = "";
			let loading = false;
			let draft = "";
			/** Caret position as a codepoint index into `draft`. */
			let caret = 0;
			/** History scroll, in lines above the newest. 0 sticks to the bottom. */
			let histScroll = 0;
			let fmt = 0;
			let status = "";
			let _focused = false;

			const rerender = () => tui.requestRender();

			// The unread scan is at most ~10 minutes old; refresh it on open so the
			// dots reflect now, not whenever the last poll happened to land.
			void deps
				.refreshUnread()
				.then(() => {
					// A scan that lands after a chat was opened would otherwise
					// re-add a dot for the conversation being read right now.
					void markReadIfUnread(openChatId);
					rerender();
				})
				.catch(() => {
					// pollUnread already reports its own failures; the dots
					// simply stay as they were rather than the window failing
					// to open.
				});

			// Stale-while-revalidate: the cached list already rendered, so a
			// chat created since the cache was written appears a few seconds
			// later instead of tomorrow. Failures are surfaced, not swallowed.
			void deps
				.revalidateChats()
				.then((next) => {
					if (!next) return;
					const grew = next.length !== chats.length;
					chats = next;
					sel = 0;
					// Always redraw: a same-length list can still be reordered or
					// renamed, and that would otherwise sit invisible until the next
					// keypress. Only the status line is conditional.
					if (grew) status = `chat list updated (${next.length})`;
					rerender();
				})
				.catch((e) => {
					status = `chat list refresh failed: ${e}`;
					rerender();
				});

			function rows(): Row[] {
				const all: Row[] = [
					{ key: SELF_ROW_KEY, id: "", display: "Self-chat (48:notes)", type: "notes", target: { kind: "self" } },
					...chats.map((c) => ({
						key: c.label,
						id: c.id,
						display: c.display ?? c.label,
						type: c.chat_type,
						target: { kind: "chat" as const, chat: c.label, id: c.id },
					})),
				];
				const f = filter.trim().toLowerCase();
				return f ? all.filter((r) => r.display.toLowerCase().includes(f)) : all;
			}

			/**
			 * Clearing the dot is idempotent and racy: a background unread
			 * refresh can land after a chat is already open, so this is called
			 * from both places and guards against a duplicate in-flight call.
			 */
			const markingRead = new Set<string>();
			async function markReadIfUnread(chatId: string | undefined) {
				if (!chatId || markingRead.has(chatId)) return;
				if (!new Set(deps.unreadIds()).has(chatId)) return;
				markingRead.add(chatId);
				try {
					await deps.markRead(chatId);
				} catch (e) {
					// The messages are on screen either way; say so rather than
					// leaving a dot that looks like a rendering bug.
					status = `could not mark read: ${e}`;
				} finally {
					markingRead.delete(chatId);
					rerender();
				}
			}

			/** url -> description, or "" while one is being fetched. */
			const alt = new Map<string, string>();

			// One theme and one cache for the whole window: re-parsing every
			// message on every keystroke would make typing crawl.
			//
			// pi's markdown palette needs its global theme initialised, which is
			// true in a session but not in every host. Falling back to the theme
			// this overlay already has keeps the pane rendering either way,
			// instead of taking the whole window down with it.
			let mdTheme: ReturnType<typeof getMarkdownTheme>;
			try {
				const candidate = getMarkdownTheme();
				// The call always succeeds: it returns closures that read the
				// global theme lazily. Exercise one to find out whether that
				// global actually exists.
				candidate.bold("probe");
				mdTheme = candidate;
			} catch {
				mdTheme = {
					heading: (t) => theme.fg("accent", t),
					link: (t) => theme.fg("accent", t),
					linkUrl: (t) => theme.fg("dim", t),
					code: (t) => theme.fg("warning", t),
					codeBlock: (t) => theme.fg("warning", t),
					codeBlockBorder: (t) => theme.fg("borderMuted", t),
					quote: (t) => theme.fg("dim", t),
					quoteBorder: (t) => theme.fg("borderMuted", t),
					hr: (t) => theme.fg("borderMuted", t),
					listBullet: (t) => theme.fg("accent", t),
					bold: (t) => theme.fg("accent", t),
					italic: (t) => theme.fg("dim", t),
					strikethrough: (t) => theme.fg("dim", t),
					underline: (t) => theme.fg("accent", t),
				};
			}
			const mdCache = new Map<string, string[]>();
			/**
			 * Style @mentions directly instead of leaving them to Markdown's bold.
			 *
			 * pi's Markdown component passes ANSI through untouched, so colour can
			 * be injected here; a mention of me is the one thing in a busy pane
			 * that has to catch the eye, and bold alone does not.
			 */
			function colourMentions(source: string, me?: string): string {
				return source.replace(/\*\*@([^*\n]+)\*\*/g, (_all, name: string) => {
					const isMe = Boolean(me) && name.trim().toLowerCase() === (me as string).trim().toLowerCase();
					return theme.fg(isMe ? "warning" : "accent", `@${name}`);
				});
			}

			function renderMarkdown(source: string, width: number): string[] {
				const key = `${width}\u0000${source}`;
				const hit = mdCache.get(key);
				if (hit) return hit;
				const lines = new Markdown(source, 0, 0, mdTheme).render(width);
				if (mdCache.size > 400) mdCache.clear();
				mdCache.set(key, lines);
				return lines;
			}

			function resolveAltText() {
				for (const { url } of imageRefs()) {
					if (alt.has(url)) continue;
					alt.set(url, "");
					void deps
						.altText(url)
						.then((text) => {
							alt.set(url, text);
							rerender();
						})
						.catch((e) => {
							// Visible, not silent: an undescribed picture should say so.
							alt.set(url, `(could not be described: ${e})`);
							rerender();
						});
				}
			}

			async function reloadHistory() {
				historyError = "";
				loading = true;
				rerender();
				try {
					history = await deps.loadHistory(target);
				} catch (e) {
					// A chat whose history cannot load is still sendable, so this
					// is shown in the pane instead of closing the window.
					historyError = String(e);
				} finally {
					loading = false;
					resolveAltText();
					rerender();
				}
			}

			/** Every image in the open conversation, oldest first. */
			function imageRefs(): { url: string; sender: string; at: string }[] {
				const out: { url: string; sender: string; at: string }[] = [];
				for (const m of history) {
					for (const url of m.images ?? []) out.push({ url, sender: m.mine ? "me" : m.sender, at: m.at });
				}
				return out;
			}

			/**
			 * Show a picture using pi's own Image component in a plain (non-overlay)
			 * custom UI.
			 *
			 * The first attempt drew the image inside this overlay's own string
			 * frame. That fails on tty7: the frame that opens the view is taller
			 * than the last one, so pi writes the image and then emits one newline
			 * per reserved row -- 46 of them on a 4K grid -- which scrolls the
			 * screen, and tty7 leaves an already-placed image behind. The picture
			 * ended up in the scrollback.
			 *
			 * A non-overlay custom UI is rendered through the same path as an image
			 * in the transcript, which does work here, and pi's Image component
			 * owns the row accounting instead of this file guessing at it.
			 */
			async function openImage(index: number) {
				const refs = imageRefs();
				if (refs.length === 0) {
					status = "no images in this conversation";
					return rerender();
				}
				imageIndex = ((index % refs.length) + refs.length) % refs.length;
				const ref = refs[imageIndex];

				if (!getCapabilities().images) {
					// Nothing to open: the descriptions are already inline, written
					// by the model when the conversation loaded.
					status = "this terminal cannot display images — the description is inline in the message above";
					return rerender();
				}
				status = "loading image…";
				rerender();

				let loaded: LoadedImage;
				try {
					loaded = await deps.loadImage(ref.url);
				} catch (e) {
					status = `could not load image: ${e}`;
					return rerender();
				}
				status = "";

				imageView = true;
				let next: number | null = null;
				await ctx.ui.custom<void>((innerTui, innerTheme, _kb, finish) => {
					let image: Image | undefined;
					let builtFor = "";

					// pi only turns mouse reporting on in fullscreen mode, so the
					// viewer asks for it itself and puts it back on the way out.
					const write = innerTui.terminal?.write?.bind(innerTui.terminal);
					let unhook: (() => void) | undefined;
					if (write && typeof ctx.ui.onTerminalInput === "function") {
						write("\x1b[?1000h\x1b[?1006h");
						unhook = ctx.ui.onTerminalInput((data: string) => {
							if (!/\x1b\[<\d+;\d+;\d+[Mm]/.test(data)) return undefined;
							finish();
							// Swallow it, or the report reaches the editor as junk.
							return { consume: true };
						});
					}
					const release = () => {
						unhook?.();
						unhook = undefined;
						write?.("\x1b[?1006l\x1b[?1000l");
					};

					return {
						render(width: number): string[] {
							// Measured every frame: the window can be resized while
							// the picture is open.
							const rows = innerTui.terminal?.rows ?? 24;
							const key = `${width}x${rows}`;
							if (!image || builtFor !== key) {
								image = new Image(loaded.base64, loaded.mime, innerTheme, {
									maxWidthCells: Math.max(4, width - 2),
									// Leave room for the header, the footer and the
									// editor pi keeps below a custom component.
									maxHeightCells: Math.max(4, rows - 6),
								});
								builtFor = key;
							}
							const head = `${ref.sender}  ${formatLocal(ref.at)}   image ${imageIndex + 1}/${refs.length}`;
							const many = refs.length > 1 ? " · ←→ step · 1-9 jump" : "";
							return [
								innerTheme.fg("accent", truncateToWidth(head, width)),
								...image.render(width),
								innerTheme.fg("muted", truncateToWidth(`any key closes${many}`, width)),
							];
						},
						handleInput(data: string) {
							if (matchesKey(data, Key.right)) next = imageIndex + 1;
							else if (matchesKey(data, Key.left)) next = imageIndex - 1;
							else if (/^[1-9]$/.test(data) && Number(data) - 1 < refs.length) next = Number(data) - 1;
							finish();
						},
						invalidate() {
							image = undefined;
						},
						dispose() {
							release();
						},
					};
				});

				imageView = false;
				rerender();
				if (next !== null) await openImage(next);
			}

			async function runPeopleSearch() {
				const q = filter.trim();
				if (!q || searching) return;
				searching = true;
				status = `searching "${q}"…`;
				rerender();
				try {
					people = await deps.searchPeople(q);
					peopleSearched = true;
					sel = 0;
					status = people.length === 0 ? `no one matches "${q}"` : `${people.length} found`;
				} catch (e) {
					status = `people search failed: ${e}`;
				} finally {
					searching = false;
					rerender();
				}
			}

			/** Open the existing chat with this person, or explain that there is none. */
			async function selectPerson(p: Person) {
				const email = p.email.toLowerCase();
				const hit = email ? chats.find((c) => (c.emails ?? []).includes(email)) : undefined;
				if (!hit) {
					// Starting a brand new conversation would mean POST /chats,
					// which is deliberately not done here.
					status = `no existing chat with ${p.name} — start it in Teams first`;
					rerender();
					return;
				}
				mode = "chats";
				filter = "";
				await selectRow({
					key: hit.label,
					id: hit.id,
					display: hit.display ?? hit.label,
					type: hit.chat_type,
					target: { kind: "chat", chat: hit.label, id: hit.id },
				});
			}

			async function selectRow(row: Row) {
				target = row.target;
				openChatId = row.id || undefined;
				targetName = row.display;
				history = [];
				status = "";
				histScroll = 0;
				pane = "composer";
				// Concurrent on purpose: the badge must not wait on the history
				// fetch, and the history must not wait on the mark-read call.
				await Promise.all([reloadHistory(), markReadIfUnread(row.id)]);
			}

			async function doSend() {
				const body = draft.trim();
				if (!body) {
					status = "nothing to send";
					rerender();
					return;
				}
				const html = fmt !== 2;
				const payload = fmt === 0 ? deps.mdToHtml(body) : body;
				status = "sending…";
				rerender();
				try {
					await deps.send(target, payload, html);
					draft = "";
					caret = 0;
					histScroll = 0;
					status = "sent ✓ · refreshing";
					rerender();
					history = await deps.loadHistory(target);
					status = "sent ✓";
				} catch (e) {
					status = `send failed: ${e}`;
				} finally {
					rerender();
				}
			}

			// ── Input ────────────────────────────────────────────────────────

			function isPrintable(data: string): boolean {
				return data.length > 0 && !data.startsWith("\x1b") && data.charCodeAt(0) >= 32 && data !== "\x7f";
			}

			// ── Paste ────────────────────────────────────────────────────────
			//
			// pi-tui turns bracketed paste on, so pasted text arrives wrapped in
			// \x1b[200~ ... \x1b[201~. isPrintable() above rejects anything starting
			// with ESC, which meant every paste was dropped in silence.
			//
			// A paste is TEXT, all of it: an Enter inside one is a newline, not a
			// send. Otherwise pasting a 40-line log fires 40 messages.
			const PASTE_START = "\x1b[200~";
			const PASTE_END = "\x1b[201~";
			/** Set while a paste is arriving across several writes. */
			let pasting = false;
			let pasteBuf = "";

			/** Clipboards carry CRLF; a chat message should not. */
			function normalizePaste(text: string): string {
				return text.replace(/\r\n?/g, "\n");
			}

			/**
			 * Consume `data` if it is part of a paste.
			 *
			 * Returns null when it is ordinary input. Returns the text to insert
			 * otherwise -- "" while a large paste is still arriving, which is
			 * consumed but has nothing to show yet.
			 */
			function takePaste(data: string): string | null {
				if (pasting) {
					const end = data.indexOf(PASTE_END);
					if (end === -1) {
						pasteBuf += data;
						return "";
					}
					const text = pasteBuf + data.slice(0, end);
					pasting = false;
					pasteBuf = "";
					return normalizePaste(text);
				}
				const start = data.indexOf(PASTE_START);
				if (start === -1) return null;
				const rest = data.slice(start + PASTE_START.length);
				const end = rest.indexOf(PASTE_END);
				if (end === -1) {
					pasting = true;
					pasteBuf = rest;
					return "";
				}
				return normalizePaste(rest.slice(0, end));
			}

			function handleInput(data: string) {
				// Before every key check: inside a paste, "\r" is a character and
				// "\x1b" is not the escape key.
				const pasted = takePaste(data);
				if (pasted !== null) {
					if (pasted === "") return;
					if (pane === "composer") {
						const a = Array.from(draft);
						const insert = Array.from(pasted);
						a.splice(caret, 0, ...insert);
						draft = a.join("");
						caret = Math.min(a.length, caret + insert.length);
					} else {
						// The filter is one line: a pasted newline would make the rest
						// of the paste invisible rather than searchable.
						filter += pasted.replace(/\n/g, " ");
						sel = 0;
					}
					return rerender();
				}

				if (matchesKey(data, Key.escape)) return done();
				if (matchesKey(data, Key.tab)) {
					pane = pane === "list" ? "composer" : "list";
					return rerender();
				}
				if (matchesKey(data, Key.ctrl("f"))) {
					fmt = (fmt + 1) % FORMATS.length;
					return rerender();
				}
				const list = rows();
				if (pane === "list") {
					if (matchesKey(data, Key.ctrl("p"))) {
						mode = mode === "chats" ? "people" : "chats";
						filter = "";
						sel = 0;
						people = [];
						peopleSearched = false;
						status = mode === "people" ? "type a name, enter to search" : "";
						return rerender();
					}

					if (mode === "people") {
						if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
							sel = Math.max(0, sel - 1);
						} else if (matchesKey(data, Key.down)) {
							sel = Math.min(Math.max(0, people.length - 1), sel + 1);
						} else if (matchesKey(data, Key.enter)) {
							// First enter runs the query; later ones open a result.
							if (!peopleSearched) void runPeopleSearch();
							else if (people[sel]) void selectPerson(people[sel]);
							return;
						} else if (matchesKey(data, Key.backspace)) {
							filter = filter.slice(0, -1);
							peopleSearched = false;
						} else if (isPrintable(data)) {
							filter += data;
							// Editing the query invalidates the previous results.
							peopleSearched = false;
						} else {
							return;
						}
						return rerender();
					}

					if (matchesKey(data, Key.ctrl("r"))) {
						// The chat list is cached for a day, so a brand new
						// conversation would otherwise be invisible until tomorrow.
						status = "reloading chats…";
						rerender();
						void deps
							.refreshChats()
							.then((next) => {
								chats = next;
								sel = 0;
								status = `${next.length} chats`;
							})
							.catch((e) => {
								status = `reload failed: ${e}`;
							})
							.finally(rerender);
						return;
					}
					if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
						sel = Math.max(0, sel - 1);
					} else if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
						sel = Math.min(list.length - 1, sel + 1);
					} else if (matchesKey(data, Key.enter)) {
						if (list[sel]) void selectRow(list[sel]);
						return;
					} else if (matchesKey(data, Key.backspace)) {
						filter = filter.slice(0, -1);
						sel = 0;
					} else if (isPrintable(data)) {
						filter += data;
						sel = 0;
					} else {
						return;
					}
					return rerender();
				}

				const chars = () => Array.from(draft);
				const replaceDraft = (next: string[], caretAt: number) => {
					draft = next.join("");
					caret = Math.max(0, Math.min(next.length, caretAt));
				};

				if (matchesKey(data, Key.ctrl("o"))) {
					// Newest first: the picture someone just sent is the one wanted.
					return void openImage(imageRefs().length - 1);
				}

				if (matchesKey(data, Key.ctrl("r"))) {
					// Refresh what is on screen: the other side may have replied
					// since this pane was filled.
					status = "";
					void reloadHistory();
					return;
				}

				if (matchesKey(data, Key.up)) {
					histScroll += 1;
				} else if (matchesKey(data, Key.down)) {
					histScroll = Math.max(0, histScroll - 1);
				} else if (matchesKey(data, Key.pageUp)) {
					histScroll += HIST_PAGE;
				} else if (matchesKey(data, Key.pageDown)) {
					histScroll = Math.max(0, histScroll - HIST_PAGE);
				} else if (matchesKey(data, Key.left)) {
					caret = Math.max(0, caret - 1);
				} else if (matchesKey(data, Key.right)) {
					caret = Math.min(chars().length, caret + 1);
				} else if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) {
					caret = 0;
				} else if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) {
					caret = chars().length;
				} else if (matchesKey(data, Key.ctrl("j"))) {
					const a = chars();
					a.splice(caret, 0, "\n");
					replaceDraft(a, caret + 1);
				} else if (matchesKey(data, Key.enter)) {
					void doSend();
					return;
				} else if (matchesKey(data, Key.backspace)) {
					if (caret === 0) return;
					const a = chars();
					a.splice(caret - 1, 1);
					replaceDraft(a, caret - 1);
				} else if (matchesKey(data, Key.delete)) {
					const a = chars();
					if (caret >= a.length) return;
					a.splice(caret, 1);
					replaceDraft(a, caret);
				} else if (isPrintable(data)) {
					const insert = Array.from(data);
					const a = chars();
					a.splice(caret, 0, ...insert);
					replaceDraft(a, caret + insert.length);
				} else {
					return;
				}
				rerender();
			}

			// ── Render ───────────────────────────────────────────────────────

			function leftPane(w: number, h: number): string[] {
				const list = rows();
				if (sel >= list.length) sel = Math.max(0, list.length - 1);
				const out: string[] = [];
				const active = pane === "list";

				if (mode === "people") {
					out.push(theme.fg(active ? "accent" : "muted", "PEOPLE"));
					const viewport = Math.max(1, h - 2);
					if (!peopleSearched && !searching) {
						out.push(theme.fg("dim", truncateToWidth("enter to search", w)));
					}
					for (const [i, p] of people.slice(0, viewport).entries()) {
						const line = `${i === sel ? "▸" : " "} ${p.name}`;
						out.push(theme.fg(i === sel ? (active ? "accent" : "dim") : "dim", truncateToWidth(line, w)));
					}
					while (out.length < h - 1) out.push("");
					const cursor = active ? CURSOR_MARKER : "";
					out.push(theme.fg("muted", truncateToWidth(`search: ${filter}${cursor}`, w)));
					return out.slice(0, h);
				}

				const unread = new Set(deps.unreadIds());
				const unreadHere = list.filter((r) => r.id && unread.has(r.id)).length;
				out.push(
					theme.fg(active ? "accent" : "muted", "CHATS") +
						(unreadHere > 0 ? theme.fg("warning", ` ●${unreadHere}`) : ""),
				);

				const viewport = Math.max(1, h - 2);
				const start = Math.max(0, Math.min(sel - Math.floor(viewport / 2), list.length - viewport));
				for (const row of list.slice(start, start + viewport)) {
					const i = list.indexOf(row);
					const cursor = i === sel ? "▸" : " ";
					const isUnread = Boolean(row.id) && unread.has(row.id);
					// Reading here does not mark the chat read in Teams, so the dot
					// stays until Teams itself considers it read (e.g. after a send).
					const dot = isUnread ? "●" : " ";
					const name = truncateToWidth(row.display, Math.max(1, w - 3));
					const line = `${cursor} ${dot} ${name}`;
					const colour = i === sel ? (active ? "accent" : "dim") : isUnread ? "warning" : "dim";
					out.push(theme.fg(colour, truncateToWidth(line, w)));
				}
				while (out.length < h - 1) out.push("");

				const marker = active ? CURSOR_MARKER : "";
				out.push(theme.fg("muted", truncateToWidth(`filter: ${filter}${marker}`, w)));
				return out.slice(0, h);
			}

			function historyLines(w: number): string[] {
				if (loading) return [theme.fg("dim", "loading…")];
				if (historyError) return wrapTextWithAnsi(theme.fg("error", historyError), w);
				if (history.length === 0) return [theme.fg("dim", "(no recent messages)")];
				const out: string[] = [];
				// Walks messages in the same order as imageRefs(), so the number
				// shown here is the number that opens that picture.
				let n = 0;
				for (const m of history) {
					// Full sender: a display name is "Family, Given", so splitting on
					// the comma and taking [0] leaves only the family name.
					const who = m.mine ? "me" : m.sender;
					const head = `${formatLocal(m.at)}  ${who}${m.mentions_me ? "  @you" : ""}`;
					out.push(
						theme.fg(m.mentions_me ? "warning" : m.mine ? "accent" : "success", truncateToWidth(head, w)),
					);

					// The same file is already a link inside the Markdown. Remove that
					// exact string -- not a regex guess -- so the dedicated line below
					// is the only place it appears.
					const body = (m.files ?? []).reduce((acc, f) => acc.split(`\u{1f4ce} [${f.name}](${f.url})`).join("").trim(), m.md ?? m.text);
					const withMentions = colourMentions(body, m.me);
					const source = (m.images ?? []).reduce((acc, url) => {
						n++;
						const described = alt.get(url);
						return acc.replace("[image]", described ? `[image ${n}: ${described}]` : `[image ${n}: describing…]`);
					}, withMentions);

					// Rendered by pi's own Markdown component, so bold, inline code,
					// fenced blocks with syntax highlighting, quotes and links all
					// look the way they do everywhere else in pi.
					// In full. A message is what it is; the pane scrolls.
					if (body) for (const line of renderMarkdown(source, Math.max(4, w - 2))) out.push(`  ${line}`);

					/**
					 * Shared files get their own line, in their own colour.
					 *
					 * Inside the Markdown they are a link among other links, and a
					 * file-only message renders as one dim line that reads like a
					 * footnote -- which is how a colleague's 10 MB log went unnoticed
					 * entirely. A file is an object you can act on, not prose.
					 */
					for (const f of m.files ?? []) {
						out.push(theme.fg("warning", truncateToWidth(`  📎 ${f.name}`, w)));
					}
				}
				return out;
			}

			function rightPane(w: number, h: number): string[] {
				const active = pane === "composer";
				const out: string[] = [];
				out.push(theme.fg(active ? "accent" : "muted", truncateToWidth(targetName, w)));

				const { lines: draftLines, caretLine, caretIndex } = layoutDraft(draft, Math.max(4, w - 2), caret);
				const composerRows = Math.min(6, Math.max(1, draftLines.length));

				// The status line wraps instead of being cut off. It carries error
				// text, and half an error message is worse than none.
				const statusLines = (
					status ? wrapTextWithAnsi(status, w).map((l) => theme.fg("warning", l)) : [theme.fg("muted", FORMATS[fmt])]
				).slice(0, MAX_STATUS_LINES);

				const chromeRows = composerRows + statusLines.length + 1; // + separator
				const histRows = Math.max(1, h - chromeRows - 1);

				const hist = historyLines(w);
				// Clamp here, not in the key handler: the limit depends on the
				// pane height, which only this function knows.
				const maxScroll = Math.max(0, hist.length - histRows);
				if (histScroll > maxScroll) histScroll = maxScroll;
				const start = Math.max(0, hist.length - histRows - histScroll);
				for (const line of hist.slice(start, start + histRows)) out.push(line);
				while (out.length < h - chromeRows) out.push("");

				out.push(
					histScroll > 0
						? theme.fg("warning", truncateToWidth(`── ${histScroll} line(s) below · ↓/PgDn to catch up `.padEnd(w, "─"), w))
						: theme.fg("borderMuted", "─".repeat(w)),
				);
				// Scroll the draft so the caret's line is always on screen.
				const first = Math.max(0, Math.min(caretLine - composerRows + 1, draftLines.length - composerRows));
				draftLines.slice(first, first + composerRows).forEach((line, i) => {
					const li = first + i;
					const prefix = li === 0 ? "> " : "  ";
					const body = active && li === caretLine ? withCaret(line, caretIndex) : line;
					out.push(truncateToWidth(`${prefix}${body}`, w));
				});

				out.push(...statusLines);
				return out.slice(0, h);
			}

			const component: Component & Focusable & { dispose?(): void } = {
				get focused() {
					return _focused;
				},
				set focused(v: boolean) {
					_focused = v;
				},
				render(width: number): string[] {
					const border = (s: string) => theme.fg(_focused ? "accent" : "borderMuted", s);
					// Every row must add up to exactly `width`: 2 border cells each side,
					// 3 for the " │ " pane separator. Never clamp this to a minimum -- a
					// row wider than `width` corrupts the whole TUI frame.
					const inner = Math.max(10, width - 4);
					const leftW = Math.max(16, Math.min(28, Math.floor(inner * 0.3)));
					const rightW = inner - leftW - 3;

					const termRows = tui.terminal?.rows ?? 24;
					const bodyRows = Math.max(8, Math.floor(termRows * 0.7) - 3);

					const left = leftPane(leftW, bodyRows);
					const right = rightPane(rightW, bodyRows);

					const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visibleWidth(s)));
					const body = Array.from({ length: bodyRows }, (_, i) =>
						`${border("│ ")}${pad(left[i] ?? "", leftW)}${border(" │ ")}${pad(right[i] ?? "", rightW)}${border(" │")}`,
					);

					const title = theme.fg("dim", " teams ");
					// "╭─" + " teams " + fill + "╮" = 2 + 7 + fill + 1, so fill = width - 10.
					const top = `${border("╭─")}${title}${border("─".repeat(Math.max(0, width - 10)))}${border("╮")}`;
					const hintText =
						pane === "list"
							? mode === "people"
								? "type a name · enter search, then enter opens · ^p back to chats · esc"
								: "filter · ↑↓ · enter open · ^p find someone · ^r reload · tab · esc"
							: imageRefs().length > 0
								? `enter send · ↑↓ scroll · ^o ${getCapabilities().images ? "view" : "describe"} ${imageRefs().length} image(s) · ^r reload · tab · esc`
								: "enter send · ↑↓ scroll · ←→ move · ^j newline · ^r reload · ^f format · tab · esc";
					const hint = `${border("│ ")}${pad(theme.fg("muted", truncateToWidth(hintText, inner)), inner)}${border(" │")}`;
					const bot = border(`╰${"─".repeat(inner + 2)}╯`);
					return [top, ...body, hint, bot];
				},
				invalidate() {},
			};

			// The picker owns input first; nothing is loaded until a chat is chosen.
			component.handleInput = handleInput;
			return component;
		},
		{
			overlay: true,
			overlayOptions: { width: "84%", maxHeight: "80%", anchor: "center", margin: 1 },
		},
	);
}
