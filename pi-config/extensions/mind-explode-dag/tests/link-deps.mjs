/**
 * Point the extension's `node_modules` at the installed pi, for tests only.
 *
 * The extension declares no runtime dependencies: `@earendil-works/pi-tui` and
 * `typebox` are pi's own, and pi resolves them itself when it loads the
 * extension. Running the harness outside pi has no such resolver — Node looks
 * for a bare specifier starting from the REAL path of the importing file, and
 * `index.ts` lives in the wayne-skills checkout, which has no node_modules.
 *
 * Symlinking rather than installing is deliberate: the harness must exercise the
 * exact pi-tui the running pi will hand the extension, not whatever version npm
 * happens to resolve today. A mismatch there would make the tests agree with a
 * library the extension never meets.
 *
 * Fails loud. A missing pi is a broken machine, not a reason to skip tests.
 */
import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

// realpath: the extension is reached through a symlink from ~/.pi/agent, and
// Node resolves modules from the real location, so that is where they must go.
const EXT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Find the pi install that would actually run, by following the `pi` on PATH.
 *
 * `npm root -g` is the obvious answer and the wrong one: with nvm it reports
 * the current Node's prefix, while pi may be installed under /usr/local by a
 * different one. The binary on PATH is the pi this machine runs, so its real
 * path is the only source that cannot disagree with reality.
 */
function piDeps() {
	let bin;
	try {
		bin = realpathSync(execFileSync("bash", ["-lc", "command -v pi"], { encoding: "utf8" }).trim());
	} catch {
		throw new Error("no `pi` on PATH; cannot locate the pi-tui the extension will be given");
	}
	for (let dir = dirname(bin); dir !== parse(dir).root; dir = dirname(dir)) {
		const deps = join(dir, "node_modules");
		if (existsSync(join(deps, "@earendil-works", "pi-tui"))) return deps;
	}
	throw new Error(`walked up from ${bin} without finding node_modules/@earendil-works/pi-tui`);
}


export function linkDeps() {
	const nm = join(EXT, "node_modules");
	const scoped = join(nm, "@earendil-works");
	if (existsSync(join(nm, "typebox")) && existsSync(join(scoped, "pi-tui"))) return EXT;

	const from = piDeps();
	mkdirSync(scoped, { recursive: true });
	for (const [target, link] of [
		[join(from, "typebox"), join(nm, "typebox")],
		[join(from, "@earendil-works", "pi-tui"), join(scoped, "pi-tui")],
	]) {
		if (existsSync(link)) continue;
		if (!existsSync(target)) throw new Error(`pi does not ship ${target}; cannot run the harness against it`);
		symlinkSync(target, link, "dir");
	}
	return EXT;
}
