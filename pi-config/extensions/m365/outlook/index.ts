/**
 * Outlook for pi: seven agent tools, an Inbox unread count in the status bar,
 * and the /outlook overlay. Every call goes through one Mailbox, which reaches
 * Graph with the Teams sign-in (teams/auth.ts), so nothing here stores a credential.
 */
import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as auth from "../core/auth.ts";
import { describeImage } from "../core/describe-image.ts";
import { GraphClient } from "../core/graph.ts";
import { searchPeople } from "../core/people.ts";
import { downloadShared } from "../core/shares.ts";
import { setStatusPart } from "../core/status-row.ts";
import { formatLocal } from "../core/time.ts";
import { downloads, isShared, saveAttachment, sharedLinks } from "./files.ts";
import { FOLDER_LABELS, Mailbox, type Summary } from "./mailbox.ts";
import { type Address, AGENT_FOOTER, type ComposeDraft, type ParsedMail, withMentioned } from "./mime.ts";
import { type OverlayDeps, openOutlookOverlay } from "./overlay.ts";
import { readSignature, signaturePath, writeSignature } from "./signature.ts";

/** Said to the agent: the signature is the extension's job, so it must not sign the mail itself. */
const SIGNED = " The user's signature, when one is set, is added after the body automatically, so do not sign the message yourself.";

/** Local `StringEnum`: `Type.Unsafe({type:"string", enum})`, the flat schema teams/index.ts uses. */
function StringEnum(values: string[], options?: { description?: string; default?: string }) {
	return Type.Unsafe({ type: "string", enum: values, ...options });
}

type ComposeKind = "new" | "reply" | "reply_all" | "forward";
/** A compose tool's parameters as the agent gives them, before any address is parsed. */
type ComposeParams = { kind?: string; id?: string; to?: string[]; cc?: string[]; subject?: string; body: string };

const HINT = "not authenticated — run /teams init";
const POLL_MS = 60_000;
/** Pictures are heavy in context; a mail can hold many. The first ones the reader sees win, as in teams_read. */
const MAX_IMAGES_PER_READ = 4;
/** Raw bytes past this would exceed the 5 MB base64 limit model APIs set per image. */
const MAX_IMAGE_BYTES = 3_750_000;
/** The image types model APIs accept. */
const MODEL_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// ── Formatting ──────────────────────────────────────────────────────────────

/** "Name <address>", or the bare address when the header gave no name. */
function who(a?: Address): string {
	if (!a) return "(unknown)";
	return a.name ? `${a.name} <${a.address}>` : a.address;
}

/** "Name <address>" or a bare address: the forms the tools accept for recipients. */
function parseAddress(text: string): Address {
	const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(text);
	if (!m) return { address: text.trim() };
	return m[1] ? { name: m[1], address: m[2].trim() } : { address: m[2].trim() };
}

/** 2048 → "2.0 KB", the size a mail client shows. */
function humanSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One message in a list: id · local time · from · subject, then ● when unread and 📎 with attachments. */
function summaryLine(s: Summary): string {
	const marks = `${s.isRead ? "" : " ●"}${s.hasAttachments ? " 📎" : ""}`;
	return `${s.id} · ${formatLocal(s.received)} · ${who(s.from)} · ${s.subject}${marks}`;
}

/** The header block, the Markdown body, then the attachments and the SharePoint/OneDrive files it links to: what outlook_read shows. */
function reading(s: Summary, mail: ParsedMail, markdown: string): string {
	const lines = [
		`From: ${who(s.from)}`,
		`To: ${mail.to.map(who).join(", ") || "(none)"}`,
		`Cc: ${mail.cc.map(who).join(", ") || "(none)"}`,
		`Date: ${formatLocal(s.received)}`,
		`Subject: ${s.subject}`,
		`id: ${s.id}`,
		"",
		markdown,
	];
	if (mail.attachments.length > 0) {
		lines.push("", "Attachments:", ...mail.attachments.map((a) => `${a.filename} · ${a.mimeType} · ${humanSize(a.size)}`));
	}
	const linked = sharedLinks(markdown);
	if (linked.length > 0) lines.push("", "Linked files (SharePoint/OneDrive):", ...linked.map((l) => `${l.text} · ${l.url}`));
	return lines.join("\n");
}

