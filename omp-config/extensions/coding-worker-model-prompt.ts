// Injects the coding/testing subagent model policy into omp agent sessions via
// `before_agent_start` (non-blocking extra prompt, zero rigid tool_call blocks).
//
// Policy (Wayne, 2026-11-27):
// - Restrict ONLY coding/testing subagents to the `task` role / `small-model`.
// - Never self-promote a coding/testing subagent to Opus or `highend-nonopus`;
//   ask the coordinator for help instead.
// - Do not restrict other non-coding/testing agents.

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export const CODING_WORKER_MODEL_PROMPT =
	"Coding/testing subagent model rule: coding and testing subagents MUST use only the default `task` role model (or `small-model`). " +
	"Never self-promote a coding/testing subagent to Opus or `highend-nonopus` (neither via `task()` `model` nor `agent://<id>/model`); " +
	"if stuck or hitting a model failure, stop and ask the coordinator for help instead. Do not restrict other non-coding/testing agents.";

export default function codingWorkerModelPrompt(pi: ExtensionAPI) {
	let injected = false;
	const reset = () => {
		injected = false;
	};

	for (const ev of ["session_start", "session_switch", "session_compact"] as const) {
		pi.on(ev, reset);
	}

	pi.on("before_agent_start", () => {
		if (injected) return undefined;
		injected = true;
		return {
			message: {
				customType: "coding-worker-model-prompt",
				content: CODING_WORKER_MODEL_PROMPT,
				display: false,
			},
		};
	});
}
