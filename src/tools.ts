/**
 * pi tool vocabulary → Sage canonical tools + artifact extraction.
 *
 * pi built-ins: bash, powershell, read, write, edit, grep, find, ls.
 * pi has no built-in web tool; `web_search` / `fetch_content` / `source_check`
 * come from the `pi-web-access` package and are mapped when present.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	type Artifact,
	type CanonicalToolType,
	extractFromBash,
	extractFromEdit,
	extractFromRead,
	extractFromWrite,
} from "@gendigital/sage-core";

export const PI_TOOL_MAP: Readonly<Record<string, CanonicalToolType>> = {
	bash: "Bash",
	powershell: "Bash",
	read: "Read",
	write: "Write",
	edit: "Edit",
	grep: "Grep",
	find: "Glob",
	ls: "List",
	fetch_content: "WebFetch",
	web_search: "WebSearch",
	source_check: "WebSearch",
};

export function canonicalTool(rawName: string): CanonicalToolType | undefined {
	return Object.hasOwn(PI_TOOL_MAP, rawName) ? PI_TOOL_MAP[rawName] : undefined;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

/** Resolve a path the way pi's tools do: strip `@`, expand `~`, resolve against cwd. */
export function resolvePiPath(p: string, cwd: string): string {
	let s = p.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	if (s.startsWith("@")) s = s.slice(1);
	if (s === "~") s = homedir();
	else if (s.startsWith("~/")) s = homedir() + s.slice(1);
	return resolve(cwd, s);
}

export interface PreparedCall {
	toolName: CanonicalToolType;
	toolInput: Record<string, unknown>;
	artifacts: Artifact[];
}

/** Returns undefined when the tool is unsupported or has nothing to inspect. */
export function prepareToolCall(
	rawName: string,
	input: Record<string, unknown>,
	cwd: string,
): PreparedCall | undefined {
	const toolName = canonicalTool(rawName);
	if (!toolName) return undefined;
	const path = str(input.path) ? resolvePiPath(str(input.path), cwd) : "";
	let toolInput: Record<string, unknown> = input;
	let artifacts: Artifact[] = [];

	switch (toolName) {
		case "Bash": {
			const command = str(input.command);
			if (command) artifacts = extractFromBash(command);
			break;
		}
		case "Read":
			if (path) {
				toolInput = { ...input, file_path: path };
				artifacts = extractFromRead({ file_path: path });
			}
			break;
		case "Write":
			if (path) {
				toolInput = { ...input, file_path: path, content: str(input.content) };
				artifacts = extractFromWrite(toolInput);
			}
			break;
		case "Edit":
			if (path) {
				const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
				const newString = edits.map((e) => str(e?.newText)).join("\n");
				toolInput = { ...input, file_path: path, new_string: newString };
				artifacts = extractFromEdit(toolInput);
			}
			break;
		case "Grep": {
			const pattern = str(input.pattern);
			if (pattern) artifacts.push({ type: "content", value: pattern, context: "grep_pattern" });
			if (path) artifacts.push({ type: "file_path", value: path, context: "grep_path" });
			break;
		}
		case "Glob": {
			const pattern = str(input.pattern);
			if (pattern) artifacts.push({ type: "file_path", value: pattern, context: "glob_pattern" });
			if (path) artifacts.push({ type: "file_path", value: path, context: "find_path" });
			break;
		}
		case "List":
			// `ls` with no path lists cwd.
			artifacts.push({ type: "file_path", value: path || resolve(cwd), context: "list" });
			break;
		case "WebFetch": {
			// fetch_content accepts `url` (single) or `urls` (parallel).
			const urls = [...new Set([str(input.url), ...strList(input.urls)])].filter((u) => u.length > 0);
			toolInput = { ...input, url: urls[0] ?? "" };
			artifacts = urls.map((value) => ({ type: "url", value, context: "webfetch" }));
			break;
		}
		case "WebSearch": {
			// web_search: query/queries; source_check: claim/queries.
			for (const value of new Set([str(input.query), str(input.claim), ...strList(input.queries)])) {
				if (value) artifacts.push({ type: "content", value, context: "websearch_query" });
			}
			break;
		}
	}
	return artifacts.length > 0 ? { toolName, toolInput, artifacts } : undefined;
}

/** Text of a tool result's text blocks. */
export function resultText(content: ReadonlyArray<{ type: string; text?: string }>): string {
	return content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("\n");
}

/**
 * Shape pi's tool output the way core's `evaluateToolOutput` reads it
 * (`hookInput.tool_response.{content|stdout|result}`).
 */
export function outputHookInput(
	toolName: CanonicalToolType,
	text: string,
): Record<string, unknown> | undefined {
	if (!text) return undefined;
	switch (toolName) {
		case "Read":
			return { tool_response: { content: text } };
		case "Bash":
			return { tool_response: { stdout: text } };
		case "WebFetch":
			return { tool_response: { result: text } };
		default:
			return undefined;
	}
}
