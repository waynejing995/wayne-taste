/**
 * The shapes a Teams backend returns and a send targets. No UI and no harness import, so the backends, the
 * tool layer and the /teams overlay all share them.
 */
import type { ReactionCount } from "./reactions.ts";

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
	/** The message's id in its chat: what teams_react targets. */
	id?: string;
	sender: string;
	at: string;
	/** Flattened text. Kept for tools and for anything that cannot render. */
	text: string;
	/** Same message as Markdown: bold, code, quotes, links, replies, forwards. */
	md?: string;
	mine: boolean;
	/** The sender's Entra object id, when the backend knows it (Graph does). The only proof of who wrote a message: display names collide. */
	sender_id?: string;
	mentions_me?: boolean;
	/** My own display name, for telling my mentions from other people's. */
	me?: string;
	/** hostedContents URLs. They need the bearer token, so only we can fetch them. */
	images?: string[];
	imageSource?: string;
	/**
	 * Files shared in this message: a name and the SharePoint URL behind it.
	 *
	 * Structured rather than left inside `md`, because `teams_download` needs the
	 * URL and parsing it back out of rendered Markdown would be a second encoding
	 * of a fact we already have.
	 */
	files?: { name: string; url: string }[];
	/** Reactions on it, each emoji with how many chose it; absent when there are none. */
	reactions?: ReactionCount[];
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
