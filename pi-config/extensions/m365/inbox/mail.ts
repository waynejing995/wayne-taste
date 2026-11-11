/**
 * Which Inbox mail is new since the cursor. No pi or Graph import, so its test runs on plain node.
 *
 * The cursor is the `received` time of the last mail recorded. Mail at exactly that time is read again
 * (`>=`): two mails can share a second, and when the second failed to record, `>` would skip it forever.
 * The re-read first one is harmless: `inbox add` answers `seen` for a key it already holds.
 */

/** The fields of an Outlook summary this needs. */
export type MailStamp = { received: string };

/** One page of the Inbox, newest first, as Mailbox.list returns it. */
export type PageFn<T extends MailStamp> = (skip: number) => Promise<T[]>;

/**
 * Every mail received at or after `since`, oldest first. Pages until a page reaches past `since` or runs
 * out, so a long absence loses nothing to the page size.
 */
export async function mailSince<T extends MailStamp>(page: PageFn<T>, since: string, pageSize: number): Promise<T[]> {
	const fresh: T[] = [];
	for (let skip = 0; ; skip += pageSize) {
		const batch = await page(skip);
		fresh.push(...batch.filter((m) => m.received >= since));
		if (batch.length < pageSize || batch.some((m) => m.received < since)) break;
	}
	return fresh.reverse();
}
