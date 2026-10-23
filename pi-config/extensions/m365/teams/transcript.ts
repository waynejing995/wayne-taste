/**
 * Meeting transcripts, fetched through chatsvc recording cards + SharePoint Stream API.
 *
 * Why not Graph's `/me/onlineMeetings/{id}/transcripts`?
 *   1. It requires OnlineMeetingTranscript.Read.All (admin consent) or being the organizer.
 *   2. Every recorded Teams meeting posts a `RichText/Media_CallRecording` card into the
 *      meeting's `19:meeting_...@thread.v2` thread with the organizer's OneDrive/SharePoint
 *      driveId, driveItemId and transcript URI. Any attendee who can view the recording can
 *      fetch `/streamContent?format=json` (with speakerDisplayName per utterance) or
 *      `/streamContent?format=vtt` using a FOCI SharePoint token (`https://<spHost>/.default`).
 */
import type { GraphClient } from "../core/graph.ts";
import { formatLocal } from "../core/time.ts";
import type { RawSkypeMessage, SkypeClient } from "./skype.ts";

export interface RecordingCard {
	title: string;
	startedAt: string;
	recordedAt: string;
	duration: string;
	transcriptUri?: string;
	transcriptId?: string;
	driveId?: string;
	driveItemId?: string;
	videoUri?: string;
}

export interface TranscriptTurn {
	speaker: string;
	at: string;
	lines: string[];
}

export interface MeetingTranscript {
	title: string;
	startedAt: string;
	recordedAt: string;
	duration: string;
	speakers: string[];
	entries: number;
	turns: TranscriptTurn[];
	markdown: string;
	recordings: RecordingCard[];
	/** Set when the primary Stream JSON endpoint failed and WebVTT fallback was used. */
	fallbackWarning?: string;
}

export type MeetingTranscriptResult =
	| { kind: "list"; chat: string; recordings: RecordingCard[] }
	| { kind: "transcript"; chat: string; transcript: MeetingTranscript };

