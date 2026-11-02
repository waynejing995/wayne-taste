/**
 * Who watches which Teams chat, across every omp/pi process on this machine.
 *
 * A watch belongs to one session. Two sessions watching one chat would inject
 * every message twice, into two agents, so a chat has at most one owner.
 *
 * Ownership is a Linux abstract Unix socket named after the chat. Binding it is
 * the claim: the kernel lets exactly one process bind a name, and frees the name
 * the moment that process exits, however it exits. So there is no lock file to
 * go stale and no reclaim step for two claimants to race through. The owner
 * answers a connection with its record, so a refused session can say where the
 * watch is; the record lives in the owner's memory and is never seen half-written.
 *
 * Abstract sockets are per network namespace: sessions in separate containers do
 * not see each other. Other platforms have no abstract sockets and are refused.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";

/** What the owner of a watch answers with. */
export interface WatchOwner {
	chatId: string;
	label: string;
	pid: number;
	sessionId: string;
	cwd: string;
	/** ISO time the watch started. */
	since: string;
}

/** A held claim. Closing it frees the chat for other sessions. */
export type WatchLease = net.Server;

/** The result of a claim: ours, or the record of the live session that holds it. */
export type ClaimResult = { lease: WatchLease } | { owner: WatchOwner };

/** How long a holder has to answer "who are you". A holder that does not answer still holds the name. */
const ASK_TIMEOUT_MS = 2000;

/** Per user: another account's watches are not ours to see or to block. */
const PREFIX = `pi-teams-watch:${process.getuid?.() ?? 0}:`;

function socketName(chatId: string): string {
	return `\0${PREFIX}${createHash("sha1").update(chatId).digest("hex")}`;
}

function requireLinux(): void {
	if (os.platform() !== "linux") throw new Error(`Teams watch needs Linux abstract sockets; this is ${os.platform()}`);
}

export function describeOwner(o: WatchOwner): string {
	return `pid ${o.pid}, session ${o.sessionId.slice(0, 8)}, ${o.cwd}, since ${o.since}`;
}

/**
 * The record of whoever holds `name`, or null when nobody does (refused: the
 * holder exited). Throws when a holder exists but does not answer.
 */
function ask(name: string): Promise<WatchOwner | null> {
	const { promise, resolve, reject } = Promise.withResolvers<WatchOwner | null>();
	let body = "";
	const sock = net.connect(name);
	sock.setTimeout(ASK_TIMEOUT_MS, () => {
		sock.destroy();
		reject(new Error(`the session holding this watch did not answer within ${ASK_TIMEOUT_MS} ms`));
	});
	sock.setEncoding("utf8");
	sock.on("data", (d) => {
		body += d;
	});
	sock.on("end", () => {
		try {
			resolve(JSON.parse(body) as WatchOwner);
		} catch (e) {
			reject(new Error(`the session holding this watch answered with something unreadable: ${e}`));
		}
	});
	sock.on("error", (e: NodeJS.ErrnoException) => {
		// Node says ECONNREFUSED, Bun says ENOENT: either way nobody holds the name.
		if (e.code === "ECONNREFUSED" || e.code === "ENOENT") resolve(null);
		else reject(e);
	});
	return promise;
}

/** Bind `name`, answering every connection with `record`. Null when another process holds it. */
function bind(name: string, record: string): Promise<WatchLease | null> {
	const { promise, resolve, reject } = Promise.withResolvers<WatchLease | null>();
	const server = net.createServer((c) => c.end(record));
	server.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" ? resolve(null) : reject(e)));
	server.listen(name, () => {
		// A watch must not keep a finished process alive.
		server.unref();
		resolve(server);
	});
	return promise;
}

/**
 * Claim a chat for this session. The record is in place before the name is
 * bound, so the first peer to ask already reads all of it.
 */
export async function claim(me: WatchOwner): Promise<ClaimResult> {
	requireLinux();
	const name = socketName(me.chatId);
	const record = JSON.stringify(me);
	// The holder can exit between our failed bind and our question; then the name is free and we bind again.
	for (let attempt = 0; attempt < 3; attempt++) {
		const lease = await bind(name, record);
		if (lease) return { lease };
		const owner = await ask(name);
		if (owner) return { owner };
	}
	throw new Error(`the watch for ${me.chatId} changed hands three times while claiming it; try again`);
}

/** Every live watch on this machine (this user), whoever holds it. */
export async function listOwners(): Promise<WatchOwner[]> {
	requireLinux();
	// Abstract names show in /proc/net/unix with '@' for the leading NUL, once per socket: dedupe.
	const names = new Set(
		fs
			.readFileSync("/proc/net/unix", "utf8")
			.split("\n")
			.map((l) => l.trim().split(/\s+/)[7] ?? "")
			.filter((p) => p.startsWith(`@${PREFIX}`)),
	);
	const owners = await Promise.all([...names].map((p) => ask(`\0${p.slice(1)}`)));
	return owners.filter((o): o is WatchOwner => o !== null);
}
