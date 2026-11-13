/**
 * m365 as an MCP server (stdio): the teams_* and outlook_* tools from the shared tool layer, plus the inbox ledger
 * tools. One implementation: omp registers the same tool objects (teams/index.ts, outlook/index.ts).
 *
 *   bun mcp/server.ts            # Claude Code, Codex, Cursor
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
import { createTeams } from "../teams/core.ts";
import { inboxTools } from "./inbox.ts";

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

/** The server, not yet connected. */
export function createServer(): Server {
	const tools: ToolDef[] = [];
	createTeams({
		registerTool: (tool) => void tools.push(tool as unknown as ToolDef),
		exec: run,
		// No channel yet: nothing here can receive a watch card, so teams_watch start is refused below.
		sendMessage: () => {},
		sendUserMessage: () => {},
	});
	createOutlook({ registerTool: (tool) => void tools.push(tool as unknown as ToolDef) });
	tools.push(...inboxTools);

	// A watch delivers cards into a session; this server has no way to push them, so a started watch would go nowhere.
	const watchTool = tools.find((t) => t.name === "teams_watch")!;
	const watchExecute = watchTool.execute.bind(watchTool);
	watchTool.execute = async (id, params, signal, onUpdate, ctx) => {
		const starting = typeof params === "object" && params !== null && "action" in params && params.action === "start";
		if (starting) throw new Error("teams_watch start is not available over MCP: this server cannot push watch cards; use list or stop, or watch from omp");
		return watchExecute(id, params, signal, onUpdate, ctx);
	};

	const server = new Server(
		{ name: NAME, version: VERSION },
		{ capabilities: { tools: {} }, instructions: "Microsoft Teams, Outlook and the user's inbox ledger, signed in as the user." },
	);

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
