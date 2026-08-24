/**
 * Microsoft identity for the Teams extension, owned entirely by the extension.
 *
 * WHY A SECOND CACHE EXISTS. fetch_teams.py, fetch_outlook.py and
 * fetch_confluence.py share one MSAL cache at
 * groups/tasks/scripts/outlook_token_cache.bin, plus an xor-obfuscated password.
 * This module deliberately shares NONE of it:
 *
 *   - Two MSAL implementations writing one cache file is two writers of one
 *     piece of state. They rotate refresh tokens independently, so the loser
 *     re-authenticates -- and that shows up as "Teams is broken this morning",
 *     not as the concurrency bug it is.
 *   - The Python side keeps a decryptable copy of a domain password because it
 *     predates this. Copying that scheme would put a second one on disk to save
 *     one browser click per refresh-token lifetime. Device code instead.
 *
 * So the cache is ours, at cachePath(), mode 0600, and nothing here ever reads
 * or writes a file under groups/tasks/scripts.
 *
 * WHO MAY PROMPT. Only `/teams init`. Every other caller gets a silent token or
 * a loud error: a device code printed in the middle of a background unread poll
 * is a prompt nobody is looking at, attached to a request that then hangs.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PublicClientApplication } from "@azure/msal-node";

/** Microsoft Office. A FOCI family client, which is what lets the same refresh
  * token be swapped for the Skype scope the self-chat needs. Public and
  * first-party -- not a secret, and not specific to any tenant. */
export const CLIENT_ID = "d3590ed6-52b3-4102-aeff-aad2292ab01c";
/**
 * No tenant id anywhere in this repository.
 *
 * `organizations` lets the sign-in decide which tenant the account belongs to.
 * A hardcoded GUID would say which company runs this, which is exactly the kind
 * of fact that should not be in source.
 */
export const AUTHORITY = "https://login.microsoftonline.com/organizations";
export const GRAPH_SCOPES = ["https://graph.microsoft.com/.default"];

const INIT_HINT = "not authenticated — run /teams init";

export function cachePath(): string {
	const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
	return path.join(base, "pi", "teams-auth", "msal-cache.json");
}

