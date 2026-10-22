/**
 * The Backend implemented against Microsoft Graph, no subprocess.
 *
 * Rules ported from fetch_teams.py rather than rederived from the Graph docs.
 * Each one is a debugged behaviour, and losing it would be a regression nobody
 * notices until a message goes missing:
 *
 *   - hidden chats, deleted previews, system events and non-`message` types are
 *     not unread activity;
 *   - a never-read chat only counts if it is recent, or every meeting thread
 *     ever joined stays unread forever;
 *   - throttling serves the previous scan marked stale, because "0 unread" and
 *     "I could not ask" must not render identically.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tokenClaim } from "../core/auth.ts";
import { GraphError, type GraphClient } from "../core/graph.ts";
import { colleagueId, type Person, searchPeople } from "../core/people.ts";
import { type DownloadedFile, downloadShared } from "../core/shares.ts";
import type { Backend, ChatAddr, ChatHistoryPage, SelfHistoryPage, SelfMessage, UnreadItem, UnreadPayload } from "./backend.ts";
import { HISTORY_MESSAGES, type ChatRef, type ChatsPage, type HistoryMessage, type SendTarget } from "./compose-overlay.ts";
import { escapeHtml, htmlToText } from "./html.ts";
import { htmlToMarkdown } from "./markdown.ts";
import { fillMentions, type Mention, type ResolvedMention } from "./mentions.ts";
import { cursorPages } from "./paging.ts";
import type { SkypeClient } from "./skype.ts";

/** Raw shapes, only the fields used here. */
interface RawMember {
	displayName?: string;
	email?: string;
}
interface RawPreview {
	id?: string;
	createdDateTime?: string;
	isDeleted?: boolean;
	messageType?: string;
	eventDetail?: unknown;
	from?: { user?: { displayName?: string } };
	body?: { contentType?: string; content?: string };
}

/**
 * The directory id behind each mention: one lookup per distinct address (core/people.ts).
 * An address that is not a colleague refuses the whole message.
 */
export async function resolveMentions(graph: GraphClient, mentions: readonly Mention[]): Promise<ResolvedMention[]> {
	const oids = new Map<string, string>();
	const out: ResolvedMention[] = [];
	for (const m of mentions) {
		const key = m.email.toLowerCase();
		let oid = oids.get(key);
		if (oid === undefined) {
			oid = await colleagueId(graph, m.email);
			oids.set(key, oid);
		}
		out.push({ ...m, oid });
	}
	return out;
}

interface RawMessage {
	id?: string;
	createdDateTime?: string;
	messageType?: string;
	from?: { user?: { displayName?: string }; application?: { displayName?: string } } | null;
	body?: { contentType?: string; content?: string };
	mentions?: { mentioned?: { user?: { displayName?: string } }; mentionText?: string }[];
	attachments?: { id?: string | number; contentType?: string; name?: string; contentUrl?: string; content?: string }[];
}

interface RawChat {
	id: string;
	topic?: string | null;
	chatType?: string;
	viewpoint?: { isHidden?: boolean; lastMessageReadDateTime?: string };
	members?: RawMember[];
	lastMessagePreview?: RawPreview | null;
}

/** A chat list page holds this many chats: Graph's cap for chats. */
const CHAT_PAGE = 50;
/** A walk over a conversation's messages asks for pages this size. */
const MESSAGE_PAGE = 50;
/** The first chat page orders by activity. Some tenants refuse that ordering, and get the plain query instead. */
const CHATS_ORDERED = `/me/chats?$top=${CHAT_PAGE}&$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime desc`;
const CHATS_PLAIN = `/me/chats?$top=${CHAT_PAGE}&$expand=members,lastMessagePreview`;

/** One page of `/me/chats`. */
interface ChatsResponse {
	value?: RawChat[];
	"@odata.nextLink"?: string;
}

/** One page of `/chats/{id}/messages`, newest first. */
interface MessagesResponse {
	value?: RawMessage[];
	"@odata.nextLink"?: string;
}

