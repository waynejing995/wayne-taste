/**
 * SharePoint / Microsoft Lists Kanban synchronization for personal-channel tasks.
 *
 * Uses the existing FOCI Office client (core/auth.ts) to request a SharePoint token
 * for `<origin>/.default`, caches `FormDigestValue` per origin (refreshing once on
 * HTTP 403), and stores no tenant, site, team, channel, or list IDs in source: all
 * board config lives in `~/.wayne/inbox/rules.yaml` under `teams_watch.channels`.
 */
import * as auth from "../core/auth.ts";
import { savedWatches, type BoardColumnsConfig, type SavedBoardConfig, type SavedChannelWatch, WATCH_LIST } from "./watch-list.ts";

export type BoardStatus = "waiting" | "working" | "done";

export interface BoardColumns {
	waiting: string;
	working: string;
	done: string;
}

export const DEFAULT_BOARD_COLUMNS: BoardColumns = {
	waiting: "🟡 待拍板",
	working: "🔄 进行中",
	done: "✅ 已完成",
};

export interface BoardConfig {
	site_url: string;
	list_id: string;
	columns?: BoardColumnsConfig;
}

export interface BoardCard {
	id: number;
	title: string;
	status: BoardStatus | "unknown";
	column: string;
	summary: string;
	threadId: string;
	threadUrl: string;
	linkDescription?: string;
}

export interface UpsertCardInput {
	threadId: string;
	title?: string;
	summary?: string;
	status: BoardStatus;
	threadUrl?: string;
	defaultThreadUrl?: string;
	linkDescription?: string;
}

export interface UpsertCardResult {
	action: "created" | "updated";
	id: number;
	threadId: string;
	status: BoardStatus;
	column: string;
}

export interface MoveCardResult {
	updated: boolean;
	id?: number;
	threadId: string;
	status: BoardStatus;
	column: string;
}

export interface EnsureSchemaResult {
	createdFields: string[];
	updatedFields: string[];
	addedViewFields: string[];
	viewPatched: boolean;
	viewTitle?: string;
}

export type BoardResponse = {
	status: number;
	headers?: { get(name: string): string | null };
	text(): Promise<string>;
};

