/**
 * A model-written description of a picture, cached on disk. Shared by Teams and Outlook.
 *
 * This terminal cannot draw images -- tty7 implements the Kitty protocol but
 * leaves placed images behind when the screen scrolls, so anything pi draws
 * lands in the wrong place. Reading the picture out is the next best thing,
 * and it should just be there rather than hidden behind a keystroke.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";

/** A picture as bytes in base64 and its MIME type. */
export interface LoadedImage {
	base64: string;
	mime: string;
}

const CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi", "teams-alt");

/**
 * One or two lines describing the picture `load` returns. `key` names the picture (a URL, a content hash):
 * a key seen before answers from the cache without loading anything.
 */
export async function describeImage(ctx: ExtensionContext, key: string, load: () => Promise<LoadedImage>): Promise<string> {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	const file = path.join(CACHE_DIR, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.txt`);
	if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");

	const model = ctx.model;
	if (!model) throw new Error("no model selected");
	const { base64, mime } = await load();
	// Credentials from the registry, the call from pi-ai: both pi and omp have getApiKeyAndHeaders and
	// completeSimple, while ModelRegistry.complete exists only in pi (omp: "complete is not a function").
	// The bare call without the registry's key comes back unauthenticated with no text at all.
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	const target = "baseUrl" in auth && auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
	const reply = await completeSimple(target, {
		messages: [
			{
				role: "user",
				timestamp: Date.now(),
				content: [
					{
						type: "text",
						text:
							"Describe this image from a work chat or email in one or two short lines, for someone " +
							"who cannot see it. Quote any error message, command or short text verbatim. " +
							"No preamble, no markdown, just the description.",
					},
					{ type: "image", data: base64, mimeType: mime },
				],
			},
		],
	}, { apiKey: auth.apiKey, headers: auth.headers });
	const text = reply.content
		.filter((c: { type: string }) => c.type === "text")
		.map((c: { text: string }) => c.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) {
		// Report what actually went wrong. A generic "no description" hid an
		// unauthenticated request behind a message that sounded like the model
		// simply had nothing to say.
		throw new Error(reply.errorMessage || `stopReason=${reply.stopReason}`);
	}
	fs.writeFileSync(file, text);
	return text;
}
