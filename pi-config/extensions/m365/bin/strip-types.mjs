/**
 * Node loader hook for the `inbox` launcher: strips TypeScript types from the plugin's .ts files.
 *
 * Node 22's --experimental-strip-types refuses any file under node_modules, and omp loads this plugin from
 * ~/.omp/plugins/node_modules/…, so the launcher registers this hook instead. Type stripping keeps every line where it
 * is, so stack traces point at the source. A file that strip mode refuses (parameter properties: the Teams core's
 * GraphClient and backends, which the probe's digest sends through) is transformed instead.
 */
import { readFile } from "node:fs/promises";
import { register, stripTypeScriptTypes } from "node:module";

if (!import.meta.url.includes("?hook")) register(`${import.meta.url}?hook`);

export async function load(url, context, next) {
	if (!url.endsWith(".ts")) return next(url, context);
	const source = await readFile(new URL(url), "utf8");
	let code;
	try {
		code = stripTypeScriptTypes(source, { mode: "strip" });
	} catch (e) {
		if (e?.code !== "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") throw e;
		code = stripTypeScriptTypes(source, { mode: "transform" });
	}
	return { format: "module", source: code, shortCircuit: true };
}