/** Human-friendly name: topic, else every member's display name. */
export function chatLabel(chat: RawChat): string {
	if (chat.topic) return chat.topic;
	const names = (chat.members ?? []).map((m) => m.displayName).filter((n): n is string => Boolean(n));
	return names.length > 0 ? names.join(", ") : (chat.chatType ?? "chat");
}

/**
 * chatLabel minus myself, for pickers.
 *
 * Dropped by display name, never by splitting the joined label on commas: a
 * display name contains one ("Family, Given (Nickname)").
 */
export function peerLabel(chat: RawChat, myName: string): string {
	if (chat.chatType !== "oneOnOne" || !myName) return chatLabel(chat);
	const names = (chat.members ?? [])
		.map((m) => m.displayName)
		.filter((n): n is string => !!n && n.toLowerCase() !== myName.toLowerCase());
	return names.length > 0 ? names.join(", ") : chatLabel(chat);
}

/**
 * The last message as one line for the chat list: "" for a deleted message, a system event, or nothing but whitespace.
 * In a group the preview names its sender, so the list says who spoke; in a one-to-one the row already names them.
 */
export function previewText(p: RawPreview | null | undefined, myName: string, chatType: string): string {
	if (!p || p.isDeleted || p.eventDetail || (p.messageType ?? "message") !== "message") return "";
	const body = p.body ?? {};
	const raw = body.contentType === "html" ? htmlToText(body.content ?? "") : (body.content ?? "").trim();
	const flat = raw.replace(/\s+/g, " ").trim();
	if (!flat) return "";
	const who = p.from?.user?.displayName ?? "";
	const mine = myName !== "" && who.toLowerCase().includes(myName.toLowerCase());
	const prefix = mine ? "me: " : who !== "" && chatType !== "oneOnOne" ? `${who}: ` : "";
	return `${prefix}${flat}`.slice(0, 200);
}

/** A chat as the picker and the tools see it. */
export function chatRef(c: RawChat, myName: string): ChatRef {
	const last = c.lastMessagePreview;
	return {
		id: c.id,
		label: chatLabel(c),
		display: peerLabel(c, myName),
		chat_type: c.chatType ?? "",
		// Emails let a picker match a searched person to an existing chat by identity instead of by display-name string.
		emails: [...new Set((c.members ?? []).map((m) => (m.email ?? "").toLowerCase()).filter(Boolean))].sort(),
		preview: previewText(last, myName, c.chatType ?? ""),
		...(last?.createdDateTime ? { last_at: last.createdDateTime } : {}),
	};
}

/** Order-independent identities for a chat: Graph does not guarantee member
  * order, so the comma-joined label alone is not a stable key. */
function chatKeys(c: { label: string; display?: string }): string[] {
	return [c.label];
}

function sortedKey(s: string): string {
	return s
		.split(",")
		.map((p) => p.trim())
		.sort()
		.join(", ")
		.toLowerCase();
}

/**
 * Resolve a name to exactly one item, or refuse.
 *
 * Ambiguity is fatal by design. Ported from _match_one, and used for teams and
 * channels as well as chats: every one of them can be addressed by a substring
 * a human typed.
 */
export function matchOne<T extends { label: string }>(items: T[], query: string, kind: string): T {
	const q = query.trim().toLowerCase();
	const exact = items.filter((i) => i.label.toLowerCase() === q);
	if (exact.length === 1) return exact[0];
	const hits = exact.length > 0 ? exact : items.filter((i) => i.label.toLowerCase().includes(q));
	if (hits.length === 0) throw new Error(`No ${kind} matches '${query}'.`);
	if (hits.length === 1) return hits[0];
	throw new Error(
		`Ambiguous ${kind}: '${query}' matches ${hits.length}:\n${hits.map((x) => `  - ${x.label}`).join("\n")}\nRefusing to guess. Use the full name exactly.`,
	);
}

/**
 * Resolve a name to exactly one chat, or refuse.
 *
 * Ambiguity is fatal by design: silently taking the first hit is how a message
 * meant for one person lands in a group chat. Ported from _find_chat/_match_one.
 */
export function findChat<T extends { label: string; display?: string }>(chats: T[], query: string): T {
	const want = sortedKey(query);
	const exactSet = chats.filter((c) => chatKeys(c).some((k) => sortedKey(k) === want));
	if (exactSet.length === 1) return exactSet[0];

	return matchOne(chats, query, "chat");
}

