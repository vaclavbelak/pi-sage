import { defaultBranding } from "@gendigital/sage-core";
import { describe, expect, it, vi } from "vitest";
import { createHandlers, type HandlerContext } from "../handlers.ts";

// Canary markers from Sage's threats/dummy.yaml (harmless, opaque, unique).
// DENY_CONTENT and DENY_URL are assembled so the full canary patterns never
// appear in this file's content (otherwise Sage denies the edits that add or
// touch these wiring checks).
const DENY_CONTENT = "diagmark_content_" + "3c8f15b7";
const DENY_CMD = "echo diagmark_cmd_a75bf229";
const ASK_CMD = "echo diagmark_cmd_8f2e6b71";
const DENY_FILE = "/tmp/diagmark_file_e6c4a918.txt";
const DENY_URL = "https://diaghost-" + "4e91ca37.test/x";

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
};

function makeCtx(opts: { hasUI?: boolean; confirm?: boolean } = {}) {
	const confirm = vi.fn(async () => opts.confirm ?? true);
	const notify = vi.fn();
	const ctx: HandlerContext = {
		cwd: "/tmp",
		hasUI: opts.hasUI ?? true,
		ui: { confirm, notify },
		sessionManager: { getSessionId: () => "test-session" },
	};
	return { ctx, confirm, notify };
}

const handlers = () =>
	createHandlers({ logger: silent as never, branding: defaultBranding, agentRuntimeVersion: "test" });

const call = (toolName: string, input: Record<string, unknown>, id = "call-1") => ({
	toolCallId: id,
	toolName,
	input,
});

describe("onToolCall", () => {
	it("allows benign commands and unsupported tools", async () => {
		const { ctx, confirm } = makeCtx();
		const h = handlers();
		expect(await h.onToolCall(call("bash", { command: "ls -la" }), ctx)).toBeUndefined();
		expect(await h.onToolCall(call("subagent", { task: "x" }), ctx)).toBeUndefined();
		expect(confirm).not.toHaveBeenCalled();
	});

	it("blocks a deny verdict (bash)", async () => {
		const { ctx, confirm } = makeCtx();
		const r = await handlers().onToolCall(call("bash", { command: DENY_CMD }), ctx);
		expect(r?.block).toBe(true);
		expect(r?.reason).toContain("blocked");
		expect(confirm).not.toHaveBeenCalled();
	});

	it("blocks a deny verdict on write file path", async () => {
		const { ctx } = makeCtx();
		const r = await handlers().onToolCall(call("write", { path: DENY_FILE, content: "x" }), ctx);
		expect(r?.block).toBe(true);
	});

	it("blocks a deny verdict on fetch_content URL", async () => {
		const { ctx } = makeCtx();
		const r = await handlers().onToolCall(call("fetch_content", { urls: [DENY_URL] }), ctx);
		expect(r?.block).toBe(true);
	});

	it("blocks a deny verdict on source_check claim", async () => {
		const { ctx } = makeCtx();
		const r = await handlers().onToolCall(call("source_check", { claim: DENY_CONTENT }), ctx);
		expect(r?.block).toBe(true);
	});

	it("ask → confirm accepted → allowed", async () => {
		const { ctx, confirm } = makeCtx({ confirm: true });
		const r = await handlers().onToolCall(call("bash", { command: ASK_CMD }), ctx);
		expect(r).toBeUndefined();
		expect(confirm).toHaveBeenCalledOnce();
	});

	it("ask → confirm declined → blocked", async () => {
		const { ctx } = makeCtx({ confirm: false });
		const r = await handlers().onToolCall(call("bash", { command: ASK_CMD }), ctx);
		expect(r?.block).toBe(true);
		expect(r?.reason).toContain("declined");
	});

	it("ask without UI → denied", async () => {
		const { ctx, confirm } = makeCtx({ hasUI: false });
		const r = await handlers().onToolCall(call("bash", { command: ASK_CMD }), ctx);
		expect(r?.block).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
	});

	it("ask → confirm throws → denied (never fail-open on a pending decision)", async () => {
		const { ctx, confirm } = makeCtx();
		confirm.mockRejectedValueOnce(new Error("aborted"));
		const r = await handlers().onToolCall(call("bash", { command: ASK_CMD }), ctx);
		expect(r?.block).toBe(true);
	});

	it("fails open when evaluation throws", async () => {
		const { ctx } = makeCtx();
		(ctx as { sessionManager: unknown }).sessionManager = {
			getSessionId: () => {
				throw new Error("boom");
			},
		};
		expect(await handlers().onToolCall(call("bash", { command: DENY_CMD }), ctx)).toBeUndefined();
	});
});

describe("onToolResult", () => {
	it("passes clean results through untouched", async () => {
		const { ctx } = makeCtx();
		const r = await handlers().onToolResult(
			{ ...call("bash", { command: "ls" }), content: [{ type: "text", text: "a.txt" }] },
			ctx,
		);
		expect(r).toBeUndefined();
	});

	it("appends a note after an approved ask", async () => {
		const { ctx } = makeCtx({ confirm: true });
		const h = handlers();
		await h.onToolCall(call("bash", { command: ASK_CMD }, "c9"), ctx);
		const r = await h.onToolResult(
			{ ...call("bash", { command: ASK_CMD }, "c9"), content: [{ type: "text", text: "ok" }] },
			ctx,
		);
		expect(r?.content[0]?.text).toBe("ok");
		expect(r?.content.at(-1)?.text).toContain("user approved a flagged action");
	});
});
