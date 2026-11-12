/**
 * One short answer from a cheap model, in omp and in pi. The Teams turn gate and the schedule judge use it.
 *
 * omp has model roles: `ctx.models.resolve("@tiny")` gives the configured `modelRoles.tiny`. pi 1.5 has no
 * roles and no `ctx.models` (its ExtensionContext has `modelRegistry`, `model`, `scopedModels`), so in pi the
 * call goes to the session's own model, the one model pi is sure to have credentials for.
 * Credentials come from the registry and the call from pi-ai's completeSimple: both hosts have those two.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeSimple, type TextContent } from "@earendil-works/pi-ai";

const TINY_ROLE = "@tiny";
/** omp's own tiny-model classifiers allow this much, so a model that reasons anyway still reaches its answer. */
const MAX_TOKENS = 4096;
/** A hung call must not hold the caller, which waits for the answer, for long. */
const TIMEOUT_MS = 30_000;

type Model = NonNullable<ExtensionContext["model"]>;

/** omp: the `tiny` role. pi: the session model. Throws when neither exists. */
export function smallModel(ctx: ExtensionContext): Model {
	// `models` is omp's model query facade; pi's ExtensionContext does not have it.
	const models: unknown = "models" in ctx ? ctx.models : undefined;
	if (models && typeof models === "object" && "resolve" in models && typeof models.resolve === "function") {
		const model: ExtensionContext["model"] = models.resolve(TINY_ROLE);
		if (!model) throw new Error(`no model for ${TINY_ROLE}: set modelRoles.tiny in omp settings`);
		return model;
	}
	if (!ctx.model) throw new Error("no model selected in this pi session, so there is no model to ask");
	return ctx.model;
}

/** The trimmed text of one completion, and the `provider/id` that answered. Throws on any failure. */
export async function askSmall(ctx: ExtensionContext, systemPrompt: string, user: string): Promise<{ text: string; model: string }> {
	const model = smallModel(ctx);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	const target = "baseUrl" in auth && auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
	// disableReasoning is omp's switch for a short answer; pi's options type lacks it, and pi ignores it.
	const options = { apiKey: auth.apiKey, headers: auth.headers, maxTokens: MAX_TOKENS, disableReasoning: true, signal: AbortSignal.timeout(TIMEOUT_MS) };
	// omp declares systemPrompt as string[] but normalizes a plain string too (pi-ai normalizeSystemPrompts); pi declares
	// and reads a string. A string is the one value both hosts accept, so only omp's declaration is widened here.
	const reply = await completeSimple(target, { systemPrompt: systemPrompt as string & string[], messages: [{ role: "user", timestamp: Date.now(), content: user }] }, options);
	const name = `${model.provider}/${model.id}`;
	if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(`${name}: ${reply.errorMessage || reply.stopReason}`);
	const text = reply.content
		.filter((c: { type: string }): c is TextContent => c.type === "text")
		.map((c: TextContent) => c.text)
		.join("")
		.trim();
	return { text, model: name };
}
