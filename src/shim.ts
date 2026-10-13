/**
 * @gendigital/sage-core's ESM build calls a bare `require` (clients/amsi-spawn.js),
 * which only exists under Bun/CJS. Provide it on Node ESM. Must be imported before core.
 */
import { createRequire } from "node:module";

const g = globalThis as { require?: NodeJS.Require };
if (typeof g.require !== "function") {
	g.require = createRequire(import.meta.url);
}
