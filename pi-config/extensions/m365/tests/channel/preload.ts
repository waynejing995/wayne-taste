/**
 * bun test preload (bunfig.toml [test] preload): runs before any test module in this package loads.
 *
 * The channel tests exercise cursor-store.ts and watch-list.ts, which read WAYNE_INBOX_DIR once at module
 * load, and `bun test` runs every file in one process with one module registry — so whichever file imports
 * those modules first fixes their inbox for the whole run. Only a preload can set the environment before
 * that first import. HOME, XDG_CACHE_HOME and WAYNE_INBOX_DIR point into one fresh temp directory, so no
 * test can touch the real home, inbox or cache whatever it imports; afterAll removes it when the run ends
 * (bun test does not run process "exit" listeners, so a global test hook is the reliable teardown).
 */
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "m365-tests-"));
process.env.HOME = root;
process.env.XDG_CACHE_HOME = join(root, ".cache");
process.env.WAYNE_INBOX_DIR = join(root, "inbox");
afterAll(() => rmSync(root, { recursive: true, force: true }));
