<!-- agent-memory:projection file=gotchas version=3 bundleHash=064a82ecbc8b63ca97d01824fdb45f860aa0481cd2ebf8e1bdd8e392cd4c29d8 -->
# Gotchas

Keep this file short, concrete, and limited to traps that are genuinely expensive to rediscover.

## Dogfood provider auth is environment-dependent

Symptom: Self-host init or repair can hang or fail when local agent auth is missing.

Cause: Dogfood scripts rely on Codex or Claude availability unless overridden.

Correct path: Set AGENT_MEMORY_DOGFOOD_PROVIDER or explicit AGENT_MEMORY_*_BIN values when exercising the repo.
