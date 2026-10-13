import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type PiSourceInfo, pluginsFromSources, resolveSkillRoots } from "../session.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-sage-sess-"));
const src = (path: string, origin: PiSourceInfo["origin"], baseDir?: string): PiSourceInfo => ({
	path,
	source: "test",
	scope: "user",
	origin,
	baseDir,
});

describe("pluginsFromSources", () => {
	it("maps package + top-level sources, dedupes, skips builtin and self", () => {
		const root = tmp();
		const pkg = join(root, "npm", "node_modules", "some-pkg");
		mkdirSync(pkg, { recursive: true });
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "some-pkg", version: "2.0.0" }));
		const ext = join(root, "extensions", "mine.ts");
		mkdirSync(join(root, "extensions"), { recursive: true });
		writeFileSync(ext, "export default () => {}");
		const self = join(root, "npm", "node_modules", "pi-sage");
		mkdirSync(self, { recursive: true });

		const plugins = pluginsFromSources(
			[
				src(join(pkg, "index.ts"), "package", pkg),
				src(join(pkg, "other.ts"), "package", pkg),
				src(ext, "top-level"),
				src("builtin:read", "top-level"),
				src("<inline:x>", "top-level"),
				src(join(self, "extensions", "sage.ts"), "package", self),
			],
			self,
		);
		expect(plugins.map((p) => p.key).sort()).toEqual([
			expect.stringMatching(/^user\/mine@local-\d+$/),
			"user/some-pkg@2.0.0",
		]);
		expect(plugins.find((p) => p.version === "2.0.0")?.installPath).toBe(pkg);
	});
});

describe("resolveSkillRoots", () => {
	it("covers pi + agents skill dirs, stopping at the repo root", () => {
		const repo = tmp();
		mkdirSync(join(repo, ".git"));
		const cwd = join(repo, "a", "b");
		mkdirSync(cwd, { recursive: true });
		const roots = resolveSkillRoots("/agent", cwd).map((r) => `${r.scope}:${r.dir}`);
		expect(roots).toContain("personal:/agent/skills");
		expect(roots).toContain(`project:${join(cwd, ".pi", "skills")}`);
		expect(roots).toContain(`project:${join(cwd, ".agents", "skills")}`);
		expect(roots).toContain(`project:${join(repo, ".agents", "skills")}`);
		expect(roots.some((r) => r.startsWith("project:") && !r.includes(repo))).toBe(false);
	});
});
