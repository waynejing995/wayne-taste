/**
 * Forces one read failure in a real digest run: every `teams_read` of the self-chat is blocked, as a Graph error
 * would be. Loaded with `-e` by tests/e2e/digest.mjs for its failure scenario only.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		const input = event.input as { target?: string; chat_id?: string };
		if (event.toolName === "teams_read" && (input.target === "self" || input.chat_id === "48:notes"))
			return { block: true, reason: "e2e: forced read failure" };
	});
}
