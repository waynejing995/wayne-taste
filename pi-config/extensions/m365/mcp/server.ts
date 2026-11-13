/**
 * m365 as an MCP server (stdio): the teams_* and outlook_* tools from the shared tool layer, plus the inbox ledger
 * tools. One implementation: omp registers the same tool objects (teams/index.ts, outlook/index.ts).
 *
 *   bun mcp/server.ts
 *
 * The server always declares Claude Code's claude/channel. A client that can take pushes (it advertises claude/channel,
 * or it is Claude Code) gets the channel: the saved Teams watches resume, and teams_watch and inbox_watch push their
 * cards into the session. Any other client gets the tools, with teams_watch start and inbox_watch start refused.
 *
 * Sign-in is omp's: the server reads the MSAL token cache `/teams init` wrote and never prompts.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Value } from "typebox/value";
import * as auth from "../core/auth.ts";
import type { ToolContent, ToolContext, ToolDef, ToolResult } from "../core/tool.ts";
import { createOutlook } from "../outlook/tools.ts";
import { setAgentHarness } from "../teams/card.ts";
import { createTeams, type TeamsHost } from "../teams/core.ts";
import { describeOwner } from "../teams/watch.ts";
import { type Channel, CHANNEL_INSTRUCTIONS, type ChannelEvent, logFailure, type Push, startChannel } from "./channel.ts";
import { inboxTools } from "./inbox.ts";
import { Type } from "typebox";

const NAME = "m365";
const VERSION = "1.0.0";
const LOGIN_HINT = "run /teams init in omp";
/** Pictures a tool returns without a file of its own (outlook_read) are saved here, so the reply can name a path. */
const IMAGES_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "pi", "m365-mcp-images");
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** The session the tools run for: no terminal, never mid-turn, notes to stderr (stdout is the protocol). */
const context: ToolContext = {
	cwd: process.cwd(),
	hasUI: false,
	isIdle: () => true,
	ui: { notify: (message, type = "info") => console.error(`[${NAME}] ${type}: ${message}`) },
	sessionManager: { getSessionId: () => `mcp-${process.pid}` },
};

/** Fails loudly when omp has never signed in on this machine: there is no second login. */
export function requireLogin(): void {
	if (auth.loadCache() === null) throw new Error(`${NAME}: not signed in to Microsoft 365 (no token cache at ${auth.cachePath()}): ${LOGIN_HINT}`);
}

/** omp's sign-in hint names omp's command; outside omp, say where to run it. */
function errorText(e: unknown): string {
	return (e instanceof Error ? e.message : String(e)).replace(/run \/teams init\b(?! in omp)/g, LOGIN_HINT);
}

function run(command: string, args: string[], options: { timeout?: number; cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }> {
	const { promise, resolve } = Promise.withResolvers<{ code: number; stdout: string; stderr: string }>();
	execFile(command, args, { ...options, maxBuffer: 64 << 20 }, (e, stdout, stderr) =>
		resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr: stderr || (e?.message ?? "") }),
	);
	return promise;
}

/**
 * A tool result as MCP content. Text stays text; an image part becomes MCP image content, and every image is named by
 * a local path: teams_read's own `[image n saved: <file>]` line, or a file saved here when the tool kept none.
 */
export function mcpContent(content: ToolContent[]): ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] {
	const out: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
	for (const part of content) {
		if (part.type === "text") {
			out.push({ type: "text", text: part.text });
			continue;
		}
		const previous = out.at(-1);
		if (previous?.type !== "text" || !/ saved: \//.test(previous.text)) {
			const bytes = Buffer.from(part.data, "base64");
			fs.mkdirSync(IMAGES_DIR, { recursive: true, mode: 0o700 });
			const file = path.join(IMAGES_DIR, `${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${IMAGE_EXT[part.mimeType] ?? "bin"}`);
			fs.writeFileSync(file, bytes, { mode: 0o600 });
			out.push({ type: "text", text: `[image saved: ${file}]` });
		}
		out.push({ type: "image", data: part.data, mimeType: part.mimeType });
	}
	return out;
}

/** The client takes pushed channel events: it advertises claude/channel, or it is Claude Code (which, as of 2.1.322, advertises nothing). */
function canTakePushes(server: Server): boolean {
	const caps = server.getClientCapabilities() as { experimental?: Record<string, unknown> } | undefined;
	return caps?.experimental?.["claude/channel"] !== undefined || server.getClientVersion()?.name === "claude-code";
}

