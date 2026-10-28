/**
 * The /teams overlay: chats on the left, the open conversation on the right.
 *
 * Laid out like the Outlook overlay (outlook/overlay.ts): a title row naming the
 * open chat and the unread count, two panes each under a header and a rule, a
 * status row and a hint row. Nothing is loaded beyond the first page of each.
 * The chat list grows as the highlight reaches its end, and a conversation
 * grows upward as its history is scrolled to the top.
 *
 *   ╭─ Teams — Family, Given · 1 unread ────────────────────────────────────╮
 *   │ Chats                         │ Family, Given                         │
 *   │ ───────────────────────────── │ ───────────────────────────────────── │
 *   │ ● Family, Given         10:42 │ 10:42  Family, Given                  │
 *   │   ship it                     │   ship it                             │
 *   │ filter:                       │ > draft▌                              │
 *   │ 12 chats loaded · ↓ at the end loads more                             │
 *   │ type to filter · ↑↓ PgUp/PgDn move · enter/→ open · tab conversation  │
 *   ╰───────────────────────────────────────────────────────────────────────╯
 *
 * One window, no dialog chain.
 */

import type { Component, Focusable, MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Markdown,
	getCapabilities,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LoadedImage } from "../core/describe-image.ts";
import * as tn from "../core/tern-native.ts";
import type { Person } from "../core/people.ts";
import { formatLocal } from "../core/time.ts";
import { showImage } from "./image-viewer.ts";

/** The newest messages of a conversation on open, and the default for teams_read. */
export const HISTORY_MESSAGES = 20;

export interface ChatRef {
	id: string;
	/** Member addresses, lowercased. Used to match a searched person to a chat. */
	emails?: string[];
	label: string;
	display?: string;
	chat_type: string;
	/** The last message as one line, for the list. "" when there is none. */
	preview?: string;
	/** ISO time of the last message. */
	last_at?: string;
}

