/**
 * The people the user works with, from Graph's relevance list (/me/people).
 * Behind teams_people, outlook_people and every @mention.
 *
 * /me/people rather than /users: the tenant throttles directory reads hard
 * (observed HTTP 429 on /users $search and $filter, and /users/{email} and /me
 * answering 429 for minutes while /me/people answered 200), and the relevance
 * list is the better answer for "who do I want to reach" anyway.
 */
import type { GraphClient } from "./graph.ts";

export interface Person {
	name: string;
	email: string;
	title: string;
}

interface RawPerson {
	id?: string;
	displayName?: string;
	jobTitle?: string | null;
	scoredEmailAddresses?: { address?: string }[];
	personType?: { subclass?: string };
}

/** Up to ten people matching `query` (a name or part of one), most relevant first. */
export async function searchPeople(graph: GraphClient, query: string): Promise<Person[]> {
	const data = await graph.get<{ value?: RawPerson[] }>(`/me/people?$search=${encodeURIComponent(query)}&$top=10`);
	return (data.value ?? [])
		.map((p) => {
			const emails = (p.scoredEmailAddresses ?? []).map((e) => e.address ?? "").filter(Boolean);
			return { name: p.displayName ?? "", email: emails[0]?.toLowerCase() ?? "", title: p.jobTitle ?? "" };
		})
		.filter((p) => p.name);
}

/**
 * The directory object id of the colleague whose address is exactly `email`.
 * An organization user's people entry carries that id. Only an exact address
 * counts -- a name search for a common name returns several different people --
 * and no match throws, naming the address, so nothing gets sent.
 */
export async function colleagueId(graph: GraphClient, email: string): Promise<string> {
	const data = await graph.get<{ value?: RawPerson[] }>(
		`/me/people?$search=${encodeURIComponent(`"${email}"`)}&$top=10&$select=id,displayName,scoredEmailAddresses,personType`,
	);
	const want = email.toLowerCase();
	const hit = (data.value ?? []).find(
		(p) => p.personType?.subclass === "OrganizationUser" && (p.scoredEmailAddresses ?? []).some((e) => e.address?.toLowerCase() === want),
	);
	if (!hit?.id) throw new Error(`no colleague with the address ${email} among your people; nothing was sent`);
	return hit.id;
}