/** Ported from msg_sender: a message can come from a person, an app, or neither. */
export function msgSender(m: RawMessage): string {
	const user = m.from?.user;
	if (user?.displayName) return user.displayName;
	const app = m.from?.application;
	if (app?.displayName) return `${app.displayName} (app)`;
	return "(system)";
}

/**
 * The flat text, and ONLY the text.
 *
 * Files are deliberately not named here. `text` is what the digests, the stored
 * knowledge files and every grep over them see, and it stays byte-identical to
 * the Python path -- live parity measured the cost of not doing so: every
 * message carrying both a comment and a file diverged. The file lives in the
 * structured `files` field, and every surface that shows messages renders it
 * from there: teams_read prints a line per file, the pane draws its own row.
 */
export function msgText(m: RawMessage): string {
	const body = m.body ?? {};
	return body.contentType === "html" ? htmlToText(body.content ?? "") : (body.content ?? "").trim();
}

/**
 * hostedContents URLs referenced by a message.
 *
 * htmlToText flattens <img> to "[image]", which is right for text but drops the
 * address. These URLs need the bearer token, so only the extension can fetch them.
 */
export function msgImages(m: RawMessage): string[] {
	const body = m.body ?? {};
	if (body.contentType !== "html") return [];
	return [...(body.content ?? "").matchAll(/<img[^>]+src="([^"]+)"/g)].map((x) => x[1]);
}

/**
 * Joins, renames, reaction-only rows: not messages, and blank in a pane.
 *
 * A message carrying an attachment is NEVER empty, whatever its text strips to.
 * A file-only message's body is just `<attachment id="...">`, which flattens to
 * "" -- so a 10 MB log someone shared showed up as nothing at all. The same trap
 * was fixed for images long ago by rendering <img> as "[image]"; files never
 * got it.
 */
export function isEmptyEvent(m: RawMessage): boolean {
	if (m.messageType && m.messageType !== "message") return true;
	if ((m.attachments ?? []).length > 0) return false;
	return !msgText(m);
}

/**
 * The downloadable files in a message.
 *
 * Only attachments with a contentUrl: a reply or a forward is also an
 * <attachment>, and offering its (absent) URL to a downloader would be a lie.
 */
export function msgFiles(m: RawMessage): { name: string; url: string }[] {
	return (m.attachments ?? [])
		.filter((a) => Boolean(a.contentUrl))
		.map((a) => ({ name: a.name || "attachment", url: a.contentUrl as string }));
}

/** `myName` arrives already lowercased, as in the Python. */
export function mentionsMe(m: RawMessage, myName: string): boolean {
	if (!myName) return false;
	for (const mn of m.mentions ?? []) {
		if ((mn.mentioned?.user?.displayName ?? "").toLowerCase().includes(myName)) return true;
		if ((mn.mentionText ?? "").toLowerCase().includes(myName)) return true;
	}
	return false;
}

function cacheDir(): string {
	return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi");
}

/** Same file the Python path uses: several pi sessions polling at once should
  * cost one Graph call between them, whichever backend they run. */
function unreadCachePath(): string {
	return path.join(cacheDir(), "teams-unread.json");
}

interface CachedScan extends UnreadPayload {
	fetched_at: string;
	error?: string;
}

export class GraphBackend implements Backend {
	constructor(
		private readonly graph: GraphClient,
		private readonly opts: { whoami: () => Promise<string>; skype?: SkypeClient },
	) {}

	/**
	 * My own display name, from the signed-in account.
	 *
	 * A resolver rather than a string: the name comes from the auth cache, which
	 * is only readable after sign-in, and hardcoding a real person's name in
	 * source is exactly what this replaced. Resolved once per process -- it
	 * decides label, `mine` and mention colouring on every message.
	 */
	private myNameCache?: string;
	private async myName(): Promise<string> {
		if (this.myNameCache === undefined) this.myNameCache = await this.opts.whoami();
		return this.myNameCache;
	}