/** One page of the chat list. `next` names the page after it; absent once the list has ended. */
export interface ChatsPage {
	chats: ChatRef[];
	next?: string;
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

/** One page of a conversation, oldest first. `older` names the page before it; absent when nothing is older. */
export interface HistoryPage {
	messages: HistoryMessage[];
	older?: string;
}

export type SendTarget =
	| { kind: "self" }
	// `chat` is the name the script matches on; `id` skips that lookup, which
	// costs ~2.6s of the ~4.3s a name-addressed call takes.
	| { kind: "chat"; chat: string; id?: string }
	| { kind: "channel"; team: string; channel: string };

export interface ComposeDeps {
	/** The first page of the chat list: the cache, or a fresh fetch. */
	chats: ChatsPage;
	/** The page `cursor` names. Called as the highlight reaches the end of what is loaded. */
	loadChats: (cursor: string) => Promise<ChatsPage>;
	/** Re-fetch the first page, bypassing the cache. Bound to ^r. */
	refreshChats: () => Promise<ChatsPage>;
	/**
	 * Called once on open. Resolves to a fresher first page, or null when the
	 * cached one is new enough to leave alone. This is what keeps opening instant
	 * while still noticing chats created since the cache was written.
	 */
	revalidateChats: () => Promise<ChatsPage | null>;
	/** The newest page of a conversation, or the page before `cursor`. Oldest first. */
	loadHistory: (target: SendTarget, cursor?: string) => Promise<HistoryPage>;
	send: (target: SendTarget, message: string, html: boolean) => Promise<string>;
	mdToHtml: (src: string) => string;
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
	/** Model-written description of a picture, cached. Called automatically. */
	altText: (url: string) => Promise<string>;
}

const SELF_LABEL = "Self-chat (48:notes)";
const FORMATS = ["md → html", "raw html", "plain text"] as const;
/** A chat takes two lines in the list: its name and time, then its preview. */
const CHAT_LINES = 2;
/** Between the two panes. */
const SEP = " │ ";
const CHATS_HINT =
	"type to filter · ↑↓ PgUp/PgDn move · enter/→ open · tab conversation · ^p find someone · ^r reload · esc close";
const CHATS_HINT_SHORT = "type filter · ↑↓ move · enter open · tab conversation · ^p people · ^r reload · esc close";
const PEOPLE_HINT = "type a name · enter search, then enter opens · ^p back to chats · esc close";
const CONV_HINT =
	"enter send · ↑↓ PgUp/PgDn scroll · ←→ caret, ← at the start: chats · ^j newline · ^f format · ^r reload · tab/esc chats";
const CONV_HINT_SHORT = "enter send · ↑↓ scroll · ←→ caret · ^f format · ^r reload · tab/esc chats";

/** Cut to `w` columns and pad to exactly `w`, so every frame row has the same width. */
const fit = (s: string, w: number): string => truncateToWidth(s, Math.max(0, w), "…", true);

/** `left` at the start of a row of `w` columns and `right` at its end. */
function justify(left: string, right: string, w: number): string {
	const rw = visibleWidth(right);
	if (rw === 0) return fit(left, w);
	return fit(`${fit(left, Math.max(0, w - rw - 1))} ${right}`, w);
}

/**
 * When a chat's last message was, as the list shows it: HH:MM when that was
 * today, MM-DD otherwise. "" when there is no message.
 */
export function chatWhen(iso: string | undefined, now: Date = new Date()): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const two = (n: number) => String(n).padStart(2, "0");
	if (d.toDateString() === now.toDateString()) return `${two(d.getHours())}:${two(d.getMinutes())}`;
	return `${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The chat list's width: about a third of the frame, and never so wide the conversation has no room. */
export function leftWidth(inner: number): number {
	return Math.max(0, Math.min(56, Math.max(24, Math.floor(inner * 0.3)), inner - SEP.length - 10));
}

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

/** One row of the list: a chat, or the self-chat. */
interface Row {
	/** The chat id; "" for the self-chat. */
	id: string;
	display: string;
	preview: string;
	at?: string;
	target: SendTarget;
}

export function openComposeOverlay(ctx: ExtensionContext, deps: ComposeDeps): Promise<void> {
	return ctx.ui.custom<void>(
		(tui: TUI, theme, _keybindings, done) => {
			// ── State ───────────────────────────────────────────────────────

			let chats: ChatRef[] = deps.chats.chats;
			/** Cursor for the page after the loaded list; undefined once the list has ended. */
			let chatsNext: string | undefined = deps.chats.next;
			/** Pages of the list loaded so far, the first included. */
			let chatsPages = 1;
			/** Bumped whenever the list is replaced, so a page still in flight for the old list is dropped. */
			let chatsGen = 0;
			let chatsInFlight: Promise<boolean> | undefined;
			/** Cursors this list has read, so one the server names again is refused rather than read a second time. */
			let chatsFollowed = new Set<string>();
			/** Set when the window closes: background paging (a filter, a person search) stops with it. */
			let closed = false;
			let pane: "list" | "composer" = "list";
			let filter = "";
			/** True while the status line is saying what the filter found. */
			let filterNote = false;
			let sel = 0;
			let listTop = 0;
			/** Chats the list showed at the last render: the PgUp/PgDn step. */
			let listFits = 5;
			let target: SendTarget = { kind: "self" };
			let targetName = SELF_LABEL;
			/** Id of the conversation open in the right pane, for clearing its dot when the scan lands. */
			let openChatId: string | undefined;
			/** A conversation has been opened, so the title names it. */
			let opened = false;
			/** The left pane lists either my chats or people I searched for. */
			let mode: "chats" | "people" = "chats";
			let people: Person[] = [];
			/** False while `filter` is a query nobody has run yet. */
			let peopleSearched = false;
			let searching = false;
			let imageIndex = 0;
			let history: HistoryMessage[] = [];
			let historyError = "";
			/** The newest page is on its way. */
			let loading = false;
			/** Cursor for the page before the loaded history; undefined when nothing is older. */
			let historyOlder: string | undefined;
			/** Cursors the conversation has read, so one named again is refused rather than prepended a second time. */
			let historyFollowed = new Set<string>();
			/** An older page is on its way. */
			let olderLoading = false;
			/** Bumped whenever the shown conversation is replaced, so a page for the old one is dropped. */
			let histGen = 0;
			let draft = "";
			/** Bumped by every edit of `draft`, so a send that returns knows whether the text it sent is still what is there. */
			let draftRev = 0;
			/** Bumped whenever a chat is opened, so a send that returns knows whether its chat is still the one on screen. */
			let viewGen = 0;
			/** A send is out: a second Enter must not post the same draft again. */
			let sending = false;
			/** Caret position as a codepoint index into `draft`. */
			let caret = 0;
			/** History scroll, in lines above the newest. 0 sticks to the bottom. */
			let histScroll = 0;
			/** How far the history can scroll, as of the last render. Reaching it asks for the page before. */
			let histMax = 0;
			/** Lines the history showed at the last render: the PgUp/PgDn step. */
			let histRows = 10;
			/** Bumped per scroll key: Tern moves the native history's scroller once per bump (core/tern-native.ts). */
			let nativeScroll: { by: "line-up" | "line-down" | "page-up" | "page-down"; n: number } = { by: "line-down", n: 0 };
			/** True while omp describes this overlay to Tern (describe ran since the last render): scroll keys go to Tern's scroller. */
			let nativeLive = false;
			let fmt = 0;
			let status = "";
			let statusError = false;
			let _focused = false;

			const rerender = () => tui.requestRender();
			const say = (text: string) => {
				status = text;
				statusError = false;
			};
			const fail = (text: string) => {
				status = text;
				statusError = true;
			};

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
				.then((page) => {
					// A list the user has already paged past is theirs now: keep it.
					if (!page || chatsPages > 1) return;
					const grew = page.chats.length !== chats.length;
					applyFirstPage(page);
					// Always redraw: a same-length list can still be reordered or
					// renamed, and that would otherwise sit invisible until the next
					// keypress. Only the status line is conditional.
					if (grew) say(`chat list updated (${page.chats.length} loaded)`);
					rerender();
				})
				.catch((e) => {
					fail(`chat list refresh failed: ${e}`);
					rerender();
				});

			function rows(): Row[] {
				const all: Row[] = [
					{ id: "", display: SELF_LABEL, preview: "", target: { kind: "self" } },
					...chats.map(
						(c): Row => ({
							id: c.id,
							display: c.display ?? c.label,
							preview: c.preview ?? "",
							at: c.last_at,
							target: { kind: "chat", chat: c.label, id: c.id },
						}),
					),
				];
				const f = filter.trim().toLowerCase();
				return f ? all.filter((r) => r.display.toLowerCase().includes(f)) : all;
			}

			/** Replace the list with a first page. Pages past it are dropped, and so is one still in flight. */
			function applyFirstPage(page: ChatsPage): void {
				chats = page.chats;
				chatsNext = page.next;
				chatsPages = 1;
				chatsGen++;
				chatsInFlight = undefined;
				chatsFollowed = new Set<string>();
				sel = 0;
				listTop = 0;
			}

			/**
			 * Fetch the page after the loaded list and append it. Single-flight: a call
			 * made while one is out joins it. Resolves true when a page landed.
			 */
			function loadMoreChats(): Promise<boolean> {
				if (chatsInFlight) return chatsInFlight;
				const cursor = chatsNext;
				if (cursor === undefined || closed) return Promise.resolve(false);
				if (chatsFollowed.has(cursor)) {
					// The list named a page it had already given: reading it again would only loop.
					fail("the server named a page it had already given; refusing to loop");
					return Promise.resolve(false);
				}
				const gen = chatsGen;
				const run = deps
					.loadChats(cursor)
					.then(
						(page) => {
							if (gen !== chatsGen) return false;
							const known = new Set(chats.map((c) => c.id));
							chats = [...chats, ...page.chats.filter((c) => !known.has(c.id))];
							chatsNext = page.next;
							chatsPages++;
							chatsFollowed.add(cursor);
							chatsInFlight = undefined;
							fillFilter();
							return true;
						},
						(e: unknown) => {
							if (gen === chatsGen) {
								chatsInFlight = undefined;
								fail(`could not load more chats: ${e}`);
							}
							return false;
						},
					)
					.finally(rerender);
				chatsInFlight = run;
				return run;
			}

			/**
			 * A filter that matches nothing among the loaded chats asks for the next
			 * page, and the one after, until something matches or the list ends.
			 */
			function fillFilter(): void {
				const q = filter.trim();
				if (mode !== "chats" || q === "" || rows().length > 0) {
					if (filterNote) say("");
					filterNote = false;
					return;
				}
				filterNote = true;
				if (chatsNext === undefined) {
					say(`no chat matches "${q}" · all ${chats.length} loaded`);
					return;
				}
				say(`no match among ${chats.length} loaded · loading more…`);
				void loadMoreChats();
			}

			/** The list's standing line: how many chats are loaded and whether more follow. */
			function chatsSummary(): string {
				if (chatsInFlight) return "loading more chats…";
				return chatsNext === undefined
					? `${chats.length} chats · end of list`
					: `${chats.length} chats loaded · ↓ at the end loads more`;
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
					fail(`could not mark read: ${e}`);
				} finally {
					markingRead.delete(chatId);
					rerender();
				}
			}

			/** url -> description, or "" while one is being fetched. `altRev` counts changes, for the Tern memo. */
			const alt = new Map<string, string>();
			let altRev = 0;

			// One theme and one cache for the whole window: re-parsing every
			// message on every keystroke would make typing crawl.
			//
			// pi's markdown palette needs its global theme initialised, which is
			// true in a session but not in every host. Falling back to the theme
			// this overlay already has keeps the pane rendering either way,
			// instead of taking the whole window down with it.
			let mdTheme: MarkdownTheme;
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
							altRev++;
							rerender();
						})
						.catch((e) => {
							// Visible, not silent: an undescribed picture should say so.
							alt.set(url, `(could not be described: ${e})`);
							altRev++;
							rerender();
						});
				}
			}

			/** A new view of the conversation: any page still in flight for the old one is dropped. */
			function bumpHistory(): number {
				loading = false;
				olderLoading = false;
				historyFollowed = new Set<string>();
				return ++histGen;
			}

			/** The newest page of the open conversation, replacing what is shown. */
			async function reloadHistory(): Promise<void> {
				const gen = bumpHistory();
				const t = target;
				historyError = "";
				loading = true;
				rerender();
				try {
					const page = await deps.loadHistory(t);
					if (gen !== histGen) return;
					history = page.messages;
					historyOlder = page.older;
					histScroll = 0;
					resolveAltText();
				} catch (e) {
					// A chat whose history cannot load is still sendable, so this
					// is shown in the pane instead of closing the window.
					if (gen === histGen) historyError = String(e);
				} finally {
					if (gen === histGen) loading = false;
					rerender();
				}
			}

			/** The page before the loaded history, prepended. The viewport is anchored to the bottom, so it stays on the same messages. */
			function loadOlderPage(cursor: string): void {
				// A page the conversation has already read is not read again: that would prepend the same messages twice.
				if (historyFollowed.has(cursor)) {
					fail("the server named a page it had already given; refusing to loop");
					rerender();
					return;
				}
				const gen = histGen;
				const t = target;
				olderLoading = true;
				say("loading older…");
				rerender();
				deps
					.loadHistory(t, cursor)
					.then(
						(page) => {
							if (gen !== histGen) return;
							history = [...page.messages, ...history];
							historyFollowed.add(cursor);
							historyOlder = page.older;
							resolveAltText();
							say(page.older === undefined ? "start of conversation" : "");
						},
						(e: unknown) => {
							// The cursor is kept, so reaching the top again retries.
							if (gen === histGen) fail(`could not load older messages: ${e}`);
						},
					)
					.finally(() => {
						if (gen === histGen) olderLoading = false;
						rerender();
					});
			}

			/** The top of the loaded history was reached: fetch the page before it, or say there is none. */
			function atTop(): void {
				if (loading || olderLoading || historyError || history.length === 0) return;
				if (historyOlder === undefined) {
					say("start of conversation");
					return;
				}
				loadOlderPage(historyOlder);
			}

			/**
			 * Scroll the history `n` lines up. Clamped at the top as of the last render, so a burst of keys before the
			 * next render cannot carry the scroll past it, where the next page would move the view. Reaching the top
			 * asks for the page before.
			 */
			function scrollUp(n: number): void {
				histScroll = Math.min(histScroll + n, histMax);
				if (histScroll >= histMax) atTop();
			}

			/** Every image in the open conversation, oldest first. */
			function imageRefs(): { url: string; sender: string; at: string }[] {
				const out: { url: string; sender: string; at: string }[] = [];
				for (const m of history) {
					for (const url of m.images ?? []) out.push({ url, sender: m.mine ? "me" : m.sender, at: m.at });
				}
				return out;
			}

			/** Show picture `index` of the conversation in the shared viewer (image-viewer.ts); ← → step through. */
			async function openImage(index: number) {
				const refs = imageRefs();
				if (refs.length === 0) {
					say("no images in this conversation");
					return rerender();
				}
				imageIndex = ((index % refs.length) + refs.length) % refs.length;
				const ref = refs[imageIndex];

				if (!getCapabilities().images) {
					// Nothing to open: the descriptions are already inline, written
					// by the model when the conversation loaded.
					say("this terminal cannot display images — the description is inline in the message above");
					return rerender();
				}
				say("loading image…");
				rerender();

				let loaded: LoadedImage;
				try {
					loaded = await deps.loadImage(ref.url);
				} catch (e) {
					fail(`could not load image: ${e}`);
					return rerender();
				}
				say("");

				const next = await showImage(ctx, loaded, `${ref.sender}  ${formatLocal(ref.at)}`, imageIndex, refs.length);
				rerender();
				if (next !== null) await openImage(next);
			}

			async function runPeopleSearch() {
				const q = filter.trim();
				if (!q || searching) return;
				searching = true;
				say(`searching "${q}"…`);
				rerender();
				try {
					people = await deps.searchPeople(q);
					peopleSearched = true;
					sel = 0;
					say(people.length === 0 ? `no one matches "${q}"` : `${people.length} found`);
				} catch (e) {
					fail(`people search failed: ${e}`);
				} finally {
					searching = false;
					rerender();
				}
			}

			/**
			 * Open the existing chat with this person, or explain that there is none.
			 *
			 * The chat may sit past the pages loaded so far, so the list is paged
			 * until it turns up or the list ends.
			 */
			async function selectPerson(p: Person) {
				const email = p.email.toLowerCase();
				say("");
				// The chat may sit past the pages loaded so far: page until it turns up or the list ends.
				let hit: ChatRef | undefined;
				for (;;) {
					hit = email === "" ? undefined : chats.find((c) => (c.emails ?? []).includes(email));
					if (hit || email === "" || chatsNext === undefined) break;
					say(`looking for ${p.name}'s chat further down the list…`);
					rerender();
					if (!(await loadMoreChats())) break;
				}
				if (!hit) {
					// Starting a brand new conversation would mean POST /chats, which is deliberately not done
					// here. A page that failed to load has already said why, so that message stays.
					if (!statusError) fail(`no existing chat with ${p.name} — start it in Teams first`);
					rerender();
					return;
				}
				const found: ChatRef = hit;
				mode = "chats";
				filter = "";
				filterNote = false;
				sel = Math.max(0, rows().findIndex((r) => r.id === found.id));
				await selectRow({
					id: found.id,
					display: found.display ?? found.label,
					preview: found.preview ?? "",
					at: found.last_at,
					target: { kind: "chat", chat: found.label, id: found.id },
				});
			}

			async function selectRow(row: Row) {
				target = row.target;
				viewGen++;
				openChatId = row.id || undefined;
				targetName = row.display;
				opened = true;
				pane = "composer";
				say("");
				history = [];
				historyOlder = undefined;
				histScroll = 0;
				// Concurrent on purpose: the badge must not wait on the history
				// fetch, and the history must not wait on the mark-read call.
				await Promise.all([reloadHistory(), markReadIfUnread(row.id)]);
			}

			async function doSend() {
				if (sending) {
					say("still sending…");
					rerender();
					return;
				}
				const body = draft.trim();
				if (!body) {
					say("nothing to send");
					rerender();
					return;
				}
				const html = fmt !== 2;
				const payload = fmt === 0 ? deps.mdToHtml(body) : body;
				const t = target;
				const sentName = targetName;
				// The text leaves the draft as it goes out: the draft follows the user from chat to chat,
				// and a sent message left in it would be one Enter away from a second, wrong chat.
				const sentDraft = draft;
				draft = "";
				caret = 0;
				draftRev++;
				// What this send belongs to. The user may open another chat or type while it is out;
				// on return only state that still belongs to this send is touched.
				const view = viewGen;
				const rev = draftRev;
				sending = true;
				say("sending…");
				rerender();
				try {
					await deps.send(t, payload, html);
				} catch (e) {
					if (view === viewGen && rev === draftRev) {
						// Nothing changed meanwhile: the unsent text goes back where it was, to retry or edit.
						draft = sentDraft;
						caret = Array.from(sentDraft).length;
						draftRev++;
						fail(`send failed: ${e}`);
					} else {
						// The user moved on; the text is not put into a draft it did not come from, so it is shown.
						fail(`send to ${sentName} failed: ${e} — not sent: ${body}`);
					}
					rerender();
					return;
				} finally {
					sending = false;
				}
				if (view !== viewGen) {
					// Another chat is open now: its draft and history are not this send's to change.
					say(`sent ✓ to ${sentName}`);
					rerender();
					return;
				}
				say("sent ✓ · refreshing");
				rerender();
				// Sending returns to the newest messages, so the refresh replaces the loaded history.
				const gen = bumpHistory();
				try {
					const page = await deps.loadHistory(t);
					if (gen === histGen && view === viewGen) {
						history = page.messages;
						historyOlder = page.older;
						histScroll = 0;
						resolveAltText();
					}
					if (view === viewGen) say("sent ✓");
				} catch (e) {
					// The message went; only the refresh failed.
					if (view === viewGen) fail(`sent ✓, but the conversation could not be refreshed: ${e}`);
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
					return text;
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
				return rest.slice(0, end);
			}

			function handleInput(data: string) {
				// Before every key check: inside a paste, "\r" is a character and
				// "\x1b" is not the escape key.
				// Clipboards carry CRLF; a chat message should not.
				const pasted = takePaste(data)?.replace(/\r\n?/g, "\n") ?? null;
				if (pasted !== null) {
					if (pasted === "") return;
					if (pane === "composer") {
						const a = Array.from(draft);
						const insert = Array.from(pasted);
						a.splice(caret, 0, ...insert);
						draft = a.join("");
						draftRev++;
						caret = Math.min(a.length, caret + insert.length);
					} else {
						// The filter is one line: a pasted newline would make the rest
						// of the paste invisible rather than searchable.
						filter += pasted.replace(/\n/g, " ");
						sel = 0;
						if (mode === "people") peopleSearched = false;
						else {
							say("");
							fillFilter();
						}
					}
					return rerender();
				}

				// Esc backs out of the conversation to the chats; in the list it closes.
				if (matchesKey(data, Key.escape)) {
					if (pane === "composer") {
						pane = "list";
						return rerender();
					}
					closed = true;
					return done();
				}
				if (matchesKey(data, Key.tab)) {
					pane = pane === "list" ? "composer" : "list";
					return rerender();
				}
				if (matchesKey(data, Key.ctrl("f"))) {
					fmt = (fmt + 1) % FORMATS.length;
					return rerender();
				}
				if (pane === "list") return listKey(data);
				composerKey(data);
			}

			function listKey(data: string): void {
				if (matchesKey(data, Key.ctrl("p"))) {
					mode = mode === "chats" ? "people" : "chats";
					filter = "";
					filterNote = false;
					sel = 0;
					people = [];
					peopleSearched = false;
					say("");
					return rerender();
				}

				if (mode === "people") {
					if (matchesKey(data, Key.up)) {
						sel = Math.max(0, sel - 1);
					} else if (matchesKey(data, Key.down)) {
						sel = Math.min(Math.max(0, people.length - 1), sel + 1);
					} else if (matchesKey(data, Key.enter)) {
						// First enter runs the query; later ones open a result.
						if (!peopleSearched) void runPeopleSearch();
						else if (people[sel]) void selectPerson(people[sel]);
						return;
					} else if (matchesKey(data, Key.backspace)) {
						filter = Array.from(filter).slice(0, -1).join("");
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
					say("reloading chats…");
					rerender();
					void deps
						.refreshChats()
						.then(
							(page) => {
								applyFirstPage(page);
								say("");
							},
							(e: unknown) => fail(`reload failed: ${e}`),
						)
						.finally(rerender);
					return;
				}

				const list = rows();
				const last = Math.max(0, list.length - 1);
				// Moving through the list retires a one-off notice ("chat list updated"), so the
				// standing line -- how many chats are loaded, whether more follow -- shows again.
				// An error stays until it is read and something else replaces it.
				if ([Key.up, Key.down, Key.pageUp, Key.pageDown].some((k) => matchesKey(data, k)) && !statusError) status = "";
				if (matchesKey(data, Key.up)) {
					sel = Math.max(0, sel - 1);
				} else if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
					sel = Math.min(last, sel + 1);
					// The highlight reached the last loaded row: fetch the next page under it.
					if (sel === last) void loadMoreChats();
				} else if (matchesKey(data, Key.pageUp)) {
					sel = Math.max(0, sel - listFits);
				} else if (matchesKey(data, Key.pageDown)) {
					sel = Math.min(last, sel + listFits);
					if (sel === last) void loadMoreChats();
				} else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
					if (list[sel]) void selectRow(list[sel]);
					return;
				} else if (matchesKey(data, Key.backspace)) {
					filter = Array.from(filter).slice(0, -1).join("");
					sel = 0;
					say("");
					fillFilter();
				} else if (isPrintable(data)) {
					filter += data;
					sel = 0;
					say("");
					fillFilter();
				} else {
					return;
				}
				rerender();
			}

			function composerKey(data: string): void {
				const chars = () => Array.from(draft);
				const replaceDraft = (next: string[], caretAt: number) => {
					draft = next.join("");
					draftRev++;
					caret = Math.max(0, Math.min(next.length, caretAt));
				};

				if (matchesKey(data, Key.ctrl("o"))) {
					// Newest first: the picture someone just sent is the one wanted.
					return void openImage(imageRefs().length - 1);
				}

				if (matchesKey(data, Key.ctrl("r"))) {
					// Refresh what is on screen: the other side may have replied
					// since this pane was filled.
					say("");
					void reloadHistory();
					return;
				}

				// In Tern the history is one native scroller that Tern clamps, and render() never runs, so the row
				// view's boundary (histMax, set by convPane) means nothing there: the keys only move the scroller,
				// and older messages come from the "load older" button at its top.
				const by = matchesKey(data, Key.up) ? "line-up" : matchesKey(data, Key.down) ? "line-down" : matchesKey(data, Key.pageUp) ? "page-up" : matchesKey(data, Key.pageDown) ? "page-down" : undefined;
				if (by && nativeLive) {
					nativeScroll = { by, n: nativeScroll.n + 1 };
					return rerender();
				}
				if (matchesKey(data, Key.up)) {
					scrollUp(1);
				} else if (matchesKey(data, Key.down)) {
					histScroll = Math.max(0, histScroll - 1);
				} else if (matchesKey(data, Key.pageUp)) {
					scrollUp(histRows);
				} else if (matchesKey(data, Key.pageDown)) {
					histScroll = Math.max(0, histScroll - histRows);
				} else if (matchesKey(data, Key.left)) {
					// ← moves the caret. With nothing typed it is the way back to the chats; with a
					// draft it stops at the start, so a half-written message never sends keys to the filter.
					if (chars().length === 0) pane = "list";
					else caret = Math.max(0, caret - 1);
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

			/** Body rows inside the frame: the frame takes 85% of the terminal, with its border, status and hint rows. */
			function bodyRows(): number {
				const rows = tui.terminal?.rows ?? 24;
				return Math.max(1, Math.min(Math.floor(rows * 0.85), rows - 2) - 4);
			}

			/** One chat as two lines: name and time (● when unread), then the preview. Highlighted across both. */
			function chatLines(row: Row, w: number, isUnread: boolean, selected: boolean): string[] {
				const when = chatWhen(row.at);
				const dot = isUnread ? theme.fg("warning", "● ") : "  ";
				const name = isUnread ? theme.bold(row.display) : row.display;
				const lines = [
					justify(`${dot}${name}`, when ? theme.fg("dim", when) : "", w),
					theme.fg("dim", fit(`  ${row.preview}`, w)),
				];
				return selected ? lines.map((l) => theme.bg("selectedBg", fit(l, w))) : lines;
			}

			function leftPane(w: number, h: number): string[] {
				const active = pane === "list";
				const listRows = Math.max(1, h - 1);
				const list = rows();
				if (sel >= list.length) sel = Math.max(0, list.length - 1);
				const out: string[] = [];
				const body: string[] = [];

				if (mode === "people") {
					if (!peopleSearched && !searching) body.push(theme.fg("dim", truncateToWidth("enter to search", w)));
					for (const [i, p] of people.slice(0, Math.max(0, listRows - body.length)).entries()) {
						const text = fit(`${i === sel ? "▸" : " "} ${p.name}`, w);
						body.push(i === sel ? theme.bg("selectedBg", text) : theme.fg("dim", text));
					}
				} else {
					const unread = new Set(deps.unreadIds());
					const fits = Math.max(1, Math.floor(listRows / CHAT_LINES));
					listFits = fits;
					if (sel < listTop) listTop = sel;
					if (sel >= listTop + fits) listTop = sel - fits + 1;
					if (list.length === 0) {
						body.push(theme.fg("dim", fit(filter.trim() ? `no chat matches "${filter.trim()}"` : "no chats", w)));
					}
					list.slice(listTop, listTop + fits).forEach((row, k) => {
						body.push(...chatLines(row, w, row.id !== "" && unread.has(row.id), listTop + k === sel));
					});
				}
				while (body.length < listRows) body.push("");
				out.push(...body.slice(0, listRows));

				const marker = active ? CURSOR_MARKER : "";
				const label = mode === "people" ? "search" : "filter";
				out.push(theme.fg("muted", truncateToWidth(`${label}: ${filter}${marker}`, w)));
				return out;
			}

			function historyLines(w: number): string[] {
				if (loading) return [theme.fg("dim", "loading…")];
				if (historyError) return wrapTextWithAnsi(theme.fg("error", historyError), w);
				if (history.length === 0) {
					return [theme.fg("dim", opened ? "(no recent messages)" : "open a chat from the list: enter or →")];
				}
				const out: string[] = [];
				if (historyOlder === undefined) out.push(theme.fg("dim", fit("── start of conversation ──", w)));
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
					// pi's Markdown component passes ANSI through untouched, so a mention is coloured here: the
					// warning colour when it is me, the accent colour for anyone else. Bold alone does not catch
					// the eye in a busy pane.
					const me = m.me?.trim().toLowerCase() ?? "";
					const withMentions = body.replace(/\*\*@([^*\n]+)\*\*/g, (_all, name: string) => {
						const isMe = me !== "" && name.trim().toLowerCase() === me;
						return theme.fg(isMe ? "warning" : "accent", `@${name}`);
					});
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

			function convPane(w: number, h: number): string[] {
				const active = pane === "composer";
				const out: string[] = [];

				const { lines: draftLines, caretLine, caretIndex } = layoutDraft(draft, Math.max(4, w - 2), caret);
				const composerRows = Math.min(6, draftLines.length, Math.max(1, h - 2));
				histRows = Math.max(1, h - 1 - composerRows);

				const hist = historyLines(w);
				// Clamp here, not in the key handler: the limit depends on the
				// pane height, which only this function knows.
				histMax = Math.max(0, hist.length - histRows);
				if (histScroll > histMax) histScroll = histMax;
				const start = Math.max(0, hist.length - histRows - histScroll);
				out.push(...hist.slice(start, start + histRows));
				while (out.length < histRows) out.push("");

				if (histScroll > 0) {
					const note = ` ── ${histScroll} line(s) below · ↓/PgDn to catch up `;
					out.push(theme.fg("warning", fit(note.padEnd(w, "─"), w)));
				} else {
					out.push(theme.fg("borderMuted", "─".repeat(w)));
				}

				// Scroll the draft so the caret's line is always on screen.
				const first = Math.max(0, Math.min(caretLine - composerRows + 1, draftLines.length - composerRows));
				draftLines.slice(first, first + composerRows).forEach((line, i) => {
					const li = first + i;
					const prefix = li === 0 ? "> " : "  ";
					const body = active && li === caretLine ? withCaret(line, caretIndex) : line;
					out.push(truncateToWidth(`${prefix}${body}`, w));
				});
				return out.slice(0, h);
			}

			/** The status row: the last thing that happened, in error colour when it failed; otherwise the standing line. */
			function statusRow(): string {
				if (status !== "") return statusError ? theme.fg("error", status) : theme.fg("accent", status);
				if (pane === "composer") return theme.fg("muted", `format: ${FORMATS[fmt]}`);
				return theme.fg("muted", mode === "people" ? "enter to search" : chatsSummary());
			}

			/** The title row: the open chat, or "Teams", and the number of chats holding unread activity. */
			function titleText(): string {
				const base = opened ? `Teams — ${targetName}` : "Teams";
				const unread = new Set(deps.unreadIds()).size;
				return unread > 0 ? `${base} · ${unread} unread` : base;
			}

			function hintText(inner: number): string {
				const wide = inner >= 120;
				if (pane === "list") {
					if (mode === "people") return PEOPLE_HINT;
					return wide ? CHATS_HINT : CHATS_HINT_SHORT;
				}
				const images = imageRefs().length;
				const pics = images > 0 ? ` · ^o ${getCapabilities().images ? "view" : "describe"} ${images} image(s)` : "";
				return `${wide ? CONV_HINT : CONV_HINT_SHORT}${pics}`;
			}

			// ── Tern layer (core/tern-native.ts) ─────────────────────────────
			// The same state, described as Tern nodes. Only omp in a Tern pane calls this.

			/** History messages in Markdown, with picture descriptions and file lines, one node per message. */
			function historyNodes(): tn.NativeNode[] {
				if (loading) return [tn.text([tn.span("loading…", "dim")], undefined, "loading")];
				if (historyError) return [tn.text([tn.span(historyError, "error")], { wrap: "word" }, "error")];
				if (history.length === 0) {
					const empty = opened ? "(no recent messages)" : "open a chat from the list: enter or →";
					return [tn.text([tn.span(empty, "dim")], undefined, "empty")];
				}
				const out: tn.NativeNode[] = [];
				if (historyOlder === undefined) out.push(tn.node("rule", { label: "start of conversation" }, undefined, "start"));
				else out.push(tn.button(olderLoading ? "loading older…" : "load older messages", "older"));
				let n = 0;
				history.forEach((m, i) => {
					const who = m.mine ? "me" : m.sender;
					const tone = m.mentions_me ? "warning" : m.mine ? "accent" : "success";
					const head = [tn.span(formatLocal(m.at), "dim"), tn.span(`  ${who}`, `${tone} strong`)];
					if (m.mentions_me) head.push(tn.span("  @you", "warning"));
					const body = (m.files ?? []).reduce((acc, f) => acc.split(`\u{1f4ce} [${f.name}](${f.url})`).join("").trim(), m.md ?? m.text);
					const source = (m.images ?? []).reduce((acc, url) => {
						n++;
						const described = alt.get(url);
						return acc.replace("[image]", described ? `[image ${n}: ${described}]` : `[image ${n}: describing…]`);
					}, body);
					const parts: tn.NativeNode[] = [tn.text(head, { wrap: "none", truncate: "end" }, "head")];
					if (source) parts.push(tn.md(tn.mdNoMath(source), "body"));
					for (const [j, f] of (m.files ?? []).entries()) {
						parts.push(tn.text([{ t: `📎 ${f.name}`, s: "warning link", href: f.url }], { truncate: "end" }, `file${j}`));
					}
					// Keyed by the message, not its index: a prepended older page then adds nodes instead of re-keying all.
					const msg = tn.col(parts, { gap: "xs" }, tn.stableKey(`${m.at}\u0000${m.sender}\u0000${m.text}`));
					// A node reveals itself when added: the newest message is new on open and on every arrival, so the
					// pane opens at the bottom. Older pages prepend under other keys and leave the view where it is.
					out.push(i === history.length - 1 ? { ...msg, reveal: "end" } : msg);
				});
				return out;
			}

			function chatItems(): tn.NativeNode[] {
				if (mode === "people") {
					return people.map((p, i) => tn.item(`p${i}`, { label: p.name, detail: [tn.span(p.email, "muted")] }));
				}
				const unread = new Set(deps.unreadIds());
				return rows().map((r, i) => {
					const isUnread = r.id !== "" && unread.has(r.id);
					return tn.item(`c${i}`, {
						label: isUnread ? [tn.span(r.display, "strong")] : r.display,
						detail: r.preview ? [tn.span(r.preview, "muted")] : undefined,
						value: [tn.span(chatWhen(r.at), "dim")],
						tone: isUnread ? "warning" : undefined,
					});
				});
			}

			/** The keycaps under the panes: the same keys as the row hints, per pane. */
			function hintNodes(): tn.NativeNode {
				const images = imageRefs().length;
				const list: { keys: string[]; label: string }[] =
					pane === "list"
						? mode === "people"
							? [
									{ keys: ["enter"], label: peopleSearched ? "open" : "search" },
									{ keys: ["ctrl+p"], label: "chats" },
									{ keys: ["escape"], label: "close" },
								]
							: [
									{ keys: ["up", "down"], label: "move" },
									{ keys: ["enter"], label: "open" },
									{ keys: ["tab"], label: "conversation" },
									{ keys: ["ctrl+p"], label: "find someone" },
									{ keys: ["ctrl+r"], label: "reload" },
									{ keys: ["escape"], label: "close" },
								]
						: [
								{ keys: ["enter"], label: "send" },
								{ keys: ["ctrl+j"], label: "newline" },
								{ keys: ["pageUp", "pageDown"], label: "scroll" },
								{ keys: ["ctrl+f"], label: `format: ${FORMATS[fmt]}` },
								{ keys: ["ctrl+r"], label: "reload" },
								...(images > 0
									? [{ keys: ["ctrl+o"], label: `${getCapabilities().images ? "view" : "describe"} ${images} image(s)` }]
									: []),
								{ keys: ["tab"], label: "chats" },
							];
				return tn.hints(list);
			}

			const describeMemo = tn.memo();

			function describe(cx: tn.DescribeContext): tn.NativeNode | null {
				if (!cx.supports("list") || !cx.supports("md") || !cx.supports("input")) return null;
				const sig = [
					pane, mode, filter, sel, draft, caret, fmt, status, statusError, loading, historyError,
					histGen, history.length, history[0]?.at ?? "", historyOlder ?? "", olderLoading, altRev, chats.length, chatsNext ?? "", nativeScroll.n,
					people.length, peopleSearched, searching, targetName, deps.unreadIds().join(),
					// The pane heights below come from the terminal's rows: a resize must rebuild the tree.
					tui.terminal?.rows ?? 24,
				].join("\u0000");
				nativeLive = true;
				return describeMemo(sig, () => {
					const count = mode === "people" ? people.length : rows().length;
					if (sel >= count) sel = Math.max(0, count - 1);
					// The sheet's body scrolls as a whole and does not hand its height down, so the panes get an explicit
					// one, as omp's split-pane does: the terminal less the sheet's head, status and hints. Inside, the list
					// `max` (in rows) and the history `max.h` (in lines) give each its own scroller.
					const paneLines = Math.max(6, (tui.terminal?.rows ?? 24) - 9);
					const listLines = Math.max(3, Math.floor((paneLines - 4) / 2));
					const fill = { grow: 1, min: { h: 0 } };
					const left = tn.col(
						[
							tn.text([tn.span(mode === "people" ? "People" : "Chats", pane === "list" ? "accent strong" : "muted")], undefined, "head"),
							tn.selectList("chats", chatItems(), count > 0 ? `${mode === "people" ? "p" : "c"}${sel}` : null, {
								...fill,
								max: { lines: listLines },
								empty: filter.trim() ? `no match for "${filter.trim()}"` : mode === "people" ? (searching ? "searching…" : "enter to search") : "no chats",
							}),
							// Tern focuses the first field a focused overlay describes, so only the active pane gets one; the
							// other shows its text, as the row view does.
							pane === "list"
								? tn.input(
										filter,
										filter.length,
										{ placeholder: mode === "people" ? "find someone: type a name, enter to search" : "type to filter chats" },
										"filter",
									)
								: tn.text([tn.span(`${mode === "people" ? "search" : "filter"}: ${filter}`, "muted")], { truncate: "end" }, "filter"),
						],
						{ gap: "sm", basis: 0.3, shrink: 0, min: { w: "32ch", h: 0 }, max: { w: "56ch" } },
						"left",
					);
					const right = tn.col(
						[
							tn.text([tn.span(targetName, pane === "composer" ? "accent strong" : "muted")], { truncate: "end" }, "head"),
							// Newest at the bottom: the last message is revealed when a conversation (or a new message) lands;
							// scroll keys move the scroller.
							{ ...tn.col(historyNodes(), { gap: "md", ...fill, max: { h: `${Math.max(4, paneLines - 6)}lines` } }, "history"), scroll: nativeScroll },
							pane === "composer"
								? tn.editor(
										draft,
										tn.utf16Offset(draft, caret),
										{ placeholder: opened ? `message ${targetName}` : "pick a chat first", prompt: ">", maxLines: 6 },
										"composer",
									)
								: tn.text([tn.span(`> ${draft}`, draft ? "" : "dim")], { wrap: "word", lines: 6 }, "composer"),
						],
						{ gap: "sm", grow: 1, min: { w: 0, h: 0 } },
						"right",
					);
					const standing = pane === "composer" ? `format: ${FORMATS[fmt]}` : mode === "people" ? "enter to search" : chatsSummary();
					const statusSpans = status !== "" ? [tn.span(status, statusError ? "error" : "accent")] : [tn.span(standing, "muted")];
					return tn.col(
						[
							tn.row([left, right], { gap: "md", align: "stretch", min: { h: `${paneLines}lines` }, max: { h: `${paneLines}lines` } }, "split"),
							tn.text(statusSpans, { truncate: "end" }, "status"),
							hintNodes(),
						],
						{ gap: "sm", grow: 1 },
					);
				});
			}

			/** Pointer actions on the described nodes, routed to the paths the matching keys take. */
			function handleNativeEvent(event: tn.NativeUiEvent): void {
				if ((event.type === "select" || event.type === "activate") && "item" in event) {
					const i = Number.parseInt(event.item.slice(1), 10);
					if (!Number.isFinite(i)) return;
					pane = "list";
					sel = i;
					if (event.type === "activate") {
						if (mode === "people") {
							if (people[i]) void selectPerson(people[i]);
						} else {
							const r = rows()[i];
							if (r) void selectRow(r);
						}
					}
					return rerender();
				}
				if (event.type === "action" && "act" in event && event.act === "older") {
					atTop();
					return rerender();
				}
				if (event.type === "edit" && "from" in event) {
					const isFilter = event.key.endsWith("filter");
					const current = isFilter ? filter : draft;
					if (event.len !== current.length) return;
					const next = current.slice(0, event.from) + event.text + current.slice(event.to);
					if (isFilter) {
						filter = next.replace(/\n/g, " ");
						sel = 0;
						if (mode === "people") peopleSearched = false;
						else fillFilter();
					} else {
						draft = next;
						draftRev++;
						caret = tn.charIndex(next, event.cursor);
						pane = "composer";
					}
					return rerender();
				}
			}

			const component: Component & Focusable & { dispose?(): void; readonly nativeOverlay: tn.OverlayProps } = {
				get nativeOverlay() {
					return tn.overlayProps("teams", titleText());
				},
				describe,
				handleNativeEvent,
				get focused() {
					return _focused;
				},
				set focused(v: boolean) {
					_focused = v;
				},
				render(width: number): string[] {
					nativeLive = false;
					const B = bodyRows();
					const inner = width - 4;
					const lw = leftWidth(inner);
					const rw = inner - lw - SEP.length;
					// Each pane's header and rule: bright while the pane has the keys.
					const heads = [
						{ text: mode === "people" ? "People" : "Chats", focused: pane === "list", w: lw },
						{ text: targetName, focused: pane === "composer", w: rw },
					].map(({ text, focused, w }) => [
						theme.fg(focused ? "accent" : "muted", focused ? theme.bold(fit(text, w)) : fit(text, w)),
						theme.fg("borderMuted", "─".repeat(w)),
					]);
					const left = [...heads[0], ...leftPane(lw, Math.max(1, B - 2))];
					const right = [...heads[1], ...convPane(rw, Math.max(1, B - 2))];
					const bar = (s: string) => theme.fg("borderMuted", s);
					const sep = bar(SEP);
					const body = Array.from(
						{ length: B },
						(_, i) => `${bar("│ ")}${fit(left[i] ?? "", lw)}${sep}${fit(right[i] ?? "", rw)}${bar(" │")}`,
					);
					const title = truncateToWidth(titleText(), Math.max(0, width - 6), "…");
					const fill = "─".repeat(Math.max(0, width - 6 - visibleWidth(title)));
					return [
						`${bar("╭─ ")}${theme.fg("accent", title)}${bar(` ─${fill}╮`)}`,
						...body,
						`${bar("│ ")}${fit(statusRow(), inner)}${bar(" │")}`,
						`${bar("│ ")}${fit(theme.fg("muted", hintText(inner)), inner)}${bar(" │")}`,
						bar(`╰${"─".repeat(Math.max(0, width - 2))}╯`),
					];
				},
				invalidate() {},
			};

			// The picker owns input first; nothing is loaded until a chat is chosen.
			component.handleInput = handleInput;
			return component;
		},
		{
			overlay: true,
			overlayOptions: { width: "96%", maxHeight: "85%", anchor: "center", margin: 1 },
		},
	);
}
