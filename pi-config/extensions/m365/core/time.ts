/**
 * Every timestamp shown to the user goes through here.
 *
 * Graph and chatsvc both hand back UTC ISO strings. Slicing the hour out of
 * one renders the wrong time for anyone not sitting on UTC — an 06:20Z message
 * is 14:20 in Asia/Shanghai — and the error is silent, which is the worst kind.
 */

/**
 * "2026-08-20 14:20" in the machine's own timezone.
 *
 * The year is included on purpose: a chat pane mixing today with last month is
 * unreadable when every row says only HH:MM.
 */
export function formatLocal(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	// Unparseable input is echoed verbatim. A visibly odd timestamp is a bug
	// report; "Invalid Date" or a silent blank is a mystery.
	if (Number.isNaN(d.getTime())) return iso;
	// sv-SE formats as "YYYY-MM-DD HH:MM:SS" while still resolving the local
	// zone, which avoids hand-rolling padding and offset arithmetic.
	return d.toLocaleString("sv-SE").slice(0, 16);
}

/** "14:20" in local time, for rows that already show the date elsewhere. */
export function formatLocalTime(iso: string): string {
	const full = formatLocal(iso);
	return full.length === 16 ? full.slice(11) : full;
}
