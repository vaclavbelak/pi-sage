import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntime } from "@gendigital/sage-core";

/** Core's `AgentRuntime` is a closed union without "pi"; at runtime it is only a string tag. */
export const PI_RUNTIME = "pi" as AgentRuntime;

const srcDir = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(srcDir, "..");
export const THREATS_DIR = join(PACKAGE_ROOT, "resources", "threats");
export const TRUSTED_DOMAINS_DIR = join(PACKAGE_ROOT, "resources", "trusted-domains");
export const MCP_SERVER_PATH = join(PACKAGE_ROOT, "bin", "mcp-server.mjs");

/**
 * Sage product version = the installed @gendigital/sage-core version (what the update
 * check compares against Sage releases), not this package's own version.
 */
export function getSageVersion(): string {
	try {
		const worker = createRequire(import.meta.url).resolve(
			"@gendigital/sage-core/dist/model-download-worker.js",
		);
		const pkg = JSON.parse(readFileSync(join(dirname(worker), "..", "package.json"), "utf-8"));
		if (typeof pkg.version === "string") return pkg.version;
	} catch {
		// fall through
	}
	return "0.0.0";
}

function resolveCoreWorker(file: string): string | undefined {
	try {
		return createRequire(import.meta.url).resolve(`@gendigital/sage-core/dist/${file}`);
	} catch {
		return undefined;
	}
}

export const modelDownloadWorkerPath = (): string | undefined =>
	resolveCoreWorker("model-download-worker.js");
export const skillUploadWorkerPath = (): string | undefined =>
	resolveCoreWorker("skill-upload-worker.js");
