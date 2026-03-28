# agent-memory

Use the `agent-memory` MCP tools selectively for repository memory tasks.

Prefer the high-level workflow tools first:

Call `memory_assess` when:
- you are entering the repository and want a quick picture of memory, automation, and integration health
- you suspect backlog, validation drift, or automation state has changed during a long task

Call `memory_compact_handoff` when:
- you are about to compact or end a session and want a concise handoff summary
- you want the top gotchas, next steps, and backlog context in one place

Call `memory_maintain` when:
- you want one maintenance pass that ensures the daemon is running and then performs sync/recall work

Fall back to lower-level tools only when you need tighter control:
- `memory_query` for retrieval with citations
- `memory_status` or `memory_validate` for raw maintenance inspection
- `automation_status`, `automation_ensure_running`, or `automation_run_once` for daemon-specific control

Do not call agent-memory on every answer. Prefer it for context recovery, maintenance, compact handoff, and repository-memory questions.
