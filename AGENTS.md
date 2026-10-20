# AGENTS.md

Sage connector for the pi coding agent. Detection lives in `@gendigital/sage-core`; this package only adapts pi to it. Do not change core or add pi-specific code there.

## Commands

```bash
npm install
npm run sync:assets   # copy threats + trusted-domains from $SAGE_REPO (default ../sage) into resources/
npm run check         # tsc --noEmit
npm test              # unit + handler tests (e2e skipped)
npm run test:e2e      # live: needs authenticated `pi` and a working model
```

## Layout

- `extensions/sage.ts` — pi entry point (re-exports `src/index.ts`)
- `src/index.ts` — registers `tool_call`, `tool_result`, `session_start`, and the Sage MCP server
- `src/handlers.ts` — PreToolUse/PostToolUse logic (allow / deny / ask → `ctx.ui.confirm`)
- `src/tools.ts` — pi tool names/args → canonical tools + artifacts
- `src/session.ts` — session-start scan (pi sources + skill roots)
- `src/shim.ts` — provides `require` for sage-core on Node ESM; must be imported first
- `bin/mcp-server.mjs` — shared Sage MCP server (false-positive tools)
- `resources/` — generated, gitignored

## Rules

- Fail-open: an internal error must never block a tool. pi blocks when a `tool_call` handler throws, so every handler catches everything. Verdict-driven blocks are the only blocks.
- `ask` with no UI (print/JSON/RPC) is denied.
- Only map tools that exist in pi or that overlap other Sage connectors. `web_search`/`fetch_content`/`source_check` come from the `pi-web-access` package (`get_search_content` is a local lookup and stays unmapped).
- Never re-assert detection in tests here; use Sage's canary rules (`threats/dummy.yaml`) for wiring checks only.
- Tests must isolate `HOME` (see `src/__tests__/setup.ts`) so `~/.sage` is never touched.
- pi docs are the source of truth for the extension API: `docs/extensions.md` in the installed `@earendil-works/pi-coding-agent`.
