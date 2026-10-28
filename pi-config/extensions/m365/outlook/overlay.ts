/**
 * The /outlook overlay: a NeoMutt-style reader and composer over the mailbox.
 *
 * One component with a mode state machine. A key outside the R6 set does
 * nothing. Every deps call runs through `run`: keys wait until it settles, a
 * failure shows in the status line, and the mode moves only once the calls
 * behind it have resolved. So a send that fails stays in compose, text intact.
 */
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Key, Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import * as tn from "../core/tern-native.ts";
import { htmlToMarkdown } from "./convert.ts";
import type { FolderInfo, Mailbox, MailImage, Summary } from "./mailbox.ts";
import { isShared, type SharedLink, sharedLinks } from "./files.ts";
import { type Address, type ComposeDraft, type MailAttachment, type ParsedMail, quoteFields, withMentioned } from "./mime.ts";

export type OverlayDeps = Pick<Mailbox, "list" | "search" | "read" | "draftFor" | "build" | "submit" | "saveDraft" | "move" | "setRead" | "folders"> & {
	refreshUnread(): Promise<void>;
	/** The user's signature in Markdown, "" when none is set; read at each send so an edit applies at once. */
	signature(): string;
	/** Saves an attachment where the user's downloads go; resolves with the path. Only on the user's `s` and Enter. */
	saveAttachment(a: MailAttachment): Promise<string>;
	/** Downloads a SharePoint/OneDrive file the same way. */
	saveLink(url: string): Promise<string>;
	/** A model-written line about a picture. Rejects with the reason when it cannot be had. */
	describe(image: MailAttachment): Promise<string>;
};

type Mode = "index" | "search" | "picker" | "pager" | "save" | "compose" | "confirm-send" | "confirm-discard";
/** One thing the save list offers: an attachment, or a file a link in the body points at. */
type SaveItem = { kind: "attachment"; attachment: MailAttachment } | { kind: "link"; link: SharedLink };
type Field = "to" | "cc" | "subject" | "body";
type Tone = "ok" | "bad" | "warn" | "muted" | "info";
type Opened = { summary: Summary; mail: ParsedMail; markdown: string; images: MailImage[] };
type Compose = Record<Field, string> & { base: ComposeDraft; focus: Field };
/** One frame's body: its title, its lines, the first line shown, and what fills the rows past the last line. */
type Screen = { title: string; lines: string[]; top: number; filler: string };

/** Messages fetched per index page; reaching the last row fetches the next page. */
const PAGE = 50;
const FIELDS: Field[] = ["to", "cc", "subject", "body"];
const NEXT: Record<Field, Field> = { to: "cc", cc: "subject", subject: "body", body: "to" };
/** Each field's label fills nine cells; continuation rows are indented by the same nine. */
const LABEL_W = 9;
const LABELS: Record<Field, string> = { to: "To:      ", cc: "Cc:      ", subject: "Subject: ", body: "Body:    " };
const TITLES: Record<ComposeDraft["kind"], string> = { new: "New message", reply: "Reply", replyAll: "Reply all", forward: "Forward" };
const HINTS: Record<Mode, string> = {
	index: "j/k ↑/↓ move · pgup/pgdn page · enter/→ read · / search · c folders · m new · r reply · g reply all · f forward · a archive · d delete · N read/unread · q/esc close",
	search: "type a query · enter search · esc back to folder",
	picker: "j/k ↑/↓ move · enter open folder · q/esc back",
	pager: "j/k ↑/↓ line · space/pgdn pgup page · s save files · r reply · g reply all · f forward · q/esc/← back",
	save: "j/k ↑/↓ move · enter save to ~/Downloads · q/esc back",
	compose: "tab next field · enter newline in body · ctrl+s send · ctrl+p save draft · esc discard",
	"confirm-send": "y send now · n/esc keep editing",
	"confirm-discard": "y discard · n/esc keep editing",
};
/**
 * From this frame width the overlay is Outlook's three panes: folders | messages | reading pane.
 * Narrower, it is one pane at a time, as before.
 */
