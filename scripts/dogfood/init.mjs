import { cwd, exit } from "node:process";
import { dogfoodPaths, dogfoodProviderPreference, initSelfHostBaseline } from "./lib.mjs";

async function main() {
  const rootDir = cwd();
  const paths = dogfoodPaths(rootDir);
  const provider = dogfoodProviderPreference();
  await initSelfHostBaseline(rootDir, paths, { provider });
  console.log("Dogfood baseline initialized.");
  console.log(`- root: ${rootDir}`);
  console.log(`- provider: ${provider}`);
  console.log("- stable assets refreshed: .agent-memory/, docs/agent-memory/, .mcp.json, .claude/, AGENTS.md");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
