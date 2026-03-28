import { cwd, exit } from "node:process";
import {
  applyPatchToRoot,
  cleanupDogfoodWorktree,
  dogfoodEnv,
  dogfoodPaths,
  dogfoodProviderPreference,
  evaluateExistingDogfoodWorktree,
  runAgentMemoryCli,
  runExerciseCycle,
  runWholeRepoRepair,
  writeDogfoodArtifacts,
} from "./lib.mjs";

const MAX_REPAIR_PASSES = 3;

function isHealthy(report) {
  return (
    report.managedBreakage.length === 0 &&
    report.repoBreakage.length === 0
  );
}

async function runDeterministicRepair(worktreeDir, paths, env) {
  const commands = [
    ["update", ["update", "--yes", "--validate"]],
    ["integrate", ["integrate"]],
    ["integrate_repair", ["integrate", "--repair"]],
    ["automate_run_once", ["automate", "run-once"]],
    ["status", ["status"]],
    ["validate", ["validate"]],
    ["integrate_status", ["integrate", "--status", "--output=json"]],
  ];

  const results = [];
  for (const [name, args] of commands) {
    results.push({
      name,
      ...(await runAgentMemoryCli(worktreeDir, args, { env, allowFailure: true })),
    });
  }

  return results;
}

async function main() {
  const rootDir = cwd();
  const paths = dogfoodPaths(rootDir);
  const env = dogfoodEnv(paths);
  const provider = dogfoodProviderPreference();

  let current = await runExerciseCycle(rootDir, paths, {
    mode: "repair",
    provider,
    keepWorktree: true,
  });

  try {
    const deterministicResults = await runDeterministicRepair(paths.worktreeDir, paths, env);
    current = await evaluateExistingDogfoodWorktree(rootDir, paths, current.baselineCommit, {
      mode: "repair",
      provider,
      keepWorktree: true,
      repairPassCount: 0,
    });
    current.log = `${current.log}\n\nDETERMINISTIC_REPAIR:\n${deterministicResults
      .map((result) => [`$ ${result.commandLine}`, result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"))
      .join("\n\n")}`;

    let appliedToRoot = false;
    let repairPassCount = 0;
    if (!isHealthy(current.report) && current.report.repoBreakage.length > 0) {
      while (repairPassCount < MAX_REPAIR_PASSES) {
        repairPassCount += 1;
        const repair = await runWholeRepoRepair(paths.worktreeDir, paths, {
          provider,
          report: current.report,
          changedPaths: current.report.artifactDiffSummary.changedPaths,
          env,
        });

        current = await evaluateExistingDogfoodWorktree(rootDir, paths, current.baselineCommit, {
          mode: "repair",
          provider: repair.provider,
          keepWorktree: true,
          repairPassCount,
        });
        current.log = `${current.log}\n\nAGENTIC_REPAIR_PASS_${repairPassCount}:\n$ ${repair.commandLine}\n${repair.stdout.trim()}\n${repair.stderr.trim()}`.trim();

        if (isHealthy(current.report)) {
          break;
        }
      }
    }

    await writeDogfoodArtifacts(paths, current.report, current.patch, current.log);

    if (current.report.managedBreakage.length === 0 && current.report.repoBreakage.length === 0) {
      appliedToRoot = await applyPatchToRoot(rootDir, paths.latestPatchPath).catch(() => false);
      current.report.status = repairPassCount > 0 || current.report.baselineDrift.length > 0 ? "repaired" : "pass";
    } else {
      current.report.status = "fail";
    }

    current.report.appliedToRoot = appliedToRoot;
    current.report.repairPassCount = repairPassCount;
    await writeDogfoodArtifacts(paths, current.report, current.patch, current.log);

    console.log(`Dogfood repair status: ${current.report.status}`);
    console.log(`- report: ${paths.latestJsonPath}`);
    console.log(`- patch: ${paths.latestPatchPath}`);
    console.log(`- appliedToRoot: ${appliedToRoot ? "yes" : "no"}`);
    console.log(`- repairPassCount: ${repairPassCount}`);

    if (!isHealthy(current.report) || (!appliedToRoot && current.report.status === "repaired" && current.patch.trim().length > 0)) {
      exit(1);
    }
  } finally {
    await cleanupDogfoodWorktree(rootDir, paths).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
