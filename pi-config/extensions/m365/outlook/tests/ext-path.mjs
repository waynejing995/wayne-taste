/**
 * The extension's REAL directory, symlinks resolved.
 *
 * ~/.pi/agent/extensions/teams is a symlink into the wayne-skills checkout.
 * jiti caches modules by resolved path, so importing "auth.ts" through the
 * symlink while index.ts resolves "./auth.ts" to the real path yields TWO
 * instances of the module -- and a test that patches one is patching a copy the
 * extension never calls.
 *
 * The symptom is not a failure, it is a HANG: login-command.test.mjs patched a
 * phantom auth module, the real device-code flow ran, and the suite sat there
 * polling Microsoft.
 */
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const EXT_DIR = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
export const ext = (file) => `${EXT_DIR}/${file}`;
