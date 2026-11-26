/**
 * Outlook for pi: ten agent tools, an Inbox unread count in the status bar,
 * and `/outlook signature`. Every call goes through one Mailbox, which reaches
 * Graph with the Teams sign-in (core/auth.ts), so nothing here stores a credential.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setStatusPart } from "../core/status-row.ts";
import { readSignature, signaturePath, writeSignature } from "./signature.ts";
import { createOutlook } from "./tools.ts";

const HINT = "not authenticated — run /teams init";
const POLL_MS = 60_000;

/** The first line of an error, cut to fit the status bar. */
function shortError(e: unknown): string {
	const first = (e instanceof Error ? e.message : String(e)).split("\n")[0].trim();
	return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

export default function (pi: ExtensionAPI) {
	// The outlook_* tools: shared with the MCP server. What stays here is omp's status bar and `/outlook signature`.
	const { mailbox } = createOutlook({
		registerTool: (tool) => pi.registerTool(tool as Parameters<ExtensionAPI["registerTool"]>[0]),
		flash: (ctx, text, holdMs) => flash(ctx as ExtensionContext, text, holdMs),
		pollUnread: (ctx) => pollUnread(ctx as ExtensionContext),
	});

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
	pi.registerCommand("outlook", {
		description: "Outlook: `/outlook signature` edits your signature",
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
			ctx.ui.notify(
				arg ? `unknown /outlook argument "${arg}" — try /outlook signature` : "usage: /outlook signature",
				"error",
			);
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
