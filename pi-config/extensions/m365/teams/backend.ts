/**
 * The seam between "what the extension wants" and "who fetches it".
 *
 * There are two answers to the second half: fetch_teams.py over a subprocess
 * (ScriptBackend, what has always shipped) and Microsoft Graph over HTTP
 * (GraphBackend). Both must be selectable at runtime, so a bad migration step
 * is a config change away from being undone rather than a restore from a
 * tarball.
 *
 * ScriptBackend owns argv and nothing else. It does not touch the status bar or
 * the script-error state -- those belong to index.ts, which is the only thing
 * that renders them, and a second writer would be a second opinion about
 * whether Teams is reachable.
 *
 * Paging: the chat list and every conversation come back a page at a time, each
 * page with a cursor for the one after (or before, for history). The script
 * cannot be asked for a second page, so ScriptBackend answers the first page and
 * hands out SCRIPT_MORE as the cursor. Following it fails with a message saying
 * why, rather than ending the list as if nothing else existed.
 */
import * as fs from "node:fs";
import type { DownloadedFile } from "../core/shares.ts";
import type { Person } from "../core/people.ts";
import { type ChatRef, type ChatsPage, type HistoryMessage, HISTORY_MESSAGES, type SendTarget } from "./compose-overlay.ts";
import type { Mention } from "./mentions.ts";
import type { MeetingTranscriptResult } from "./transcript.ts";

/** One chat holding unread activity. Chat-level: Graph's preview carries no
  * mention data, so an honest per-message count does not exist here. */
export interface UnreadItem {
	id: string;
	label: string;
	chat_type: string;
	sender: string;
	created_at: string;
	preview: string;
}

export interface UnreadPayload {
	unread_chats: number;
	items: UnreadItem[];
	/** True when this is a previous scan served because the live one failed. */
	stale?: boolean;
}

export interface SelfMessage {
	id: string;
	at: string;
	text: string;
	/** Markdown form. The pane renders this; `text` is the flat fallback. */
	md?: string;
}

/** Where to read a chat from. `id` is preferred: resolving a name walks the whole chat list. */
export interface ChatAddr {
	id?: string;
	name?: string;
}

/** A conversation's messages as a backend returns them: oldest first, my own name, and the cursor for the page before. */
export interface ChatHistoryPage {
	messages: HistoryMessage[];
	me?: string;
	older?: string;
}

/** The self-chat's messages, oldest first, and the cursor for the page before. */
export interface SelfHistoryPage {
	messages: SelfMessage[];
	older?: string;
}

/** The cursor a script-backend page hands out when more may follow. Following it fails with a reason. */
export const SCRIPT_MORE = "script:more";
/** The chats the script lists in its one page (`--max-chats`). */
const SCRIPT_CHAT_PAGE = 100;

export interface Backend {
	unread(maxAgeSec: number): Promise<UnreadPayload>;
	/** One page of the chat list: the first when there is no cursor, the one a previous page named otherwise. */
	chatsPage(cursor?: string): Promise<ChatsPage>;
	/** Up to `top` of a chat's newest messages, oldest first. Walks pages as it needs to. */
	messages(addr: ChatAddr, top: number): Promise<{ messages: HistoryMessage[]; me?: string }>;
	/** One page of a conversation: the newest with no cursor, the page before `cursor` otherwise. Oldest first. */
	historyPage(addr: ChatAddr, cursor?: string): Promise<ChatHistoryPage>;
	/**
	 * The self-chat. With `sinceId`, one page of what is newer than it (the remote
	 * channel's cursor). Without, the newest `top`, walking back as far as needed.
	 */
	selfMessages(sinceId: string, top: number): Promise<SelfMessage[]>;
	/** One page of the self-chat: the newest with no cursor, the page before `cursor` otherwise. */
	selfHistoryPage(cursor?: string): Promise<SelfHistoryPage>;
	/**
	 * The image bytes. Bytes rather than a path: only the script backend has a
	 * file, and making Graph invent a temp file to satisfy the signature would be
	 * the subprocess shape leaking into an interface that no longer has one.
	 */
	image(url: string): Promise<Buffer>;
	people(query: string): Promise<Person[]>;
	/**
	 * Fetch a file someone shared, to a local path.
	 *
	 * The URL is the `contentUrl` of a `reference` attachment: a human
	 * SharePoint/OneDrive address, not an API endpoint.
	 */
	downloadFile(url: string, toPath?: string, opts?: { maxBytes?: number }): Promise<DownloadedFile>;
	/**
	 * Fetch a meeting's transcript (or list its recorded sessions) from its
	 * `19:meeting_...@thread.v2` conversation via chatsvc + SharePoint.
	 */
	transcript(addr: ChatAddr, opts?: { date?: string; list?: boolean }): Promise<MeetingTranscriptResult>;
	markRead(chatId: string): Promise<void>;
	/**
	 * `mentions` are the @mentions cut from the Markdown (mentions.ts). Only the
	 * graph backend can resolve them to people, so the script backend refuses.
	 */
	send(target: SendTarget, message: string, html: boolean, mentions?: Mention[]): Promise<void>;
}

