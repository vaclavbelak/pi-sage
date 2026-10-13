# pi-sage

[Sage](https://ai.gendigital.com/sage) (Safety for Agents) for the [pi coding agent](https://github.com/earendil-works/pi). Checks tool calls against Sage's threat detection before they run.

## Install

```bash
pi install npm:@vaclavbelak/pi-sage
```

Pi installs the dependencies (`@gendigital/sage-core`, `@gendigital/sage-mcp`) from npm.

From a local checkout:

```bash
npm install && npm run sync:assets   # local installs are not managed by pi
pi install /path/to/pi-sage
```

Installing from git is not supported: the bundled threat rules in `resources/` are generated, not committed.

Publishing: `npm publish` (the `prepack` step runs `sync:assets`, which needs the Sage repo at `../sage` or `SAGE_REPO=/path/to/sage`).

## What it does

| pi event | Sage hook | Behaviour |
|---|---|---|
| `tool_call` | PreToolUse | `deny` blocks the call. `ask` opens a confirmation dialog; without a UI (print/JSON/RPC mode) it is denied. |
| `tool_result` | PostToolUse | Appends a note after an approved action, medium-risk prompt-injection warnings, and heuristic scan results for tool output. |
| `session_start` | SessionStart | Scans installed pi extensions/packages and skills; shows notices and findings. |

With `manage_status_line` enabled in `~/.sage/config.json` (default), the extension maintains a footer status line (blocked/flagged counts and recent reason, plus fresh risky skill findings) via pi's status API. Disable it there if you set your own.

Covered tools: `bash`, `powershell`, `read`, `write`, `edit`, `grep`, `find`, `ls`, plus `url_context` and `web_search` from [`pi-web-search`](https://www.npmjs.com/package/pi-web-search).

The Sage MCP server is registered as `sage`, providing `sage_report_false_positive` and `sage_list_audit_entries`. It requires pi's built-in MCP support (on by default).

Errors inside Sage never block a tool (fail-open). Configuration, allowlists and exceptions are the standard Sage ones in `~/.sage/`; see the [Sage user guide](https://github.com/gendigitalinc/sage/blob/main/docs/user-guide.md).

## Development

```bash
npm install
npm run sync:assets   # needs the Sage repo at ../sage (or SAGE_REPO=...)
npm test
PI_SAGE_E2E=1 npm run test:e2e   # live pi run with Sage's canary rules
```

## License

Apache-2.0. Threat definitions bundled from the Sage repository are under their own [Detection Rule License](https://github.com/gendigitalinc/sage/blob/main/threats/LICENSE).
