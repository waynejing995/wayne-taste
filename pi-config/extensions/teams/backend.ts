/**
 * The seam between "what the extension wants" and "who fetches it".
 *
 * There are two answers to the second half: fetch_teams.py over a subprocess
 * (ScriptBackend, what has always shipped) and Microsoft Graph over HTTP
 * (GraphBackend, arriving unit by unit). Both must be selectable at runtime, so
 * a bad migration step is a config change away from being undone rather than a
 * restore from a tarball.
 *
 * ScriptBackend owns argv and nothing else. It does not touch the status bar or
 * the script-error state -- those belong to index.ts, which is the only thing
 * that renders them, and a second writer would be a second opinion about
 * whether Teams is reachable.
 */
import * as fs from "node:fs";
import type { ChatRef, HistoryMessage, Person, SendTarget } from "./compose-overlay.ts";

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

/** Where to read a chat from. `id` is preferred: resolving a name re-fetches
  * the whole chat list. */
export interface DownloadedFile {
	name: string;
	size: number;
	path: string;
	mimeType?: string;
}

export interface ChatAddr {
	id?: string;
	name?: string;
}

export interface Backend {
	unread(maxAgeSec: number): Promise<UnreadPayload>;
	chats(maxChats: number): Promise<ChatRef[]>;
	messages(addr: ChatAddr, top: number): Promise<{ messages: HistoryMessage[]; me?: string }>;
	selfMessages(sinceId: string, top: number): Promise<SelfMessage[]>;
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
	markRead(chatId: string): Promise<void>;
	send(target: SendTarget, message: string, html: boolean): Promise<void>;
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

export class ScriptBackend implements Backend {
	constructor(private readonly run: ScriptRunner) {}

	async unread(maxAgeSec: number): Promise<UnreadPayload> {
		// String(0) matters: 0 means "force a live scan", and dropping a falsy
		// value here would silently serve a cached scan to a forced refresh.
		return lastJsonLine<UnreadPayload>(await this.run(["unread", "--max-age", String(maxAgeSec)]));
	}

	async chats(maxChats: number): Promise<ChatRef[]> {
		const out = await this.run(["chats", "--list", "--format", "json", "--max-chats", String(maxChats)]);
		return lastJsonLine<{ chats: ChatRef[] }>(out).chats ?? [];
	}

	async messages(addr: ChatAddr, top: number): Promise<{ messages: HistoryMessage[]; me?: string }> {
		const where = addr.id ? ["--chat-id", addr.id] : ["--chat", addr.name ?? ""];
		const out = await this.run(["chats", ...where, "--top", String(top)]);
		const payload = lastJsonLine<{ messages: HistoryMessage[]; me?: string }>(out);
		return { messages: payload.messages ?? [], me: payload.me };
	}

	async selfMessages(sinceId: string, top: number): Promise<SelfMessage[]> {
		const args = ["chats", "--self", "--format", "json", "--top", String(top)];
		if (sinceId) args.push("--since-id", sinceId);
		return lastJsonLine<{ messages: SelfMessage[] }>(await this.run(args)).messages ?? [];
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

	async send(target: SendTarget, message: string, html: boolean): Promise<void> {
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