/** The script logs progress to stderr and emits exactly one JSON line on stdout. */
export function lastJsonLine<T>(stdout: string): T {
	const line = stdout
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("{"))
		.pop();
	if (!line) throw new Error(`no JSON on stdout: ${stdout.slice(0, 200)}`);
	return JSON.parse(line) as T;
}

/** Runs fetch_teams.py with the given verb+flags and returns stdout. */
export type ScriptRunner = (args: string[]) => Promise<string>;

/** Following a cursor the script cannot honour: the error says what to do instead. */
function scriptNoPaging(what: string): Error {
	return new Error(`the script backend cannot load more of the ${what}; set "backend": "graph" in ~/.pi/agent/teams.json`);
}

export class ScriptBackend implements Backend {
	constructor(private readonly run: ScriptRunner) {}

	async unread(maxAgeSec: number): Promise<UnreadPayload> {
		// String(0) matters: 0 means "force a live scan", and dropping a falsy
		// value here would silently serve a cached scan to a forced refresh.
		return lastJsonLine<UnreadPayload>(await this.run(["unread", "--max-age", String(maxAgeSec)]));
	}

	async chatsPage(cursor?: string): Promise<ChatsPage> {
		if (cursor !== undefined) throw scriptNoPaging("chat list");
		const out = await this.run(["chats", "--list", "--format", "json", "--max-chats", String(SCRIPT_CHAT_PAGE)]);
		const chats = lastJsonLine<{ chats: ChatRef[] }>(out).chats ?? [];
		// A full page may have more behind it, and the script cannot say so.
		return { chats, next: chats.length >= SCRIPT_CHAT_PAGE ? SCRIPT_MORE : undefined };
	}

	async messages(addr: ChatAddr, top: number): Promise<{ messages: HistoryMessage[]; me?: string }> {
		const where = addr.id ? ["--chat-id", addr.id] : ["--chat", addr.name ?? ""];
		const out = await this.run(["chats", ...where, "--top", String(top)]);
		const payload = lastJsonLine<{ messages: HistoryMessage[]; me?: string }>(out);
		return { messages: payload.messages ?? [], me: payload.me };
	}

	async historyPage(addr: ChatAddr, cursor?: string): Promise<ChatHistoryPage> {
		if (cursor !== undefined) throw scriptNoPaging("conversation");
		const page = await this.messages(addr, HISTORY_MESSAGES);
		return { ...page, older: page.messages.length >= HISTORY_MESSAGES ? SCRIPT_MORE : undefined };
	}

	async selfMessages(sinceId: string, top: number): Promise<SelfMessage[]> {
		const args = ["chats", "--self", "--format", "json", "--top", String(top)];
		if (sinceId) args.push("--since-id", sinceId);
		return lastJsonLine<{ messages: SelfMessage[] }>(await this.run(args)).messages ?? [];
	}

	async selfHistoryPage(cursor?: string): Promise<SelfHistoryPage> {
		if (cursor !== undefined) throw scriptNoPaging("self-chat");
		const messages = await this.selfMessages("", HISTORY_MESSAGES);
		return { messages, older: messages.length >= HISTORY_MESSAGES ? SCRIPT_MORE : undefined };
	}

	async image(url: string): Promise<Buffer> {
		// The script downloads to a temp file and prints its path; the bytes are
		// what the caller wanted, so the path stops here.
		const file = lastJsonLine<{ path: string }>(await this.run(["image", "--url", url])).path;
		return fs.readFileSync(file);
	}

	async people(query: string): Promise<Person[]> {
		return lastJsonLine<{ people: Person[] }>(await this.run(["people", "--search", query])).people ?? [];
	}

	async markRead(chatId: string): Promise<void> {
		await this.run(["markread", "--chat-id", chatId]);
	}

	downloadFile(): Promise<never> {
		// fetch_teams.py has no equivalent command, and returning an empty file
		// would be indistinguishable from a file that is genuinely empty.
		return Promise.reject(
			new Error('the script backend cannot download files; set "backend": "graph" in ~/.pi/agent/teams.json'),
		);
	}

	transcript(): Promise<never> {
		return Promise.reject(
			new Error('the script backend cannot read meeting transcripts by chat; set "backend": "graph" in ~/.pi/agent/teams.json'),
		);
	}

	async send(target: SendTarget, message: string, html: boolean, mentions: Mention[] = []): Promise<void> {
		if (mentions.length > 0)
			throw new Error(
				'@mentions need the graph backend: the script cannot look a person up in the directory. Set "backend": "graph" in ~/.pi/agent/teams.json, or send without the mention.',
			);
		const args = ["send"];
		if (target.kind === "self") args.push("--self");
		else if (target.kind === "chat")
			args.push(...(target.id ? ["--chat-id", target.id] : ["--chat", target.chat]));
		else args.push("--team", target.team, "--channel", target.channel);
		args.push("-m", message);
		if (html) args.push("--html");
		await this.run(args);
	}
}
