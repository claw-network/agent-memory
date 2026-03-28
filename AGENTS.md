<!-- agent-memory:codex-integration start -->
## agent-memory Integration

This repository is integrated with the `agent-memory` MCP server.

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
