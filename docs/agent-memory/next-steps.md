<!-- agent-memory:projection file=next-steps version=3 bundleHash=37b2761c7e3cd464944e92a2dce3e0a81841fd70230390a0f72009a4770a4e9b -->
# Next Steps

## 1. Refresh the self-host baseline

Why: Keep repo-root memory assets aligned with the current codebase.

Start: Run npm run dogfood:init after major dogfood or memory flow changes.

Done when: The stable repo-root memory assets match the current implementation.

## 2. Exercise the self-host canary

Why: Confirm the isolated dogfood path still works end-to-end.

Start: Run npm run dogfood:exercise.

Done when: A fresh dogfood report is green.
