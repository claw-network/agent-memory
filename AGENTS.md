<!-- agent-memory:entry version=3 bundleHash=37b2761c7e3cd464944e92a2dce3e0a81841fd70230390a0f72009a4770a4e9b start -->
## Project Memory

This repository keeps canonical project memory in `.agent-memory/state.json`.

History and checkpoints live in `.agent-memory/history/`.

Readable projections live in `docs/agent-memory/`.

Recommended reading order:
1. `docs/agent-memory/README.md`
2. `docs/agent-memory/project-map.md`
3. `docs/agent-memory/current-focus.md`
4. `docs/agent-memory/gotchas.md` when debugging gets noisy or surprising
5. `docs/agent-memory/next-steps.md` when you need a clean starting point

Use `npx agent-memory sync`, `npx agent-memory recall`, and `npx agent-memory query` to maintain and retrieve project memory.
<!-- agent-memory:entry end -->

<!-- agent-memory:codex-integration start -->
## agent-memory Integration

This repository is integrated with the `agent-memory` MCP server.

Default integration uses stdio via `npx agent-memory mcp`.
Optional HTTP transport is available for debugging or custom clients via `agent-memory mcp --transport=http --port=<port>`.

Prefer `agent-memory` tools when the task is about:
- project structure or current focus
- recent changes
- next steps
- known gotchas

Default workflow order:
1. `memory_assess`
2. `memory_query`
3. `memory_compact_handoff`
4. `memory_maintain`

Use lower-level controls only when you need them:
- `memory_status`
- `memory_validate`
- `automation_status`
- `automation_run_once`

Typical trigger points:
- At repository entry: run `memory_assess` first
- During a long task when memory or automation may have drifted: run `memory_assess` again
- Before compact or at major task boundaries: run `memory_compact_handoff`

Codex does not have a guaranteed startup hook here, so rely on MCP + this guidance + the local daemon.
<!-- agent-memory:codex-integration end -->
