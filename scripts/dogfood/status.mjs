import { cwd, exit } from "node:process";
import { dogfoodPaths, formatDogfoodStatus, loadLatestDogfoodReport } from "./lib.mjs";

async function main() {
  const rootDir = cwd();
  const paths = dogfoodPaths(rootDir);
  const report = await loadLatestDogfoodReport(paths);
  console.log(formatDogfoodStatus(report, paths));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
