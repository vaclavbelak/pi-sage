#!/usr/bin/env node
// Sage MCP server (sage_report_false_positive, sage_list_audit_entries) for pi.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// sage-core's ESM build uses a bare `require` (amsi-spawn); provide it on Node ESM.
globalThis.require ??= createRequire(import.meta.url);
const { createOperationalLogger, loadConfig, nullLogger, resolveBranding } = await import("@gendigital/sage-core");
const { runSageMcpServerStdio } = await import("@gendigital/sage-mcp");

let logger = nullLogger;
try {
	// Sage product version = installed sage-core version.
	const worker = createRequire(import.meta.url).resolve("@gendigital/sage-core/dist/model-download-worker.js");
	const version = JSON.parse(readFileSync(join(dirname(worker), "..", "package.json"), "utf-8")).version;

	const config = await loadConfig();
	logger = createOperationalLogger(config.operational_logging, "pi").forComponent("mcp-server");
	await runSageMcpServerStdio({
		version,
		logger,
		branding: resolveBranding(config.brand_key, logger),
	});
} catch (e) {
	logger.error("MCP server failed", { error: String(e) });
	await logger.flush?.();
	process.exit(1);
}