export type BoardTransport = (
	url: string,
	init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<BoardResponse>;

export interface BoardClientOpts {
	token?: (scope: string) => Promise<string>;
	fetch?: BoardTransport;
	tenantId?: string;
}

export class SharePointError extends Error {
	readonly status: number;
	readonly body: string;
	readonly url: string;

	constructor(message: string, status: number, body: string, url: string) {
		super(message);
		this.name = "SharePointError";
		this.status = status;
		this.body = body;
		this.url = url;
	}
}

const VALID_STATUSES: Record<BoardStatus, true> = { waiting: true, working: true, done: true };
const SP_URL_MAX_LEN = 255;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveColumns(columns?: BoardColumnsConfig): BoardColumns {
	return {
		waiting: columns?.waiting?.trim() || DEFAULT_BOARD_COLUMNS.waiting,
		working: columns?.working?.trim() || DEFAULT_BOARD_COLUMNS.working,
		done: columns?.done?.trim() || DEFAULT_BOARD_COLUMNS.done,
	};
}

function statusOfColumn(column: string, cols: BoardColumns): BoardStatus | "unknown" {
	if (column === cols.waiting) return "waiting";
	if (column === cols.working) return "working";
	if (column === cols.done) return "done";
	return "unknown";
}

function assertStatus(status: string): BoardStatus {
	if (!Object.prototype.hasOwnProperty.call(VALID_STATUSES, status)) {
		throw new Error(`Invalid board status "${status}" (expected waiting, working, or done)`);
	}
	return status as BoardStatus;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeSiteUrl(siteUrl: string): { siteUrl: string; origin: string } {
	let parsed: URL;
	try {
		parsed = new URL(siteUrl.trim());
	} catch {
		throw new Error(`Invalid board site_url: "${siteUrl}"`);
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`Board site_url must be https: "${siteUrl}"`);
	}
	const cleanPath = parsed.pathname.replace(/\/+$/, "");
	return { siteUrl: `${parsed.origin}${cleanPath}`, origin: parsed.origin };
}

function normalizeGuid(raw: unknown, label: string): string {
	if (typeof raw !== "string") {
		throw new Error(`Invalid ${label}: expected GUID string`);
	}
	const cleaned = raw.trim().replace(/^\{|\}$/g, "");
	if (!GUID_RE.test(cleaned)) {
		throw new Error(`Invalid ${label}: "${raw}" (expected RFC-4122 GUID)`);
	}
	return cleaned;
}

function normalizeListId(listId: string): string {
	return normalizeGuid(listId, "board list_id");
}

function escapeOData(value: string): string {
	return value.replace(/'/g, "''");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * SharePoint `SPFieldUrl` (`FieldTypeKind: 11`) enforces a hard 255-char `Url` limit.
 * Teams message deep links often carry a redundant `&createdTime=<id>` parameter that
 * pushes the URL past 255 characters; strip it and reject URLs that still exceed 255.
 */
export function sanitizeThreadUrl(rawUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		throw new Error(`Invalid thread URL: "${rawUrl}"`);
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error(`Thread URL must be http(s): "${rawUrl}"`);
	}
	parsed.searchParams.delete("createdTime");
	const cleaned = parsed.toString();
	if (cleaned.length > SP_URL_MAX_LEN) {
		throw new Error(`Thread URL exceeds SharePoint's ${SP_URL_MAX_LEN}-char SPFieldUrl limit (${cleaned.length} chars)`);
	}
	return cleaned;
}

export function buildThreadUrl(opts: { teamId: string; channelId: string; tenantId: string; threadId: string }): string {
	const url = new URL(`https://teams.microsoft.com/l/message/${encodeURIComponent(opts.channelId)}/${encodeURIComponent(opts.threadId)}`);
	url.searchParams.set("tenantId", opts.tenantId);
	url.searchParams.set("groupId", opts.teamId);
	url.searchParams.set("parentMessageId", opts.threadId);
	return sanitizeThreadUrl(url.toString());
}

/**
 * SharePoint Board View `CustomFormatter` using `kanbanProps.formatter`.
 * Deliberately omits `templateId: "KanbanCardDesigner100"` and `designerConfig`:
 * SharePoint's server-side Card Designer rewrites URL columns into `null`
 * children and blanks cards on render.
 */
export function buildKanbanFormatter(): Record<string, unknown> {
	return {
		$schema: "https://developer.microsoft.com/json-schemas/sp/v2/board-formatting.schema.json",
		kanbanProps: {
			formatter: {
				elmType: "div",
				attributes: { class: "sp-card-container" },
				children: [
					{
						elmType: "div",
						attributes: { class: "sp-card-defaultClickButton" },
						customRowAction: { action: "defaultClick" },
					},
					{
						elmType: "div",
						attributes: { class: "sp-card-content sp-card-formatterRef" },
						children: [
							{
								elmType: "div",
								attributes: { class: "sp-card-displayColumnContainer" },
								children: [
									{
										elmType: "p",
										attributes: { class: "sp-card-label" },
										txtContent: "[$Title]",
									},
									{
										elmType: "p",
										attributes: { class: "sp-card-subTitle" },
										style: { display: "=if([$Summary] != '', 'block', 'none')" },
										txtContent: "[$Summary]",
									},
									{
										elmType: "a",
										attributes: {
											href: "[$ThreadLink]",
											target: "_blank",
											class: "ms-fontColor-themePrimary ms-fontWeight-semibold",
										},
										style: { display: "=if([$ThreadLink] != '', 'inline-block', 'none')" },
										txtContent: "=if([$ThreadLink.desc] != '', [$ThreadLink.desc], 'Open in Teams')",
									},
								],
							},
						],
					},
				],
			},
		},
	};
}

function validateBoardConfig(board: SavedBoardConfig): BoardConfig {
	if (!board || typeof board.site_url !== "string" || !board.site_url.trim()) {
		throw new Error(`Board config in ${WATCH_LIST} is missing site_url`);
	}
	if (typeof board.list_id !== "string" || !board.list_id.trim()) {
		throw new Error(`Board config in ${WATCH_LIST} is missing list_id`);
	}
	normalizeSiteUrl(board.site_url);
	normalizeListId(board.list_id);
	return board;
}

/** Find the board config for a specific `mode: personal` channel entry in rules.yaml, or null if absent. */
export function findPersonalBoard(teamId: string, channelId: string): { channel: SavedChannelWatch; board: BoardConfig } | null {
	const channels = savedWatches().channels ?? [];
	const match = channels.find((c) => c.team_id === teamId && c.channel_id === channelId && c.mode === "personal" && c.board !== undefined);
	if (!match?.board) return null;
	return { channel: match, board: validateBoardConfig(match.board) };
}

/** Resolve the configured personal-channel board from rules.yaml (fail loud if missing or ambiguous). */
export function requirePersonalBoard(opts?: { teamId?: string; channelId?: string }): { channel: SavedChannelWatch; board: BoardConfig } {
	const teamId = opts?.teamId?.trim() || undefined;
	const channelId = opts?.channelId?.trim() || undefined;
	const matches = (savedWatches().channels ?? []).filter(
		(c) =>
			c.mode === "personal" &&
			c.board !== undefined &&
			(!teamId || c.team_id === teamId) &&
			(!channelId || c.channel_id === channelId),
	);
	if (matches.length === 0) {
		if (teamId || channelId) {
			throw new Error(`No personal channel matching team_id=${teamId ?? "*"} channel_id=${channelId ?? "*"} with a board config found in ${WATCH_LIST}.`);
		}
		throw new Error(`No personal channel with a board config found in ${WATCH_LIST}. Add board: { site_url, list_id } under a mode: personal channel in teams_watch.channels.`);
	}
	if (matches.length > 1) {
		const labels = matches.map((c) => `${c.channel} (${c.team_id}/${c.channel_id})`).join(", ");
		throw new Error(`Multiple personal channels with board config found in ${WATCH_LIST}: ${labels}. Pass team_id and channel_id.`);
	}
	return { channel: matches[0], board: validateBoardConfig(matches[0].board!) };
}

export function formatBoardList(cards: BoardCard[]): string {
	if (cards.length === 0) return "(no cards on board)";
	return cards
		.map((c) => {
			const head = `#${c.id} [${c.column || c.status}] ${c.title}  thread_id: ${c.threadId}`;
			const lines = [head];
			if (c.summary) lines.push(`  summary: ${c.summary}`);
			if (c.threadUrl) lines.push(`  link: ${c.threadUrl}`);
			return lines.join("\n");
		})
		.join("\n");
}

function parseJson(text: string, status: number, url: string): Record<string, unknown> {
	if (!text.trim()) return {};
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new SharePointError(`SharePoint returned non-JSON (HTTP ${status}): ${text.slice(0, 200)}`, status, text, url);
	}
}

function failSharePoint(status: number, text: string, url: string): never {
	let detail = text.slice(0, 300);
	try {
		const parsed: unknown = JSON.parse(text);
		if (isRecord(parsed)) {
			const err = isRecord(parsed["odata.error"]) ? parsed["odata.error"] : isRecord(parsed.error) ? parsed.error : undefined;
			if (err) {
				const code = typeof err.code === "string" ? err.code : "";
				const msg = typeof err.message === "string"
					? err.message
					: isRecord(err.message) && typeof err.message.value === "string"
						? err.message.value
						: "";
				if (msg) detail = code ? `${code}: ${msg}` : msg;
			}
		}
	} catch {
		// keep raw text snippet
	}
	throw new SharePointError(`SharePoint ${status} on ${url}${detail ? `: ${detail}` : ""}`, status, text, url);
}

function unwrapSingle(data: Record<string, unknown>): Record<string, unknown> {
	return isRecord(data.d) ? data.d : data;
}

function unwrapCollection(data: Record<string, unknown>): { items: Record<string, unknown>[]; next?: string } {
	if (isRecord(data.d) && Array.isArray(data.d.results)) {
		return {
			items: data.d.results.filter(isRecord),
			next: typeof data.d.__next === "string" ? data.d.__next : undefined,
		};
	}
	const items = Array.isArray(data.value) ? data.value.filter(isRecord) : [];
	const next = typeof data["@odata.nextLink"] === "string"
		? data["@odata.nextLink"]
		: typeof data["odata.nextLink"] === "string"
			? data["odata.nextLink"]
			: undefined;
	return { items, next };
}

function toCard(raw: Record<string, unknown>, cols: BoardColumns): BoardCard {
	const column = typeof raw.board_x0020_choice === "string" ? raw.board_x0020_choice : "";
	const link = isRecord(raw.ThreadLink) ? raw.ThreadLink : undefined;
	return {
		id: Number(raw.Id ?? 0),
		title: typeof raw.Title === "string" ? raw.Title : "",
		status: statusOfColumn(column, cols),
		column,
		summary: typeof raw.Summary === "string" ? raw.Summary : "",
		threadId: typeof raw.ThreadId === "string" ? raw.ThreadId : "",
		threadUrl: link && typeof link.Url === "string" ? link.Url : "",
		...(link && typeof link.Description === "string" ? { linkDescription: link.Description } : {}),
	};
}

export class BoardClient {
	private readonly getTokenFn: (scope: string) => Promise<string>;
	private readonly doFetch: BoardTransport;
	private readonly tenantIdOverride?: string;
	private readonly digestCache = new Map<string, { value: string; expiresAt: number }>();
	private readonly entityTypeCache = new Map<string, string>();

	constructor(opts: BoardClientOpts = {}) {
		this.getTokenFn = opts.token ?? ((scope) => auth.getToken({ scopes: [scope] }));
		this.doFetch = opts.fetch ?? (fetch as unknown as BoardTransport);
		this.tenantIdOverride = opts.tenantId;
	}

	private async tokenFor(origin: string): Promise<string> {
		return this.getTokenFn(`${origin}/.default`);
	}

	async resolveTenantId(cfg: BoardConfig): Promise<string> {
		if (this.tenantIdOverride) return this.tenantIdOverride;
		const { origin } = normalizeSiteUrl(cfg.site_url);
		const token = await this.tokenFor(origin);
		return auth.tokenClaim(token, "tid");
	}

	private async getDigest(siteUrl: string, token: string, forceRefresh = false): Promise<string> {
		const cached = this.digestCache.get(siteUrl);
		if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
			return cached.value;
		}
		const url = `${siteUrl}/_api/contextinfo`;
		const r = await this.doFetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json;odata=verbose",
			},
			body: "",
		});
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) failSharePoint(r.status, text, url);
		const parsed = parseJson(text, r.status, url);
		const info = isRecord(parsed.d) && isRecord(parsed.d.GetContextWebInformation) ? parsed.d.GetContextWebInformation : parsed;
		const digest = info.FormDigestValue;
		if (typeof digest !== "string" || !digest) {
			throw new SharePointError(`SharePoint contextinfo at ${url} returned no FormDigestValue`, r.status, text, url);
		}
		const timeoutSec = typeof info.FormDigestTimeoutSeconds === "number" && info.FormDigestTimeoutSeconds > 0
			? info.FormDigestTimeoutSeconds
			: 1800;
		const ttlMs = timeoutSec > 60 ? (timeoutSec - 60) * 1000 : timeoutSec * 500;
		this.digestCache.set(siteUrl, { value: digest, expiresAt: Date.now() + ttlMs });
		return digest;
	}

	private async getJson(url: string, origin: string): Promise<Record<string, unknown>> {
		const token = await this.tokenFor(origin);
		const r = await this.doFetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json;odata=nometadata",
			},
		});
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) failSharePoint(r.status, text, url);
		return parseJson(text, r.status, url);
	}

	private async sendMutation(
		url: string,
		siteUrl: string,
		origin: string,
		payload: unknown,
		extraHeaders: Record<string, string> = {},
	): Promise<Record<string, unknown>> {
		const token = await this.tokenFor(origin);
		const body = JSON.stringify(payload);
		const runOnce = async (digest: string) => {
			return this.doFetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json;odata=verbose",
					"Content-Type": "application/json;odata=verbose",
					"X-RequestDigest": digest,
					...extraHeaders,
				},
				body,
			});
		};
		let digest = await this.getDigest(siteUrl, token, false);
		let r = await runOnce(digest);
		if (r.status === 403) {
			await r.text().catch(() => {});
			digest = await this.getDigest(siteUrl, token, true);
			r = await runOnce(digest);
		}
		const text = await r.text();
		if (r.status < 200 || r.status >= 300) failSharePoint(r.status, text, url);
		return parseJson(text, r.status, url);
	}

	private async getEntityType(siteUrl: string, origin: string, listId: string): Promise<string> {
		const cacheKey = `${siteUrl}::${listId}`;
		const cached = this.entityTypeCache.get(cacheKey);
		if (cached) return cached;
		const url = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')?$select=ListItemEntityTypeFullName`;
		const raw = unwrapSingle(await this.getJson(url, origin));
		const entityType = raw.ListItemEntityTypeFullName;
		if (typeof entityType !== "string" || !entityType) {
			throw new Error(`SharePoint list ${listId} returned no ListItemEntityTypeFullName`);
		}
		this.entityTypeCache.set(cacheKey, entityType);
		return entityType;
	}

	private async findByThreadId(siteUrl: string, origin: string, listId: string, threadId: string, cols: BoardColumns): Promise<BoardCard | null> {
		const filter = encodeURIComponent(`ThreadId eq '${escapeOData(threadId)}'`);
		const url = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/items?$select=Id,Title,board_x0020_choice,Summary,ThreadId,ThreadLink&$filter=${filter}&$top=2`;
		const { items } = unwrapCollection(await this.getJson(url, origin));
		if (items.length === 0) return null;
		if (items.length > 1) {
			console.warn(`[teams-board] multiple items (${items.length}) matched ThreadId=${threadId}; updating first (#${items[0].Id})`);
		}
		return toCard(items[0], cols);
	}

	async listCards(cfg: BoardConfig): Promise<BoardCard[]> {
		const { siteUrl, origin } = normalizeSiteUrl(cfg.site_url);
		const listId = normalizeListId(cfg.list_id);
		const cols = resolveColumns(cfg.columns);
		const cards: BoardCard[] = [];
		const seen = new Set<string>();
		let next: string | undefined = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/items?$select=Id,Title,board_x0020_choice,Summary,ThreadId,ThreadLink`;
		while (next) {
			if (seen.has(next)) throw new Error(`SharePoint list pagination repeated URL: ${next}`);
			seen.add(next);
			const page = unwrapCollection(await this.getJson(next, origin));
			for (const item of page.items) cards.push(toCard(item, cols));
			if (page.next) {
				let parsedNext: URL;
				try {
					parsedNext = new URL(page.next, origin);
				} catch {
					throw new Error(`Invalid SharePoint pagination link: ${page.next}`);
				}
				if (parsedNext.protocol !== "https:" || parsedNext.origin !== origin) {
					throw new Error(`SharePoint pagination link must stay on same https origin (${origin}): ${page.next}`);
				}
				next = parsedNext.toString();
			} else {
				next = undefined;
			}
		}
		return cards;
	}

	async upsertCard(cfg: BoardConfig, input: UpsertCardInput): Promise<UpsertCardResult> {
		const threadId = input.threadId.trim();
		if (!threadId) throw new Error("upsertCard requires a non-empty threadId");
		const status = assertStatus(input.status);
		const explicitUrl = input.threadUrl !== undefined ? sanitizeThreadUrl(input.threadUrl) : undefined;
		const fallbackUrl = input.defaultThreadUrl !== undefined ? sanitizeThreadUrl(input.defaultThreadUrl) : undefined;
		const { siteUrl, origin } = normalizeSiteUrl(cfg.site_url);
		const listId = normalizeListId(cfg.list_id);
		const cols = resolveColumns(cfg.columns);
		const column = cols[status];

		const existing = await this.findByThreadId(siteUrl, origin, listId, threadId, cols);
		const entityType = await this.getEntityType(siteUrl, origin, listId);

		if (existing) {
			const urlToSet = explicitUrl ?? (!existing.threadUrl ? fallbackUrl : undefined);
			const payload: Record<string, unknown> = {
				__metadata: { type: entityType },
				board_x0020_choice: column,
			};
			if (input.title !== undefined) payload.Title = input.title;
			if (input.summary !== undefined) payload.Summary = input.summary;
			if (urlToSet !== undefined) {
				payload.ThreadLink = {
					__metadata: { type: "SP.FieldUrlValue" },
					Url: urlToSet,
					Description: input.linkDescription ?? "Open in Teams",
				};
			}
			const url = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/items(${existing.id})`;
			await this.sendMutation(url, siteUrl, origin, payload, {
				"X-HTTP-Method": "MERGE",
				"IF-MATCH": "*",
			});
			return { action: "updated", id: existing.id, threadId, status, column };
		}

		const createUrl = explicitUrl ?? fallbackUrl;
		const payload: Record<string, unknown> = {
			__metadata: { type: entityType },
			Title: input.title ?? threadId,
			board_x0020_choice: column,
			ThreadId: threadId,
		};
		if (input.summary !== undefined) payload.Summary = input.summary;
		if (createUrl !== undefined) {
			payload.ThreadLink = {
				__metadata: { type: "SP.FieldUrlValue" },
				Url: createUrl,
				Description: input.linkDescription ?? "Open in Teams",
			};
		}
		const url = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/items`;
		const created = unwrapSingle(await this.sendMutation(url, siteUrl, origin, payload));
		return { action: "created", id: Number(created.Id ?? 0), threadId, status, column };
	}

	async moveCard(cfg: BoardConfig, threadId: string, status: BoardStatus): Promise<MoveCardResult> {
		const id = threadId.trim();
		if (!id) throw new Error("moveCard requires a non-empty threadId");
		const validStatus = assertStatus(status);
		const { siteUrl, origin } = normalizeSiteUrl(cfg.site_url);
		const listId = normalizeListId(cfg.list_id);
		const cols = resolveColumns(cfg.columns);
		const column = cols[validStatus];

		const existing = await this.findByThreadId(siteUrl, origin, listId, id, cols);
		if (!existing) return { updated: false, threadId: id, status: validStatus, column };

		const entityType = await this.getEntityType(siteUrl, origin, listId);
		const url = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/items(${existing.id})`;
		await this.sendMutation(
			url,
			siteUrl,
			origin,
			{ __metadata: { type: entityType }, board_x0020_choice: column },
			{ "X-HTTP-Method": "MERGE", "IF-MATCH": "*" },
		);
		return { updated: true, id: existing.id, threadId: id, status: validStatus, column };
	}

	async ensureSchema(cfg: BoardConfig): Promise<EnsureSchemaResult> {
		const { siteUrl, origin } = normalizeSiteUrl(cfg.site_url);
		const listId = normalizeListId(cfg.list_id);
		const cols = resolveColumns(cfg.columns);
		const wantedChoices = [cols.waiting, cols.working, cols.done];

		const fieldsUrl = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/fields?$select=Id,InternalName,Title,TypeAsString,Choices`;
		const { items: fields } = unwrapCollection(await this.getJson(fieldsUrl, origin));
		const byInternal = new Map<string, Record<string, unknown>>();
		for (const f of fields) {
			if (typeof f.InternalName === "string") byInternal.set(f.InternalName, f);
		}

		const createdFields: string[] = [];
		const updatedFields: string[] = [];
		const createFieldXml = async (internalName: string, schemaXml: string) => {
			const url = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/fields/createfieldasxml`;
			await this.sendMutation(url, siteUrl, origin, {
				parameters: {
					__metadata: { type: "SP.XmlSchemaFieldCreationInformation" },
					SchemaXml: schemaXml,
				},
			});
			createdFields.push(internalName);
		};

		const choiceField = byInternal.get("board_x0020_choice");
		if (!choiceField) {
			await createFieldXml(
				"board_x0020_choice",
				`<Field Type="Choice" Name="board_x0020_choice" StaticName="board_x0020_choice" DisplayName="board choice" Format="Dropdown"><Default>${escapeXml(cols.waiting)}</Default><CHOICES>${wantedChoices.map((c) => `<CHOICE>${escapeXml(c)}</CHOICE>`).join("")}</CHOICES></Field>`,
			);
		} else {
			const rawChoices = choiceField.Choices;
			const existingChoices: string[] = Array.isArray(rawChoices)
				? rawChoices.filter((c): c is string => typeof c === "string")
				: Array.isArray((rawChoices as { results?: unknown } | undefined)?.results)
					? ((rawChoices as { results: unknown[] }).results.filter((c): c is string => typeof c === "string"))
					: [];
			const missing = wantedChoices.filter((c) => !existingChoices.includes(c));
			if (missing.length > 0) {
				const fieldId = normalizeGuid(choiceField.Id, "field Id");
				const patchUrl = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/fields(guid'${escapeOData(fieldId)}')`;
				await this.sendMutation(
					patchUrl,
					siteUrl,
					origin,
					{ __metadata: { type: "SP.FieldChoice" }, Choices: { results: [...existingChoices, ...missing] } },
					{ "X-HTTP-Method": "MERGE", "IF-MATCH": "*" },
				);
				updatedFields.push("board_x0020_choice");
			}
		}

		if (!byInternal.has("Summary")) {
			await createFieldXml(
				"Summary",
				`<Field Type="Note" Name="Summary" StaticName="Summary" DisplayName="Summary" NumLines="6" RichText="FALSE" />`,
			);
		}
		if (!byInternal.has("ThreadLink")) {
			await createFieldXml(
				"ThreadLink",
				`<Field Type="URL" Name="ThreadLink" StaticName="ThreadLink" DisplayName="ThreadLink" Format="Hyperlink" />`,
			);
		}
		if (!byInternal.has("ThreadId")) {
			await createFieldXml(
				"ThreadId",
				`<Field Type="Text" Name="ThreadId" StaticName="ThreadId" DisplayName="ThreadId" MaxLength="255" />`,
			);
		}

		const viewsUrl = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/views?$select=Id,Title,ViewType,ViewType2,CustomFormatter`;
		const { items: views } = unwrapCollection(await this.getJson(viewsUrl, origin));
		const kanbanViews = views.filter((v) => v.ViewType2 === "KANBAN" || v.ViewType === "KANBAN");
		const boardView = kanbanViews.find((v) => v.Title === "Board") ?? kanbanViews[0];

		if (!boardView) {
			return { createdFields, updatedFields, addedViewFields: [], viewPatched: false };
		}

		const viewId = normalizeGuid(boardView.Id, "view Id");
		const viewUrl = `${siteUrl}/_api/web/lists(guid'${escapeOData(listId)}')/views(guid'${escapeOData(viewId)}')`;
		const vfRaw = unwrapSingle(await this.getJson(`${viewUrl}/ViewFields`, origin));
		const rawVfItems = vfRaw.Items;
		const existingViewFields: string[] = Array.isArray(rawVfItems)
			? rawVfItems.filter((f): f is string => typeof f === "string")
			: isRecord(rawVfItems) && Array.isArray(rawVfItems.results)
				? rawVfItems.results.filter((f): f is string => typeof f === "string")
				: [];
		const addedViewFields: string[] = [];
		const hasTitleField = existingViewFields.some((f) => f === "LinkTitle" || f === "Title" || f === "LinkTitleNoMenu");
		const neededViewFields = [
			...(hasTitleField ? [] : ["LinkTitle"]),
			...["board_x0020_choice", "Summary", "ThreadLink"].filter((f) => !existingViewFields.includes(f)),
		];
		for (const vf of neededViewFields) {
			await this.sendMutation(`${viewUrl}/ViewFields/addViewField('${escapeOData(vf)}')`, siteUrl, origin, {});
			addedViewFields.push(vf);
		}

		await this.sendMutation(
			viewUrl,
			siteUrl,
			origin,
			{ __metadata: { type: "SP.View" }, CustomFormatter: JSON.stringify(buildKanbanFormatter()) },
			{ "X-HTTP-Method": "MERGE", "IF-MATCH": "*" },
		);

		return {
			createdFields,
			updatedFields,
			addedViewFields,
			viewPatched: true,
			viewTitle: typeof boardView.Title === "string" ? boardView.Title : "Board",
		};
	}
}

