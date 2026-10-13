import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { canonicalTool, outputHookInput, prepareToolCall, resolvePiPath } from "../tools.ts";

const cwd = "/work/proj";

describe("canonicalTool", () => {
	it("maps pi tools and ignores unknown / canonical-looking names", () => {
		expect(canonicalTool("bash")).toBe("Bash");
		expect(canonicalTool("find")).toBe("Glob");
		expect(canonicalTool("url_context")).toBe("WebFetch");
		expect(canonicalTool("Task")).toBeUndefined();
		expect(canonicalTool("subagent")).toBeUndefined();
	});
});

describe("resolvePiPath", () => {
	it("mirrors pi path handling", () => {
		expect(resolvePiPath("@src/a.ts", cwd)).toBe("/work/proj/src/a.ts");
		expect(resolvePiPath("~/.ssh/id_rsa", cwd)).toBe(`${homedir()}/.ssh/id_rsa`);
		expect(resolvePiPath("/etc/passwd", cwd)).toBe("/etc/passwd");
	});
});

describe("prepareToolCall", () => {
	it("bash → command artifact", () => {
		const p = prepareToolCall("bash", { command: "ls -la" }, cwd);
		expect(p?.toolName).toBe("Bash");
		expect(p?.artifacts[0]).toMatchObject({ type: "command", value: "ls -la" });
	});
	it("empty bash → nothing", () => {
		expect(prepareToolCall("bash", { command: "" }, cwd)).toBeUndefined();
	});
	it("edit → joins edits[].newText and resolves path", () => {
		const p = prepareToolCall(
			"edit",
			{
				path: "a.ts",
				edits: [
					{ oldText: "x", newText: "first" },
					{ oldText: "y", newText: "second" },
				],
			},
			cwd,
		);
		expect(p?.toolInput.file_path).toBe("/work/proj/a.ts");
		expect(p?.toolInput.new_string).toBe("first\nsecond");
		expect(p?.artifacts.some((a) => a.type === "file_path" && a.value === "/work/proj/a.ts")).toBe(
			true,
		);
	});
	it("write → file_path + content", () => {
		const p = prepareToolCall("write", { path: "~/.bashrc", content: "alias x=y" }, cwd);
		expect(p?.toolName).toBe("Write");
		expect(p?.toolInput.file_path).toBe(`${homedir()}/.bashrc`);
	});
	it("url_context → one url artifact per URL", () => {
		const p = prepareToolCall(
			"url_context",
			{ query: "q", urls: ["https://a.test", "https://b.test"] },
			cwd,
		);
		expect(p?.toolName).toBe("WebFetch");
		expect(p?.artifacts.map((a) => a.value)).toEqual(["https://a.test", "https://b.test"]);
		expect(p?.toolInput.url).toBe("https://a.test");
	});
	it("web_search → query content + optional urls", () => {
		const p = prepareToolCall("web_search", { query: "hi", urls: ["https://a.test"] }, cwd);
		expect(p?.artifacts.map((a) => a.type)).toEqual(["content", "url"]);
	});
	it("ls without path lists cwd", () => {
		expect(prepareToolCall("ls", {}, cwd)?.artifacts[0]).toMatchObject({
			value: cwd,
			context: "list",
		});
	});
	it("unsupported tool → undefined", () => {
		expect(prepareToolCall("subagent", { x: 1 }, cwd)).toBeUndefined();
	});
});

describe("outputHookInput", () => {
	it("shapes output for core's evaluateToolOutput", () => {
		expect(outputHookInput("Bash", "out")).toEqual({ tool_response: { stdout: "out" } });
		expect(outputHookInput("Read", "c")).toEqual({ tool_response: { content: "c" } });
		expect(outputHookInput("WebFetch", "r")).toEqual({ tool_response: { result: "r" } });
		expect(outputHookInput("Grep", "r")).toBeUndefined();
		expect(outputHookInput("Bash", "")).toBeUndefined();
	});
});