	/**
	 * The self-chat client, or a loud refusal.
	 *
	 * Injected rather than constructed here: it needs a token for a DIFFERENT
	 * scope (api.spaces.skype.com), and a backend that quietly built its own
	 * would hide which credential a failure came from.
	 */
	private requireSkype(): SkypeClient {
		if (!this.opts.skype)
			throw new Error("self-chat (48:notes) needs the chatsvc client; none was configured for this backend");
		return this.opts.skype;
	}

	// ── Unread ──────────────────────────────────────────────────────────────

	private readCache(): CachedScan | null {
		const p = unreadCachePath();
		if (!fs.existsSync(p)) return null;
		try {
			return JSON.parse(fs.readFileSync(p, "utf8")) as CachedScan;
		} catch (e) {
			// Refetch, but say so: a silently discarded cache turns into a Graph
			// call on every poll from every session, which is how you get 429s.
			console.warn(`[teams] unread cache unreadable, refetching: ${e}`);
			return null;
		}
	}

	private writeCache(payload: CachedScan): void {
		fs.mkdirSync(cacheDir(), { recursive: true });
		fs.writeFileSync(unreadCachePath(), JSON.stringify(payload));
	}

	async unread(maxAgeSec: number): Promise<UnreadPayload> {
		const cached = this.readCache();
		if (maxAgeSec > 0 && cached) {
			const age = (Date.now() - Date.parse(cached.fetched_at)) / 1000;
			if (age < maxAgeSec) return cached;
		}

		let items: UnreadItem[];
		try {
			items = await this.scanUnread();
		} catch (e) {
			// Throttling is normal here. Serve the last good scan rather than
			// blanking the indicator, but say loudly that it is stale.
			if (e instanceof GraphError && cached) {
				const stale = { ...cached, stale: true, error: e.message.slice(0, 200) };
				return stale;
			}
			throw e;
		}

		const payload: CachedScan = {
			fetched_at: new Date().toISOString(),
			unread_chats: items.length,
			items,
			stale: false,
		};
		this.writeCache(payload);
		return payload;
	}

	private async scanUnread(): Promise<UnreadItem[]> {
		const data = await this.graph.get<{ value?: RawChat[] }>(
			"/me/chats?$top=50&$expand=members,lastMessagePreview",
		);
		const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const out: UnreadItem[] = [];

		for (const chat of data.value ?? []) {
			const vp = chat.viewpoint ?? {};
			if (vp.isHidden) continue;

			const prev = chat.lastMessagePreview;
			if (!prev) continue;
			const created = prev.createdDateTime ?? "";
			const read = vp.lastMessageReadDateTime ?? "";
			// Sending marks a chat read, so this also excludes my own messages
			// without a second lookup.
			if (!created || (read && created <= read)) continue;
			if (prev.isDeleted || prev.eventDetail) continue;
			if ((prev.messageType ?? "message") !== "message") continue;
			// A never-read chat surfaces only if it is recent, or every stale
			// meeting thread ever joined shows up as unread forever.
			if (!read && created < dayAgo) continue;

			const body = prev.body ?? {};
			const text = body.contentType === "html" ? htmlToText(body.content ?? "") : (body.content ?? "").trim();
			if (!text) continue;

			out.push({
				id: chat.id,
				// chatLabel, NOT peerLabel: the unread list has always carried the full
				// membership, and the picker is the only surface that drops me (it gets
				// peerLabel as a separate `display` field). Live parity caught this.
				label: chatLabel(chat),
				chat_type: chat.chatType ?? "",
				sender: prev.from?.user?.displayName || "(unknown)",
				created_at: created,
				preview: text.slice(0, 200).replace(/\n/g, " "),
			});
		}

		out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
		return out;
	}

	// ── Chats and conversations ─────────────────────────────────────────────

