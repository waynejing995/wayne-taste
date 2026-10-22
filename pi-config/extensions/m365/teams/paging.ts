/**
 * Reads a cursor-paged listing to its end, one page at a time.
 *
 * A page names the cursor of the page after it; the last page names none. The walk ends where the server stops naming
 * one, so a list of any length is read whole: there is no page count here to reach. A cursor the walk has already
 * followed is refused instead, because a server that hands back a page it gave before is looping and would otherwise
 * be read forever. A caller that stops early stops the walk, and an aborted signal stops it before the next request.
 */
export async function* cursorPages<P>(
	first: P,
	cursorOf: (page: P) => string | undefined,
	fetchPage: (cursor: string) => Promise<P>,
	signal?: AbortSignal,
): AsyncGenerator<P> {
	const followed = new Set<string>();
	let page = first;
	for (;;) {
		yield page;
		const next = cursorOf(page);
		if (next === undefined) return;
		if (followed.has(next)) {
			throw new Error("the server named a page it had already given; refusing to loop");
		}
		followed.add(next);
		signal?.throwIfAborted();
		page = await fetchPage(next);
	}
}
