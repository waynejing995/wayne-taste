/**
 * Files a mail carries or points at: its attachments, and the SharePoint / OneDrive links in its body.
 * Nothing is saved unless the user asks (outlook_download, or `s` in the /outlook pager), and no save
 * overwrites a file (save-file.ts).
 */
import * as os from "node:os";
import * as path from "node:path";
import { type SaveTarget, saveNew } from "../core/save-file.ts";
import type { MailAttachment } from "./mime.ts";

/** A link in the body to a file on SharePoint or OneDrive: the link text and its address. */
export type SharedLink = { text: string; url: string };

/** Where a save goes when no path is given: a free name in ~/Downloads. */
export function downloads(): SaveTarget {
	return { dir: path.join(os.homedir(), "Downloads") };
}

/** A SharePoint or OneDrive address: what Graph's /shares can resolve with the user's token. */
export function isShared(url: string): boolean {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	return host.endsWith(".sharepoint.com") || host === "1drv.ms" || host === "onedrive.live.com";
}

/** The SharePoint and OneDrive links in a body's Markdown, once each, in order. */
export function sharedLinks(markdown: string): SharedLink[] {
	const seen = new Map<string, SharedLink>();
	for (const m of markdown.matchAll(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
		if (isShared(m[2]) && !seen.has(m[2])) seen.set(m[2], { text: m[1].trim() || m[2], url: m[2] });
	}
	return [...seen.values()];
}

/** Writes an attachment to `target` (an exact path that must not exist yet), or to a free name in ~/Downloads. Returns the path. */
export function saveAttachment(a: MailAttachment, target?: string): string {
	return saveNew(target ?? downloads(), a.filename, a.content);
}
