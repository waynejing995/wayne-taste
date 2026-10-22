/**
 * The user's outgoing signature: Markdown in one file, beside the Teams config.
 *
 * Graph exposes no Outlook signature, so the signature lives here. It is read on
 * every build, so an edit (through `/outlook signature` or any text editor)
 * applies to the next message without a restart.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function signaturePath(): string {
	return path.join(os.homedir(), ".pi", "agent", "outlook-signature.md");
}

/** The signature's Markdown, trimmed; "" when none is set. */
export function readSignature(): string {
	const p = signaturePath();
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "";
}

/** Saves `markdown` as the signature; blank text removes it. */
export function writeSignature(markdown: string): void {
	const p = signaturePath();
	if (markdown.trim() === "") {
		fs.rmSync(p, { force: true });
		return;
	}
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, `${markdown.trim()}\n`);
}
