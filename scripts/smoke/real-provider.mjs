import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const cliPath = join(repoRoot, "dist", "cli.js");

async function runCli(projectDir, args, env = process.env) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`node ${cliPath} ${args.join(" ")} failed with exit code ${code}.\n${stderr || stdout}`.trim()));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function createProject() {
  const projectDir = await mkdtemp(join(tmpdir(), "agent-memory-real-provider-"));
  await mkdir(join(projectDir, "src"), { recursive: true });
  await writeFile(
    join(projectDir, "package.json"),
    `${JSON.stringify({
      name: "agent-memory-real-provider-smoke",
      private: true,
      scripts: {
        build: "node -e \"process.stdout.write('build-ok')\"",
        test: "node -e \"process.stdout.write('test-ok')\"",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(projectDir, "README.md"), "# Real Provider Smoke\n", "utf8");
  await writeFile(join(projectDir, "src", "index.js"), "module.exports = 1;\n", "utf8");
  return projectDir;
}

async function main() {
  if (process.env.AGENT_MEMORY_REAL_PROVIDER_SMOKE !== "1") {
    console.log("Skipping real-provider smoke. Set AGENT_MEMORY_REAL_PROVIDER_SMOKE=1 to enable it.");
    return;
  }

  const provider = process.env.AGENT_MEMORY_REAL_PROVIDER ?? "auto";
  const projectDir = await createProject();

  try {
    console.log(`Running real-provider smoke with provider=${provider}...`);
    await runCli(projectDir, ["init", "--yes", `--provider=${provider}`], process.env);
    await runCli(projectDir, ["status"], process.env);
    await runCli(projectDir, ["query", "what should I do next?", `--provider=${provider}`], process.env);
    console.log("Real-provider smoke passed.");
  } finally {
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
