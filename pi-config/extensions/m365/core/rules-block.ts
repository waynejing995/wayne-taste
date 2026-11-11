/**
 * Rewrite one program-kept top-level list of the hand-written rules.yaml (`teams_watch`, `agent_watch`, `schedule`)
 * in place, leaving every other byte as the user wrote it.
 *
 * The block is the key line, the indented or column-0 `- ` lines under it, and blank lines between them, plus the
 * program's own header comment when it sits right above the key. A column-0 comment or key ends it, and so do blank
 * lines before one: those belong to whatever follows. A missing block is appended at the end.
 */

/** `text` with `key`'s block replaced by `block` (which ends with a newline and carries its own header line). */
export function replaceBlock(text: string, key: string, headerLead: string, block: string): string {
	const lines = text.split("\n");
	// Offsets of each line start, so the cut keeps the exact bytes around it.
	const starts: number[] = [];
	let at = 0;
	for (const line of lines) {
		starts.push(at);
		at += line.length + 1;
	}
	const keyAt = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}:`) && /^\s|^$/.test(l.slice(key.length + 1)));
	if (keyAt < 0) {
		const body = text.replace(/\n*$/, "");
		return body ? `${body}\n\n${block}` : block;
	}
	const first = keyAt > 0 && lines[keyAt - 1].startsWith(headerLead) ? keyAt - 1 : keyAt;
	let last = keyAt; // last line that belongs to the block
	for (let i = keyAt + 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() === "") continue;
		if (/^[ \t]/.test(l) || l === "-" || l.startsWith("- ")) last = i;
		else break;
	}
	const end = last + 1 < lines.length ? starts[last + 1] : text.length;
	return text.slice(0, starts[first]) + block + text.slice(end);
}
