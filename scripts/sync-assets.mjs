// Copies threat definitions + trusted domains into ./resources.
// Source: $SAGE_REPO (default ../sage). Falls back to keeping an existing ./resources.
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(process.env.SAGE_REPO ?? join(root, "..", "sage"));
const out = join(root, "resources");

const exists = (p) => access(p).then(() => true, () => false);

if (!(await exists(join(repo, "threats")))) {
	if (await exists(join(out, "threats"))) {
		console.log(`Sage repo not found at ${repo}; keeping existing resources/.`);
		process.exit(0);
	}
	console.error(`Sage repo not found at ${repo}. Set SAGE_REPO=/path/to/sage.`);
	process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(repo, "threats"), join(out, "threats"), { recursive: true });
await cp(join(repo, "trusted-domains"), join(out, "trusted-domains"), { recursive: true });
for (const f of ["LICENSE", "NOTICE"]) {
	if (await exists(join(repo, f))) await cp(join(repo, f), join(root, f));
}
console.log(`Synced threats + trusted-domains from ${repo}`);
