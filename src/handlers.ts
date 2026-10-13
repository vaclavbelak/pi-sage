/**
 * tool_call (PreToolUse) and tool_result (PostToolUse) handlers.
 *
 * Fail-open: evaluation errors never block. pi blocks a tool when a tool_call
 * handler throws, so nothing may escape the evaluation try/catch.
 */

import {
	type Artifact,
	type Branding,
	evaluateToolCall,
	evaluateToolOutput,
	findPiWarningInAuditLog,
	formatPiWarning,
	kv,
	type Logger,
	loadConfig,
	ruleLabel,
	separatorLine,
	severityEmoji,
	type Verdict,
} from "@gendigital/sage-core";
import { PI_RUNTIME, THREATS_DIR, TRUSTED_DOMAINS_DIR } from "./runtime.ts";
import { canonicalTool, outputHookInput, prepareToolCall, resultText } from "./tools.ts";

/** Minimal slices of pi's ExtensionContext / events that the handlers use. */
export interface HandlerContext {
	cwd: string;
	hasUI: boolean;
	signal?: AbortSignal;
	ui: {
		confirm(title: string, message: string, opts?: { signal?: AbortSignal }): Promise<boolean>;
		notify(message: string, type?: "info" | "warning" | "error"): void;
	};
	sessionManager: { getSessionId(): string };
}

export interface ToolCallEventLike {
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
}

