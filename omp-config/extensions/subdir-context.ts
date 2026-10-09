// Subdirectory context files for omp, after pi-subdir-context
// (https://github.com/default-anton/pi-subdir-context, MIT).
//
// omp injects only the context files it discovers from the startup cwd; AGENTS.md /
// CLAUDE.md in subdirectories are listed by path in <dir-context> and never injected.
// This extension delivers them the first time the agent touches a directory below them:
// - read: after a successful read, as `additionalContext` (a developer message);
// - write: BEFORE the write runs. The write's content was generated without the rules,
//   so the first write into such a directory is blocked and the rules ride back in the
//   block reason; the agent re-issues a compliant write. (`edit` needs a prior read for
//   its anchors, so the read path covers it.)
// Every delivery shows a TUI info notice naming the files. A rule file omp cannot read is
// skipped exactly as omp's own loader skips it; this extension adds no policy of its own.
//
// Discovery and dedup are omp's own: `discoverContextFiles(dir)` is the loader omp runs
// for its system prompt (provider priority, one file per directory depth and one user-level
// file, `@path` imports expanded, a farther file dropped when its content is contained in a
// closer one). "What to inject for dir" = what omp would inject had it started in dir, minus
// any content already delivered. Seeded with discoverContextFiles(cwd), which is exactly what
// the system prompt holds. Content-keyed, so symlinks and copies count once.
// `@oh-my-pi/pi-coding-agent` does not resolve at runtime; the legacy specifier is rewritten
// onto the host's compat shim, which re-exports the SDK.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { discoverContextFiles } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i; // skill://, omp://, local://, https://, …

function realpath(p: string): string | undefined {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return undefined;
	}
}

function isInside(root: string, target: string): boolean {
	const rel = path.relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function absolute(raw: string, cwd: string): string {
	return path.resolve(cwd, raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw);
}

/** Directory a read touched: the existing target (selectors `:…` / `?…` stripped), or its parent if a file. */
function readDir(raw: string, cwd: string): string | undefined {
	let candidate = absolute(raw, cwd);
	for (;;) {
		const resolved = realpath(candidate);
		if (resolved) return fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
		const cut = Math.max(candidate.lastIndexOf(":"), candidate.lastIndexOf("?"));
		if (cut <= candidate.lastIndexOf(path.sep)) return undefined;
		candidate = candidate.slice(0, cut);
	}
}

/** Directory a write will land in: the nearest existing ancestor (the write may create the rest). */
function writeDir(raw: string, cwd: string): string | undefined {
	for (let dir = path.dirname(absolute(raw, cwd)); ; dir = path.dirname(dir)) {
		const resolved = realpath(dir);
		if (resolved) return resolved;
		if (path.dirname(dir) === dir) return undefined;
	}
}

export default function subdirContext(pi: ExtensionAPI) {
	let cwd = "";
	let home = "";
	let delivered = new Set<string>(); // contents already in the model's context
	// Delivered during the current tool batch, so not yet seen by the model: a sibling write
	// prepared in the same batch must not land before the next turn. Cleared on turn_start.
	const unseen = new Set<string>();
	let ready: Promise<void> | undefined;

	function reset(ctx: ExtensionContext): Promise<void> {
		cwd = realpath(ctx.cwd) ?? path.resolve(ctx.cwd);
		home = realpath(os.homedir()) ?? os.homedir();
		unseen.clear();
		ready = discoverContextFiles(cwd).then((files) => {
			delivered = new Set(files.map((f) => f.content));
		});
		return ready;
	}

	/** Scope root for `dir` (cwd, else home), or undefined when the target is outside both. */
	async function rootFor(dir: string, ctx: ExtensionContext): Promise<string | undefined> {
		await (ready ?? reset(ctx));
		return isInside(cwd, dir) ? cwd : isInside(home, dir) ? home : undefined;
	}

	function deliver(files: { path: string; content: string }[], ctx: ExtensionContext): string {
		for (const f of files) {
			delivered.add(f.content);
			unseen.add(f.content);
		}
		if (ctx.hasUI) ctx.ui.notify(`subdir-context: loaded ${files.map((f) => path.relative(cwd, f.path) || f.path).join(", ")}`, "info");
		return files.map((f) => `<file path="${f.path}">\n${f.content.trim()}\n</file>`).join("\n");
	}

	for (const event of ["session_start", "session_switch", "session_branch", "session_tree", "session_compact"] as const) {
		pi.on(event, (_event, ctx) => reset(ctx));
	}
	pi.on("turn_start", () => unseen.clear());

	pi.on("tool_call", async (event, ctx) => {
		const raw = event.input.path;
		if (event.toolName !== "write" || typeof raw !== "string" || raw === "" || URL_SCHEME.test(raw)) return undefined;
		const dir = writeDir(raw, cwd || ctx.cwd);
		const root = dir && (await rootFor(dir, ctx));
		if (!dir || !root) return undefined;
		const files = await discoverContextFiles(dir);
		const pending = files.filter((f) => !delivered.has(f.content));
		if (pending.length > 0) {
			return {
				block: true,
				reason:
					`Write to ${raw} NOT executed: this directory has rules you have not loaded yet. ` +
					`Read them below (deeper rules override higher ones; MUST follow), then re-issue the write, ` +
					`adjusted if it violates them:\n${deliver(pending, ctx)}`,
			};
		}
		const justDelivered = files.filter((f) => unseen.has(f.content)).map((f) => f.path);
		if (justDelivered.length === 0) return undefined;
		return {
			block: true,
			reason:
				`Write to ${raw} NOT executed: the rules for this directory (${justDelivered.join(", ")}) ` +
				`were delivered by another call in this same batch and you have not read them yet. ` +
				`Read them in that call's result, then re-issue this write, adjusted if it violates them.`,
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		const raw = event.input.path;
		if (event.toolName !== "read" || event.isError || typeof raw !== "string" || raw === "" || URL_SCHEME.test(raw)) return undefined;
		const dir = readDir(raw, cwd || ctx.cwd);
		const root = dir && (await rootFor(dir, ctx));
		if (!dir || !root) return undefined;
		const pending = (await discoverContextFiles(dir)).filter((f) => !delivered.has(f.content));
		if (pending.length === 0) return undefined;
		return {
			additionalContext:
				`Directory context files for ${path.relative(cwd, dir) || dir} ` +
				`(loaded on first access; deeper rules override higher ones; MUST follow):\n${deliver(pending, ctx)}`,
		};
	});
}
