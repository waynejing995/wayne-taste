/**
 * An agent tool as the shared tool layer defines it: pi's tool shape, minus pi. omp registers these objects as they
 * are; the MCP server lists their schemas and calls `execute`.
 */
import type { Static, TSchema } from "typebox";

/** The session a tool runs for: the part of pi's ExtensionContext the tools read. */
export interface ToolContext {
	cwd: string;
	hasUI?: boolean;
	isIdle(): boolean;
	ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
	sessionManager: { getSessionId(): string };
}

/** An image part of a tool result or a custom message, as pi and omp take it. */
export type ImagePart = { type: "image"; data: string; mimeType: string };
export type ToolContent = { type: "text"; text: string } | ImagePart;

export interface ToolResult {
	content: ToolContent[];
	details: Record<string, unknown>;
}

export interface ToolDef<P extends TSchema = TSchema> {
	name: string;
	label: string;
	description: string;
	parameters: P;
	execute(toolCallId: string, params: Static<P>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/** Where a tool layer registers its tools. */
export type RegisterTool = <P extends TSchema>(tool: ToolDef<P>) => void;