const SPLIT_MIN = 140;
/** Between two panes. */
const SEP = " │ ";
/** Rows per message in the messages pane: sender and time, subject, preview. */
const ROW_LINES = 3;
/** The reading pane follows the highlight once it rests this long, so holding j does not fetch every mail. */
const PREVIEW_DELAY_MS = 200;
/** Previews kept; each holds the message's raw parts, pictures included. */
const PREVIEW_CACHE = 20;
const SPLIT_HINTS: Partial<Record<Mode, string>> = {
	index: "j/k ↑/↓ move · enter/→/tab read · ←/c folders · / search · m new · r reply · g reply all · f forward · a archive · d delete · N read/unread · q/esc close",
	picker: "j/k ↑/↓ move · enter open folder · →/tab/esc messages",
	pager: "j/k ↑/↓ line · space/pgdn pgup page · s save files · r reply · g reply all · f forward · ←/esc/q messages · tab folders",
};
/** Tone spans written by renderMarkdown map onto the overlay's theme colours. */
const TONE_COLOR: Record<Tone, ThemeColor> = { ok: "success", bad: "error", warn: "warning", muted: "dim", info: "accent" };
const TONE_SPAN = /\[([^\]\n]+)\]\{\.(ok|bad|warn|muted|info)\}/g;
const PRINTABLE = /^[^\x00-\x1f\x7f]+$/;
const ANSI = /\x1b\[[0-9;]*m/g;
/** The caret: a reverse-video cell after the text, with the IME cursor marker in front. */
const CARET = `${CURSOR_MARKER}\x1b[7m \x1b[27m`;

/** MM-DD HH:MM in local time, the year first when `withYear`: the index's date column and the pager's Date header. */
function stamp(iso: string, withYear: boolean): string {
	const d = new Date(iso);
	const two = (n: number) => String(n).padStart(2, "0");
	const md = `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
	return withYear ? `${d.getFullYear()}-${md}` : md;
}

/** "Name <address>", or the bare address when the header gave no name. */
const who = (a?: Address): string => (a ? (a.name ? `${a.name} <${a.address}>` : a.address) : "");
/** Several addresses for a header line, separated by semicolons as buildEml writes them. */
const listed = (list: Address[]): string => list.map(who).join("; ");
/** Cut to `w` columns and pad to exactly `w`, so every frame row has the same width. */
const fit = (s: string, w: number): string => truncateToWidth(s, Math.max(0, w), "…", true);

/** Plain text cut into rows of at most `w` columns; a newline always starts a row. */
function wrapPlain(text: string, w: number): string[] {
	const out: string[] = [];
	for (const logical of text.split("\n")) {
		let row = "";
		let rowW = 0;
		for (const ch of Array.from(logical)) {
			const cw = Math.max(1, visibleWidth(ch));
			if (rowW + cw > w && row !== "") {
				out.push(row);
				row = "";
				rowW = 0;
			}
			row += ch;
			rowW += cw;
		}
		out.push(row);
	}
	return out;
}

/** The draft as its fields read now: To and Cc parsed, and a known address keeps its name. */
function draftNow(c: Compose): ComposeDraft {
	const known = [...c.base.to, ...c.base.cc];
	const [to, cc] = [c.to, c.cc].map((text) =>
		text
			.split(/[,;]/)
			.map((s) => s.trim())
			.filter((s) => s !== "")
			.map((address) => known.find((k) => k.address.toLowerCase() === address.toLowerCase()) ?? { address }),
	);
	return { ...c.base, to, cc, subject: c.subject };
}

/**
 * Rendered Markdown lines with the blank header row of each headerless table removed.
 * A key/value sheet is written `|  |  |` (render.ts); pi-tui always draws the header row,
 * so without this the pager shows an empty box above the first key.
 */
function dropBlankTableHeaders(lines: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		out.push(lines[i]);
		const top = lines[i].replace(ANSI, "").trimStart();
		const header = (lines[i + 1] ?? "").replace(ANSI, "").trim();
		const sep = (lines[i + 2] ?? "").replace(ANSI, "").trimStart();
		if (top.startsWith("┌") && /^│[\s│]*│$/.test(header) && sep.startsWith("├")) i += 2;
	}
	return out;
}

class OutlookOverlay implements Component {
	get nativeOverlay(): tn.OverlayProps {
		return tn.overlayProps("outlook", this.nativeTitle());
	}
	/** Bumped per pager scroll key: Tern moves the native reading pane's scroller once per bump (core/tern-native.ts). */
	private nativeScroll: { by: "line-up" | "line-down" | "page-up" | "page-down"; n: number } = { by: "line-down", n: 0 };
	private readonly describeMemo = tn.memo();
	private mode: Mode = "index";
	/** The folder listed: a well-known name or a folder id, and what the title calls it. */
	private folder = { id: "inbox", label: "Inbox" };
	/** False once a folder page came back short: there is nothing further down. */
	private more = false;
	private folderList: FolderInfo[] = [];
	/** True once the folders pane asked for the folder list. */
	private foldersAsked = false;
	private pickTop = 0;
	private rows: Summary[] = [];
	/** The search that produced `rows`; undefined while the rows are a folder listing. */
	private query?: string;
	private sel = 0;
	private listTop = 0;
	private pickSel = 0;
	private saveSel = 0;
	private searchText = "";
	private status = "";
	private statusError = false;
	private busy = false;
	private opened?: Opened;
	/** Picture label → its description, "" while one is on its way; for the message `describedId`. */
	private described = new Map<string, string>();
	private describedId?: string;
	/** Messages the reading pane has shown, by id, oldest first. */
	private previews = new Map<string, Opened>();
	/** The id the pending or running preview fetch is for. */
	private previewWanted?: string;
	private previewTimer?: NodeJS.Timeout;
	private pagerTop = 0;
	private pagerCache?: { key: string; lines: string[] };
	private compose?: Compose;
	private width = 80;
	private readonly md: MarkdownTheme;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly deps: OverlayDeps,
		private readonly done: () => void,
	) {
		this.md = getMarkdownTheme();
		this.run(() => this.listFolder(this.folder), "loading…");
	}

	/** One deps action. Keys wait for it, a failure lands in the status line, and the mode moves only if it resolves. */
	private run(task: () => Promise<void>, pending = ""): void {
		if (this.busy) return;
		this.busy = true;
		this.status = pending;
		this.statusError = false;
		task()
			.catch((e: unknown) => {
				this.status = e instanceof Error ? e.message : String(e);
				this.statusError = true;
			})
			.finally(() => {
				this.busy = false;
				this.tui.requestRender();
			});
	}

	private clearStatus(): void {
		this.status = "";
		this.statusError = false;
	}

	private async listFolder(folder: { id: string; label: string }): Promise<void> {
		const rows = await this.deps.list(folder.id, { top: PAGE });
		this.folder = folder;
		this.rows = rows;
		this.more = rows.length === PAGE;
		this.query = undefined;
		this.sel = 0;
		this.listTop = 0;
		this.mode = "index";
		this.clearStatus();
	}

	/** The next page of the folder, appended; the highlight stays where it is. */
	private async loadMore(): Promise<void> {
		const rows = await this.deps.list(this.folder.id, { top: PAGE, skip: this.rows.length });
		const known = new Set(this.rows.map((r) => r.id));
		this.rows.push(...rows.filter((r) => !known.has(r.id)));
		this.more = rows.length === PAGE;
		this.clearStatus();
	}

	/** Every folder, for the picker, with the highlight on the folder listed now. */
	private async openPicker(): Promise<void> {
		this.folderList = await this.deps.folders();
		this.pickSel = Math.max(0, this.currentFolderIndex());
		this.pickTop = 0;
		this.mode = "picker";
		this.clearStatus();
	}

	private async runSearch(q: string): Promise<void> {
		const rows = await this.deps.search(q, PAGE);
		this.more = false;
		this.rows = rows;
		this.query = q;
		this.sel = 0;
		this.listTop = 0;
		this.mode = "index";
		this.clearStatus();
	}

	/** Enter: read the message (the preview already did, when there is one), mark it read, and open the pager on it. */
	private openRow(row: Summary): void {
		this.run(async () => {
			const got = this.previewOf(row) ?? (await this.deps.read(row.id));
			await this.deps.setRead(row.id, true);
			row.isRead = true;
			await this.deps.refreshUnread();
			this.remember(got);
			this.opened = got;
			this.pagerTop = 0;
			this.pagerCache = undefined;
			this.mode = "pager";
			this.describeImages(got);
		});
	}

	/** The message `row` as last read, if it was. */
	private previewOf(row: Summary | undefined): Opened | undefined {
		if (!row) return undefined;
		return this.opened?.summary.id === row.id ? this.opened : this.previews.get(row.id);
	}

	/** Keeps `got` as the newest preview, dropping the oldest past PREVIEW_CACHE. */
	private remember(got: Opened): void {
		this.previews.delete(got.summary.id);
		this.previews.set(got.summary.id, got);
		for (const id of this.previews.keys()) {
			if (this.previews.size <= PREVIEW_CACHE) break;
			this.previews.delete(id);
		}
	}

	/**
	 * Reads the highlighted message for the reading pane once the highlight rests, as Outlook does.
	 * Not through `run`: keys stay live, and a preview does not mark the message read. A failure is
	 * shown and not retried until the highlight moves away and back.
	 */
	private schedulePreview(): void {
		const row = this.rows[this.sel];
		if (!row || this.mode === "pager" || this.previewOf(row) || this.previewWanted === row.id) return;
		this.previewWanted = row.id;
		clearTimeout(this.previewTimer);
		this.previewTimer = setTimeout(() => {
			this.deps
				.read(row.id)
				.then(
					(got) => this.remember(got),
					(e: unknown) => {
						this.status = `preview failed: ${e instanceof Error ? e.message : String(e)}`;
						this.statusError = true;
					},
				)
				.finally(() => this.tui.requestRender());
		}, PREVIEW_DELAY_MS);
	}

	/** The folder list for the folders pane, fetched once; a failure shows in the status line. */
	private ensureFolders(): void {
		if (this.foldersAsked) return;
		this.foldersAsked = true;
		this.deps
			.folders()
			.then(
				(all) => {
					this.folderList = all;
				},
				(e: unknown) => {
					this.status = `folders: ${e instanceof Error ? e.message : String(e)}`;
					this.statusError = true;
				},
			)
			.finally(() => this.tui.requestRender());
	}

	/** Where the folder listed now sits in the folder list; -1 before the list arrives. */
	private currentFolderIndex(): number {
		return this.folderList.findIndex((f) => f.id === this.folder.id || f.path === this.folder.label);
	}

	/** Focus the folders pane, on the folder listed now. */
	private focusFolders(): void {
		if (this.folderList.length === 0) {
			this.run(() => this.openPicker(), "loading folders…");
			return;
		}
		this.pickSel = Math.max(0, this.currentFolderIndex());
		this.mode = "picker";
	}

	/** Closes the overlay; a pending preview is dropped. */
	private close(): void {
		clearTimeout(this.previewTimer);
		this.done();
	}

	/** Asks for a description of every picture in `opened`; each one that lands redraws the pager. */
	private describeImages(opened: Opened): void {
		this.described = new Map(opened.images.map((m) => [m.label, ""]));
		this.describedId = opened.summary.id;
		const mine = this.described;
		for (const { label, image } of opened.images) {
			this.deps
				.describe(image)
				.catch((e: unknown) => `(could not be described: ${e instanceof Error ? e.message : String(e)})`)
				.then((text) => {
					// A late answer for a message no longer open changes nothing.
					if (this.described !== mine) return;
					mine.set(label, text);
					this.pagerCache = undefined;
					this.tui.requestRender();
				});
		}
	}

	/** The defaults of a new draft, or of a reply, reply-all or forward to message `id`, opened in compose. */
	private async openDraft(kind: ComposeDraft["kind"], id?: string): Promise<void> {
		const d = await this.deps.draftFor(kind, id);
		this.compose = {
			base: d,
			to: d.to.map((a) => a.address).join(", "),
			cc: d.cc.map((a) => a.address).join(", "),
			subject: d.subject,
			body: "",
			focus: "to",
		};
		this.mode = "compose";
		this.clearStatus();
	}

	private moveRow(row: Summary, folder: "archive" | "deleteditems", outcome: string): void {
		this.run(async () => {
			await this.deps.move(row.id, folder);
			this.rows.splice(this.rows.indexOf(row), 1);
			this.sel = Math.min(this.sel, Math.max(0, this.rows.length - 1));
			this.status = outcome;
			await this.deps.refreshUnread();
		});
	}

	private toggleRead(row: Summary): void {
		const read = !row.isRead;
		this.run(async () => {
			await this.deps.setRead(row.id, read);
			row.isRead = read;
			this.status = read ? "marked read" : "marked unread";
			await this.deps.refreshUnread();
		});
	}

	/** Back to the index with `status`; the draft, if any, is gone. */
	private toIndex(status: string): void {
		this.compose = undefined;
		this.mode = "index";
		this.status = status;
		this.statusError = false;
	}

	/** Ctrl+S then y: the draft as its fields read now, sent with no agent footer. */
	private send(c: Compose): void {
		this.mode = "compose";
		this.run(async () => {
			const d = withMentioned(draftNow(c), c.body);
			const eml = await this.deps.build({ ...d, markdown: c.body, signature: this.deps.signature() });
			await this.deps.submit(d, eml);
			this.toIndex("sent");
		}, "sending…");
	}

	/** Ctrl+P: the draft saved to Drafts, compose closed. */
	private keepDraft(c: Compose): void {
		this.run(async () => {
			const d = withMentioned(draftNow(c), c.body);
			const eml = await this.deps.build({ ...d, markdown: c.body, signature: this.deps.signature() });
			await this.deps.saveDraft(d, eml);
			this.toIndex("draft saved");
		}, "saving draft…");
	}

	handleInput(data: string): void {
		if (this.busy) return;
		switch (this.mode) {
			case "index":
				this.indexKey(data);
				break;
			case "search":
				this.searchKey(data);
				break;
			case "picker":
				this.pickerKey(data);
				break;
			case "pager":
				this.pagerKey(data);
				break;
			case "compose":
				this.composeKey(data);
				break;
			case "confirm-send":
				this.confirmSendKey(data);
				break;
			case "confirm-discard":
				this.confirmDiscardKey(data);
				break;
			case "save":
				this.saveKey(data);
				break;
		}
		this.tui.requestRender();
	}

	private indexKey(data: string): void {
		const row = this.rows[this.sel];
		// One page is what the pane shows: three lines a message under the two header rows when split.
		const B = this.split() ? Math.max(1, Math.floor((this.bodyRows() - 2) / ROW_LINES)) : this.bodyRows();
		const lastRow = Math.max(0, this.rows.length - 1);
		if (this.split() && (matchesKey(data, Key.left) || data === "c")) {
			this.focusFolders();
			return;
		}
		if (this.split() && matchesKey(data, Key.tab)) {
			if (row) this.openRow(row);
			return;
		}
		if (data === "j" || matchesKey(data, Key.down)) this.sel = Math.min(this.sel + 1, lastRow);
		else if (data === "k" || matchesKey(data, Key.up)) this.sel = Math.max(0, this.sel - 1);
		else if (matchesKey(data, Key.pageDown)) this.sel = Math.min(this.sel + B, lastRow);
		else if (matchesKey(data, Key.pageUp)) this.sel = Math.max(0, this.sel - B);
		else if (data === "/") {
			this.mode = "search";
			this.searchText = "";
			this.clearStatus();
		} else if (data === "c") this.run(() => this.openPicker(), "loading folders…");
		else if (data === "m") this.run(() => this.openDraft("new"));
		else if (data === "q" || matchesKey(data, Key.escape)) this.close();
		else if (row && (matchesKey(data, Key.enter) || matchesKey(data, Key.right))) this.openRow(row);
		else if (row && data === "r") this.run(() => this.openDraft("reply", row.id));
		else if (row && data === "g") this.run(() => this.openDraft("replyAll", row.id));
		else if (row && data === "f") this.run(() => this.openDraft("forward", row.id));
		else if (row && data === "a") this.moveRow(row, "archive", "archived");
		else if (row && data === "d") this.moveRow(row, "deleteditems", "deleted");
		else if (row && data === "N") this.toggleRead(row);
		// The last row is in view and the folder has more: fetch the next page under it.
		if (this.mode === "index" && this.more && this.query === undefined && this.sel >= this.rows.length - 1) {
			this.run(() => this.loadMore(), "loading more…");
		}
	}

	private searchKey(data: string): void {
		if (matchesKey(data, Key.escape)) this.run(() => this.listFolder(this.folder), "loading…");
		else if (matchesKey(data, Key.enter)) {
			const q = this.searchText.trim();
			if (q !== "") this.run(() => this.runSearch(q), "searching…");
		} else if (matchesKey(data, Key.backspace)) {
			this.searchText = Array.from(this.searchText).slice(0, -1).join("");
			this.clearStatus();
		} else if (PRINTABLE.test(data)) {
			this.searchText += data;
			this.clearStatus();
		}
	}

	private pickerKey(data: string): void {
		const last = Math.max(0, this.folderList.length - 1);
		const B = this.split() ? Math.max(1, this.bodyRows() - 2) : this.bodyRows();
		if (data === "j" || matchesKey(data, Key.down)) this.pickSel = Math.min(this.pickSel + 1, last);
		else if (data === "k" || matchesKey(data, Key.up)) this.pickSel = Math.max(0, this.pickSel - 1);
		else if (matchesKey(data, Key.pageDown)) this.pickSel = Math.min(this.pickSel + B, last);
		else if (matchesKey(data, Key.pageUp)) this.pickSel = Math.max(0, this.pickSel - B);
		else if (matchesKey(data, Key.enter)) {
			const f = this.folderList[this.pickSel];
			if (f) this.run(() => this.listFolder({ id: f.id, label: f.path }), "loading…");
		} else if (data === "q" || matchesKey(data, Key.escape)) this.mode = "index";
		else if (this.split() && (matchesKey(data, Key.right) || matchesKey(data, Key.tab))) this.mode = "index";
	}

	private pagerKey(data: string): void {
		const p = this.opened;
		if (!p) return;
		const { w, rows } = this.readingSize();
		const last = Math.max(0, this.pagerRows(p, w).length - rows);
		// In Tern the message is one native scroller: the same keys move it there, by a `scroll` op.
		const by = data === "j" || matchesKey(data, Key.down) ? "line-down" : data === "k" || matchesKey(data, Key.up) ? "line-up" : data === " " || matchesKey(data, Key.pageDown) ? "page-down" : matchesKey(data, Key.pageUp) ? "page-up" : undefined;
		if (by) this.nativeScroll = { by, n: this.nativeScroll.n + 1 };
		if (data === "j" || matchesKey(data, Key.down)) this.pagerTop = Math.min(this.pagerTop + 1, last);
		else if (data === "k" || matchesKey(data, Key.up)) this.pagerTop = Math.min(Math.max(this.pagerTop - 1, 0), last);
		else if (data === " " || matchesKey(data, Key.pageDown)) this.pagerTop = Math.min(this.pagerTop + rows, last);
		else if (matchesKey(data, Key.pageUp)) this.pagerTop = Math.max(0, this.pagerTop - rows);
		else if (this.split() && matchesKey(data, Key.tab)) this.focusFolders();
		else if (data === "s") {
			if (this.saveItems(p).length === 0) {
				this.status = "this mail has no attachments or linked files";
				this.statusError = false;
			} else {
				this.saveSel = 0;
				this.mode = "save";
			}
		}
		else if (data === "r") this.run(() => this.openDraft("reply", p.summary.id));
		else if (data === "g") this.run(() => this.openDraft("replyAll", p.summary.id));
		else if (data === "f") this.run(() => this.openDraft("forward", p.summary.id));
		else if (data === "q" || matchesKey(data, Key.escape) || matchesKey(data, Key.left)) {
			this.opened = undefined;
			this.pagerCache = undefined;
			this.mode = "index";
		}
	}

	private composeKey(data: string): void {
		const c = this.compose;
		if (!c) return;
		if (matchesKey(data, Key.tab)) c.focus = NEXT[c.focus];
		else if (matchesKey(data, Key.enter)) {
			if (c.focus === "body") c.body += "\n";
		} else if (matchesKey(data, Key.backspace)) c[c.focus] = Array.from(c[c.focus]).slice(0, -1).join("");
		else if (matchesKey(data, Key.ctrl("s"))) this.mode = "confirm-send";
		else if (matchesKey(data, Key.ctrl("p"))) this.keepDraft(c);
		else if (matchesKey(data, Key.escape)) {
			if (FIELDS.every((f) => c[f] === "")) this.toIndex("");
			else this.mode = "confirm-discard";
		} else if (PRINTABLE.test(data)) c[c.focus] += data;
	}

	private confirmSendKey(data: string): void {
		const c = this.compose;
		if (data === "y" && c) this.send(c);
		else if (data === "n" || matchesKey(data, Key.escape)) this.mode = "compose";
	}

	private confirmDiscardKey(data: string): void {
		if (data === "y") this.toIndex("discarded");
		else if (data === "n" || matchesKey(data, Key.escape)) this.mode = "compose";
	}

	/** Body rows inside the frame: the frame takes 85% of the terminal, with its border, status and hint rows. */
	private bodyRows(): number {
		const rows = this.tui.terminal?.rows ?? 24;
		return Math.max(1, Math.min(Math.floor(rows * 0.85), rows - 2) - 4);
	}

	/** Three panes: the frame is wide enough and no draft has the screen. */
	private split(): boolean {
		return this.width >= SPLIT_MIN && !this.compose;
	}

	/** The three panes' widths inside the frame, separators excluded. */
	private panes(): { folders: number; list: number; read: number } {
		const inner = this.width - 4;
		const folders = Math.min(32, Math.max(18, Math.floor(inner * 0.16)));
		const list = Math.min(64, Math.max(36, Math.floor(inner * 0.32)));
		return { folders, list, read: inner - folders - list - 2 * SEP.length };
	}

	/** Where the message being read is drawn: the reading pane under its two header rows, or the whole frame. */
	private readingSize(): { w: number; rows: number } {
		const B = this.bodyRows();
		return this.split() ? { w: this.panes().read, rows: Math.max(1, B - 2) } : { w: this.width - 4, rows: B };
	}

	render(width: number): string[] {
		this.width = width;
		const B = this.bodyRows();
		const inner = width - 4;
		if (this.split()) {
			// Render is where the layout becomes known; both calls are no-ops once their data is in hand.
			this.ensureFolders();
			this.schedulePreview();
		}
		const screen = this.split() ? this.splitScreen(B) : this.screen(width, B);
		const bar = (s: string) => this.theme.fg("borderMuted", s);
		const line = (s: string) => `${bar("│ ")}${fit(s, inner)}${bar(" │")}`;
		const title = truncateToWidth(screen.title, Math.max(0, width - 6), "…");
		const fill = "─".repeat(Math.max(0, width - 6 - visibleWidth(title)));
		const body = Array.from({ length: B }, (_, i) => line(screen.lines[screen.top + i] ?? screen.filler));
		const hints = (this.split() ? SPLIT_HINTS[this.mode] : undefined) ?? HINTS[this.mode];
		return [
			`${bar("╭─ ")}${this.theme.fg("accent", title)}${bar(` ─${fill}╮`)}`,
			...body,
			line(this.statusRow()),
			line(this.theme.fg("muted", hints)),
			bar(`╰${"─".repeat(Math.max(0, width - 2))}╯`),
		];
	}

	/** The folder title: its unread count, or the search that filled it. */
	private indexTitle(): string {
		const label = this.folder.label;
		return this.query === undefined ? `${label} (${this.rows.filter((r) => !r.isRead).length} unread)` : `${label} — search: ${this.query}`;
	}

	/** Outlook's layout: folders | messages | reading pane, each under a header that is bright while it has the keys. */
	private splitScreen(B: number): Screen {
		const { folders: fw, list: lw, read: rw } = this.panes();
		const rows = Math.max(1, B - 2);
		const head = (text: string, focused: boolean, w: number) => [
			this.theme.fg(focused ? "accent" : "muted", focused ? this.theme.bold(fit(text, w)) : fit(text, w)),
			this.theme.fg("borderMuted", "─".repeat(w)),
		];
		const reading = this.mode === "pager" ? this.opened : this.previewOf(this.rows[this.sel]);
		const left = [...head("Folders", this.mode === "picker", fw), ...this.folderPane(fw, rows)];
		const mid = [...head("Messages", this.mode === "index" || this.mode === "search", lw), ...this.listPane(lw, rows)];
		const right = [...head(reading?.summary.subject ?? "", this.mode === "pager", rw), ...this.readingPane(reading, rw, rows)];
		const sep = this.theme.fg("borderMuted", SEP);
		const lines = Array.from({ length: B }, (_, i) => `${fit(left[i] ?? "", fw)}${sep}${fit(mid[i] ?? "", lw)}${sep}${fit(right[i] ?? "", rw)}`);
		return { title: this.indexTitle(), lines, top: 0, filler: "" };
	}

	/** Every folder, subfolders indented, unread counts right-aligned; the window follows the highlight or the folder listed. */
	private folderPane(w: number, rows: number): string[] {
		if (this.folderList.length === 0) return [this.theme.fg("dim", "loading…")];
		const focused = this.mode === "picker";
		const at = focused ? this.pickSel : Math.max(0, this.currentFolderIndex());
		if (at < this.pickTop) this.pickTop = at;
		if (at >= this.pickTop + rows) this.pickTop = at - rows + 1;
		return this.folderList.slice(this.pickTop, this.pickTop + rows).map((f, k) => {
			const parts = f.path.split("/");
			const count = f.unread > 0 ? String(f.unread) : "";
			const text = `${fit(`${"  ".repeat(parts.length - 1)}${parts.at(-1)}`, w - count.length - 1)} ${count}`;
			if (k + this.pickTop !== at) return text;
			return focused ? this.theme.bg("selectedBg", fit(text, w)) : this.theme.fg("accent", this.theme.bold(text));
		});
	}

	/** Messages as Outlook lists them: sender and time, subject, preview; unread ones marked and bold. */
	private listPane(w: number, rows: number): string[] {
		if (this.rows.length === 0) return [this.theme.fg("dim", "(no messages)")];
		const fits = Math.max(1, Math.floor(rows / ROW_LINES));
		if (this.sel < this.listTop) this.listTop = this.sel;
		if (this.sel >= this.listTop + fits) this.listTop = this.sel - fits + 1;
		const today = new Date().toDateString();
		const out: string[] = [];
		for (const [k, r] of this.rows.slice(this.listTop, this.listTop + fits).entries()) {
			const at = new Date(r.received);
			const when = at.toDateString() === today ? stamp(r.received, false).slice(6) : stamp(r.received, false).slice(0, 5);
			const sender = r.from ? r.from.name || r.from.address : "";
			const clip = r.hasAttachments ? " 📎" : "";
			const subject = `  ${fit(r.subject, w - 2 - visibleWidth(clip))}${clip}`;
			const lines = [
				`${r.isRead ? "  " : "● "}${fit(sender, w - 3 - when.length)} ${when}`,
				r.isRead ? subject : this.theme.bold(subject),
				this.theme.fg("dim", `  ${r.preview.replace(/\s+/g, " ").trim()}`),
			];
			const selected = k + this.listTop === this.sel;
			out.push(...lines.map((l) => (selected ? this.theme.bg("selectedBg", fit(l, w)) : l)));
		}
		return out;
	}

	/** The message in the reading pane, scrolled only while the pane has the keys; the save list while it is open. */
	private readingPane(msg: Opened | undefined, w: number, rows: number): string[] {
		if (this.mode === "save" && this.opened) return this.saveRows(this.opened, w);
		if (!msg) return this.rows[this.sel] ? [this.theme.fg("dim", "loading…")] : [];
		const lines = this.pagerRows(msg, w);
		if (this.mode !== "pager") return lines.slice(0, rows);
		this.pagerTop = Math.min(this.pagerTop, Math.max(0, lines.length - rows));
		return lines.slice(this.pagerTop, this.pagerTop + rows);
	}

	/** What `s` offers for `p`: every attachment, then every SharePoint/OneDrive file the body links to. */
	private saveItems(p: Opened): SaveItem[] {
		return [
			...p.mail.attachments.map((attachment): SaveItem => ({ kind: "attachment", attachment })),
			...sharedLinks(p.markdown).map((link): SaveItem => ({ kind: "link", link })),
		];
	}

	/** The save list, one line an item, the highlighted one selected. */
	private saveRows(p: Opened, w: number): string[] {
		return [
			this.theme.fg("dim", "Save which file? (to ~/Downloads, never overwriting)"),
			"",
			...this.saveItems(p).map((item, i) => {
				const text = fit(
					item.kind === "attachment"
						? `📎 ${item.attachment.filename} · ${item.attachment.mimeType} · ${(item.attachment.size / 1024).toFixed(0)} KB`
						: `🔗 ${item.link.text} · SharePoint/OneDrive`,
					w,
				);
				return i === this.saveSel ? this.theme.bg("selectedBg", text) : text;
			}),
		];
	}

	private saveKey(data: string): void {
		const p = this.opened;
		if (!p) return;
		const items = this.saveItems(p);
		if (data === "j" || matchesKey(data, Key.down)) this.saveSel = Math.min(this.saveSel + 1, items.length - 1);
		else if (data === "k" || matchesKey(data, Key.up)) this.saveSel = Math.max(0, this.saveSel - 1);
		else if (data === "q" || matchesKey(data, Key.escape) || matchesKey(data, Key.left)) this.mode = "pager";
		else if (matchesKey(data, Key.enter)) {
			const item = items[this.saveSel];
			if (!item) return;
			this.run(async () => {
				const at =
					item.kind === "attachment"
						? await this.deps.saveAttachment(item.attachment)
						: isShared(item.link.url)
							? await this.deps.saveLink(item.link.url)
							: "";
				this.status = `saved to ${at}`;
			}, "saving…");
		}
	}

	invalidate(): void {
		this.pagerCache = undefined;
	}

	private screen(width: number, B: number): Screen {
		const inner = width - 4;
		if (this.mode === "picker") {
			if (this.pickSel < this.pickTop) this.pickTop = this.pickSel;
			if (this.pickSel >= this.pickTop + B) this.pickTop = this.pickSel - B + 1;
			// A subfolder is indented under its parent; the unread count shows when there is one.
			const lines = this.folderList.map((f, i) => {
				const depth = f.path.split("/").length - 1;
				const unread = f.unread > 0 ? `  (${f.unread})` : "";
				const text = fit(`  ${"  ".repeat(depth)}${f.path.split("/").pop()}${unread}`, inner);
				return i === this.pickSel ? this.theme.bg("selectedBg", text) : text;
			});
			return { title: "Folders", lines, top: this.pickTop, filler: "" };
		}
		// Pager and compose are documents, so rows past their end read as mutt's `~`; the glyph also keeps them from looking like a field's continuation rows.
		if (this.mode === "save" && this.opened) {
			return { title: `Save from: ${this.opened.summary.subject}`, lines: this.saveRows(this.opened, inner), top: 0, filler: "" };
		}
		if (this.mode === "pager" && this.opened) {
			const lines = this.pagerRows(this.opened, inner);
			this.pagerTop = Math.min(this.pagerTop, Math.max(0, lines.length - B));
			return { title: this.opened.summary.subject, lines, top: this.pagerTop, filler: this.theme.fg("muted", "~") };
		}
		const c = this.compose;
		if (c) {
			const { lines, caret } = this.composeRows(c, inner);
			const top = Math.max(0, Math.min(caret - B + 1, lines.length - B));
			return { title: TITLES[c.base.kind], lines, top, filler: this.theme.fg("muted", "~") };
		}
		const title = this.indexTitle();
		const lines = this.indexRows(inner, B);
		return { title, lines, top: this.listTop, filler: "" };
	}

	/** The index's rows. The window follows the highlight and scrolls only when the highlight leaves it. */
	private indexRows(inner: number, B: number): string[] {
		if (this.sel < this.listTop) this.listTop = this.sel;
		if (this.sel >= this.listTop + B) this.listTop = this.sel - B + 1;
		if (this.rows.length === 0) return [this.theme.fg("dim", "(no messages)")];
		return this.rows.map((r, i) => {
			const text = fit(this.rowText(r, inner), inner);
			return i === this.sel ? this.theme.bg("selectedBg", text) : text;
		});
	}

	/** Unread dot, date, sender (16 columns), subject, and a paperclip when the message has attachments. */
	private rowText(r: Summary, inner: number): string {
		const sender = r.from ? r.from.name || r.from.address : "";
		const clip = r.hasAttachments ? "  📎" : "";
		const head = `${r.isRead ? "  " : "● "}${stamp(r.received, false)}  ${fit(sender, 16)}  `;
		return `${head}${fit(r.subject, inner - visibleWidth(head) - visibleWidth(clip))}${clip}`;
	}

	/**
	 * The message as lines `inner` columns wide: headers, a blank, then the body with its colours.
	 * Picture descriptions show for the message they were asked for; a preview shows the bare labels.
	 */
	private pagerRows(p: Opened, inner: number): string[] {
		const key = `${p.summary.id}\n${inner}`;
		if (this.pagerCache?.key === key) return this.pagerCache.lines;
		const headers: [string, string][] = [
			["From", who(p.summary.from)],
			["To", listed(p.mail.to)],
			["Cc", listed(p.mail.cc)],
			["Date", stamp(p.summary.received, true)],
			["Subject", p.summary.subject],
		];
		const head = headers.flatMap(([k, v]) => wrapTextWithAnsi(`${k}: ${v}`, inner));
		// A picture reads as its label, then what the model saw in it once that is known.
		const mine = this.describedId === p.summary.id;
		const seen = (label: string) => {
			if (!mine) return label;
			const text = this.described.get(label);
			return text ? `${label} — ${text}` : `${label} — describing…`;
		};
		const pictured = p.images.reduce((md, { label }) => md.split(`[${label}]`).join(`[${seen(label)}]`), p.markdown);
		// Tone spans become theme colours, so the Markdown renderer lays them out like any other text.
		const painted = pictured.replace(TONE_SPAN, (_all, text: string, tone: Tone) => this.theme.fg(TONE_COLOR[tone], text));
		const body = dropBlankTableHeaders(new Markdown(painted, 0, 0, this.md).render(inner));
		// Attachments the body does not show, a picture among them with its description.
		const shown = new Set(p.images.filter(({ label }) => p.markdown.includes(`[${label}]`)).map((m) => m.image));
		const files = p.mail.attachments
			.filter((a) => !shown.has(a))
			.flatMap((a) => {
				const pic = p.images.find((m) => m.image === a);
				return wrapTextWithAnsi(`📎 ${a.filename} · ${a.mimeType}${pic ? ` · ${seen(pic.label)}` : ""}`, inner);
			});
		const lines = [...head, "", ...body, ...(files.length > 0 ? ["", "Attachments:", ...files] : [])];
		this.pagerCache = { key, lines };
		return lines;
	}

	/** The compose screen's lines, and the index of the line holding the caret. */
	private composeRows(c: Compose, inner: number): { lines: string[]; caret: number } {
		// One cell is kept back, so a full row still has room for the caret.
		const cw = Math.max(1, inner - LABEL_W - 1);
		const lines: string[] = [];
		let caret = 0;
		for (const f of FIELDS) {
			const rows = wrapPlain(c[f], cw);
			rows.forEach((text, i) => {
				const label = i === 0 ? LABELS[f] : " ".repeat(LABEL_W);
				const atCaret = i === rows.length - 1 && f === c.focus;
				if (atCaret) caret = lines.length;
				lines.push(`${label}${text}${atCaret ? CARET : ""}`);
			});
		}
		// The signature goes out under the body, so it shows there, read-only and dim.
		const signature = this.deps.signature();
		if (signature) lines.push("", ...signature.split("\n").flatMap((l) => wrapPlain(l, inner)).map((l) => this.theme.fg("dim", l)));
		if (c.base.quote) lines.push(...this.quoteRows(c.base.quote, inner));
		return { lines, caret };
	}

	/** The original under the body, read-only: Outlook's separator lines (quoteFields), then the body quoted with "> ". */
	private quoteRows(q: ParsedMail, inner: number): string[] {
		const head = quoteFields(q).map(([k, v]) => `${k}: ${v}`);
		// The body the pager shows (Mailbox.read): the HTML as Markdown when there is HTML, else the text.
		const text = (q.html ? htmlToMarkdown(q.html) : (q.text ?? "")).trimEnd();
		const quoted = text ? text.split("\n").map((l) => `> ${l}`) : [];
		const rows = [...head, "", ...quoted].flatMap((l) => wrapPlain(l, inner));
		return [this.theme.fg("dim", "─".repeat(inner)), ...rows.map((l) => this.theme.fg("dim", l))];
	}

	/** The status line: a confirmation prompt, the search prompt, or the last status, in error colour when it failed. */
	private statusRow(): string {
		if (this.mode === "confirm-send") return "Send? (y/n)";
		if (this.mode === "confirm-discard") return "Discard draft? (y/n)";
		if (this.mode === "search" && this.status === "") return `/${this.searchText}${CARET}`;
		if (this.status === "") return "";
		return this.statusError ? this.theme.fg("error", this.status) : this.status;
	}

	// ── Tern layer (core/tern-native.ts) ─────────────────────────────────
	// The same state, described as Tern nodes. Only omp in a Tern pane calls this; keys still go through handleInput.

	/** The sheet's title: what the row view's frame title says for the same screen. */
	private nativeTitle(): string {
		if (this.mode === "save" && this.opened) return `Save from: ${this.opened.summary.subject}`;
		if (this.compose) return TITLES[this.compose.base.kind];
		if (this.mode === "pager" && this.opened && !this.wide()) return this.opened.summary.subject;
		if (this.mode === "picker" && !this.wide()) return "Folders";
		return this.indexTitle();
	}

	/** Three panes in Tern: the pane is wide enough and no draft has the screen (the row view's `split()`, on Tern's width). */
	private wide(): boolean {
		return (this.tui.terminal?.columns ?? this.width) >= SPLIT_MIN && !this.compose;
	}

	/** A message's headers, body (Markdown, pictures described) and attachments, as the pager shows them. */
	private nativeMessage(p: Opened): tn.NativeNode[] {
		const mine = this.describedId === p.summary.id;
		const seen = (label: string) => {
			if (!mine) return label;
			const text = this.described.get(label);
			return text ? `${label} — ${text}` : `${label} — describing…`;
		};
		const head: [string, string][] = [
			["From", who(p.summary.from)],
			["To", listed(p.mail.to)],
			["Cc", listed(p.mail.cc)],
			["Date", stamp(p.summary.received, true)],
		];
		const pictured = p.images.reduce((md, { label }) => md.split(`[${label}]`).join(`[${seen(label)}]`), p.markdown);
		// Tone spans (`[text]{.ok}`) are this package's Markdown dialect; Tern's reads them as text, so keep the text.
		const plain = pictured.replace(TONE_SPAN, (_all, text: string) => text);
		const shown = new Set(p.images.filter(({ label }) => p.markdown.includes(`[${label}]`)).map((m) => m.image));
		const files = p.mail.attachments
			.filter((a) => !shown.has(a))
			.map((a, i) => {
				const pic = p.images.find((m) => m.image === a);
				return tn.text([tn.span(`📎 ${a.filename} · ${a.mimeType}${pic ? ` · ${seen(pic.label)}` : ""}`, "warning")], { wrap: "word" }, `att${i}`);
			});
		return [
			tn.text([tn.span(p.summary.subject, "strong")], { wrap: "word" }, "subject"),
			tn.node("kv", { items: head.filter(([, v]) => v !== "").map(([k, v]) => ({ k: [tn.span(k, "muted")], v })) }, undefined, "headers"),
			tn.node("rule", {}, undefined, "rule"),
			tn.md(tn.mdNoMath(plain), "body"),
			...files,
		];
	}

	private messageItems(): tn.NativeNode[] {
		const today = new Date().toDateString();
		return this.rows.map((r, i) => {
			const when = new Date(r.received).toDateString() === today ? stamp(r.received, false).slice(6) : stamp(r.received, false).slice(0, 5);
			const sender = r.from ? r.from.name || r.from.address : "";
			return tn.item(`m${i}`, {
				label: r.isRead ? sender : [tn.span(sender, "strong")],
				detail: [tn.span(r.subject, r.isRead ? "" : "strong"), tn.span(`  ${r.preview.replace(/\s+/g, " ").trim()}`, "muted")],
				value: [tn.span(`${r.hasAttachments ? "📎 " : ""}${when}`, "dim")],
				tone: r.isRead ? undefined : "warning",
			});
		});
	}

	private folderItems(): tn.NativeNode[] {
		return this.folderList.map((f, i) => {
			const parts = f.path.split("/");
			return tn.item(`f${i}`, {
				label: `${"  ".repeat(parts.length - 1)}${parts.at(-1)}`,
				value: f.unread > 0 ? [tn.span(String(f.unread), "accent")] : undefined,
			});
		});
	}

	private saveNodes(p: Opened): tn.NativeNode[] {
		const items = this.saveItems(p).map((item, i) =>
			tn.item(`s${i}`, {
				label: item.kind === "attachment" ? `📎 ${item.attachment.filename}` : `🔗 ${item.link.text}`,
				detail:
					item.kind === "attachment"
						? [tn.span(`${item.attachment.mimeType} · ${(item.attachment.size / 1024).toFixed(0)} KB`, "muted")]
						: [tn.span("SharePoint/OneDrive", "muted")],
			}),
		);
		return [
			tn.text([tn.span("Save which file? (to ~/Downloads, never overwriting)", "dim")], undefined, "save-head"),
			tn.selectList("save", items, items.length > 0 ? `s${this.saveSel}` : null, { grow: 1, min: { h: 0 } }),
		];
	}

	/** The draft's fields: the focused one is a native field (Tern focuses it), the others its text. */
	private composeNodes(c: Compose): tn.NativeNode[] {
		const out: tn.NativeNode[] = FIELDS.map((f) => {
			const label = tn.text([tn.span(LABELS[f].trim(), c.focus === f ? "accent strong" : "muted")], { wrap: "none", min: { w: `${LABEL_W}ch` } });
			const value = c[f];
			const field =
				c.focus !== f
					? tn.text(value || " ", { wrap: "word", grow: 1 })
					: f === "body"
						? tn.editor(value, value.length, { placeholder: "write the message (Markdown)", maxLines: 12 }, "field")
						: tn.input(value, value.length, { placeholder: f === "subject" ? "subject" : "addresses, separated by , or ;" }, "field");
			return tn.row([label, { ...field, p: { ...field.p, grow: 1 } }], { gap: "sm", align: "start" }, f);
		});
		const signature = this.deps.signature();
		if (signature) out.push(tn.text([tn.span(signature, "dim")], { wrap: "word" }, "signature"));
		const q = c.base.quote;
		if (q) {
			const head = quoteFields(q).map(([k, v]) => `${k}: ${v}`).join("\n");
			const text = (q.html ? htmlToMarkdown(q.html) : (q.text ?? "")).trimEnd();
			out.push(tn.node("rule", {}, undefined, "quote-rule"), tn.text([tn.span(head, "dim")], { wrap: "word" }, "quote-head"));
			if (text) out.push(tn.text([tn.span(text.split("\n").map((l) => `> ${l}`).join("\n"), "dim")], { wrap: "word" }, "quote"));
		}
		return out;
	}

	/** The keycaps under the panes: the keys HINTS and SPLIT_HINTS name for this mode. */
	private hintNodes(): tn.NativeNode {
		const h = (keys: string[], label: string) => ({ keys, label });
		const wide = this.wide();
		const byMode: Record<Mode, { keys: string[]; label: string }[]> = {
			index: [
				h(["up", "down"], "move"), h(["enter"], "read"), ...(wide ? [h(["left"], "folders")] : [h(["c"], "folders")]), h(["/"], "search"),
				h(["m"], "new"), h(["r"], "reply"), h(["g"], "reply all"), h(["f"], "forward"), h(["a"], "archive"), h(["d"], "delete"),
				h(["N"], "read/unread"), h(["escape"], "close"),
			],
			search: [h(["enter"], "search"), h(["escape"], "back to folder")],
			picker: [h(["up", "down"], "move"), h(["enter"], "open folder"), h(["escape"], wide ? "messages" : "back")],
			pager: [
				h(["up", "down"], "line"), h(["pageUp", "pageDown"], "page"), h(["s"], "save files"), h(["r"], "reply"), h(["g"], "reply all"),
				h(["f"], "forward"), h(["escape"], wide ? "messages" : "back"),
			],
			save: [h(["up", "down"], "move"), h(["enter"], "save to ~/Downloads"), h(["escape"], "back")],
			compose: [h(["tab"], "next field"), h(["ctrl+s"], "send"), h(["ctrl+p"], "save draft"), h(["escape"], "discard")],
			"confirm-send": [h(["y"], "send now"), h(["n"], "keep editing")],
			"confirm-discard": [h(["y"], "discard"), h(["n"], "keep editing")],
		};
		return tn.hints(byMode[this.mode]);
	}

	describe(cx: tn.DescribeContext): tn.NativeNode | null {
		if (!cx.supports("list") || !cx.supports("md") || !cx.supports("input")) return null;
		const wide = this.wide();
		if (wide) {
			// What render() does once the layout is known: the folders pane and the preview of the highlight.
			this.ensureFolders();
			this.schedulePreview();
		}
		const reading = this.mode === "pager" || this.mode === "save" ? this.opened : this.previewOf(this.rows[this.sel]);
		const c = this.compose;
		const sig = [
			this.mode, wide, this.folder.id, this.rows.length, this.rows.map((r) => (r.isRead ? 1 : 0)).join(""), this.query ?? "", this.sel,
			this.pickSel, this.saveSel, this.searchText, this.status, this.statusError, this.busy, this.folderList.length,
			this.folderList.map((f) => f.unread).join(), reading?.summary.id ?? "", [...this.described.values()].join("\u0001"),
			this.describedId ?? "", c ? `${c.focus}\u0001${c.to}\u0001${c.cc}\u0001${c.subject}\u0001${c.body}` : "", this.nativeScroll.n,
			this.previews.size,
			// The pane heights below come from the terminal's rows: a resize must rebuild the tree.
			this.tui.terminal?.rows ?? 24,
		].join("\u0000");
		return this.describeMemo(sig, () => {
			// The sheet's body does not hand its height down: the panes get one, the terminal less head, status and hints.
			const paneLines = Math.max(6, (this.tui.terminal?.rows ?? 24) - 9);
			const listRows = Math.max(3, Math.floor((paneLines - 2) / 2));
			const fill = { grow: 1, min: { h: 0 } };
			const heading = (label: string, on: boolean, key: string) =>
				tn.text([tn.span(label, on ? "accent strong" : "muted")], { truncate: "end" }, key);
			const messageList = tn.selectList("messages", this.messageItems(), this.rows.length > 0 ? `m${this.sel}` : null, {
				...fill,
				max: { lines: listRows },
				empty: this.busy ? "loading…" : "(no messages)",
			});
			const searchField =
				this.mode === "search" ? [tn.input(this.searchText, this.searchText.length, { placeholder: "search mail, enter to run", prompt: "/" }, "search")] : [];
			const readingPane = (msg: Opened | undefined): tn.NativeNode =>
				({
					...tn.col(
						msg ? this.nativeMessage(msg) : [tn.text([tn.span(this.rows[this.sel] ? "loading…" : "", "dim")], undefined, "empty")],
						{ gap: "sm", ...fill, max: { h: `${paneLines - 1}lines` } },
						"reading",
					),
					scroll: this.nativeScroll,
				});
			let panes: tn.NativeNode[];
			if (c) {
				panes = [tn.col(this.composeNodes(c), { gap: "sm", ...fill }, "compose")];
			} else if (this.mode === "save" && this.opened) {
				panes = [tn.col(this.saveNodes(this.opened), { gap: "sm", ...fill }, "save")];
			} else if (wide) {
				panes = [
					tn.col(
						[heading("Folders", this.mode === "picker", "head"), tn.selectList("folders", this.folderItems(), this.folderList.length > 0 ? `f${this.mode === "picker" ? this.pickSel : Math.max(0, this.currentFolderIndex())}` : null, { ...fill, max: { lines: listRows }, empty: "loading…" })],
						{ gap: "sm", basis: 0.16, shrink: 0, min: { w: "18ch", h: 0 }, max: { w: "32ch" } },
						"folders",
					),
					tn.col(
						[heading("Messages", this.mode === "index" || this.mode === "search", "head"), ...searchField, messageList],
						{ gap: "sm", basis: 0.32, shrink: 0, min: { w: "36ch", h: 0 }, max: { w: "64ch" } },
						"list",
					),
					tn.col([readingPane(reading)], { gap: "sm", grow: 1, min: { w: 0, h: 0 } }, "read"),
				];
			} else if (this.mode === "picker") {
				panes = [tn.col([tn.selectList("folders", this.folderItems(), this.folderList.length > 0 ? `f${this.pickSel}` : null, { ...fill, max: { lines: listRows } })], { ...fill }, "folders")];
			} else if (this.mode === "pager" && this.opened) {
				panes = [readingPane(this.opened)];
			} else {
				panes = [tn.col([...searchField, messageList], { gap: "sm", ...fill }, "list")];
			}
			const prompt = this.mode === "confirm-send" ? "Send?" : this.mode === "confirm-discard" ? "Discard draft?" : undefined;
			const statusNode = prompt
				? tn.row([tn.text([tn.span(prompt, "warning strong")]), tn.button("Yes", "yes", "y"), tn.button("No", "no", "n")], { gap: "md", align: "center" }, "status")
				: tn.text(this.status ? [tn.span(this.status, this.statusError ? "error" : "accent")] : " ", { truncate: "end" }, "status");
			return tn.col(
				[
					tn.row(panes, { gap: "md", align: "stretch", min: { h: `${paneLines}lines` }, max: { h: `${paneLines}lines` } }, "split"),
					statusNode,
					this.hintNodes(),
				],
				{ gap: "sm", grow: 1 },
			);
		});
	}

	/** Pointer actions on the described nodes, routed to the paths the matching keys take. */
	handleNativeEvent(event: tn.NativeUiEvent): void {
		if (this.busy) return;
		if ((event.type === "select" || event.type === "activate") && "item" in event) {
			const i = Number.parseInt(event.item.slice(1), 10);
			if (!Number.isFinite(i)) return;
			const kind = event.item[0];
			if (kind === "m") {
				this.sel = i;
				if (this.mode === "picker" || this.mode === "pager") this.mode = "index";
				if (event.type === "activate" && this.rows[i]) this.openRow(this.rows[i]);
			} else if (kind === "f") {
				this.pickSel = i;
				this.mode = "picker";
				if (event.type === "activate") this.pickerKey("\r");
			} else if (kind === "s") {
				this.saveSel = i;
				if (event.type === "activate") this.saveKey("\r");
			}
		} else if (event.type === "action" && "act" in event) {
			if (this.mode === "confirm-send") this.confirmSendKey(event.act === "yes" ? "y" : "n");
			else if (this.mode === "confirm-discard") this.confirmDiscardKey(event.act === "yes" ? "y" : "n");
		} else if (event.type === "edit" && "from" in event) {
			const c = this.compose;
			const current = this.mode === "search" ? this.searchText : c ? c[c.focus] : undefined;
			if (current === undefined || event.len !== current.length) return;
			const next = current.slice(0, event.from) + event.text + current.slice(event.to);
			if (this.mode === "search") this.searchText = next.replace(/\n/g, " ");
			else if (c) c[c.focus] = c.focus === "body" ? next : next.replace(/\n/g, " ");
		}
		this.tui.requestRender();
	}
}

/** Opens the overlay. The promise resolves when the user quits it with q. */
export function openOutlookOverlay(ctx: ExtensionContext, deps: OverlayDeps): Promise<void> {
	return ctx.ui.custom<void>(
		(tui: TUI, theme: Theme, _keybindings, done) => new OutlookOverlay(tui, theme, deps, () => done()),
		{ overlay: true, overlayOptions: { width: "96%", maxHeight: "85%", anchor: "center", margin: 1 } },
	);
}