export function loadCache(): string | null {
	const p = cachePath();
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

export function saveCache(serialized: string): void {
	const p = cachePath();
	fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
	fs.writeFileSync(p, serialized, { mode: 0o600 });
	// writeFileSync only applies the mode when it creates the file; an existing
	// one keeps whatever it had, which after a manual edit could be 0644.
	fs.chmodSync(p, 0o600);
}

/** Minimal surface of the MSAL app this module uses, so tests can supply one. */
export interface MsalApp {
	getTokenCache(): { getAllAccounts(): Promise<{ username: string }[]>; serialize(): Promise<string> };
	acquireTokenSilent(req: { scopes: string[]; account?: unknown }): Promise<{ accessToken: string } | null>;
	acquireTokenByDeviceCode(req: {
		scopes: string[];
		deviceCodeCallback: (r: { message: string }) => void;
	}): Promise<{ accessToken: string; account?: { username?: string } } | null>;
}

function buildApp(serializedCache: string | null): MsalApp {
	const app = new PublicClientApplication({
		auth: { clientId: CLIENT_ID, authority: AUTHORITY },
	});
	if (serializedCache) app.getTokenCache().deserialize(serializedCache);
	return app as unknown as MsalApp;
}

/** Reads the cache, refusing loudly if it is present but unreadable. */
function requireCache(): string {
	const raw = loadCache();
	if (raw === null) throw new Error(INIT_HINT);
	try {
		JSON.parse(raw);
	} catch (e) {
		// Do not delete and re-prompt: that turns a truncated file into a
		// mysterious daily device-code dance with no explanation.
		throw new Error(`teams auth cache at ${cachePath()} is unreadable (${e}); delete it and run /teams init`);
	}
	return raw;
}

/**
 * A token for `scopes`, silently. Never prompts.
 *
 * `app` is injectable for tests only; production passes nothing.
 */
export async function getToken(opts: { scopes: string[]; app?: MsalApp }): Promise<string> {
	const app = opts.app ?? buildApp(requireCache());
	const accounts = await app.getTokenCache().getAllAccounts();
	if (accounts.length === 0) throw new Error(INIT_HINT);

	let result: { accessToken: string } | null = null;
	try {
		result = await app.acquireTokenSilent({ scopes: opts.scopes, account: accounts[0] });
	} catch (e) {
		// interaction_required, expired refresh token, revoked consent: all mean
		// the same thing to a caller that must not prompt.
		throw new Error(`${INIT_HINT} (silent token failed: ${e instanceof Error ? e.message : e})`);
	}
	if (!result?.accessToken) throw new Error(INIT_HINT);

	// The refresh token may have rotated; persist or the next run re-prompts.
	saveCache(await app.getTokenCache().serialize());
	return result.accessToken;
}

/** The one interactive path. Device code: no password is stored anywhere. */
export async function init(opts: {
	app?: MsalApp;
	onPrompt: (message: string) => void;
	scopes?: string[];
}): Promise<{ username: string; cache: string }> {
	const app = opts.app ?? buildApp(loadCache());
	const result = await app.acquireTokenByDeviceCode({
		scopes: opts.scopes ?? GRAPH_SCOPES,
		deviceCodeCallback: (r) => opts.onPrompt(r.message),
	});
	if (!result?.accessToken) throw new Error("device code flow returned no token");
	const serialized = await app.getTokenCache().serialize();
	saveCache(serialized);
	return { username: result.account?.username ?? "(unknown)", cache: cachePath() };
}

export interface VerifyResult {
	ok: boolean;
	/**
	 * True when the check could not be COMPLETED, as opposed to failing.
	 *
	 * A 429 or a 5xx says nothing about the token. Reporting it as "rejected"
	 * sends the user off to sign in again to fix a problem that fixes itself,
	 * and teaches them that the verifier lies.
	 */
	transient?: boolean;
	status?: number;
	aud?: string;
	oid?: string;
	tid?: string;
	displayName?: string;
	upn?: string;
	error?: string;
}

/**
 * Proves the token actually works: right audience, and Graph answers as us.
 *
 * Storing a token is not the same as having access. The account can be missing
 * a licence, the tenant can refuse the scope, the device clock can be off. A
 * login that only reports "saved" defers that discovery to the first real
 * operation, where it reads as a Teams outage rather than a failed login.
 *
 * `doFetch` is injectable for tests; production passes nothing.
 */
export async function verify(
	token: string,
	doFetch: (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json(): Promise<Record<string, unknown>> }> = (u, i) =>
		fetch(u, i) as unknown as Promise<{ status: number; json(): Promise<Record<string, unknown>> }>,
): Promise<VerifyResult> {
	let aud: string;
	let oid: string;
	let tid: string;
	try {
		aud = tokenClaim(token, "aud");
		oid = tokenClaim(token, "oid");
		tid = tokenClaim(token, "tid");
	} catch (e) {
		return { ok: false, error: String(e instanceof Error ? e.message : e) };
	}
	if (!aud.startsWith("https://graph.microsoft.com"))
		return { ok: false, aud, oid, tid, error: `wrong audience: ${aud} (expected Graph)` };

	const r = await doFetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${token}` } });
	const body = await r.json().catch(() => ({}) as Record<string, unknown>);
	if (r.status !== 200) {
		const transient = r.status === 429 || r.status >= 500;
		const detail = (body as { error?: { message?: string } })?.error?.message ?? JSON.stringify(body).slice(0, 200);
		return { ok: false, transient, status: r.status, aud, oid, tid, error: detail };
	}
	return {
		ok: true,
		status: r.status,
		aud,
		oid,
		tid,
		displayName: typeof body.displayName === "string" ? body.displayName : undefined,
		upn: typeof body.userPrincipalName === "string" ? body.userPrincipalName : undefined,
	};
}

export interface Identity {
	displayName: string;
	upn: string;
	oid: string;
	tid: string;
}

function identityPath(): string {
	return path.join(path.dirname(cachePath()), "identity.json");
}

/**
 * Who the signed-in user is, from the sign-in itself.
 *
 * The display name decides which chat member to drop from a picker label,
 * whether a message is mine, and whether a mention is of me -- so it has to be
 * exactly what Teams shows. Reading it from the account rather than a constant
 * keeps a real person's name out of the source, and means it cannot go stale
 * against the directory.
 *
 * Cached on disk: it is stable for years, and a /me call per session start is a
 * pointless dependency on Graph being up.
 */
export async function identity(opts: { refresh?: boolean } = {}): Promise<Identity> {
	const p = identityPath();
	if (!opts.refresh && fs.existsSync(p)) {
		try {
			return JSON.parse(fs.readFileSync(p, "utf8")) as Identity;
		} catch (e) {
			// Refetch, but say so rather than silently papering over a bad file.
			console.warn(`[teams] identity cache unreadable, refetching: ${e}`);
		}
	}
	const v = await verify(await getToken({ scopes: GRAPH_SCOPES }));
	if (!v.ok) throw new Error(`cannot read your identity: ${v.error ?? `HTTP ${v.status}`}`);
	const id: Identity = {
		displayName: v.displayName ?? v.upn ?? "",
		upn: v.upn ?? "",
		oid: v.oid ?? "",
		tid: v.tid ?? "",
	};
	if (!id.displayName) throw new Error("Graph returned no displayName for this account");
	saveIdentity(id);
	return id;
}

export function saveIdentity(id: Identity): void {
	const p = identityPath();
	fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
	fs.writeFileSync(p, JSON.stringify(id, null, 1), { mode: 0o600 });
	fs.chmodSync(p, 0o600);
}

/** One claim out of a JWT. markChatReadForUser needs `oid` and `tid`. */
export function tokenClaim(token: string, key: string): string {
	const part = token.split(".")[1];
	if (!part) throw new Error("access token is not a JWT");
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
	} catch (e) {
		throw new Error(`access token payload is not JSON: ${e}`);
	}
	const v = payload[key];
	if (typeof v !== "string") throw new Error(`access token has no ${key} claim`);
	return v;
}
