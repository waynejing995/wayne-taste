/**
 * Live seed: delivers the fixture report to your own mailbox, so the rendering
 * can be checked in Outlook on the web.
 *
 *   node tests/live-seed.mjs [message.eml] [--dry-run]
 *
 * The message defaults to tests/fixtures/seed-report.eml. A message for this
 * script is addressed to the placeholder `self@example.invalid`, never to a real
 * person: before any token is asked for, every recipient in it (To, Cc and Bcc)
 * must be that placeholder, or the script refuses and exits 1. At send time the
 * placeholder becomes the signed-in account's own address, so the mail can only
 * ever reach the person running it. Message-ID and Date are dropped, so Exchange
 * stamps fresh ones and never de-duplicates a re-send.
 *
 * --dry-run prints the request Graph would receive and sends nothing; it never
 * reads the token cache. See tests/LIVE-TEST-RULES.md.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "/root/.nvm/versions/node/v22.22.1/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";
import PostalMime from "postal-mime";
// Resolved paths: importing through the symlink would give a SECOND copy of
// every module, and `instanceof` across the two silently fails. See ext-path.mjs.
import { ext } from "./ext-path.mjs";

/** The only recipient a message for this script may name; it stands for the signed-in user. */
const SELF = "self@example.invalid";

const D = "/root/.nvm/versions/node/v22.22.1/lib/node_modules/@earendil-works/pi-coding-agent";
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
const { Mailbox } = await jiti.import(ext("mailbox.ts"));

const dryRun = process.argv.includes("--dry-run");
const given = process.argv.slice(2).find((a) => a !== "--dry-run");
const file = given ?? join(dirname(fileURLToPath(import.meta.url)), "fixtures", "seed-report.eml");
const raw = readFileSync(file);

// The refusal runs before a token is asked for or a request is built.
const mail = await PostalMime.parse(raw);
const recipients = [...(mail.to ?? []), ...(mail.cc ?? []), ...(mail.bcc ?? [])].flatMap((a) => ("group" in a ? a.group : [a]));
const others = recipients.filter((a) => a.address.toLowerCase() !== SELF).map((a) => a.address);
if (others.length > 0) {
	console.error(`live-seed: refusing to send to ${others.join(", ")}: address a live message to ${SELF}, which becomes your own address.`);
	console.error("See tests/LIVE-TEST-RULES.md.");
	process.exit(1);
}

/**
 * The bytes with the Message-ID and Date headers removed and the placeholder replaced by
 * `me` in the headers. Only the header block is rebuilt, with the line ending of the blank
 * line that closes it. The body is copied byte for byte: the file is read one char per
 * byte, so nothing is re-encoded.
 */
function forSending(bytes, me) {
	const text = bytes.toString("latin1");
	const gap = /\r?\n\r?\n/.exec(text);
	if (!gap) throw new Error(`${file} has no blank line between its headers and its body`);
	const eol = gap[0].startsWith("\r") ? "\r\n" : "\n";
	const kept = [];
	let drop = false;
	for (const line of text.slice(0, gap.index).split(/\r?\n/)) {
		// A folded header continues the one above it, so it is dropped or kept with that header.
		if (!/^[ \t]/.test(line)) drop = /^(Message-ID|Date):/i.test(line);
		if (!drop) kept.push(line.split(SELF).join(me));
	}
	return Buffer.from(kept.join(eol) + text.slice(gap.index), "latin1");
}

/** --dry-run: the request as Graph would receive it, read back from the body, then a 202. */
async function dryTransport(url, init) {
	const sent = Buffer.from(init.body ?? "", "base64").toString("latin1");
	const fields = sent.split(/\r?\n\r?\n/)[0].match(/^[\w-]+(?=:)/gm) ?? [];
	console.log(`dry run: ${init.method} ${url} (${init.headers["Content-Type"]}, ${sent.length} bytes)`);
	console.log(`dry run: header fields: ${fields.join(", ")}`);
	return { status: 202, text: async () => "" };
}

const graph = dryRun
	? new GraphClient(async () => "dry-run", dryTransport)
	: new GraphClient(() => getToken({ scopes: GRAPH_SCOPES }));
// Your own address, from the sign-in (cached after the first ask); a dry run never asks.
const me = dryRun ? SELF : (await new Mailbox(graph).me()).addresses[0];
await graph.postText("/me/sendMail", forSending(raw, me).toString("base64"), "text/plain");
console.log(
	dryRun
		? "dry run: nothing was sent"
		: `accepted by Graph: "${mail.subject}" to ${me}. Look for it in your Inbox in Outlook on the web.`,
);
