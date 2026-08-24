/**
 * Microsoft Graph over HTTP. The only place in the extension that knows the
 * wire protocol.
 *
 * Two behaviours here are not incidental:
 *
 *   - `getAll` follows `@odata.nextLink`. A client that ignores it silently
 *     truncates, and truncation looks exactly like "there was nothing else".
 *     fetch_teams.py shipped that bug once and it was found months later in a
 *     digest, not by a test.
 *   - Every non-2xx becomes a thrown `GraphError` carrying the status. A 429
 *     turned into an empty list is an outage the status bar renders as "0
 *     unread"; the caller must be able to tell "nothing" from "I could not ask".
 */

const BASE = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: string,
	) {
		super(message);
		this.name = "GraphError";
	}

	/** 429 and 503 mean "ask again later"; a caller may serve a stale cache. */
	get throttled(): boolean {
		return this.status === 429 || this.status === 503;
	}
}

/** The subset of `fetch` this client uses, so tests can supply a stub. */
type Transport = (
	url: string,
	init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }>;

export class GraphClient {
	constructor(
		private readonly token: () => Promise<string>,
		private readonly doFetch: Transport = fetch as unknown as Transport,
	) {}

	/**
	 * The raw access token.
	 *
	 * markChatReadForUser identifies the user in the BODY, and the only place
	 * that identity exists is the token's oid/tid claims. Exposed here rather
	 * than threading a second token source through the backend.
	 */
	rawToken(): Promise<string> {
		return this.token();
	}

	private url(pathOrUrl: string): string {
		return pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`;
	}

	private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
		return { Authorization: `Bearer ${await this.token()}`, Accept: "application/json", ...extra };
	}

	private parse(text: string, status: number): Record<string, unknown> {
		if (text.trim() === "") return {};
		try {
			return JSON.parse(text) as Record<string, unknown>;
		} catch {
			// A proxy error page or an HTML sign-in redirect lands here. Returning
			// {} would make it indistinguishable from an empty successful reply.
			throw new GraphError(`Graph returned non-JSON (HTTP ${status}): ${text.slice(0, 200)}`, status, text);
		}
	}

	private fail(status: number, text: string, url: string): never {
		const body = (() => {
			try {
				return JSON.parse(text) as { error?: { code?: string; message?: string } };
			} catch {
				return {};
			}
		})();
		const code = body.error?.code ?? `HTTP ${status}`;
		const detail = body.error?.message ?? text.slice(0, 200);
		throw new GraphError(`Graph ${status} on ${url}: ${code}${detail ? ` — ${detail}` : ""}`, status, text);
	}

	async get<T = Record<string, unknown>>(pathOrUrl: string): Promise<T> {
		const url = this.url(pathOrUrl);
		const r = await this.doFetch(url, { headers: await this.headers() });
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) this.fail(r.status, text, url);
		return this.parse(text, r.status) as T;
	}

	/**
	 * Every page of a collection.
	 *
	 * `max` caps the walk. It is not a page size: the last page is kept whole,
	 * so the result may exceed `max` slightly rather than cutting mid-page.
	 */
	async getAll<T = unknown>(pathOrUrl: string, opts: { max?: number } = {}): Promise<T[]> {
		const max = opts.max ?? 1000;
		const out: T[] = [];
		const seen = new Set<string>();
		let next: string | undefined = this.url(pathOrUrl);

		while (next) {
			if (seen.has(next)) throw new GraphError(`Graph nextLink repeats itself: ${next}`, 0, "");
			seen.add(next);
			const page: { value?: T[]; "@odata.nextLink"?: string } = await this.get(next);
			out.push(...(page.value ?? []));
			if (out.length >= max) break;
			next = page["@odata.nextLink"];
		}
		return out;
	}

	async post<T = Record<string, unknown>>(pathOrUrl: string, payload: unknown): Promise<T> {
		const url = this.url(pathOrUrl);
		const r = await this.doFetch(url, {
			method: "POST",
			headers: await this.headers({ "Content-Type": "application/json" }),
			body: JSON.stringify(payload),
		});
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) this.fail(r.status, text, url);
		return this.parse(text, r.status) as T;
	}

	/** Hosted image contents: bytes, not JSON. */
	async getBytes(pathOrUrl: string): Promise<Buffer> {
		const url = this.url(pathOrUrl);
		const r = await this.doFetch(url, { headers: await this.headers({ Accept: "*/*" }) });
		if (r.status < 200 || r.status >= 300) this.fail(r.status, await r.text(), url);
		if (!r.arrayBuffer) throw new Error("transport cannot return bytes");
		return Buffer.from(await r.arrayBuffer());
	}
}
