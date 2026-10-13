import { defaultBranding, loadConfig, readSessionStatus } from "@gendigital/sage-core";
import type { Verdict } from "@gendigital/sage-core";
import { describe, expect, it, vi } from "vitest";
import "./setup.ts";
import { createStatusLine, type StatusContext } from "../status.ts";

const verdict = (decision: "deny" | "ask", reason = "Read a password file") =>
	({
		decision,
		category: "secrets",
		reasons: [reason],
		severity: "high",
		matchedThreatId: "TEST-1",
		source: "local",
		artifacts: [],
	}) as unknown as Verdict;

const ctxWith = (setStatus: StatusContext["ui"]["setStatus"]): StatusContext => ({
	hasUI: true,
	sessionManager: { getSessionId: () => "status-test" },
	ui: { setStatus },
});

const SID = "status-test";

async function freshLine() {
	const config = await loadConfig();
	// Avoid env drift from a user's manage_status_line setting.
	return createStatusLine(defaultBranding, { ...config, manage_status_line: true, skill_check: { ...config.skill_check, enabled: false } });
}

describe("statusLine", () => {
	it("tracks deny and ask verdicts in the session status file", async () => {
		const line = await freshLine();
		await line.start(SID);

		line.record(SID, verdict("deny"));
		await vi.waitFor(async () => {
			expect((await readSessionStatus(SID))?.denied).toBe(1);
		});
		expect((await readSessionStatus(SID))?.lastReason).toBe("Read a password file");

		line.record(SID, verdict("ask"));
		await vi.waitFor(async () => {
			const status = await readSessionStatus(SID);
			expect(status?.flagged).toBe(1);
			expect(status?.denied).toBe(1);
		});
	});

	it("renders with setStatus when a UI exists", async () => {
		const line = await freshLine();
		const setStatus = vi.fn();
		await line.render(ctxWith(setStatus));
		expect(setStatus).toHaveBeenCalledWith("sage", expect.any(String));
	});

	it("does nothing without a UI", async () => {
		const line = await freshLine();
		const setStatus = vi.fn();
		await line.render({ hasUI: false, sessionManager: { getSessionId: () => SID }, ui: { setStatus } });
		expect(setStatus).not.toHaveBeenCalled();
	});
});
