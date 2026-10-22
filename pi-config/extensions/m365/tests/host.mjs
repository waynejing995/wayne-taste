/**
 * Where pi is installed, for tests that load the extension the way pi does (through pi's own jiti,
 * with pi's packages as the aliases). Nothing machine-specific is written in a test file.
 *
 * PI_CODING_AGENT_DIR wins when set; otherwise pi's global npm install
 * (`npm root -g`/@earendil-works/pi-coding-agent). Not found is an error that says how to point at it.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function locate() {
	const given = process.env.PI_CODING_AGENT_DIR;
	if (given) return given;
	const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
	return join(root, "@earendil-works", "pi-coding-agent");
}

/** pi's install directory: the root the jiti aliases point into. */
export const PI = locate();
if (!existsSync(join(PI, "package.json"))) {
	throw new Error(`pi is not installed at ${PI}; install it (npm i -g @earendil-works/pi-coding-agent) or set PI_CODING_AGENT_DIR`);
}

/** pi's own jiti, so modules load exactly as pi loads them. */
export const { createJiti } = await import(join(PI, "node_modules", "jiti", "lib", "jiti.mjs"));
