/**
 * SharePoint and OneDrive files, fetched by the address a person was handed. Behind
 * teams_download, outlook_download and the /outlook save list.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { GraphClient } from "./graph.ts";
import { safeName, type SaveTarget, saveNew } from "./save-file.ts";

/** A file saved to disk: its own name, its size, where it went, and its type when Graph said. */
export interface DownloadedFile {
	name: string;
	size: number;
	path: string;
	mimeType?: string;
}

/**
 * Graph's encoding for "a file, addressed by the URL a human was given".
 *
 * A Teams file attachment is a `reference` to the sender's OneDrive, and the
 * contentUrl is a web address, not an API path. /shares/{id} is the way in, and
 * the id is `u!` + unpadded base64url. Getting the padding wrong returns a 400
 * that says nothing about encoding.
 */
export function shareId(url: string): string {
	return `u!${Buffer.from(url).toString("base64url").replace(/=+$/, "")}`;
}

/**
 * Fetch the file at `url` to disk.
 *
 * Metadata first, for two reasons: the real filename lives there rather than
 * in the URL, and the size lets an absurd download be refused before it
 * starts rather than after it has filled a disk. `toPath` is an exact path that
 * must not exist yet, or a directory to pick a free name in (save-file.ts);
 * absent, a fresh temp directory. No existing file is ever overwritten.
 */
export async function downloadShared(
	graph: GraphClient,
	url: string,
	toPath?: SaveTarget,
	opts: { maxBytes?: number } = {},
): Promise<DownloadedFile> {
	const maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
	const item = await graph.get<{ name?: string; size?: number; file?: { mimeType?: string } }>(`/shares/${shareId(url)}/driveItem`);
	const name = safeName(item.name ?? "teams-file");
	// A folder or a site page has no bytes to fetch; say what it is rather than fail on the content call.
	if (!item.file) throw new Error(`${name} is not a file (a folder or a page); open it in the browser`);
	const size = item.size ?? 0;
	if (size > maxBytes)
		throw new Error(`${name} is too large: ${size} bytes, limit ${maxBytes}. Pass a bigger maxBytes if you mean it.`);

	const bytes = await graph.getBytes(`/shares/${shareId(url)}/driveItem/content`);
	// A half-written log that looks complete is worse than an error: it gets
	// read, and the missing half is never noticed.
	if (size > 0 && bytes.length !== size)
		throw new Error(`${name} came back truncated: got ${bytes.length} bytes, Graph said ${size}`);

	const written = saveNew(toPath ?? { dir: fs.mkdtempSync(path.join(os.tmpdir(), "teams-file-")) }, name, bytes);
	return { name: item.name ?? name, size: bytes.length, path: written, mimeType: item.file.mimeType };
}
