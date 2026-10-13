/**
 * Sage connector for pi.
 *
 *   tool_call      → PreToolUse   (allow / deny / ask → native confirm)
 *   tool_result    → PostToolUse  (approval note, PI warnings, output scan)
 *   session_start  → SessionStart (plugin + skill scan, notices)
 */

import "./shim.ts"; // must stay first: provides `require` for sage-core on Node ESM
import {
	createOperationalLogger,
	loadConfig,
	resolveBranding,
} from "@gendigital/sage-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { createHandlers, type HandlerContext } from "./handlers.ts";
import { MCP_SERVER_PATH, PI_RUNTIME } from "./runtime.ts";
import { type PiSourceInfo, runSessionScan } from "./session.ts";

export default async function sage(pi: ExtensionAPI): Promise<void> {
	const config = await loadConfig();
	const operational = createOperationalLogger(config.operational_logging, PI_RUNTIME);
	const logger = operational.forComponent("extension");
	const branding = resolveBranding(config.brand_key, logger);

	const handlers = createHandlers({
		logger: operational.forComponent("tool-handler"),
		branding,
		agentRuntimeVersion: PI_VERSION,
	});

	pi.on("tool_call", (event, ctx) =>
		handlers.onToolCall(event as never, ctx as unknown as HandlerContext),
	);
	pi.on("tool_result", (event, ctx) =>
		handlers.onToolResult(event as never, ctx as unknown as HandlerContext) as never,
	);

	// sage_report_false_positive / sage_list_audit_entries. A user-defined "sage" server wins.
	try {
		pi.registerMcpServer("sage", {
			command: process.execPath,
			args: [MCP_SERVER_PATH],
			env: { SAGE_AGENT_RUNTIME: PI_RUNTIME },
		});
	} catch (error) {
		logger.debug("Sage MCP server registration failed", { error: String(error) });
	}

	// One scan per session id; session_start also fires on reload/resume/fork, and pi
	// invalidates the previous ctx on reload. Everything is read from pi/ctx synchronously,
	// and results are delivered through whichever ctx is current (a stale ctx throws).
	const scans = new Map<string, Promise<string[]>>();
	const delivered = new Set<string>();
	pi.on("session_start", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		let scan = scans.get(sessionId);
		if (!scan) {
			const input = {
				logger: operational.forComponent("startup-scan"),
				branding,
				agentDir: getAgentDir(),
				cwd: ctx.cwd,
				sources: [
					...pi.getAllTools().map((t) => t.sourceInfo),
					...pi.getCommands().map((c) => c.sourceInfo),
				] as PiSourceInfo[],
				agentRuntimeVersion: PI_VERSION,
			};
			scan = runSessionScan(input).catch((error) => {
				logger.error(`${branding.name} session scan failed (fail-open)`, { error: String(error) });
				return [] as string[];
			});
			scans.set(sessionId, scan);
		}

		// Don't hold up startup; deliver when the scan finishes.
		void scan.then((messages) => {
			if (delivered.has(sessionId) || messages.length === 0) return;
			try {
				if (!ctx.hasUI) return;
				for (const m of messages) ctx.ui.notify(m, "info");
				delivered.add(sessionId);
			} catch {
				// ctx went stale (reload); the next session_start delivers.
			}
		});
	});
}
