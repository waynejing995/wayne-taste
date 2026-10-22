/**
 * Live cleanup: removes the mail the live scripts left in the user's mailbox.
 *
 *   node tests/live-cleanup.mjs [--dry-run]
 *
 * A message is ours when its subject contains [omp outlook e2e] or
 * [omp outlook probe]. Each of ours in Inbox, Archive, Sent Items and Drafts
 * moves to Deleted Items. Then every one of ours in Deleted Items, including any
 * an earlier run left there, is deleted with DELETE /me/messages/{id}. Prints a
 * count per folder and no message text.
 *
 * --dry-run works on a small in-memory mailbox and never reads the token cache.
 * See tests/LIVE-TEST-RULES.md.
 */
import { createJiti, PI } from "../../tests/host.mjs";
// Resolved paths: importing through the symlink would give a SECOND copy of
// every module, and `instanceof` across the two silently fails. See ext-path.mjs.
import { ext } from "./ext-path.mjs";

const MARKS = ["[omp outlook e2e]", "[omp outlook probe]"];
const BASE = "https://graph.microsoft.com/v1.0";
const SOURCES = ["inbox", "archive", "sentitems", "drafts"];

const D = PI;
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${D}/dist/index.js`,
		"@earendil-works/pi-ai": `${D}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${D}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${D}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const { getToken, GRAPH_SCOPES } = await jiti.import(ext("../core/auth.ts"));
const { GraphClient } = await jiti.import(ext("../core/graph.ts"));
const { Mailbox, FOLDER_LABELS } = await jiti.import(ext("mailbox.ts"));

const dryRun = process.argv.includes("--dry-run");
const transport = dryRun ? fakeMailbox() : fetch;
const graph = new GraphClient(dryRun ? async () => "dry-run" : () => getToken({ scopes: GRAPH_SCOPES }), transport);
const mailbox = new Mailbox(graph);

const ours = (m) => MARKS.some((mark) => (m.subject ?? "").includes(mark));

/** Ours, in one folder, as id and subject. GraphClient follows the nextLink, so no page is skipped. */
const listed = async (folder) =>
	(await graph.getAll(`/me/mailFolders/${folder}/messages?$select=id,subject&$top=100`, { max: Infinity })).filter(ours);

/** DELETE /me/messages/{id}. GraphClient has no DELETE verb, so this one request uses the same transport. */
async function remove(id) {
	const url = `${BASE}/me/messages/${id}`;
	const r = await transport(url, { method: "DELETE", headers: { Authorization: `Bearer ${await graph.rawToken()}` } });
	if (r.status < 200 || r.status >= 300) throw new Error(`Graph ${r.status} on DELETE ${url}: ${await r.text()}`);
}

for (const folder of SOURCES) {
	const hits = await listed(folder);
	for (const m of hits) await mailbox.move(m.id, "deleteditems");
	console.log(`${FOLDER_LABELS[folder]}: ${hits.length} moved to ${FOLDER_LABELS.deleteditems}`);
}
// Moved messages get new ids, so this lists Deleted Items after the moves and deletes what it finds there.
const doomed = await listed("deleteditems");
for (const m of doomed) await remove(m.id);
console.log(`${FOLDER_LABELS.deleteditems}: ${doomed.length} deleted`);

/**
 * --dry-run: an in-memory mailbox that answers the requests above the way Graph
 * does for them. Each folder holds one of ours or a message that is not.
 */
function fakeMailbox() {
	const boxes = {
		inbox: [
			{ id: "in-1", subject: "[omp outlook e2e] seed report" },
			{ id: "in-2", subject: "Quarterly plan" },
		],
		archive: [],
		sentitems: [{ id: "sent-1", subject: "[omp outlook probe] hello" }],
		drafts: [{ id: "draft-1", subject: "Not ours" }],
		deleteditems: [{ id: "old-1", subject: "[omp outlook e2e] left by an earlier run" }],
	};
	const reply = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
	const holding = (id) => Object.values(boxes).find((list) => list.some((m) => m.id === id));
	return async (url, init) => {
		const method = init.method ?? "GET";
		const path = url.slice(BASE.length);
		console.log(`dry run: ${method} ${path.split("?")[0]}`);
		let m;
		if (method === "GET" && (m = /^\/me\/mailFolders\/(\w+)\/messages\?/.exec(path))) return reply(200, { value: boxes[m[1]] });
		if (method === "POST" && (m = /^\/me\/messages\/([^/]+)\/move$/.exec(path))) {
			const list = holding(m[1]);
			const [msg] = list.splice(list.findIndex((x) => x.id === m[1]), 1);
			const moved = { ...msg, id: `${msg.id}-moved` };
			boxes.deleteditems.push(moved);
			return reply(201, { id: moved.id });
		}
		if (method === "DELETE" && (m = /^\/me\/messages\/([^/]+)$/.exec(path))) {
			const list = holding(m[1]);
			list.splice(list.findIndex((x) => x.id === m[1]), 1);
			return reply(204);
		}
		throw new Error(`dry run has no answer for ${method} ${path}`);
	};
}
