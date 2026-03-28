import { cwd, exit } from "node:process";
import { dogfoodPaths, dogfoodProviderPreference, runExerciseCycle, writeDogfoodArtifacts } from "./lib.mjs";

async function main() {
  const rootDir = cwd();
  const paths = dogfoodPaths(rootDir);
  const provider = dogfoodProviderPreference();
  const report = await runExerciseCycle(rootDir, paths, {
    mode: "exercise",
    provider,
  });

  await writeDogfoodArtifacts(paths, report.report, report.patch, report.log);
  console.log(`Dogfood exercise status: ${report.report.status}`);
  console.log(`- report: ${paths.latestJsonPath}`);
  console.log(`- patch: ${paths.latestPatchPath}`);
  console.log(`- provider: ${provider}`);
  console.log(`- baseline drift: ${report.report.baselineDrift.length}`);
  console.log(`- managed breakage: ${report.report.managedBreakage.length}`);
  console.log(`- repo breakage: ${report.report.repoBreakage.length}`);

  if (report.report.status !== "pass") {
    exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