type Transport = (
	url: string,
	init: { method?: string; headers: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>;

function unescapeXmlAttr(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#39;/g, "'");
}

function xmlAttr(tag: string, attr: string): string | undefined {
	const m = tag.match(new RegExp(`\\b${attr}="([^"]*)"`, "i"));
	return m && m[1] ? unescapeXmlAttr(m[1]) : undefined;
}

/**
 * Completed recording/transcript cards in a meeting thread, newest first.
 *
 * During a meeting Teams also posts `Initial` and `ChunkFinished` cards without
 * OneDrive/SharePoint items; those have nothing to download yet and are skipped.
 */
export function extractRecordingCards(messages: readonly RawSkypeMessage[]): RecordingCard[] {
	const out: RecordingCard[] = [];
	for (const m of messages) {
		const mt = m.messagetype ?? "";
		const xml = m.content ?? "";
		if (!mt.includes("Media_CallRecording") && !xml.includes("Media_CallRecording")) continue;
		if (!xml.includes("onedriveForBusinessTranscript") && !xml.includes("onedriveForBusinessVideo")) continue;

		const titleMatch = xml.match(/<Title>([\s\S]*?)<\/Title>/i);
		const title = titleMatch ? unescapeXmlAttr(titleMatch[1].trim()) : "Meeting";

		const rcTag = xml.match(/<RecordingContent\b[^>]*>/i)?.[0] ?? "";
		const startedAt = xmlAttr(rcTag, "timestamp") ?? m.composetime ?? "";
		const recordedAt = m.composetime ?? startedAt;
		const duration = xmlAttr(rcTag, "duration") ?? "";

		const tTag = xml.match(/<item\b[^>]*type="onedriveForBusinessTranscript"[^>]*>/i)?.[0] ?? "";
		const vTag = xml.match(/<item\b[^>]*type="onedriveForBusinessVideo"[^>]*>/i)?.[0] ?? "";
		const playHref = xml.match(/<a\b[^>]*href="([^"]+)"[^>]*>Play<\/a>/i)?.[1];

		const transcriptUri = xmlAttr(tTag, "uri");
		const transcriptId = xmlAttr(tTag, "id");
		const driveId = xmlAttr(tTag, "driveId") ?? xmlAttr(vTag, "driveId");
		const driveItemId = xmlAttr(tTag, "driveItemId") ?? xmlAttr(vTag, "driveItemId");
		const videoUri = xmlAttr(vTag, "uri") ?? (playHref ? unescapeXmlAttr(playHref) : undefined);

		if (!transcriptUri && !(driveId && driveItemId)) continue;

		out.push({
			title,
			startedAt,
			recordedAt,
			duration,
			...(transcriptUri ? { transcriptUri } : {}),
			...(transcriptId ? { transcriptId } : {}),
			...(driveId ? { driveId } : {}),
			...(driveItemId ? { driveItemId } : {}),
			...(videoUri ? { videoUri } : {}),
		});
	}
	return out.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
}

/** Pick the newest recording, or the one matching `date` (UTC ISO or local formatted date). */
export function pickRecording(cards: readonly RecordingCard[], date?: string): RecordingCard {
	if (cards.length === 0) {
		throw new Error("no completed recording or transcript found in this meeting thread");
	}
	const q = (date ?? "").trim().toLowerCase();
	if (!q) return cards[0];

	const hit = cards.find((c) => {
		const hay = `${c.startedAt} ${c.recordedAt} ${formatLocal(c.startedAt)} ${formatLocal(c.recordedAt)}`.toLowerCase();
		return hay.includes(q);
	});
	if (!hit) {
		const avail = cards.map((c) => formatLocal(c.startedAt || c.recordedAt)).join(", ");
		throw new Error(`no recording matches date "${date}" (available: ${avail})`);
	}
	return hit;
}

/** Verify a URL's host is a SharePoint host before minting or sending a token for it. */
export function allowedSharePointHost(urlStr: string): string {
	let host: string;
	try {
		host = new URL(urlStr).hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		throw new Error(`invalid SharePoint URL: ${urlStr}`);
	}
	if (!host.endsWith(".sharepoint.com")) {
		throw new Error(`refusing to send a SharePoint token to non-SharePoint host "${host}"`);
	}
	return host;
}

/**
 * Parse SharePoint Stream's `streamContent?format=json` payload.
 *
 * Unlike `streamContent?format=vtt` (which strips `<v Speaker>` tags on Stream-hosted
 * recordings), the JSON format carries `speakerDisplayName` and `startOffset` on every entry.
 */
export function parseStreamJsonTranscript(jsonText: string): { entries: number; turns: TranscriptTurn[] } {
	const data = JSON.parse(jsonText) as {
		entries?: { speakerDisplayName?: string; startOffset?: string; text?: string }[];
	};
	const raw = data.entries ?? [];
	const turns: TranscriptTurn[] = [];
	let count = 0;

	for (const e of raw) {
		const text = (e.text ?? "").trim();
		if (!text) continue;
		count++;
		const speaker = (e.speakerDisplayName ?? "").trim() || "(unknown)";
		const at = (e.startOffset ?? "").trim().replace(/\.\d+$/, "");
		const last = turns[turns.length - 1];
		if (last && last.speaker === speaker) {
			last.lines.push(text);
		} else {
			turns.push({ speaker, at, lines: [text] });
		}
	}
	return { entries: count, turns };
}

/** Parse WebVTT transcript content (`<v Speaker>text</v>` or plain cues). */
export function parseVttTranscript(vttText: string): { entries: number; turns: TranscriptTurn[] } {
	const lines = vttText.trim().split(/\r?\n/);
	const turns: TranscriptTurn[] = [];
	let count = 0;
	let i = 0;

	while (i < lines.length) {
		if (!lines[i].includes("-->")) {
			i++;
			continue;
		}
		const at = (lines[i].split("-->")[0] ?? "").trim().replace(/\.\d+$/, "");
		i++;
		let speaker = "";
		const parts: string[] = [];
		while (i < lines.length && lines[i].trim() !== "") {
			const line = lines[i].trim();
			const m = line.match(/^<v\s+([^>]+)>([\s\S]*)$/i);
			if (m) {
				speaker = m[1].trim();
				parts.push(m[2].replace(/<\/v>\s*$/i, "").trim());
			} else {
				parts.push(line.replace(/<\/v>\s*$/i, "").trim());
			}
			i++;
		}
		const text = parts.filter(Boolean).join(" ").trim();
		if (!text) continue;
		count++;
		const who = speaker || "(unknown)";
		const last = turns[turns.length - 1];
		if (last && last.speaker === who) {
			last.lines.push(text);
		} else {
			turns.push({ speaker: who, at, lines: [text] });
		}
	}
	return { entries: count, turns };
}

export function formatTranscriptMarkdown(
	meta: { title: string; startedAt: string; duration: string },
	turns: readonly TranscriptTurn[],
): string {
	const when = formatLocal(meta.startedAt);
	const dur = meta.duration ? `, duration ${meta.duration}` : "";
	const out: string[] = [`# Transcript: ${meta.title} (${when}${dur})`];
	for (const t of turns) {
		const ts = t.at ? ` [${t.at}]` : "";
		out.push("", `**${t.speaker}**${ts}`);
		for (const line of t.lines) {
			out.push(`  ${line}`);
		}
	}
	return out.join("\n");
}

async function resolveSharePointHost(card: RecordingCard, graph: GraphClient): Promise<string> {
	for (const u of [card.transcriptUri, card.videoUri]) {
		if (u) return allowedSharePointHost(u);
	}
	if (card.driveId) {
		const drive = await graph.get<{ webUrl?: string }>(`/drives/${card.driveId}`);
		if (drive.webUrl) return allowedSharePointHost(drive.webUrl);
	}
	throw new Error("cannot determine SharePoint host for recording card");
}

export async function fetchMeetingTranscript(opts: {
	chatId: string;
	chatLabel?: string;
	date?: string;
	list?: boolean;
	skype: SkypeClient;
	graph: GraphClient;
	sharepointToken: (spHost: string) => Promise<string>;
	doFetch?: Transport;
}): Promise<MeetingTranscriptResult> {
	const doFetch = opts.doFetch ?? (fetch as unknown as Transport);
	const raw = await opts.skype.conversationMessages(opts.chatId, 200);
	const recordings = extractRecordingCards(raw);
	const chatName = opts.chatLabel || recordings[0]?.title || opts.chatId;

	if (opts.list) {
		return { kind: "list", chat: chatName, recordings };
	}

	const card = pickRecording(recordings, opts.date);
	const spHost = await resolveSharePointHost(card, opts.graph);
	const token = await opts.sharepointToken(spHost);

	// Build candidate base URLs for this transcript on SharePoint Stream v2.1 API.
	let transcriptBase: string | undefined;
	if (card.transcriptUri) {
		const u = card.transcriptUri;
		if (allowedSharePointHost(u) === spHost) {
			transcriptBase = u.replace(/\/(content|streamContent)(\?.*)?$/i, "");
		}
	}
	if (!transcriptBase && card.driveId && card.driveItemId) {
		const itemMedia = `https://${spHost}/_api/v2.1/drives/${card.driveId}/items/${card.driveItemId}/media/transcripts`;
		if (card.transcriptId) {
			transcriptBase = `${itemMedia}/${card.transcriptId}`;
		} else {
			const r = await doFetch(itemMedia, {
				headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
			});
			if (r.status >= 200 && r.status < 300) {
				const body = JSON.parse(await r.text()) as { value?: { id?: string }[] };
				const id = body.value?.[0]?.id;
				if (id) transcriptBase = `${itemMedia}/${id}`;
			}
		}
	}

	let parsed: { entries: number; turns: TranscriptTurn[] } | undefined;
	let jsonFailureReason = "no Stream transcript endpoint resolved from recording card";
	let fallbackWarning: string | undefined;

	// 1. Primary: Stream JSON transcript (preserves speakerDisplayName on every utterance).
	if (transcriptBase) {
		const r = await doFetch(`${transcriptBase}/streamContent?format=json`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		});
		if (r.status >= 200 && r.status < 300) {
			const text = await r.text();
			if (text.trim().startsWith("{")) {
				const p = parseStreamJsonTranscript(text);
				if (p.entries > 0) {
					parsed = p;
				} else {
					jsonFailureReason = "Stream JSON transcript returned 0 entries";
				}
			} else {
				jsonFailureReason = "Stream JSON endpoint returned non-JSON payload";
			}
		} else {
			jsonFailureReason = `Stream JSON endpoint returned HTTP ${r.status}`;
		}
	}

	// 2. Explicit fallback: WebVTT from streamContent?format=vtt, transcriptUri, or drive item content.
	// Stream-hosted WebVTT omits `<v Speaker>` tags on some tenants, so falling back can degrade
	// speaker attribution; log a warning and surface `fallbackWarning` to the caller.
	if (!parsed) {
		const vttUrls: string[] = [];
		if (transcriptBase) vttUrls.push(`${transcriptBase}/streamContent?format=vtt`, `${transcriptBase}/content`);
		if (card.transcriptUri && !vttUrls.includes(card.transcriptUri)) vttUrls.push(card.transcriptUri);
		if (card.driveId && card.driveItemId) {
			vttUrls.push(`https://${spHost}/_api/v2.1/drives/${card.driveId}/items/${card.driveItemId}/content`);
		}
		for (const u of vttUrls) {
			if (allowedSharePointHost(u) !== spHost) continue;
			const r = await doFetch(u, {
				headers: { Authorization: `Bearer ${token}`, Accept: "text/vtt" },
			});
			if (r.status >= 200 && r.status < 300) {
				const text = await r.text();
				if (text.includes("WEBVTT") || text.includes("-->")) {
					const p = parseVttTranscript(text);
					if (p.entries > 0) {
						parsed = p;
						fallbackWarning = `Stream JSON transcript unavailable (${jsonFailureReason}); fell back to WebVTT (speaker attribution may be degraded)`;
						console.warn(`[teams] ${fallbackWarning}`);
						break;
					}
				}
			}
		}
	}

	if (!parsed) {
		throw new Error(`transcript exists in recording card (${formatLocal(card.startedAt || card.recordedAt)}) but could not be downloaded from ${spHost}`);
	}

	const title = card.title || chatName;
	const seenSpeakers = new Set<string>();
	for (const t of parsed.turns) {
		if (t.speaker !== "(unknown)") seenSpeakers.add(t.speaker);
	}
	const speakers = [...seenSpeakers];
	const markdown = formatTranscriptMarkdown(
		{ title, startedAt: card.startedAt || card.recordedAt, duration: card.duration },
		parsed.turns,
	);

	return {
		kind: "transcript",
		chat: chatName,
		transcript: {
			title,
			startedAt: card.startedAt,
			recordedAt: card.recordedAt,
			duration: card.duration,
			speakers,
			entries: parsed.entries,
			turns: parsed.turns,
			markdown,
			recordings,
			...(fallbackWarning ? { fallbackWarning } : {}),
		},
	};
}
