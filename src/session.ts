/**
 * Session-start scan: discovers what pi has loaded (extensions, packages, skills)
 * and feeds it to Sage's plugin scanner.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
	type Branding,
	checkAllowlistMigration,
	discoverLooseSkillsAcrossRoots,
	formatAllowlistMigrationWarning,
	formatConfigurationWarnings,
	formatNoticeById,
	getConfigurationWarnings,
	type Logger,
	loadConfig,
	type PluginInfo,
	runPluginScan,
	type SkillRoot,
} from "@gendigital/sage-core";
import {
	modelDownloadWorkerPath,
	PACKAGE_ROOT,
	PI_RUNTIME,
	skillUploadWorkerPath,
	THREATS_DIR,
	TRUSTED_DOMAINS_DIR,
	getSageVersion,
} from "./runtime.ts";

/** `sourceInfo` as exposed by pi's `getAllTools()` / `getCommands()`. */
export interface PiSourceInfo {
	path: string;
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	baseDir?: string;
}

const isSynthetic = (p: string): boolean => p.startsWith("builtin:") || p.startsWith("<");

/** Walk from `cwd` up to the repo root (first dir containing `.git`) or the filesystem root. */
function ancestorsToRepoRoot(cwd: string): string[] {
	const dirs: string[] = [];
	let dir = resolve(cwd);
	for (;;) {
		dirs.push(dir);
		if (existsSync(join(dir, ".git"))) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return dirs;
}

export function resolveSkillRoots(agentDir: string, cwd: string): SkillRoot[] {
	const roots: SkillRoot[] = [
		{ dir: join(agentDir, "skills"), tag: "pi", scope: "personal" },
		{ dir: join(homedir(), ".agents", "skills"), tag: "agents", scope: "personal" },
		{ dir: join(cwd, ".pi", "skills"), tag: "pi", scope: "project" },
	];
	for (const dir of ancestorsToRepoRoot(cwd)) {
		roots.push({ dir: join(dir, ".agents", "skills"), tag: "agents", scope: "project" });
	}
	return roots;
}

function isInside(child: string, parent: string): boolean {
	const c = resolve(child);
	const p = resolve(parent);
	return c === p || c.startsWith(p + sep);
}

/** Turn pi's loaded-resource sources into scannable plugins (excluding Sage itself). */
export function pluginsFromSources(
	sources: PiSourceInfo[],
	selfRoot: string = PACKAGE_ROOT,
): PluginInfo[] {
	const byPath = new Map<string, PluginInfo>();
	for (const s of sources) {
		if (isSynthetic(s.path)) continue;
		const installPath = s.origin === "package" && s.baseDir ? s.baseDir : s.path;
		if (isSynthetic(installPath) || isInside(installPath, selfRoot) || byPath.has(installPath)) {
			continue;
		}
		try {
			const stats = statSync(installPath);
			let name = basename(installPath).replace(/\.(ts|js|mjs|cjs)$/, "");
			let version = `local-${Math.round(stats.mtimeMs)}`;
			if (stats.isDirectory()) {
				try {
					const pkg = JSON.parse(readFileSync(join(installPath, "package.json"), "utf-8"));
					if (typeof pkg.name === "string") name = pkg.name;
					if (typeof pkg.version === "string") version = pkg.version;
				} catch {
					// no package.json — keep directory name
				}
			}
			byPath.set(installPath, {
				key: `${s.scope}/${name}@${version}`,
				installPath,
				version,
				lastUpdated: stats.mtime.toISOString(),
			});
		} catch {
			// vanished or unreadable — skip
		}
	}
	return [...byPath.values()];
}

export interface SessionScanInput {
	logger: Logger;
	branding: Branding;
	agentDir: string;
	cwd: string;
	sources: PiSourceInfo[];
	agentRuntimeVersion?: string;
}

/** Runs the scan; returns user-facing messages (empty when nothing to say). */
export async function runSessionScan(input: SessionScanInput): Promise<string[]> {
	const { logger, branding } = input;
	const messages: string[] = [];
	const config = await loadConfig(undefined, logger);

	const warnings = formatConfigurationWarnings(await getConfigurationWarnings(undefined, logger), branding);
	if (warnings) messages.push(warnings);

	const migration = await checkAllowlistMigration();
	if (migration.needed) messages.push(formatAllowlistMigrationWarning(migration.entryTypes, branding));

	const plugins = [
		...pluginsFromSources(input.sources),
		...(await discoverLooseSkillsAcrossRoots(resolveSkillRoots(input.agentDir, input.cwd))),
	];

	const notices: string[] = [];
	const scanMessage = await runPluginScan(
		logger,
		"session",
		plugins,
		THREATS_DIR,
		TRUSTED_DOMAINS_DIR,
		getSageVersion(),
		PI_RUNTIME,
		branding,
		modelDownloadWorkerPath(),
		"verbose",
		input.agentRuntimeVersion,
		skillUploadWorkerPath(),
		(ids) => {
			for (const id of ids) {
				const text = formatNoticeById(id, branding);
				if (text) notices.push(text);
			}
		},
		undefined,
		config.announce_clean_scans,
	);
	// One-time notices first, as in the other connectors.
	return [...notices, ...messages, ...(scanMessage ? [scanMessage] : [])];
}
