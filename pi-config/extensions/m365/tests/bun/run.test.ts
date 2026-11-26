import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { groups, runGroup } from "../groups.mjs";

for (const group of groups) {
	test.skipIf(group.local && !existsSync(group.script))(
		group.label,
		() => {
			const r = runGroup(group);
			if (r.status !== 0) {
				throw new Error(`exit ${r.status}\n${r.stdout}${r.stderr}`.trimEnd());
			}
			expect(r.status).toBe(0);
		},
		300_000,
	);
}
