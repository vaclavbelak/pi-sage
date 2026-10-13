/**
 * Status line (parity with the Claude Code connector's sage-statusline).
 *
 * pi renders status natively through `ctx.ui.setStatus()`, so there is no
 * settings.json handoff. Core owns the per-session state file
 * (~/.sage/statusline-<id>.txt): `updateSessionStatus()` writes it on
 * non-allow verdicts, `readSessionStatus()` reads it back here.
 */

import {
	foreignSourceRuntime,
	formatStatusLine,
	initSessionStatus,
	loadSkillVerdictCacheSync,
	readSessionStatus,
	riskyVerdictsSince,
	updateSessionStatus,
	type Branding,
	type Config,
	type SkillWarning,
	type Verdict,
} from "@gendigital/sage-core";
import { PI_RUNTIME } from "./runtime.ts";

/** Fresh risky-skill verdicts stay on the footer this long (2× a 5s poll). */
const SKILL_WARNING_WINDOW_MS = 10_000;

/** Slices of pi's ctx that the status line needs. */
export interface StatusContext {
	hasUI: boolean;
	sessionManager: { getSessionId(): string };
	ui: { setStatus?(key: string, text: string): void };
}

export interface StatusLine {
	/** Fire-and-forget state update after a non-allow verdict. */
	record(sessionId: string, verdict: Verdict): void;
	/** Establish a clean status file for a new session. */
	start(sessionId: string): Promise<void>;
	/** Render the current status into the footer (no-op without a UI). */
	render(ctx: StatusContext): Promise<void>;
}

export function createStatusLine(branding: Branding, config: Config): StatusLine {
	/** Resolve the skill warning to display: HIGH/CRITICAL verdicts analyzed
	 * within the last window (and after session start). */
	function skillWarning(startedAt: string): SkillWarning | undefined {
		try {
			const windowStart = new Date(Date.now() - SKILL_WARNING_WINDOW_MS).toISOString();
			const laterIso = startedAt > windowStart ? startedAt : windowStart;
			const risky = riskyVerdictsSince(loadSkillVerdictCacheSync(), laterIso).filter(
				(v) => !foreignSourceRuntime(v.sources, PI_RUNTIME),
			);
			if (risky.length === 0) return undefined;
			const names = risky
				.map((v) => v.skillName?.trim())
				.filter((n): n is string => n !== undefined && n !== "");
			return { count: risky.length, names };
		} catch {
			return undefined; // Fail open — base status only
		}
	}

	return {
		record(sessionId, verdict) {
			updateSessionStatus(sessionId, verdict).catch(() => {
				// Status state is display-only data; a failure must never
				// affect enforcement.
			});
		},

		start(sessionId) {
			return initSessionStatus(sessionId).catch(() => {});
		},

		async render(ctx) {
			try {
				// Footer rendering only exists with a UI (TUI / RPC). In print
				// and JSON modes the stub throws or no-ops either way.
				if (!ctx.hasUI) return;
				const setStatus = ctx.ui.setStatus;
				if (!setStatus) return;
				const sessionId = ctx.sessionManager.getSessionId();
				const status = await readSessionStatus(sessionId);
				const warning =
					config.skill_check.enabled && status?.startedAt
						? skillWarning(status.startedAt)
						: undefined;
				setStatus(
					"sage",
					formatStatusLine(
						status?.denied ?? 0,
						status?.flagged ?? 0,
						status?.lastReason ?? null,
						status?.lastCategory ?? null,
						branding,
						warning,
					),
				);
			} catch {
				// Display-only; never affects enforcement.
			}
		},
	};
}
