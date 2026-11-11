/**
 * The session side of the schedule: the judge reads the tiny model's answer and rejects anything else.
 *
 *   node --experimental-strip-types inbox/tests/schedule.test.mjs
 */
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { join } from "node:path";
import { createJiti, PI } from "../../tests/host.mjs";

const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${PI}/dist/index.js`,
		"@earendil-works/pi-ai": `${PI}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
	},
	interopDefault: true,
});
const { judgeOutput, runOne } = await jiti.import("../schedule.ts");
const { registerFauxProvider, fauxAssistantMessage } = await jiti.import("@earendil-works/pi-ai");
const faux = registerFauxProvider();

let failed = 0;
async function check(label, fn) {
    try {
        await fn();
        console.log(`PASS ${label}`);
    } catch (e) {
        failed++;
        console.log(`FAIL ${label}\n${e.stack ?? e.message}`);
    }
}

function ctxWith() {
	const model = faux.getModel();
	return {
		models: { resolve: (role) => (role === "@tiny" ? model : undefined) },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) },
	};
}
const seen = [];
function answer(text) {
	faux.setResponses([(context) => (seen.push(context), fauxAssistantMessage(text))]);
}

await check("INJECT with a summary line", async () => {
	answer("INJECT\nhost b is full");
	const got = await judgeOutput(ctxWith(), "inject only outages", "disk full on host b");
	deepStrictEqual(got, { verdict: "INJECT", summary: "host b is full" });
	const system = JSON.stringify(seen.at(-1));
	if (!system.includes("inject only outages")) throw new Error("judge prompt missing the rule");
});


await check("SKIP", async () => {
    answer("SKIP");
    strictEqual((await judgeOutput(ctxWith(), "inject only outages", "all quiet")).verdict, "SKIP");
});

await check("anything but INJECT or SKIP throws", async () => {
    answer("maybe");
    await rejects(() => judgeOutput(ctxWith(), "rule", "output"), /not INJECT or SKIP/);
});

await check("no tiny model throws instead of guessing", async () => {
    const ctx = { models: { resolve: () => undefined }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) } };
    await rejects(() => judgeOutput(ctx, "rule", "output"), /no model for @tiny/);
});

await check("a tool that is not teams_read finishes with a card and returns the prompt", async () => {
    const calls = [];
    const stub = async (args) => {
        calls.push(args);
        return args.includes("show")
            ? '{"action":{"kind":"tool","name":"read","args":{"path":"/etc/hostname"}},"judge":"off"}'
            : "card foreign 2026-11-11T0114: notify foreign:2026-11-11T0114";
    };
    const line = await runOne(ctxWith(), "foreign", stub);
    strictEqual(line, 'call the tool read with {"path":"/etc/hostname"}');
    const finish = calls.find((args) => args.includes("finish"));
    if (!finish || !finish.includes("DISPATCHED")) throw new Error("the card must be recorded so the job advances");
});

await check("a judged tool that is not teams_read is refused", async () => {
    const stub = async (args) => args.includes("show")
        ? '{"action":{"kind":"tool","name":"read","args":{}},"judge":"on","judge_prompt":"rule"}'
        : "finished";
    await rejects(() => runOne(ctxWith(), "foreign", stub), /cannot be judged/);
});

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

