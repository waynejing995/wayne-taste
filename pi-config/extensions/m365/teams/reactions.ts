/**
 * Message reactions: the names teams_react takes, and the counts a message shows.
 *
 * Graph lists each reaction with its emoji (`reactionType: "👍"`, one entry per person); chatsvc, which serves the
 * self-chat, keeps them under `properties.emotions` by legacy key (`like`), with the people who chose it. Both read
 * back as the emoji and how many chose it.
 */

/** The classic Teams reactions, by the names Graph's legacy API used, as the emoji Graph now stores. */
export const REACTIONS: Readonly<Record<string, string>> = {
	like: "👍",
	heart: "❤️",
	laugh: "😆",
	surprised: "😮",
	sad: "😢",
	angry: "😡",
};

export interface ReactionCount {
	reaction: string;
	count: number;
}

/**
 * The reactionType to send for a name or an emoji. Anything else is refused: Graph would store any string as a
 * "reaction" nobody can see.
 */
export function reactionType(input: string): string {
	const s = input.trim();
	const named = REACTIONS[s.toLowerCase()];
	if (named) return named;
	if (/^\p{Extended_Pictographic}/u.test(s) && !/[\p{L}\p{N}\s]/u.test(s)) return s;
	throw new Error(`reaction must be one of ${Object.keys(REACTIONS).join(", ")} or an emoji, not "${input}"`);
}

/** Counts in first-seen order, empty ones dropped. */
function tally(entries: [string, number][]): ReactionCount[] {
	const counts = new Map<string, number>();
	for (const [reaction, n] of entries) if (reaction && n > 0) counts.set(reaction, (counts.get(reaction) ?? 0) + n);
	return [...counts].map(([reaction, count]) => ({ reaction, count }));
}

/** Graph's `reactions`: one entry per person and reaction. */
export function graphReactions(reactions: unknown): ReactionCount[] {
	if (!Array.isArray(reactions)) return [];
	return tally(reactions.map((r): [string, number] => [String((r as { reactionType?: unknown })?.reactionType ?? ""), 1]));
}

/** chatsvc's `properties.emotions`: [{key, users: [...]}]; a removed reaction stays with no users. */
export function skypeReactions(emotions: unknown): ReactionCount[] {
	if (!Array.isArray(emotions)) return [];
	return tally(
		emotions.map((e): [string, number] => {
			const { key, users } = (e ?? {}) as { key?: unknown; users?: unknown };
			const k = String(key ?? "");
			return [REACTIONS[k] ?? k, Array.isArray(users) ? users.length : 0];
		}),
	);
}

/** "👍 2 · 😆 1", for one line under a message. */
export function reactionLine(reactions: ReactionCount[] | undefined): string {
	return (reactions ?? []).map((r) => `${r.reaction} ${r.count}`).join(" · ");
}
