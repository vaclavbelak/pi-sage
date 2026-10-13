/**
 * Live E2E: real `pi` (headless, JSON mode) + this extension + Sage canary rules.
 * Asserts wiring only (hook fires, verdict enforced, audit written); detection itself
 * is covered by sage-core's tests.
 *
 * Needs an installed, authenticated `pi` and a working model:
 *   PI_SAGE_E2E=1 npm run test:e2e
 * Optional: PI_SAGE_E2E_MODEL=<model> to pass --model.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTENSION = join(ROOT, "extensions", "sage.ts");
const enabled = process.env.PI_SAGE_E2E === "1";

// Canary markers from Sage's threats/dummy.yaml (harmless, opaque).
const DENY_CMD = "diagmark_cmd_a75bf229"; // DUMMY-CMD-DENY-001
const ASK_CMD = "diagmark_cmd_8f2e6b71"; // DUMMY-CMD-ASK-001

interface RunResult {
	toolResults: string[];
	audit: string;
	stdout: string;
	stderr: string;
}

function runPi(command: string): RunResult {
	// Isolated HOME keeps ~/.sage (config, cache, audit) away from the real one;
	// the real agent dir is reused only for auth.
	const home = mkdtempSync(join(tmpdir(), "pi-sage-e2e-"));
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(userInfo().homedir, ".pi", "agent"); // setup.ts overrides HOME
	const args = [
		"--mode",
		"json",
		"--no-session",
		"--no-extensions", // also disables built-in MCP, so load it explicitly
		"--no-skills",
		"--tools",
		"bash",
		"-e",
		"builtin:mcp",
		"-e",
		EXTENSION,
		...(process.env.PI_SAGE_E2E_MODEL ? ["--model", process.env.PI_SAGE_E2E_MODEL] : []),
		`Use the bash tool to run exactly this command and nothing else: ${command}`,
	];
	const proc = spawnSync("pi", args, {
		cwd: tmpdir(),
		encoding: "utf-8",
		timeout: 120_000,
		env: { ...process.env, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agentDir },
	});

	const toolResults: string[] = [];
	for (const line of (proc.stdout ?? "").split("\n")) {
		if (!line.trim()) continue;
		try {
			const ev = JSON.parse(line);
			if (ev.type !== "turn_end") continue;
			for (const r of ev.toolResults ?? []) {
				for (const c of r.content ?? []) if (c.type === "text") toolResults.push(c.text);
			}
		} catch {
			// non-JSON line
		}
	}
	const auditPath = join(home, ".sage", "audit.jsonl");
	return {
		toolResults,
		audit: existsSync(auditPath) ? readFileSync(auditPath, "utf-8") : "",
		stdout: proc.stdout ?? "",
		stderr: proc.stderr ?? "",
	};
}

describe.skipIf(!enabled)("live pi + Sage", () => {
	it("blocks a canary deny command and audits it", () => {
		const r = runPi(`echo ${DENY_CMD}`);
		const diag = `\nstderr:\n${r.stderr}\nstdout:\n${r.stdout.slice(-1500)}`;
		expect(r.toolResults.length, `no tool result observed${diag}`).toBeGreaterThan(0);
		expect(r.toolResults.join("\n"), diag).toContain("blocked this action");
		// The command must not have executed (a real run would print just the marker).
		expect(r.toolResults.some((t) => t.trim() === DENY_CMD)).toBe(false);
		expect(r.audit).toContain("DUMMY-CMD-DENY-001");
	}, 150_000);

	it("denies a canary ask command when no UI is available", () => {
		const r = runPi(`echo ${ASK_CMD}`);
		const diag = `\nstderr:\n${r.stderr}\nstdout:\n${r.stdout.slice(-1500)}`;
		expect(r.toolResults.length, `no tool result observed${diag}`).toBeGreaterThan(0);
		expect(r.toolResults.join("\n"), diag).toContain("no UI is available");
		expect(r.toolResults.some((t) => t.trim() === ASK_CMD)).toBe(false);
		expect(r.audit).toContain("DUMMY-CMD-ASK-001");
	}, 150_000);
});
