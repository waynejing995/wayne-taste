/**
 * coding-worker-model-prompt: verifies before_agent_start message injection without blocking tool calls.
 *
 *   node --experimental-strip-types omp-config/tests/coding-worker-model-prompt.test.mjs
 */
import { match, ok, strictEqual } from "node:assert/strict";

const EXT = new URL("../extensions/coding-worker-model-prompt.ts", import.meta.url).href;
const { CODING_WORKER_MODEL_PROMPT, default: codingWorkerModelPrompt } = await import(EXT);

const handlers = new Map();
codingWorkerModelPrompt({
	on(event, fn) {
		handlers.set(event, fn);
	},
});

ok(handlers.has("before_agent_start"), "registers before_agent_start");
ok(!handlers.has("tool_call"), "does not register a blocking tool_call hook");

const beforeStart = handlers.get("before_agent_start");

// 1. Injects non-blocking hidden message on first agent start
const r1 = beforeStart({ prompt: "run tests" });
ok(r1?.message, "returns message payload");
strictEqual(r1.message.customType, "coding-worker-model-prompt");
strictEqual(r1.message.display, false);
strictEqual(r1.message.content, CODING_WORKER_MODEL_PROMPT);
match(r1.message.content, /coding and testing subagents/i);
match(r1.message.content, /ask the coordinator for help/i);
match(r1.message.content, /Do not restrict other non-coding\/testing agents/i);

// 2. Does not duplicate on subsequent turns in the same session
strictEqual(beforeStart({ prompt: "turn 2" }), undefined);

// 3. Re-injects after compaction or session switch
handlers.get("session_compact")();
const r2 = beforeStart({ prompt: "after compact" });
strictEqual(r2?.message?.content, CODING_WORKER_MODEL_PROMPT);

handlers.get("session_switch")();
const r3 = beforeStart({ prompt: "new session" });
strictEqual(r3?.message?.content, CODING_WORKER_MODEL_PROMPT);

console.log("all green");
