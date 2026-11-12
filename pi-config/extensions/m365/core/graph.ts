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
type ResponseBody = { status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer>; body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } };
type Transport = (
	url: string,
	init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<ResponseBody>;

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

	/** Extra headers are merged over the bearer and Accept defaults. */
	async get<T = Record<string, unknown>>(
		pathOrUrl: string,
		opts: { headers?: Record<string, string> } = {},
	): Promise<T> {
		const url = this.url(pathOrUrl);
		const r = await this.doFetch(url, { headers: await this.headers(opts.headers) });
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
		return this.send("POST", pathOrUrl, JSON.stringify(payload), "application/json");
	}

	async patch<T = Record<string, unknown>>(pathOrUrl: string, payload: unknown): Promise<T> {
		return this.send("PATCH", pathOrUrl, JSON.stringify(payload), "application/json");
	}

	/** Raw string body, sent as-is under contentType: base64 MIME for the mail endpoints. */
	async postText<T = Record<string, unknown>>(pathOrUrl: string, body: string, contentType: string): Promise<T> {
		return this.send("POST", pathOrUrl, body, contentType);
	}

	private async send<T>(method: string, pathOrUrl: string, body: string, contentType: string): Promise<T> {
		const url = this.url(pathOrUrl);
		const r = await this.doFetch(url, { method, headers: await this.headers({ "Content-Type": contentType }), body });
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) this.fail(r.status, text, url);
		return this.parse(text, r.status) as T;
	}

	/**
	 * Bytes, not JSON. `timeoutMs` bounds the whole download; leave it out for files and mail, which may be large and
	 * slow but are fetched on purpose.
	 */
	async getBytes(pathOrUrl: string, maxBytes = Number.POSITIVE_INFINITY, timeoutMs?: number): Promise<Buffer> {
		const url = this.url(pathOrUrl);
		const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
		const r = await this.doFetch(url, { headers: await this.headers({ Accept: "*/*" }), signal });
		if (r.status < 200 || r.status >= 300) this.fail(r.status, await r.text(), url);
		return readBounded(r, maxBytes, signal);
	}
}

export async function readBounded(r: ResponseBody, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
	if (signal?.aborted) throw new Error("download timed out");
	if (r.body) {
		const reader = r.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new Error(`image over ${Math.floor(maxBytes / (1024 * 1024))} MB`);
			}
			chunks.push(value);
		}
		return Buffer.concat(chunks, size);
	}
	if (!r.arrayBuffer) throw new Error("transport cannot return bytes");
	const bytes = Buffer.from(await r.arrayBuffer());
	if (bytes.length > maxBytes) throw new Error(`image over ${Math.floor(maxBytes / (1024 * 1024))} MB`);
	return bytes;
}
