/**
 * The session side of the schedule: the judge reads the small model's answer (omp: @tiny; pi: the session model)
 * and rejects anything else.
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
		typebox: `${PI}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${PI}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const { judgeOutput } = await jiti.import("../schedule.ts");
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

const registry = { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) };
/** omp: a `models` facade with roles. */
function ctxWith() {
	const model = faux.getModel();
	return { models: { resolve: (role) => (role === "@tiny" ? model : undefined) }, modelRegistry: registry };
}
/** pi 1.5: no `models`; the session's own model. */
function piCtx() {
	return { model: faux.getModel(), modelRegistry: registry };
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

await check("pi: the session model judges", async () => {
    answer("SKIP");
    strictEqual((await judgeOutput(piCtx(), "inject only outages", "all quiet")).verdict, "SKIP");
});

await check("pi: no session model throws", async () => {
    await rejects(() => judgeOutput({ modelRegistry: registry }, "rule", "output"), /no model selected/);
});

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

