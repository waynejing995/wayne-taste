/**
 * Fake `tern` and `tmux` for tests that run `inbox agent add`, which probes the pane it is given. probe.sh looks in
 * `$HOME/.local/bin` first, so the fakes go under `home` and the caller points HOME there.
 *
 * Every pane exists, and the agent process in it is this test process (which holds no session file), until `close`
 * names it: then the mux says what the real one says of a pane that is not there.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function fakePanes(home) {
	const bin = join(home, ".local", "bin");
	const closed = join(home, "closed-panes");
	mkdirSync(bin, { recursive: true });
	writeFileSync(closed, "");
	const gone = `grep -qxF -- "$id" '${closed}'`;
	writeFileSync(
		join(bin, "tern"),
		`#!/bin/sh\nid=$2\n${gone} && { echo "tern $1: no block is called \\\`$id\\\`" >&2; exit 1; }\ncase "$1" in\nprocess) echo '{"foreground": {"pid": ${process.pid}}}' ;;\ncapture) echo pane ;;\nesac\n`,
		{ mode: 0o755 },
	);
	writeFileSync(
		join(bin, "tmux"),
		`#!/bin/sh\nfor a do [ "$prev" = -t ] && id=$a; prev=$a; done\n${gone} && { echo "can't find pane: $id" >&2; exit 1; }\ncase "$1" in\ndisplay-message) echo "0 ${process.pid}" ;;\ncapture-pane) echo pane ;;\nesac\n`,
		{ mode: 0o755 },
	);
	return { close: (id) => appendFileSync(closed, `${id}\n`) };
}
