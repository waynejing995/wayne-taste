import { isAgentSend } from "./card.ts";
import { compareIds, type ThreadBinding } from "./cursor-store.ts";
import { cardsText, forwardParts, htmlToMarkdown, partImages, partsText, senderOf, sentFiles, type RawSkypeMessage } from "./skype.ts";

export const COMMAND = /^(omp|pi)[:：]/i;

export interface ChannelAddr { teamId: string; channelId: string }

export interface ChannelEvent {
	id: string;
	threadId: string;
	isRoot: boolean;
	at: string;
	authorOid: string;
	author: string;
	email: boolean;
	agentEcho: boolean;
	subject?: string;
	text: string;
	md: string;
	files?: { name: string; url: string }[];
	images?: string[];
	imageSource?: string;
}

export type ChannelMode = "shared" | "personal";

export interface DeliveryEntry {
	threadId: string;
	kind: "prompt" | "card" | "relay";
	ids: string[];
	events: ChannelEvent[];
	owner: string;
	turn: boolean;
	untrusted: boolean;
}

/** Project one chatsvc item without looking up forward originals or names. */
export function toChannelEvent(raw: RawSkypeMessage, _myOid: string): ChannelEvent | null {
	if ((raw.messagetype ?? "").startsWith("Control/")) return null;
	const id = String(raw.id ?? "");
	const threadId = raw.rootMessageId ?? /;messageid=(\d+)/.exec(raw.conversationLink ?? "")?.[1] ?? id;
	const html = raw.content ?? "";
	const parts = forwardParts(html, [], raw.properties?.originalMessageContext);
	const text = [partsText(parts, new Map()), cardsText(raw)].filter(Boolean).join("\n");
	const files = sentFiles(raw);
	if (!text && files.length === 0) return null;
	const images = partImages(parts).map((src) => src.replaceAll("&amp;", "&"));
	const isRoot = threadId === id;
	return {
		id, threadId, isRoot,
		at: raw.composetime ?? "",
		authorOid: senderOf(raw),
		author: raw.imdisplayname ?? "",
		email: raw.s2spartnername === "MailhookService" || raw.properties?.emaildetails != null,
		agentEcho: isAgentSend(text),
		...(isRoot && raw.properties?.subject !== undefined ? { subject: raw.properties.subject } : {}),
		text,
		md: [htmlToMarkdown(html, [], undefined, raw.properties?.originalMessageContext), cardsText(raw, "\n\n")].filter(Boolean).join("\n\n"),
		...(files.length > 0 ? { files } : {}),
		...(images.length > 0 ? { images } : {}),
	};
}

/** Keep instructions separate from untrusted data before routing both to the thread owner. */
export function planDelivery(
	events: ChannelEvent[],
	opts: { mode: ChannelMode; myOid: string; self: string; threads: Record<string, ThreadBinding> },
): { entries: DeliveryEntry[]; skipped: string[]; bind: Record<string, string> } {
	const groups = new Map<string, { prompt: ChannelEvent[]; card: ChannelEvent[] }>();
	const skipped: string[] = [];
	const bind: Record<string, string> = {};
	for (const event of [...events].sort((a, b) => compareIds(a.id, b.id))) {
		if (event.agentEcho) {
			skipped.push(event.id);
			continue;
		}
		const own = opts.myOid !== "" && event.authorOid === opts.myOid;
		const command = COMMAND.test(event.text);
		if (opts.mode === "shared" && own && !event.email && !command) {
			skipped.push(event.id);
			continue;
		}
		const prompt = own && !event.email && (opts.mode === "personal" || command);
		let group = groups.get(event.threadId);
		if (!group) {
			group = { prompt: [], card: [] };
			groups.set(event.threadId, group);
		}
		if (prompt) {
			group.prompt.push(opts.mode === "shared" ? { ...event, text: event.text.replace(COMMAND, "").trim(), md: event.md.replace(COMMAND, "").trim() } : event);
			if (!opts.threads[event.threadId]) bind[event.threadId] = opts.self;
		} else group.card.push(event);
	}
	const entries: DeliveryEntry[] = [];
	for (const [threadId, group] of groups) {
		const owner = opts.threads[threadId]?.owner ?? opts.self;
		for (const [kind, items] of [["prompt", group.prompt], ["card", group.card]] as const) {
			if (items.length === 0) continue;
			const relay = owner !== opts.self;
			entries.push({
				threadId, kind: relay ? "relay" : kind, ids: items.map((item) => item.id), events: items, owner,
				turn: kind === "prompt" || (opts.mode === "personal" && items.some((item) => item.email)),
				untrusted: kind === "card",
			});
		}
	}
	return { entries, skipped, bind };
}