/** The server, not yet connected. Once the client has initialized, a client that takes pushes gets the channel. */
export function createServer(): Server {
	const tools: ToolDef[] = [];
	let pushEvent: Push | undefined;
	let channel: Channel | undefined;
	const send = (event: ChannelEvent) => pushEvent && logFailure(pushEvent(event));
	const host: TeamsHost = {
		registerTool: (tool) => void tools.push(tool as unknown as ToolDef),
		exec: run,
		sendMessage: (message, delivery, meta) =>
			send({
				kind: "card",
				content: typeof message.content === "string" ? message.content : message.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n"),
				meta: { chat_id: message.details.chatId, sender: meta.senders.join(", "), policy: message.details.policy, turn: delivery.triggerTurn ? "yes" : "no" },
			}),
		sendUserMessage: (text, _options, meta) => send({ kind: "instruction", content: text, meta: { chat_id: meta.chatId, sender: "user", policy: meta.policy } }),
	};
	const teams = createTeams(host);
	createOutlook({ registerTool: host.registerTool });
	tools.push(...inboxTools);

	const noPush = () => `${server.getClientVersion()?.name ?? "this client"} cannot receive pushed events (it neither advertises claude/channel nor is Claude Code)`;
	const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], details: {} });
	/** Said on every watch tool: the server cannot see whether Claude Code registered the channel. */
	const LIVE_ONLY =
		" Over MCP this works only in an interactive Claude Code session started with " +
		"--dangerously-load-development-channels server:m365: anywhere else (claude -p, a session without the flag, " +
		"or an org policy that disables channels) Claude Code drops the cards silently, so start a watch only when the user asks in such a session.";

	// A watch here delivers only through the channel; without one its cards would go nowhere.
	const watchTool = tools.find((t) => t.name === "teams_watch")!;
	const watchExecute = watchTool.execute.bind(watchTool);
	watchTool.description += ` With action='start' and no chat_id or chat, the chats saved in rules.yaml are resumed, the self-chat included; one another session holds is skipped and named.${LIVE_ONLY}`;
	watchTool.execute = async (id, params, signal, onUpdate, ctx) => {
		const p = params as { action?: string; chat_id?: string; chat?: string };
		if (p.action === "start" && !channel) throw new Error(`teams_watch start is refused: ${noPush()}.`);
		if (p.action === "start" && channel && !p.chat_id && !p.chat) return text(await channel.resume());
		const result = await watchExecute(id, params, signal, onUpdate, ctx);
		if (p.action !== "list" || !channel?.held.length) return result;
		const held = channel.held.map((h) => `- ${h.label}  id: ${h.chatId}\n  held by ${describeOwner(h.owner)}`).join("\n");
		return { ...result, content: [...result.content, { type: "text", text: `Saved watches skipped by the last resume (another session holds them):\n${held}` }] };
	};

	tools.push({
		name: "inbox_watch",
		label: "Inbox Watch",
		description:
			"Push the user's inbox cards into this session, as omp's /inbox watch does: start takes the inbox lease when " +
			"no other session holds it (otherwise it says who does, and takes nothing), stop releases it, status says " +
			`who delivers the inbox. Start only when the user asks.${LIVE_ONLY}`,
		parameters: Type.Object({ action: Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("status")], { description: "What to do" }) }),
		async execute(_id, params) {
			const action = (params as { action: "start" | "stop" | "status" }).action;
			if (action === "start") {
				if (!channel) throw new Error(`inbox_watch start is refused: ${noPush()}.`);
				return text(await channel.inbox.start());
			}
			if (action === "stop") return text(channel ? channel.inbox.stop() : "This session does not watch the inbox.");
			return text(channel ? await channel.inbox.status() : `This session does not watch the inbox: ${noPush()}.`);
		},
	});

	const server = new Server({ name: NAME, version: VERSION }, { capabilities: { tools: {}, experimental: { "claude/channel": {} } }, instructions: CHANNEL_INSTRUCTIONS });

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: tools.map((t) => ({ name: t.name, title: t.label, description: t.description, inputSchema: t.parameters as { type: "object" } })),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const tool = tools.find((t) => t.name === request.params.name);
		if (!tool) return { isError: true, content: [{ type: "text", text: `unknown tool: ${request.params.name}` }] };
		const args = request.params.arguments ?? {};
		if (!Value.Check(tool.parameters, args)) {
			const why = [...Value.Errors(tool.parameters, args)].map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
			return { isError: true, content: [{ type: "text", text: `invalid arguments for ${tool.name}: ${why}` }] };
		}
		try {
			const result: ToolResult = await tool.execute(String(extra.requestId), args, extra.signal, undefined, context);
			return { content: mcpContent(result.content) };
		} catch (e) {
			return { isError: true, content: [{ type: "text", text: errorText(e) }] };
		}
	});

	server.oninitialized = () => {
		// One client per process: its name foots every send ("sent by claude-code agent"), and the echo guard knows only that.
		setAgentHarness(server.getClientVersion()?.name);
		if (!canTakePushes(server)) {
			console.error(`[${NAME}] ${noPush()}: tools only, no channel`);
			return;
		}
		pushEvent = (event) => server.notification({ method: "notifications/claude/channel", params: { content: event.content, meta: { kind: event.kind, ...event.meta } } });
		const started = startChannel({ teams, context, push: pushEvent });
		channel = started;
		server.onclose = () => started.stop();
	};
	return server;
}

if (import.meta.main) {
	// stdout is the protocol: anything a library logs goes to stderr.
	console.log = console.error;
	requireLogin();
	const server = createServer();
	await server.connect(new StdioServerTransport());
	process.stdin.on("close", () => void server.close().finally(() => process.exit(0)));
}
