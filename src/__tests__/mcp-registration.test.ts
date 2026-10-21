// Unit tests: sage's MCP server registers only when the session actually has
// MCP support (a "mcp"/"mcp:*" command consumer), once per extension instance/load, from
// session_start. See AGENTS.md: wiring checks only; never re-assert detection.
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../shim.ts";
import { MCP_SERVER_PATH } from "../runtime.ts";


vi.mock("../session.ts", () => ({ runSessionScan: vi.fn(async () => []) }));
vi.mock("../status.ts", () => ({ createStatusLine: vi.fn(() => undefined) }));
vi.mock("@gendigital/sage-core", () => ({
	loadConfig: vi.fn(async () => ({ manage_status_line: false })),
	createOperationalLogger: vi.fn(() => ({
		forComponent: () => ({ debug: () => {}, warn: () => {}, error: () => {} }),
	})),
	resolveBranding: vi.fn(() => ({ name: "Sage" })),
}));

type Command = { name: string };

const makeApi = (commands: Command[]) => {
	const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
	return {
		getCommands: () => commands,
		getAllTools: () => [],
		registerMcpServer: vi.fn(),
		on: (event: string, handler: unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler as never]);
		},
		__handlers: handlers,
	};
};

type Api = ReturnType<typeof makeApi>;

const makeCtx = (sessionId: string) =>
	({
		sessionManager: { getSessionId: () => sessionId },
		cwd: "/tmp",
		hasUI: false,
	}) as never;

const startSession = async (api: Api, sessionId = "sess-1") => {
	const extension = (await import("../index.ts")).default;
	await extension(api as never);
	const sessionStart = api.__handlers.get("session_start")![0];
	await (sessionStart as (event: unknown, ctx: unknown) => Promise<void> | void)(
		{},
		makeCtx(sessionId),
	);
};

describe("sage MCP registration", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("registers the sage MCP server when an mcp consumer is present", async () => {
		const api = makeApi([{ name: "something-else" }, { name: "mcp" }]);
		await startSession(api);
		expect(api.registerMcpServer).toHaveBeenCalledTimes(1);
		expect(api.registerMcpServer).toHaveBeenCalledWith(
			"sage",
			expect.objectContaining({
				command: process.execPath,
				args: [MCP_SERVER_PATH],
			}),
		);
	});

	it("recognizes mcp:*-prefixed commands as consumers", async () => {
		const api = makeApi([{ name: "mcp:list" }]);
		await startSession(api);
		expect(api.registerMcpServer).toHaveBeenCalledTimes(1);
	});

	it("does not register when no mcp consumer is loaded", async () => {
		const api = makeApi([{ name: "other-command" }]);
		await startSession(api);
		expect(api.registerMcpServer).not.toHaveBeenCalled();
	});

	it("registers at most once across session_start events", async () => {
		const api = makeApi([{ name: "mcp" }]);
		const extension = (await import("../index.ts")).default;
		await extension(api as never);
		const sessionStart = api.__handlers.get("session_start")![0] as (
			event: unknown,
			ctx: unknown,
		) => Promise<void> | void;
		await sessionStart({}, makeCtx("a"));
		await sessionStart({}, makeCtx("b"));
		expect(api.registerMcpServer).toHaveBeenCalledTimes(1);
	});

	// Reload invokes the extension factory again in a fresh runtime with its own flag;
	// each instance must register in its own runtime.
	it("registers again in a fresh extension instance after reload", async () => {
		const extension = (await import("../index.ts")).default;
		const first = makeApi([{ name: "mcp" }]);
		await startSession(first, "a");
		const second = makeApi([{ name: "mcp" }]);
		await extension(second as never);
		const sessionStart = second.__handlers.get("session_start")![0] as (
			event: unknown,
			ctx: unknown,
		) => Promise<void> | void;
		await sessionStart({}, makeCtx("b"));
		expect(first.registerMcpServer).toHaveBeenCalledTimes(1);
		expect(second.registerMcpServer).toHaveBeenCalledTimes(1);
	});
});
