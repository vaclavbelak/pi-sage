// Isolate ~/.sage (config, cache, audit log) from the real home directory.
import { mkdtempSync } from "node:fs";
import "../shim.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pi-sage-test-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