	/**
	 * One page of the chat list, for the picker and the tools.
	 *
	 * No cursor asks for the first page, ordered by activity where the tenant allows it. `$orderby` on
	 * lastMessagePreview is refused by some tenants, so one refusal falls back to the plain query -- but only here, on
	 * the first page, and only after the ordered attempt actually failed. A blanket retry would launder a 401 into an
	 * empty list. A cursor is the nextLink Graph gave for the page after, followed as given.
	 */
	async chatsPage(cursor?: string): Promise<ChatsPage> {
		let page: ChatsResponse;
		if (cursor !== undefined) {
			page = await this.graph.get<ChatsResponse>(cursor);
		} else {
			try {
				page = await this.graph.get<ChatsResponse>(CHATS_ORDERED);
			} catch (e) {
				if (!(e instanceof GraphError)) throw e;
				page = await this.graph.get<ChatsResponse>(CHATS_PLAIN);
			}
		}
		const me = await this.myName();
		return { chats: (page.value ?? []).map((c) => chatRef(c, me)), next: page["@odata.nextLink"] };
	}

	/**
	 * Every chat, page after page. Name resolution and sending by name need the whole list: a chat past the first page
	 * must still be reachable by its name, so the walk reads on until the server names no next page.
	 */
	async allChats(): Promise<ChatRef[]> {
		const out: ChatRef[] = [];
		const first = await this.chatsPage();
		for await (const page of cursorPages(first, (p) => p.next, (c) => this.chatsPage(c))) out.push(...page.chats);
		return out;
	}

	/** The conversation an address names: the id as given, or the one a name resolves to. A name costs the whole chat list. */
	private async resolveChat(addr: ChatAddr): Promise<{ id: string; label: string | null; display: string | null }> {
		if (addr.id) return { id: addr.id, label: null, display: null };
		const found = findChat(await this.allChats(), addr.name ?? "");
		return { id: found.id, label: found.label, display: found.display ?? null };
	}

	/** Graph messages as the panes show them: system events dropped, oldest first. */
	private project(raw: RawMessage[], myName: string): HistoryMessage[] {
		const me = myName.toLowerCase();
		return raw
			.filter((m) => !isEmptyEvent(m))
			.map((m): HistoryMessage => {
				const sender = msgSender(m);
				const body = m.body ?? {};
				const files = msgFiles(m);
				return {
					sender,
					at: m.createdDateTime ?? "",
					mine: Boolean(me) && sender.toLowerCase().includes(me),
					text: msgText(m),
					// Structure kept for the chat pane; `text` stays flat for tools.
					md: body.contentType === "html" ? htmlToMarkdown(body.content ?? "", m.attachments ?? []) : msgText(m),
					mentions_me: mentionsMe(m, me),
					images: msgImages(m),
					// Absent rather than empty when there are none: every consumer then only has to check one thing.
					...(files.length > 0 ? { files } : {}),
				};
			})
			.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
	}

	/**
	 * Up to `top` of a chat's newest messages, oldest first: teams_read's count.
	 *
	 * Graph returns newest-first and caps a page, so `top` is a message count walked across pages -- not a page size.
	 * A client that reads one page silently truncates, which is indistinguishable from a quiet chat. The cap comes
	 * FIRST and system events are dropped after, as the Python does.
	 */
	async messages(addr: ChatAddr, top: number): Promise<{ messages: HistoryMessage[]; me?: string; chat?: string | null; display?: string | null }> {
		const chat = await this.resolveChat(addr);
		const raw = await this.graph.getAll<RawMessage>(`/chats/${chat.id}/messages?$top=${MESSAGE_PAGE}`, { max: top });
		const myName = await this.myName();
		return { messages: this.project(raw.slice(0, top), myName), me: myName, chat: chat.label, display: chat.display };
	}

	/** One page of a conversation's messages as Graph gives them: the raw messages, and the link to the page before. */
	private async messagesPage(url: string): Promise<{ raw: RawMessage[]; older?: string }> {
		const page = await this.graph.get<MessagesResponse>(url);
		return { raw: page.value ?? [], older: page["@odata.nextLink"] };
	}

