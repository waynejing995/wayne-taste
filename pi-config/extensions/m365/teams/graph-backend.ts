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
import { attachedCardText, CARD_CONTENT_TYPE, isCardType } from "./card.ts";
import { type ForwardContext, type ForwardNeed, forwardedAttachmentIds, forwardNeed, forwardParts, NO_FORWARD_CONTEXT, type Original, originalKey, partImages, partsText, type Part } from "./forward.ts";
import { escapeHtml, htmlToText } from "./html.ts";
import { htmlToMarkdown } from "./markdown.ts";
import { fillMentions, type Mention, type ResolvedMention } from "./mentions.ts";
import { cursorPages } from "./paging.ts";
import { graphReactions } from "./reactions.ts";
import type { SkypeClient } from "./skype.ts";
import { fetchMeetingTranscript, type MeetingTranscriptResult } from "./transcript.ts";

const IMAGE_DOWNLOAD_MAX = 20 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 30_000;
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

interface RawAttachment { id?: string | number; contentType?: string; name?: string; contentUrl?: string; content?: string }
interface RawMessage {
	id?: string;
	createdDateTime?: string;
	messageType?: string;
	from?: { user?: { id?: string; displayName?: string }; application?: { displayName?: string } } | null;
	body?: { contentType?: string; content?: string };
	mentions?: { mentioned?: { user?: { displayName?: string } }; mentionText?: string }[];
	attachments?: RawAttachment[];
	reactions?: unknown;
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
/** The largest image teams_send reads: a screenshot is a few MB; anything past this is not one. */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

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
function attachmentList(m: RawMessage): RawAttachment[] {
	return Array.isArray(m.attachments) ? m.attachments.filter((a): a is RawAttachment => Boolean(a) && typeof a === "object") : [];
}

function attachmentError(m: RawMessage): string {
	if (m.attachments === undefined) return "";
	if (!Array.isArray(m.attachments)) return "\n[unreadable attachment]";
	return m.attachments.some((a) => !a || typeof a !== "object") ? "\n[unreadable attachment]" : "";
}

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
export function msgText(m: RawMessage, fwd: ForwardContext = NO_FORWARD_CONTEXT): string {
	const body = m.body ?? {};
	const atts = attachmentList(m);
	const cardOf = (id: string) => {
		const a = atts.find((x) => String(x.id) === id && isCardType(x.contentType));
		return a ? attachedCardText(a.content, a.contentType) : undefined;
	};
	const parts = msgParts(m, fwd);
	const text = body.contentType === "html" ? partsText(parts, fwd.names, cardOf) : (body.content ?? "").trim();
	// A card's body is only the <attachment> tag pointing at it, so the card is the message's text. One a forward
	// points at is already in the forward's quote.
	const quoted = forwardedAttachmentIds(parts);
	// Graph lists a link preview's card once per place it shows; it is one card.
	const cards = [...new Map(atts.filter((a) => isCardType(a.contentType) && !quoted.has(String(a.id))).map((a) => [String(a.id), a])).values()].map((a) =>
		attachedCardText(a.content, a.contentType),
	);
	return [text, ...cards].filter(Boolean).join("\n");
}

/** The body cut into its own HTML and its forwards (forward.ts). */
function msgParts(m: RawMessage, fwd: ForwardContext = NO_FORWARD_CONTEXT): Part[] {
	const body = m.body ?? {};
	return body.contentType === "html" ? forwardParts(body.content ?? "", attachmentList(m), undefined, fwd.originals) : [];
}

/**
 * hostedContents URLs referenced by a message.
 *
 * htmlToText flattens <img> to "[image]", which is right for text but drops the
 * address. These URLs need the bearer token, so only the extension can fetch them.
 */
export function msgImages(m: RawMessage, fwd: ForwardContext = NO_FORWARD_CONTEXT): string[] {
	// A forward's pictures too, which a forwardedMessageReference carries in its content, not in the body.
	return partImages(msgParts(m, fwd));
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
	if (attachmentList(m).length > 0 || attachmentError(m)) return false;
	return !msgText(m);
}

/**
 * The downloadable files in a message.
 *
 * Only attachments with a contentUrl: a reply or a forward is also an
 * <attachment>, and offering its (absent) URL to a downloader would be a lie.
 */
export function msgFiles(m: RawMessage): { name: string; url: string }[] {
	return attachmentList(m)
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
		private readonly opts: {
			whoami: () => Promise<string>;
			skype?: SkypeClient;
			sharepointToken?: (host: string) => Promise<string>;
		},
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

	/** Names of people by directory id, read once per process: a forward names its sender only by id. */
	private readonly userNames = new Map<string, string>();

	/** Originals of forwarded messages by originalKey, read once per process: a forwarded card is only there. */
	private readonly originals = new Map<string, Original>();

	/** What the forwards in `raw` need read: their senders' names and the originals of forwarded cards. */
	private forwardContext(raw: readonly RawMessage[]): Promise<ForwardContext> {
		return this.lookupForwards(forwardNeed(raw.flatMap((m) => msgParts(m))));
	}

	/** Names and originals for forwards, from Graph; the self-chat (chatsvc) asks through this too. */
	private async lookupForwards(need: ForwardNeed): Promise<ForwardContext> {
		const [names] = await Promise.all([this.namesOf(need.senderIds), this.originalsOf(need.originals)]);
		return { names, originals: this.originals };
	}

	/**
	 * The originals of forwards that leave their content out (a card) or name a bot only by id, read from the chat they
	 * were sent in. One the reader cannot see (not a member any more, deleted) is logged and stays a stub.
	 */
	private async originalsOf(wanted: readonly [string, string][]): Promise<void> {
		const missing = new Map(wanted.map(([c, id]) => [originalKey(c, id), [c, id] as const]).filter(([k]) => !this.originals.has(k as string)));
		await Promise.all(
			[...missing].map(async ([key, [conversation, id]]) => {
				try {
					const o = await this.graph.get<RawMessage>(`/chats/${encodeURIComponent(conversation)}/messages/${encodeURIComponent(id)}`);
					const body = o.body ?? {};
					this.originals.set(key, {
						sender: msgSender(o) === "(system)" ? "" : msgSender(o),
						html: body.contentType === "html" ? (body.content ?? "") : `<p>${escapeHtml(body.content ?? "")}</p>`,
						attachments: attachmentList(o),
					});
				} catch (e) {
					console.warn(`[teams] forwarded message ${id} not read from ${conversation}: ${e instanceof Error ? e.message : String(e)}`);
				}
			}),
		);
	}

	/**
	 * People's names by directory id. One directory call for the lot; ids it does not know stay out, and a forward
	 * without a name is headed "Forwarded message". A failed lookup is logged and costs only the names, never the
	 * messages.
	 */
	private async namesOf(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
		const missing = [...new Set(ids)].filter((id) => !this.userNames.has(id));
		if (missing.length > 0) {
			try {
				const r = await this.graph.post<{ value?: { id?: string; displayName?: string }[] }>("/directoryObjects/getByIds", { ids: missing.slice(0, 1000), types: ["user"] });
				for (const u of r.value ?? []) if (u.id && u.displayName) this.userNames.set(u.id, u.displayName);
			} catch (e) {
				console.warn(`[teams] forward sender names not resolved: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		return this.userNames;
	}

	/** Graph messages as the panes show them: system events dropped, oldest first. */
	private project(raw: RawMessage[], myName: string, chatId: string, fwd: ForwardContext): HistoryMessage[] {
		const me = myName.toLowerCase();
		return raw
			.flatMap((m): HistoryMessage[] => {
				try {
					if (isEmptyEvent(m)) return [];
					const sender = msgSender(m);
					const body = m.body ?? {};
					const files = msgFiles(m);
					const images = msgImages(m, fwd);
					const badAttachment = attachmentError(m);
					const text = `${msgText(m, fwd)}${badAttachment}`;
					const messageUrl = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(m.id ?? "")}/`;
					const resolved: string[] = [];
					let imageError = "";
					for (const src of images) {
						try {
							resolved.push(src.startsWith("../") ? new URL(src.slice(3), messageUrl).href : new URL(src, messageUrl).href);
						} catch {
							imageError = "\n[unreadable attachment]";
						}
					}
					const reactions = graphReactions(m.reactions);
					return [{
						...(m.id ? { id: m.id } : {}),
						sender,
						at: m.createdDateTime ?? "",
						mine: Boolean(me) && sender.toLowerCase().includes(me),
						...(m.from?.user?.id ? { sender_id: m.from.user.id } : {}),
						text: `${text}${imageError}`,
						md: body.contentType === "html" ? `${htmlToMarkdown(body.content ?? "", attachmentList(m), fwd.names, undefined, fwd.originals)}${badAttachment}${imageError}` : `${text}${imageError}`,
						mentions_me: mentionsMe(m, me),
						images: resolved,
						imageSource: messageUrl,
						...(files.length > 0 ? { files } : {}),
						...(reactions.length > 0 ? { reactions } : {}),
					}];
				} catch {
					return [{ sender: "(system)", at: m.createdDateTime ?? "", mine: false, text: "[unreadable attachment]", md: "[unreadable attachment]", mentions_me: false, images: [] }];
				}
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
		const kept = raw.slice(0, top);
		return { messages: this.project(kept, myName, chat.id, await this.forwardContext(kept)), me: myName, chat: chat.label, display: chat.display };
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
		const chat = await this.resolveChat(addr);
		const start = cursor ?? `/chats/${chat.id}/messages?$top=${HISTORY_MESSAGES}`;
		let messages: HistoryMessage[] = [];
		let older: string | undefined;
		for await (const page of cursorPages(await this.messagesPage(start), (p) => p.older, (c) => this.messagesPage(c))) {
			messages = this.project(page.raw, myName, chat.id, await this.forwardContext(page.raw));
			older = page.older;
			if (messages.length > 0) break;
		}
		return { messages, me: myName, older };
	}

	/** 48:notes is chatsvc, not Graph. See skype.ts. */
	selfMessages(sinceId: string, top: number): Promise<SelfMessage[]> {
		return this.requireSkype().selfMessages(sinceId, top, (need) => this.lookupForwards(need));
	}

	/** One page of the self-chat for the pane: the newest, then the page before `cursor`. See SkypeClient.selfPage. */
	selfHistoryPage(cursor?: string): Promise<SelfHistoryPage> {
		return this.requireSkype().selfPage(cursor, HISTORY_MESSAGES, (need) => this.lookupForwards(need));
	}
	/**
	 * A picture in a message: hostedContents on Graph (the Graph bearer), or an AMS object pasted into the self-chat
	 * (the skype token). The address is written by whoever sent the message, so each token goes only to its own
	 * host and any other address is refused: never the Graph token to wherever an <img> points.
	 */
	async image(url: string, source?: string): Promise<Buffer> {
		const u = new URL(url);
		if (u.protocol !== "https:") throw new Error(`${u.protocol}//${u.host} is not https; not sending a token there`);
		const asm = u.hostname.endsWith(".asm.skype.com");
		if (source && !asm) {
			const owned = new URL(source);
			// Compare segment by segment: `19:x` and `19%3Ax` are the same chat (a chat id may even hold an encoded
			// `/`), but past the message prefix a segment that decodes to a separator or a dot-segment (`..%2F`, `%5C`,
			// `%2E%2E`) would climb out of the message, so it is refused.
			const own = owned.pathname.replace(/\/$/, "").split("/").map(decodeURIComponent);
			const asked = u.pathname.split("/").map(decodeURIComponent);
			const samePath = own.every((s, i) => asked[i] === s)
				&& !asked.slice(own.length).some((s) => /[/\\]/.test(s) || s === ".." || s === ".");
			if (owned.origin !== u.origin || !samePath) throw new Error(`${u.host} is not the source message; not sending a token there`);
		}
		if (u.host === "graph.microsoft.com") return this.graph.getBytes(url, IMAGE_DOWNLOAD_MAX, IMAGE_TIMEOUT_MS);
		if (asm) return this.requireSkype().image(url);
		throw new Error(`${u.host} is not a Teams image host; not sending a token there`);
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

	/**
	 * My reaction on one message: Graph's setReaction / unsetReaction. The self-chat is "48:notes" on Graph too, and its
	 * chatsvc message ids are the Graph ids.
	 */
	async react(chatId: string, messageId: string, reactionType: string, remove = false): Promise<void> {
		const chat = encodeURIComponent(chatId);
		const message = encodeURIComponent(messageId);
		await this.graph.post(`/chats/${chat}/messages/${message}/${remove ? "unsetReaction" : "setReaction"}`, { reactionType });
	}

	/** Fetch a shared file to disk; see downloadShared. */
	async downloadFile(url: string, toPath?: string, opts: { maxBytes?: number } = {}): Promise<DownloadedFile> {
		return downloadShared(this.graph, url, toPath, opts);
	}

	/** Fetch a meeting transcript or list its recorded sessions; see fetchMeetingTranscript. */
	async transcript(addr: ChatAddr, opts: { date?: string; list?: boolean } = {}): Promise<MeetingTranscriptResult> {
		if (!this.opts.sharepointToken) {
			throw new Error("meeting transcripts need a SharePoint token supplier; none was configured for this backend");
		}
		const chat = await this.resolveChat(addr);
		return fetchMeetingTranscript({
			chatId: chat.id,
			chatLabel: chat.display ?? chat.label ?? undefined,
			date: opts.date,
			list: opts.list,
			skype: this.requireSkype(),
			graph: this.graph,
			sharepointToken: this.opts.sharepointToken,
		});
	}

	async send(
		target: SendTarget,
		message: string,
		html: boolean,
		mentions: Mention[] = [],
		images: string[] = [],
		card?: Record<string, unknown>,
		files: string[] = [],
	): Promise<void> {
		if (mentions.length > 0 && !html) throw new Error("an @mention can only be sent as html");
		if (images.length > 0 && !html) throw new Error("an image can only be sent as html");
		if (files.length > 0 && !html) throw new Error("a file can only be sent as html");
		// Read before anything is uploaded or posted: one bad file refuses the whole message. Pictures must be
		// PNG/JPEG/GIF; files can be anything regular (readLocal).
		const imageBudget = { left: IMAGE_MAX_BYTES, max: IMAGE_MAX_BYTES, what: "images" };
		const pictures = images.map((p) => {
			const bytes = readLocal(p, "image", imageBudget);
			const head = bytes.subarray(0, 8).toString("latin1");
			const type = head.startsWith("\x89PNG\r\n\x1a\n")
				? "image/png"
				: head.startsWith("\xff\xd8\xff")
					? "image/jpeg"
					: head.startsWith("GIF8")
						? "image/gif"
						: "";
			if (!type) throw new Error(`image ${p} is not a PNG, JPEG or GIF file`);
			return { name: path.basename(p), bytes, type };
		});
		const fileBudget = { left: FILE_MAX_BYTES, max: FILE_MAX_BYTES, what: "files" };
		const attached = files.map((p) => ({ name: path.basename(p), bytes: readLocal(p, "file", fileBudget) }));
		// Resolved before anything is posted: one address the directory does not
		// know refuses the whole message.
		const resolved = await resolveMentions(this.graph, mentions);

		if (target.kind === "self" && !card && attached.length === 0) {
			// 48:notes is chatsvc with a Skype token, not Graph. Its mention markup
			// is chatsvc's own, so the resolved list goes to skype.ts unchanged.
			const skype = this.requireSkype();
			const uploaded = [];
			for (const f of pictures) uploaded.push(await skype.uploadImage(f.bytes, f.name));
			await skype.send(message, html, resolved, uploaded);
			return;
		}

		// Where the message goes, found before any file is uploaded: a chat name that matches nothing leaves no
		// orphan in OneDrive.
		let post: string;
		let upload: (name: string, bytes: Uint8Array) => Promise<SharedFile>;
		if (target.kind !== "channel") {
			const id = target.kind === "self" ? "48:notes" : target.id || findChat(await this.allChats(), target.chat).id;
			post = `/chats/${id}/messages`;
			// A chat's files are the sender's: OneDrive's "Microsoft Teams Chat Files", the folder Teams itself uses,
			// opened to exactly the chat's members. The self-chat has only me, and I own the file.
			upload = async (name, bytes) => {
				const item = await this.graph.upload<DriveItem>(`/me/drive/root:/${encodeURIComponent(CHAT_FILES)}/${encodeURIComponent(name)}:`, bytes);
				if (target.kind === "chat") await this.shareWithMembers(item, id);
				return sharedFile(item);
			};
		} else {
			const teams = await this.graph.getAll<{ id: string; displayName?: string }>("/me/joinedTeams");
			const team = matchOne(teams.map((t) => ({ ...t, label: t.displayName ?? "" })), target.team, "team");
			const channels = await this.graph.getAll<{ id: string; displayName?: string }>(`/teams/${team.id}/channels`);
			const channel = matchOne(channels.map((c) => ({ ...c, label: c.displayName ?? "" })), target.channel, "channel");
			post = `/teams/${team.id}/channels/${channel.id}/messages`;
			// A channel's files live in its own folder of the team's library, which its members can already read.
			upload = async (name, bytes) => {
				const folder = await this.graph.get<DriveItem>(`/teams/${team.id}/channels/${channel.id}/filesFolder`);
				const drive = folder.parentReference?.driveId;
				if (!drive || !folder.id) throw new Error(`channel ${target.channel} has no files folder`);
				return sharedFile(await this.graph.upload<DriveItem>(`/drives/${drive}/items/${folder.id}:/${encodeURIComponent(name)}:`, bytes));
			};
		}
		// A chat file inherits whatever its folder is already shared with: check before the first byte goes up.
		if (attached.length > 0 && target.kind !== "channel") await this.requireChatFilesPrivate();
		const shared: SharedFile[] = [];
		for (const f of attached) shared.push(await upload(f.name, f.bytes));

		// Carried, not guessed: posting RichText/Html unconditionally once made
		// plain text containing "<" disappear as markup.
		// With a card, `message` holds only what notifies (the mentions); the card follows it as an attachment the
		// body points at, the shape Graph's own card example posts. Graph posts cards to the self-chat too.
		// Pictures go inline as hostedContents: each `<img>` points at a temporary id the post carries the bytes under,
		// and Teams stores them with the message. Files are "reference" attachments: the uploaded item, by its id.
		const attachmentId = card ? crypto.randomUUID().replaceAll("-", "") : "";
		const content =
			fillMentions(message, resolved, (m, i) => `<at id="${i}">${escapeHtml(m.name)}</at>`) +
			pictures.map((f, i) => `<p><img src="../hostedContents/${i + 1}/$value" alt="${escapeHtml(f.name)}"></p>`).join("") +
			(card ? `<attachment id="${attachmentId}"></attachment>` : "") +
			shared.map((f) => `<attachment id="${f.id}"></attachment>`).join("");
		const graphMentions = resolved.map((m, i) => ({
			id: i,
			mentionText: m.name,
			mentioned: { user: { id: m.oid, displayName: m.name, userIdentityType: "aadUser" } },
		}));
		const attachments = [
			...(card ? [{ id: attachmentId, contentType: CARD_CONTENT_TYPE, content: JSON.stringify(card) }] : []),
			...shared.map((f) => ({ id: f.id, contentType: "reference", contentUrl: f.url, name: f.name })),
		];
		// Only present when someone is mentioned: a plain message's body is unchanged.
		const body = {
			body: { contentType: html ? "html" : "text", content },
			...(graphMentions.length > 0 ? { mentions: graphMentions } : {}),
			...(pictures.length > 0
				? {
						hostedContents: pictures.map((f, i) => ({
							"@microsoft.graph.temporaryId": String(i + 1),
							contentBytes: f.bytes.toString("base64"),
							contentType: f.type,
						})),
					}
				: {}),
			...(attachments.length > 0 ? { attachments } : {}),
		};
		await this.graph.post(post, body);
	}

	/** When the chat files folder was last seen shared with no one but me: a send checks again after CLEAN_FOR_MS. */
	private chatFilesCleanAt = 0;

	/**
	 * Refuses a chat or self-chat file send while "Microsoft Teams Chat Files" is shared with anyone but me. A file
	 * uploaded there inherits every permission the folder and the drive above it hold (an old share, a guest, an
	 * organisation or anonymous link), and shareWithMembers only adds to them. So any grant other than my own owner
	 * role names itself in the error and nothing is uploaded; the user decides what to unshare. A folder that does not
	 * exist yet is clean: Teams creates it owned by me alone.
	 */
	private async requireChatFilesPrivate(): Promise<void> {
		if (Date.now() - this.chatFilesCleanAt < CLEAN_FOR_MS) return;
		let perms: DrivePermission[];
		try {
			perms = await this.graph.getAll<DrivePermission>(`/me/drive/root:/${encodeURIComponent(CHAT_FILES)}:/permissions`);
		} catch (e) {
			if (e instanceof GraphError && e.status === 404) {
				this.chatFilesCleanAt = Date.now();
				return;
			}
			throw e;
		}
		const me = tokenClaim(await this.graph.rawToken(), "oid");
		const extra = perms.filter((p) => !(p.roles?.length === 1 && p.roles[0] === "owner" && !p.link && (p.grantedToV2?.user?.id ?? p.grantedTo?.user?.id) === me));
		if (extra.length > 0) {
			throw new Error(
				`refusing to upload: OneDrive "${CHAT_FILES}" is shared beyond you, and every file sent would inherit it: ${extra.map(describeGrant).join("; ")}. ` +
					"Remove those shares from the folder (or the drive above it), then send again.",
			);
		}
		this.chatFilesCleanAt = Date.now();
	}

	/**
	 * Opens an uploaded chat file to exactly the chat's members, read-only: each by address, no invitation mail,
	 * sign-in required. Never a link anyone or the whole organisation could use. A member Graph lists without an
	 * address gets it by object id; one with neither refuses the send, as the file would be unreadable to them.
	 */
	private async shareWithMembers(item: DriveItem, chatId: string): Promise<void> {
		const me = tokenClaim(await this.graph.rawToken(), "oid");
		const members = await this.graph.getAll<{ userId?: string; email?: string; displayName?: string }>(`/chats/${chatId}/members`);
		const recipients = members
			.filter((m) => m.userId !== me)
			.map((m) => {
				if (m.email) return { email: m.email };
				if (m.userId) return { objectId: m.userId };
				throw new Error(`chat member ${m.displayName ?? "(unnamed)"} has no address to share ${item.name} with`);
			});
		if (recipients.length === 0) return;
		const drive = item.parentReference?.driveId;
		if (!drive || !item.id) throw new Error(`uploaded ${item.name} has no drive item id`);
		await this.graph.post(`/drives/${drive}/items/${item.id}/invite`, {
			recipients,
			roles: ["read"],
			requireSignIn: true,
			sendInvitation: false,
		});
	}
}

/** The OneDrive folder Teams keeps chat files in; the name is Teams' own, the same in every tenant language. */
const CHAT_FILES = "Microsoft Teams Chat Files";
/** How long a clean check of CHAT_FILES' sharing holds: sends in a burst ask once. */
const CLEAN_FOR_MS = 5 * 60 * 1000;

interface DriveIdentity {
	id?: string;
	displayName?: string;
	email?: string;
	loginName?: string;
}

/** A driveItem permission: a grant to someone (grantedToV2), or a sharing link (link.scope). */
interface DrivePermission {
	id?: string;
	roles?: string[];
	link?: { scope?: string; type?: string };
	grantedToV2?: { user?: DriveIdentity; group?: DriveIdentity; siteUser?: DriveIdentity; siteGroup?: DriveIdentity; application?: DriveIdentity };
	grantedTo?: { user?: DriveIdentity };
	grantedToIdentitiesV2?: { user?: DriveIdentity; group?: DriveIdentity; siteUser?: DriveIdentity }[];
	invitation?: { email?: string };
	inheritedFrom?: { path?: string; id?: string };
}

/** One permission as the refusal names it: who or what link, its roles, where it is inherited from. */
function describeGrant(p: DrivePermission): string {
	const who = (i?: DriveIdentity) => i?.email || i?.displayName || i?.loginName || i?.id || "";
	const g = p.grantedToV2;
	const holders = [g?.user, g?.group, g?.siteGroup, g?.application, p.grantedTo?.user, ...(p.grantedToIdentitiesV2 ?? []).flatMap((x) => [x.user, x.group])].map(who).filter(Boolean);
	const subject = p.link
		? [`${p.link.scope ?? "unknown"}-scope`, p.link.type, "link"].filter(Boolean).join(" ")
		: [...new Set(holders)].join(", ") || p.invitation?.email || g?.siteUser?.loginName || `permission ${p.id ?? "?"}`;
	const from = p.inheritedFrom?.path ? ` inherited from ${p.inheritedFrom.path}` : "";
	return `${subject} (${(p.roles ?? []).join(", ") || "no role"})${from}`;
}

/** The most teams_send reads for files in one message: they are read whole before the first upload. */
const FILE_MAX_BYTES = 250 * 1024 * 1024;

interface DriveItem {
	id?: string;
	name?: string;
	eTag?: string;
	webUrl?: string;
	webDavUrl?: string;
	parentReference?: { driveId?: string };
}

/** What a "reference" attachment needs: the item's GUID (its eTag's), its direct URL, its name. */
interface SharedFile {
	id: string;
	url: string;
	name: string;
}

function sharedFile(item: DriveItem): SharedFile {
	const id = /\{([0-9a-f-]{36})\}/i.exec(item.eTag ?? "")?.[1];
	// The file's own address (…/Documents/Folder/name.ext), as Teams attaches it, not the Office viewer page webUrl
	// can be.
	const url = item.webDavUrl ?? item.webUrl;
	if (!id || !url) throw new Error(`OneDrive did not describe uploaded ${item.name ?? "file"} (eTag ${item.eTag}, url ${url})`);
	return { id: id.toLowerCase(), url, name: item.name ?? "file" };
}

/**
 * One local file the model named, whole. The paths come from the model, so only regular files within the budget
 * are read: never a device, a FIFO, a huge file. A non-regular path is refused before it is opened, and the opened
 * descriptor must be the same inode. Not defended: a concurrent rename of a parent directory between the stat and
 * the open; only a process of this same user could race it, and that process can open the device itself.
 */
function readLocal(p: string, kind: string, budget: { left: number; max: number; what: string }): Buffer {
	// The real path, so the open below can refuse a symlinked final component (O_NOFOLLOW).
	const real = fs.realpathSync(p);
	const named = fs.statSync(real);
	if (!named.isFile()) throw new Error(`${kind} ${p} is not a regular file`);
	const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOCTTY | fs.constants.O_NOFOLLOW);
	try {
		const st = fs.fstatSync(fd);
		if (!st.isFile() || st.dev !== named.dev || st.ino !== named.ino) throw new Error(`${kind} ${p} changed while being read`);
		budget.left -= st.size;
		if (budget.left < 0) throw new Error(`${budget.what} total more than ${budget.max} bytes`);
		const bytes = Buffer.alloc(st.size);
		for (let off = 0; off < st.size; ) {
			const n = fs.readSync(fd, bytes, off, st.size - off, off);
			if (n === 0) throw new Error(`${kind} ${p} shrank while being read`);
			off += n;
		}
		return bytes;
	} finally {
		fs.closeSync(fd);
	}
}