/** The first line of an error, cut to fit the status bar. */
function shortError(e: unknown): string {
	const first = (e instanceof Error ? e.message : String(e)).split("\n")[0].trim();
	return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

/** Every tool answers with one text block, except outlook_read when the mail has pictures. */
const textResult = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

// ── Compose ─────────────────────────────────────────────────────────────────

/** The kind of a compose call, after the checks that need no Graph call. */
function composeKind(p: ComposeParams): ComposeKind {
	const kind = (p.kind ?? "new") as ComposeKind;
	if (kind !== "new" && !p.id) throw new Error(`kind=${kind} needs id, the id of the message it answers`);
	if (kind === "new" && !p.subject) throw new Error("kind=new needs subject");
	return kind;
}

const COMPOSE_PARAMETERS = Type.Object({
	kind: Type.Optional(
		StringEnum(["new", "reply", "reply_all", "forward"], {
			default: "new",
			description: "new starts a message; reply, reply_all and forward answer the message named by id",
		}),
	),
	id: Type.Optional(Type.String({ description: "Id of the message answered or forwarded; required unless kind is new" })),
	to: Type.Optional(
		Type.Array(Type.String(), {
			description: 'Recipients: addresses or "Name <address>". Replaces the default To. Take addresses from outlook_people or the mail answered; never guess one.',
		}),
	),
	cc: Type.Optional(Type.Array(Type.String(), { description: "Copy recipients, same form and rule as to. Replaces the default Cc." })),
	subject: Type.Optional(Type.String({ description: "Required for a new message; for a reply it replaces the default RE: subject." })),
	body: Type.String({ description: "The message body in Markdown." }),
});

const MARKUP =
	"Markdown supports [text]{.ok|.bad|.warn|.muted|.info} for a color span and > [!SUMMARY|NOTE|TIP|WARNING|CAUTION] for a callout; " +
	"a headerless two-column table is a key/value sheet. Raw HTML is shown literally. " +
	"@[Name](address) is an Outlook @mention; as in Outlook, a mentioned person not already in To or Cc is added to To, " +
	"so mention only people who should receive the mail, with the address from outlook_people.";

const SEND_DESCRIPTION =
	"Send an email from the user's Outlook account, body in Markdown. Only send when the user asked you to. " +
	MARKUP +
	" Every message sent this way is footed with a note that an agent wrote it, so do not add your own disclaimer." +
	SIGNED;

const DRAFT_DESCRIPTION =
	"Save an email to Drafts in the user's Outlook account, unsent: the user reviews it there and sends it. " +
	MARKUP +
	" The same agent note is added, so do not add your own disclaimer." +
	SIGNED;

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const graph = new GraphClient(() => auth.getToken({ scopes: auth.GRAPH_SCOPES }));
	const mailbox = new Mailbox(graph);

	// Status-bar state. `unread` stays null until the first poll answers.
	let unread: number | null = null;
	let pollError = ""; // the last poll's failure; "" after a good one
	let transient = ""; // "sending…", "sent ✓" or "send failed ✗" while it shows
	let unreadInFlight = false;
	let unreadTimer: ReturnType<typeof setInterval> | undefined;

	function renderStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		const t = ctx.ui.theme;
		let s: string;
		if (pollError) s = t.fg("error", `Outlook: ${pollError}`);
		else if (unread === null) s = t.fg("dim", "Outlook: …");
		else if (unread > 0) s = t.fg("warning", `Outlook: ${unread} unread`);
		else s = t.fg("dim", "Outlook: 0");
		if (transient) s += t.fg("dim", ` · ${transient}`);
		setStatusPart(ctx.ui, "outlook", s);
	}

	/** Shows `text` after the count for holdMs, then lets the count return if `text` is still the one showing. */
	function flash(ctx: ExtensionContext, text: string, holdMs = 4000) {
		transient = text;
		renderStatus(ctx);
		setTimeout(() => {
			if (transient === text) {
				transient = "";
				renderStatus(ctx);
			}
		}, holdMs).unref?.();
	}

	/** One Inbox unread count. Single-flight: a call made while one is pending does nothing. */
	async function pollUnread(ctx: ExtensionContext) {
		if (unreadInFlight) return;
		unreadInFlight = true;
		try {
			unread = await mailbox.unreadCount();
			pollError = "";
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			pollError = msg.includes(HINT) ? "sign in with /teams init" : shortError(e);
		} finally {
			unreadInFlight = false;
			renderStatus(ctx);
		}
	}

	/**
	 * Mailbox's defaults for the kind, with the caller's To, Cc and Subject in their place, everyone the body
	 * @mentions added to To, and the MIME under the agent footer.
	 */
	async function composeMail(kind: ComposeKind, p: ComposeParams) {
		const defaults = await mailbox.draftFor(kind === "reply_all" ? "replyAll" : kind, p.id);
		if (p.to) defaults.to = p.to.map(parseAddress);
		if (p.cc) defaults.cc = p.cc.map(parseAddress);
		if (p.subject !== undefined) defaults.subject = p.subject;
		const draft = withMentioned(defaults, p.body);
		const eml = await mailbox.build({ ...draft, markdown: p.body, signature: readSignature(), footer: AGENT_FOOTER });
		return { draft, eml };
	}

	pi.registerTool({
		name: "outlook_list",
		label: "Outlook List",
		description:
			"List messages in an Outlook folder, newest first, one line each: id · local time · from · subject, " +
			"with ● when unread and 📎 when it has attachments. Read one with outlook_read by its id.",
		parameters: Type.Object({
			folder: Type.Optional(
				Type.String({
					default: "inbox",
					description:
						`${Object.keys(FOLDER_LABELS).join(", ")}, or any folder by name or path as outlook_folders shows it ` +
						'(e.g. "dri-devel" or "Inbox/Jira Change"), such as the folders mail rules file into',
				}),
			),
			unread_only: Type.Optional(Type.Boolean({ description: "Only unread messages" })),
			top: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "How many to list, 1–50 (default 20)" })),
			skip: Type.Optional(Type.Number({ minimum: 0, description: "Skip this many newest messages first, to page further back" })),
		}),
		async execute(_id, params) {
			const folder = await mailbox.resolveFolder(params.folder ?? "inbox");
			const rows = await mailbox.list(folder.id, {
				unreadOnly: params.unread_only ?? false,
				top: params.top ?? 20,
				skip: params.skip ?? 0,
			});
			return textResult(rows.length > 0 ? rows.map(summaryLine).join("\n") : `no messages in ${folder.path}`);
		},
	});

	pi.registerTool({
		name: "outlook_folders",
		label: "Outlook Folders",
		description:
			"List every Outlook mail folder, subfolders included (where mail rules file messages), one per line: path · unread · total. " +
			"Pass a path or name to outlook_list to read one.",
		parameters: Type.Object({}),
		async execute() {
			const all = await mailbox.folders();
			return textResult(all.map((f) => `${f.path} · ${f.unread} unread · ${f.total} total`).join("\n"));
		},
	});

	pi.registerTool({
		name: "outlook_people",
		label: "Outlook People",
		description:
			"Find a person's email address by name among the people the user works with. Use it for every recipient or " +
			"@mention you did not take from a mail itself; never guess an address. Several matches: ask the user which one.",
		parameters: Type.Object({ query: Type.String({ description: "Name or part of it" }) }),
		async execute(_id, params) {
			const people = await searchPeople(graph, params.query);
			const text =
				people.length === 0
					? `Nobody matches "${params.query}".`
					: people.map((p) => `- ${p.name}${p.email ? `  <${p.email}>` : ""}${p.title ? `  — ${p.title}` : ""}`).join("\n");
			return textResult(text);
		},
	});

	pi.registerTool({
		name: "outlook_search",
		label: "Outlook Search",
		description: "Search the whole mailbox for a phrase. Results use the same lines as outlook_list.",
		parameters: Type.Object({
			query: Type.String({ description: "The phrase to find" }),
			top: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "How many to list, 1–50 (default 20)" })),
		}),
		async execute(_id, params) {
			const rows = await mailbox.search(params.query, params.top ?? 20);
			return textResult(rows.length > 0 ? rows.map(summaryLine).join("\n") : "no messages");
		},
	});

	pi.registerTool({
		name: "outlook_read",
		label: "Outlook Read",
		description:
			"Read one message by id (from outlook_list or outlook_search): the header block (From, To, Cc, Date, Subject, id), " +
			`the body as Markdown, then any attachments as name · type · size, and the SharePoint/OneDrive files it links to. ` +
			`A picture reads as [image N: file name] and the first ${MAX_IMAGES_PER_READ} ` +
			"pictures are attached to the result, so describe what they show instead of telling the user to open Outlook -- " +
			"this terminal cannot display them. To save an attachment or a linked file, use outlook_download, and only when the user asks.",
		parameters: Type.Object({ id: Type.String({ description: "Message id" }) }),
		async execute(_id, params) {
			const { summary, mail, markdown, images } = await mailbox.read(params.id);
			const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
				{ type: "text", text: reading(summary, mail, markdown) },
			];
			// Said, never silently dropped: a picture the model cannot see must not read as one it saw.
			for (const { label, image } of images.slice(0, MAX_IMAGES_PER_READ)) {
				if (!MODEL_IMAGE_TYPES.includes(image.mimeType)) {
					content.push({ type: "text", text: `[${label}: not attached, ${image.mimeType} is not a type the model reads]` });
				} else if (image.size > MAX_IMAGE_BYTES) {
					content.push({ type: "text", text: `[${label}: not attached, ${humanSize(image.size)} is over the per-image limit]` });
				} else {
					content.push({ type: "text", text: `[${label}]` }, { type: "image", data: image.content.toString("base64"), mimeType: image.mimeType });
				}
			}
			if (images.length > MAX_IMAGES_PER_READ) {
				content.push({ type: "text", text: `[${images.length - MAX_IMAGES_PER_READ} more picture(s) not attached]` });
			}
			return { content, details: {} };
		},
	});

	pi.registerTool({
		name: "outlook_download",
		label: "Outlook Download",
		description:
			"Save one file to disk and return its path: an attachment of a mail, named as outlook_read lists it, or a " +
			"SharePoint/OneDrive file linked from a mail. Call it ONLY when the user asks to save, download or open a file; " +
			"reading a mail never needs it. Give exactly one of attachment or url. An ordinary web link is not for this tool.",
		parameters: Type.Object({
			id: Type.Optional(Type.String({ description: "Message id; required with attachment" })),
			attachment: Type.Optional(Type.String({ description: "The attachment's file name, exactly as outlook_read lists it" })),
			url: Type.Optional(Type.String({ description: "A SharePoint/OneDrive link, as outlook_read lists it under Linked files" })),
			path: Type.Optional(
				Type.String({
					description: "A new file path to save to; an existing file is never overwritten (the call fails). Default: ~/Downloads under the file's own name, or name (1).ext if taken.",
				}),
			),
			max_mb: Type.Optional(Type.Number({ description: "Refuse a linked file larger than this, in MB. Default 256." })),
		}),
		async execute(_id, params) {
			if (Boolean(params.attachment) === Boolean(params.url)) throw new Error("give exactly one of attachment or url");
			if (params.attachment) {
				if (!params.id) throw new Error("attachment needs id, the message it belongs to");
				const { mail } = await mailbox.read(params.id);
				const hits = mail.attachments.filter((a) => a.filename === params.attachment);
				if (hits.length !== 1) {
					const names = mail.attachments.map((a) => a.filename).join(", ") || "none";
					throw new Error(`${hits.length === 0 ? "no" : "several"} attachments named "${params.attachment}"; this mail has: ${names}`);
				}
				const saved = saveAttachment(hits[0], params.path);
				return textResult(`saved ${hits[0].filename} (${humanSize(hits[0].size)}) to ${saved}`);
			}
			const url = params.url as string;
			if (!isShared(url)) throw new Error(`${url} is not a SharePoint/OneDrive link; fetch ordinary links with your web tools`);
			const got = await downloadShared(graph, url, params.path ?? downloads(), {
				maxBytes: params.max_mb ? Math.round(params.max_mb * 1024 * 1024) : undefined,
			});
			return textResult(`saved ${got.name} (${humanSize(got.size)}) to ${got.path}`);
		},
	});

	pi.registerTool({
		name: "outlook_draft",
		label: "Outlook Draft",
		description: DRAFT_DESCRIPTION,
		parameters: COMPOSE_PARAMETERS,
		async execute(_id, params) {
			const { draft, eml } = await composeMail(composeKind(params), params);
			const id = await mailbox.saveDraft(draft, eml);
			return textResult(`draft saved "${draft.subject}" (id ${id}) — in Drafts, not sent`);
		},
	});

	pi.registerTool({
		name: "outlook_send",
		label: "Outlook Send",
		description: SEND_DESCRIPTION,
		parameters: COMPOSE_PARAMETERS,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const kind = composeKind(params);
			flash(ctx, "sending…", 30_000);
			let mail: { draft: ComposeDraft; eml: Buffer };
			try {
				mail = await composeMail(kind, params);
				await mailbox.submit(mail.draft, mail.eml);
			} catch (e) {
				flash(ctx, "send failed ✗", 8000);
				throw e;
			}
			flash(ctx, "sent ✓");
			const { draft } = mail;
			const to = draft.to.map((a) => a.address).join(", ");
			const cc = draft.cc.length > 0 ? ` cc ${draft.cc.map((a) => a.address).join(", ")}` : "";
			return textResult(`sent "${draft.subject}" to ${to}${cc}`);
		},
	});

	pi.registerTool({
		name: "outlook_move",
		label: "Outlook Move",
		description: "Move a message to Archive or Deleted Items. The unread count is refreshed afterwards.",
		parameters: Type.Object({
			id: Type.String({ description: "Message id" }),
			folder: StringEnum(["archive", "deleteditems"], { description: "Destination folder" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const folder = params.folder as "archive" | "deleteditems";
			await mailbox.move(params.id, folder);
			await pollUnread(ctx);
			return textResult(`moved to ${FOLDER_LABELS[folder]}`);
		},
	});

	pi.registerTool({
		name: "outlook_mark",
		label: "Outlook Mark",
		description: "Mark a message read or unread. The unread count is refreshed afterwards.",
		parameters: Type.Object({
			id: Type.String({ description: "Message id" }),
			read: Type.Boolean({ description: "true to mark it read, false to mark it unread" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			await mailbox.setRead(params.id, params.read);
			await pollUnread(ctx);
			return textResult(params.read ? "marked read" : "marked unread");
		},
	});

	pi.registerCommand("outlook", {
		description: "Outlook: browse folders, read, reply, forward and compose mail; `/outlook signature` edits your signature",
		getArgumentCompletions: (prefix: string) => ("signature".startsWith(prefix) ? [{ value: "signature", label: "signature" }] : null),
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg === "signature") {
				const edited = await ctx.ui.editor("Outlook signature, in Markdown (leave it empty to remove it)", readSignature());
				if (edited === undefined) return;
				writeSignature(edited);
				ctx.ui.notify(edited.trim() ? `signature saved to ${signaturePath()}` : "signature removed", "info");
				return;
			}
			if (arg !== "") {
				ctx.ui.notify(`unknown /outlook argument "${arg}" — try /outlook or /outlook signature`, "error");
				return;
			}
			const deps: OverlayDeps = {
				list: mailbox.list.bind(mailbox),
				search: mailbox.search.bind(mailbox),
				read: mailbox.read.bind(mailbox),
				draftFor: mailbox.draftFor.bind(mailbox),
				build: mailbox.build.bind(mailbox),
				submit: mailbox.submit.bind(mailbox),
				saveDraft: mailbox.saveDraft.bind(mailbox),
				move: mailbox.move.bind(mailbox),
				setRead: mailbox.setRead.bind(mailbox),
				folders: mailbox.folders.bind(mailbox),
				refreshUnread: () => pollUnread(ctx),
				signature: readSignature,
				saveAttachment: async (a) => saveAttachment(a),
				saveLink: async (url) => (await downloadShared(graph, url, downloads())).path,
				describe: async (image) => {
					if (!MODEL_IMAGE_TYPES.includes(image.mimeType)) throw new Error(`${image.mimeType} is not a type the model reads`);
					if (image.size > MAX_IMAGE_BYTES) throw new Error(`${humanSize(image.size)} is over the per-image limit`);
					const key = `outlook:${createHash("sha256").update(image.content).digest("hex")}`;
					return describeImage(ctx, key, async () => ({ base64: image.content.toString("base64"), mime: image.mimeType }));
				},
			};
			await openOutlookOverlay(ctx, deps);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return; // no status bar to feed, and -p runs should cost nothing
		renderStatus(ctx);
		void pollUnread(ctx);
		unreadTimer = setInterval(() => void pollUnread(ctx), POLL_MS);
		unreadTimer.unref?.();
	});

	pi.on("session_shutdown", async () => {
		if (unreadTimer) clearInterval(unreadTimer);
		unreadTimer = undefined;
	});
}
