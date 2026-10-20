import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { canonicalTool, outputHookInput, prepareToolCall, resolvePiPath } from "../tools.ts";

const cwd = "/work/proj";

describe("canonicalTool", () => {
	it("maps pi tools and ignores unknown / canonical-looking names", () => {
		expect(canonicalTool("bash")).toBe("Bash");
		expect(canonicalTool("find")).toBe("Glob");
		expect(canonicalTool("fetch_content")).toBe("WebFetch");
		expect(canonicalTool("web_search")).toBe("WebSearch");
		expect(canonicalTool("source_check")).toBe("WebSearch");
		expect(canonicalTool("url_context")).toBeUndefined();
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
	it("fetch_content → one url artifact per URL (url + urls, deduped)", () => {
		const p = prepareToolCall(
			"fetch_content",
			{ url: "https://a.test", urls: ["https://a.test", "https://b.test"] },
			cwd,
		);
		expect(p?.toolName).toBe("WebFetch");
		expect(p?.artifacts.map((a) => a.value)).toEqual(["https://a.test", "https://b.test"]);
		expect(p?.toolInput.url).toBe("https://a.test");
	});
	it("web_search → content artifact per query/queries", () => {
		const p = prepareToolCall("web_search", { query: "hi", queries: ["ho", "hi"] }, cwd);
		expect(p?.toolName).toBe("WebSearch");
		expect(p?.artifacts.map((a) => a.value)).toEqual(["hi", "ho"]);
	});
	it("source_check → claim content artifact", () => {
		const p = prepareToolCall("source_check", { claim: "the earth is flat" }, cwd);
		expect(p?.toolName).toBe("WebSearch");
		expect(p?.artifacts[0]).toMatchObject({
			type: "content",
			value: "the earth is flat",
			context: "websearch_query",
		});
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
