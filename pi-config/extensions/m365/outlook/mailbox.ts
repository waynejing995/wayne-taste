/**
 * The mailbox over Microsoft Graph: the only Outlook module that knows the mail
 * URLs. A failed request throws what Graph or the token source raised. Nothing
 * here turns a failure into [] or 0: "no mail" and "could not ask" must stay
 * distinguishable, or the status bar reports an outage as an empty inbox.
 *
 * Two Graph rules shape the queries. A `$filter` must name its ordered property
 * first, or Graph refuses it (InefficientFilter). `$search` takes no `$orderby`
 * and needs ConsistencyLevel: eventual.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { GraphClient } from "../core/graph.ts";
import { htmlToMarkdown } from "./convert.ts";
import { type Address, buildEml, type BuildInput, type ComposeDraft, type MailAttachment, mailImages, type ParsedMail, parseEml, respondDefaults } from "./mime.ts";

/** The five well-known folders Graph names. Any other folder (a rule's target, say) is addressed by its id. */
export type Folder = "inbox" | "archive" | "sentitems" | "drafts" | "deleteditems";

export const FOLDER_LABELS: Record<Folder, string> = {
	inbox: "Inbox",
	archive: "Archive",
	sentitems: "Sent Items",
	drafts: "Drafts",
	deleteditems: "Deleted Items",
};

/** A mail folder as the picker and outlook_folders show it. `path` joins display names with "/", e.g. "Inbox/dri-devel". */
export type FolderInfo = { id: string; path: string; unread: number; total: number };

type RawFolder = { id: string; displayName: string; childFolderCount: number; unreadItemCount: number; totalItemCount: number };
const FOLDER_SELECT = "id,displayName,childFolderCount,unreadItemCount,totalItemCount";

/** A picture in a message and the label it goes by, in the body's Markdown and in tool output. */
export type MailImage = { label: string; image: MailAttachment };

/** A message as a list shows it: what the index needs, never the body. */
export type Summary = {
	id: string;
	subject: string;
	from?: Address;
	received: string;
	isRead: boolean;
	hasAttachments: boolean;
	preview: string;
};

/** The signed-in user: every address that counts as self, and the display name. */
type Me = { addresses: string[]; name: string };

const SELECT = "id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview";
/** Graph needs the property $orderby names (receivedDateTime) to lead the filter; the 1900 floor admits every real date. */
const UNREAD = "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false";

/** Graph's message resource, the fields SELECT names. */
type RawMessage = {
	id: string;
	subject: string | null;
	from: { emailAddress: { name?: string; address: string } } | null;
	receivedDateTime: string;
	isRead: boolean;
	hasAttachments: boolean;
	bodyPreview: string | null;
};

/** `name` is absent when Graph gave only the address, as in mime.ts. */
const address = (e: { name?: string; address: string }): Address => (e.name ? { name: e.name, address: e.address } : { address: e.address });

const summary = (m: RawMessage): Summary => ({
	id: m.id,
	subject: m.subject ?? "",
	from: m.from ? address(m.from.emailAddress) : undefined,
	received: m.receivedDateTime,
	isRead: m.isRead,
	hasAttachments: m.hasAttachments,
	preview: m.bodyPreview ?? "",
});

/** The endpoint that creates a draft answering a message: createReply and its siblings. */
const CREATE_VERB: Record<"reply" | "replyAll" | "forward", string> = {
	reply: "createReply",
	replyAll: "createReplyAll",
	forward: "createForward",
};

export class Mailbox {
	private myself?: Me;

	constructor(private readonly graph: GraphClient) {}

