/**
 * Node loader hook for the `inbox` launcher: strips TypeScript types from the plugin's .ts files.
 *
 * Node 22's --experimental-strip-types refuses any file under node_modules, and omp loads this plugin from
 * ~/.omp/plugins/node_modules/…, so the launcher registers this hook instead. Type stripping only: the plugin's
 * .ts files use no enums, namespaces or parameter properties.
 */
import { readFile } from "node:fs/promises";
import { register, stripTypeScriptTypes } from "node:module";

if (!import.meta.url.includes("?hook")) register(`${import.meta.url}?hook`);

export async function load(url, context, next) {
	if (!url.endsWith(".ts")) return next(url, context);
	const source = await readFile(new URL(url), "utf8");
	return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip" }), shortCircuit: true };
}