	/**
	 * One page of a conversation for the pane: the newest with no cursor, the page before `cursor` otherwise. The cursor
	 * is Graph's own nextLink. A page of events alone is passed over, and the walk reads on through as many of them as
	 * there are, so a page is never blank while older messages exist.
	 */
	async historyPage(addr: ChatAddr, cursor?: string): Promise<ChatHistoryPage> {
		const myName = await this.myName();
		const start = cursor ?? `/chats/${(await this.resolveChat(addr)).id}/messages?$top=${HISTORY_MESSAGES}`;
		let messages: HistoryMessage[] = [];
		let older: string | undefined;
		for await (const page of cursorPages(await this.messagesPage(start), (p) => p.older, (c) => this.messagesPage(c))) {
			messages = this.project(page.raw, myName);
			older = page.older;
			if (messages.length > 0) break;
		}
		return { messages, me: myName, older };
	}

	/** 48:notes is chatsvc, not Graph. See skype.ts. */
	selfMessages(sinceId: string, top: number): Promise<SelfMessage[]> {
		return this.requireSkype().selfMessages(sinceId, top);
	}

	/** One page of the self-chat for the pane: the newest, then the page before `cursor`. See SkypeClient.selfPage. */
	selfHistoryPage(cursor?: string): Promise<SelfHistoryPage> {
		return this.requireSkype().selfPage(cursor, HISTORY_MESSAGES);
	}
	/** hostedContents needs the bearer, so it cannot be a plain <img src>. */
	async image(url: string): Promise<Buffer> {
		return this.graph.getBytes(url);
	}
	async people(query: string): Promise<Person[]> {
		return searchPeople(this.graph, query);
	}

	/**
	 * Move my read watermark to now, the same thing the Teams client does.
	 *
	 * This changes the real state rather than hiding an unread badge locally, so
	 * the desktop client agrees instead of the two views drifting apart.
	 */
	async markRead(chatId: string): Promise<void> {
		const token = await this.graph.rawToken();
		const oid = tokenClaim(token, "oid");
		const tid = tokenClaim(token, "tid");
		await this.graph.post(`/chats/${chatId}/markChatReadForUser`, { user: { id: oid, tenantId: tid } });
	}

	/** Fetch a shared file to disk; see downloadShared. */
	async downloadFile(url: string, toPath?: string, opts: { maxBytes?: number } = {}): Promise<DownloadedFile> {
		return downloadShared(this.graph, url, toPath, opts);
	}

	async send(target: SendTarget, message: string, html: boolean, mentions: Mention[] = []): Promise<void> {
		if (mentions.length > 0 && !html) throw new Error("an @mention can only be sent as html");
		// Resolved before anything is posted: one address the directory does not
		// know refuses the whole message.
		const resolved = await resolveMentions(this.graph, mentions);

		if (target.kind === "self") {
			// 48:notes is chatsvc with a Skype token, not Graph. Its mention markup
			// is chatsvc's own, so the resolved list goes to skype.ts unchanged.
			await this.requireSkype().send(message, html, resolved);
			return;
		}

		// Carried, not guessed: posting RichText/Html unconditionally once made
		// plain text containing "<" disappear as markup.
		const content = fillMentions(message, resolved, (m, i) => `<at id="${i}">${escapeHtml(m.name)}</at>`);
		const graphMentions = resolved.map((m, i) => ({
			id: i,
			mentionText: m.name,
			mentioned: { user: { id: m.oid, displayName: m.name, userIdentityType: "aadUser" } },
		}));
		// Only present when someone is mentioned: a plain message's body is unchanged.
		const body = {
			body: { contentType: html ? "html" : "text", content },
			...(graphMentions.length > 0 ? { mentions: graphMentions } : {}),
		};

		if (target.kind === "chat") {
			const id = target.id || findChat(await this.allChats(), target.chat).id;
			await this.graph.post(`/chats/${id}/messages`, body);
			return;
		}

		const teams = await this.graph.getAll<{ id: string; displayName?: string }>("/me/joinedTeams");
		const team = matchOne(teams.map((t) => ({ ...t, label: t.displayName ?? "" })), target.team, "team");
		const channels = await this.graph.getAll<{ id: string; displayName?: string }>(`/teams/${team.id}/channels`);
		const channel = matchOne(channels.map((c) => ({ ...c, label: c.displayName ?? "" })), target.channel, "channel");
		await this.graph.post(`/teams/${team.id}/channels/${channel.id}/messages`, body);
	}
}