export interface ToolResultEventLike {
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

export interface HandlerDeps {
	logger: Logger;
	branding: Branding;
	agentRuntimeVersion?: string;
}

interface PendingApproval {
	threatId: string;
	threatTitle: string;
	artifacts: Array<{ type: string; value: string }>;
}

const artifactLabel = (type: string): string =>
	type === "url" ? "URL" : type === "file_path" ? "file path" : type;

function details(verdict: Verdict): string[] {
	const lines: string[] = [];
	const rule = ruleLabel(verdict);
	if (rule) lines.push(kv("Rule", rule));
	lines.push(kv("Severity", verdict.severity.toUpperCase()));
	verdict.artifacts.slice(0, 3).forEach((a, i) => lines.push(kv(i === 0 ? "Artifact" : "", a)));
	return lines;
}

function reasonOf(verdict: Verdict): string {
	return verdict.reasons[0] ?? verdict.category;
}

/** Model-facing text for a blocked call. */
export function formatBlocked(verdict: Verdict, branding: Branding): string {
	return [
		`${branding.name} blocked this action; the tool did not run.`,
		`Threat: ${reasonOf(verdict)}`,
		...details(verdict).map((l) => l.trimEnd()),
		verdict.source === "pi_check"
			? "Do NOT fetch this URL again or access it through alternative tools."
			: "Do not attempt an equivalent workaround. Tell the user the action was blocked.",
	].join("\n");
}

/** User-facing confirmation dialog text for an `ask` verdict. */
export function formatAsk(verdict: Verdict, branding: Branding): { title: string; body: string } {
	return {
		title: `${branding.name}: Suspicious activity detected`,
		body: [
			`${severityEmoji(verdict.severity)} ${reasonOf(verdict)}`,
			separatorLine(40),
			...details(verdict),
			"",
			"Allow this action?",
		].join("\n"),
	};
}

export function createHandlers(deps: HandlerDeps) {
	const { logger, branding } = deps;
	// pi runs in one process, so approvals can be correlated in memory
	// (Claude Code needs files because its hooks are separate processes).
	const pendingApprovals = new Map<string, PendingApproval>();

	const evaluationContext = { threatsDir: THREATS_DIR, trustedDomainsDir: TRUSTED_DOMAINS_DIR, logger };

	async function onToolCall(
		event: ToolCallEventLike,
		ctx: HandlerContext,
	): Promise<{ block: true; reason: string } | undefined> {
		let verdict: Verdict;
		let artifacts: Artifact[];
		try {
			const prepared = prepareToolCall(event.toolName, event.input, ctx.cwd);
			if (!prepared) return undefined;
			artifacts = prepared.artifacts;
			const sessionId = ctx.sessionManager.getSessionId();
			verdict = await evaluateToolCall(
				{
					sessionId,
					conversationId: sessionId,
					agentRuntime: PI_RUNTIME,
					agentRuntimeVersion: deps.agentRuntimeVersion,
					hookType: "PreToolUse",
					toolName: prepared.toolName,
					toolInput: prepared.toolInput,
					artifacts,
					toolUseId: event.toolCallId,
				},
				evaluationContext,
			);
		} catch (error) {
			logger.error(`${branding.name} pi tool_call failed open`, {
				error: String(error),
				tool: event.toolName,
			});
			return undefined;
		}

		if (verdict.decision === "allow") return undefined;

		const block = (text: string) => ({ block: true as const, reason: text });

		if (verdict.decision === "deny") {
			notify(ctx, `${branding.name} blocked: ${reasonOf(verdict)}`, "warning");
			return block(formatBlocked(verdict, branding));
		}

		// ask → native confirmation. No UI (print/RPC mode) → deny.
		if (!ctx.hasUI) {
			return block(
				`${formatBlocked(verdict, branding)}\n(Confirmation required but no UI is available.)`,
			);
		}
		const { title, body } = formatAsk(verdict, branding);
		let approved = false;
		try {
			approved = await ctx.ui.confirm(title, body, { signal: ctx.signal });
		} catch (error) {
			logger.debug("Sage confirmation failed; denying", { error: String(error) });
		}
		if (!approved) {
			return block(
				`${branding.name} flagged this action (${reasonOf(verdict)}) and the user declined it; the tool did not run. Do not retry or work around it.`,
			);
		}

		// Only allowlistable artifacts are tracked (free-form content is not meaningful to allow).
		const matched = artifacts
			.filter((a) => a.type !== "content" && verdict.artifacts.includes(a.value))
			.map((a) => ({ type: a.type, value: a.value }));
		if (matched.length > 0) {
			pendingApprovals.set(event.toolCallId, {
				threatId: verdict.matchedThreatId ?? "unknown",
				threatTitle: reasonOf(verdict),
				artifacts: matched,
			});
		}
		return undefined;
	}

	async function onToolResult(
		event: ToolResultEventLike,
		ctx: HandlerContext,
	): Promise<{ content: Array<{ type: string; text?: string }> } | undefined> {
		const parts: string[] = [];
		try {
			const pending = pendingApprovals.get(event.toolCallId);
			if (pending) {
				pendingApprovals.delete(event.toolCallId);
				const list = pending.artifacts
					.map((a) => `${artifactLabel(a.type)} '${a.value}'`)
					.join(", ");
				parts.push(
					`${branding.name}: The user approved a flagged action (threat ${pending.threatId}: ${pending.threatTitle}, artifacts: ${list}). To permanently allow this in the future, the user can add an exception rule to ~/.sage/exceptions.json.`,
				);
			}

			const toolName = canonicalTool(event.toolName);
			if (toolName) {
				const config = await loadConfig(undefined, logger);

				// Medium-risk PI warning recorded by the pre-check on fetched content.
				if (toolName === "WebFetch" && config.logging.enabled && config.sensitivity !== "relaxed") {
					const warning = await findPiWarningInAuditLog(config.logging, event.toolCallId);
					if (warning) parts.push(`🛡️ ${formatPiWarning(warning, branding)}`);
				}

				// Heuristic prompt-injection scan of tool output.
				const hookInput = outputHookInput(toolName, resultText(event.content));
				if (hookInput) {
					const sessionId = ctx.sessionManager.getSessionId();
					const warnings = await evaluateToolOutput(
						{
							sessionId,
							conversationId: sessionId,
							agentRuntime: PI_RUNTIME,
							agentRuntimeVersion: deps.agentRuntimeVersion,
							hookType: "PostToolUse",
							toolName,
							toolInput: event.input,
							hookInput,
							toolUseId: event.toolCallId,
						},
						evaluationContext,
					);
					for (const w of warnings) parts.push(`🛡️ ${w.message}`);
				}
			}
		} catch (error) {
			logger.error(`${branding.name} pi tool_result failed open`, { error: String(error) });
		}
		if (parts.length === 0) return undefined;
		return { content: [...event.content, { type: "text", text: parts.join("\n\n") }] };
	}

	return { onToolCall, onToolResult };
}

function notify(ctx: HandlerContext, msg: string, type: "info" | "warning" | "error"): void {
	try {
		if (ctx.hasUI) ctx.ui.notify(msg, type);
	} catch {
		// Notification failure must never affect enforcement.
	}
}