	/**
	 * The signed-in user's addresses (mail and userPrincipalName both count as self) and display name.
	 * Cached on disk, like the Teams identity: it is stable for years, and the tenant throttles /me
	 * hard enough (observed: minutes of 429) that asking every session made sending fail.
	 */
	async me(): Promise<Me> {
		if (this.myself) return this.myself;
		const file = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi", "outlook-me.json");
		if (fs.existsSync(file)) {
			this.myself = JSON.parse(fs.readFileSync(file, "utf8")) as Me;
			return this.myself;
		}
		const r = await this.graph.get<{ displayName?: string | null; mail?: string | null; userPrincipalName?: string | null }>(
			"/me?$select=displayName,mail,userPrincipalName",
		);
		this.myself = {
			addresses: [r.mail, r.userPrincipalName].filter((a): a is string => !!a),
			name: r.displayName ?? "",
		};
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(this.myself));
		return this.myself;
	}

	/** Every mail folder, depth first in Graph's order, children right after their parent. */
	async folders(): Promise<FolderInfo[]> {
		const out: FolderInfo[] = [];
		const walk = async (url: string, prefix: string): Promise<void> => {
			for (const f of await this.graph.getAll<RawFolder>(`${url}?$top=100&$select=${FOLDER_SELECT}`)) {
				const path = prefix ? `${prefix}/${f.displayName}` : f.displayName;
				out.push({ id: f.id, path, unread: f.unreadItemCount, total: f.totalItemCount });
				if (f.childFolderCount > 0) await walk(`/me/mailFolders/${f.id}/childFolders`, path);
			}
		};
		await walk("/me/mailFolders", "");
		return out;
	}

	/**
	 * A folder named by the agent: a well-known name (inbox, archive, …), a full path ("Inbox/dri-devel"),
	 * or a folder's own name ("dri-devel"), case-insensitive. No match, or a name two folders share, throws.
	 */
	async resolveFolder(name: string): Promise<{ id: string; path: string }> {
		if (name in FOLDER_LABELS) return { id: name, path: FOLDER_LABELS[name as Folder] };
		const want = name.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
		const all = await this.folders();
		const byPath = all.filter((f) => f.path.toLowerCase() === want);
		const hits = byPath.length > 0 ? byPath : all.filter((f) => f.path.split("/").pop()?.toLowerCase() === want);
		if (hits.length === 1) return { id: hits[0].id, path: hits[0].path };
		if (hits.length === 0) throw new Error(`no mail folder named "${name}" — outlook_folders lists them`);
		throw new Error(`"${name}" names several folders: ${hits.map((f) => f.path).join(", ")} — give the full path`);
	}

	/** `top` messages in a folder (a well-known name or a folder id), newest first after skipping `skip`, optionally only unread ones. */
	async list(folder: string, opts: { unreadOnly?: boolean; top: number; skip?: number }): Promise<Summary[]> {
		const filter = opts.unreadOnly ? `&$filter=${UNREAD}` : "";
		const skip = opts.skip ? `&$skip=${opts.skip}` : "";
		const r = await this.graph.get<{ value: RawMessage[] }>(
			`/me/mailFolders/${folder}/messages?$top=${opts.top}${skip}&$select=${SELECT}&$orderby=receivedDateTime desc${filter}`,
		);
		return r.value.map(summary);
	}

	/** Messages matching `query` as a phrase, in whatever order Graph ranks them. */
	async search(query: string, top: number): Promise<Summary[]> {
		const phrase = `"${query.replace(/"/g, '\\"')}"`;
		const r = await this.graph.get<{ value: RawMessage[] }>(
			`/me/messages?$search=${encodeURIComponent(phrase)}&$top=${top}&$select=${SELECT}`,
			{ headers: { ConsistencyLevel: "eventual" } },
		);
		return r.value.map(summary);
	}

	/**
	 * One message: its summary, its parsed MIME, its body as Markdown, and its pictures (mailImages order).
	 * A picture the body shows reads in the Markdown as `[<label>]`, the label being "image N: file name".
	 */
	async read(id: string): Promise<{ summary: Summary; mail: ParsedMail; markdown: string; images: MailImage[] }> {
		const [meta, bytes] = await Promise.all([
			this.graph.get<RawMessage>(`/me/messages/${id}?$select=${SELECT}`),
			this.graph.getBytes(`/me/messages/${id}/$value`),
		]);
		const mail = await parseEml(bytes);
		const images = mailImages(mail).map((image, i) => ({ label: `image ${i + 1}: ${image.filename}`, image }));
		const labels = new Map(images.filter((m) => m.image.contentId).map((m) => [m.image.contentId as string, m.label]));
		return {
			summary: summary(meta),
			mail,
			markdown: mail.html ? htmlToMarkdown(mail.html, labels) : (mail.text ?? ""),
			images,
		};
	}

	/** A new draft, or the defaults of a reply, reply-all or forward to message `id`. */
	async draftFor(kind: ComposeDraft["kind"], id?: string): Promise<ComposeDraft> {
		if (kind === "new") return { kind, to: [], cc: [], subject: "", references: [], attachments: [] };
		if (id === undefined) throw new Error(`a ${kind} draft needs the id of the message it answers`);
		const { mail } = await this.read(id);
		const me = await this.me();
		return { ...respondDefaults(kind, mail, me.addresses), id };
	}

	/** The MIME of a draft, From set to the signed-in user. The draft's own fields go out as given. */
	async build(d: Omit<BuildInput, "from">): Promise<Buffer> {
		const me = await this.me();
		return buildEml({ ...d, from: { name: me.name, address: me.addresses[0] } });
	}

	/** Sends the EML: /me/sendMail for a new message, otherwise the reply, reply-all or forward of the message. */
	async submit(d: ComposeDraft, eml: Buffer): Promise<void> {
		const at = d.kind === "new" ? "/me/sendMail" : `/me/messages/${d.id}/${d.kind}`;
		await this.graph.postText(at, eml.toString("base64"), "text/plain");
	}

	/** Saves the EML as a draft in Drafts and returns the draft's id. */
	async saveDraft(d: ComposeDraft, eml: Buffer): Promise<string> {
		const at = d.kind === "new" ? "/me/messages" : `/me/messages/${d.id}/${CREATE_VERB[d.kind]}`;
		const made = await this.graph.postText<{ id: string }>(at, eml.toString("base64"), "text/plain");
		return made.id;
	}

	async move(id: string, folder: "archive" | "deleteditems"): Promise<void> {
		await this.graph.post(`/me/messages/${id}/move`, { destinationId: folder });
	}

	async setRead(id: string, read: boolean): Promise<void> {
		await this.graph.patch(`/me/messages/${id}`, { isRead: read });
	}

	async unreadCount(): Promise<number> {
		const r = await this.graph.get<{ unreadItemCount: number }>("/me/mailFolders/inbox?$select=unreadItemCount");
		return r.unreadItemCount;
	}
}