const defaultClient = new BoardClient();

function resolveClient(clientOrOpts?: BoardClient | BoardClientOpts): BoardClient {
	if (clientOrOpts instanceof BoardClient) return clientOrOpts;
	if (clientOrOpts && (clientOrOpts.fetch || clientOrOpts.token || clientOrOpts.tenantId)) {
		return new BoardClient(clientOrOpts);
	}
	return defaultClient;
}

export function listCards(cfg: BoardConfig, clientOrOpts?: BoardClient | BoardClientOpts): Promise<BoardCard[]> {
	return resolveClient(clientOrOpts).listCards(cfg);
}

export function upsertCard(cfg: BoardConfig, input: UpsertCardInput, clientOrOpts?: BoardClient | BoardClientOpts): Promise<UpsertCardResult> {
	return resolveClient(clientOrOpts).upsertCard(cfg, input);
}

export function moveCard(cfg: BoardConfig, threadId: string, status: BoardStatus, clientOrOpts?: BoardClient | BoardClientOpts): Promise<MoveCardResult> {
	return resolveClient(clientOrOpts).moveCard(cfg, threadId, status);
}

export function ensureSchema(cfg: BoardConfig, clientOrOpts?: BoardClient | BoardClientOpts): Promise<EnsureSchemaResult> {
	return resolveClient(clientOrOpts).ensureSchema(cfg);
}
