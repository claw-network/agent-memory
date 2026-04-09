import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const require = createRequire(import.meta.url);
const { createFakeProviderBinaries, providerEnv } = require("../../test/helpers/cli-fixture.js");

async function runCommand(command, args, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
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
      if (code !== 0 && options.allowFailure !== true) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with exit code ${code}.\n${stderr || stdout}`.trim(),
          ),
        );
        return;
      }
      resolvePromise({ code, stdout, stderr });
    });

    child.stdin.end(options.stdin ?? undefined);
  });
}

async function packCurrentBuild() {
  const packDir = await mkdtemp(join(tmpdir(), "agent-memory-consumer-pack-"));
  const result = await runCommand("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: repoRoot,
  });
  const tarball = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.endsWith(".tgz"));

  if (!tarball) {
    throw new Error(`npm pack did not produce a tarball.\n${result.stdout}\n${result.stderr}`.trim());
  }

  return { packDir, tarballPath: join(packDir, tarball) };
}

async function createConsumerProject() {
  const projectDir = await mkdtemp(join(tmpdir(), "agent-memory-consumer-project-"));
  await mkdir(join(projectDir, "src"), { recursive: true });
  await writeFile(
    join(projectDir, "package.json"),
    `${JSON.stringify({
      name: "agent-memory-consumer-smoke",
      private: true,
      scripts: {
        build: "node -e \"process.stdout.write('build-ok')\"",
        test: "node -e \"process.stdout.write('test-ok')\"",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(projectDir, "README.md"), "# Consumer Smoke Project\n", "utf8");
  await writeFile(join(projectDir, "src", "index.js"), "module.exports = 1;\n", "utf8");
  return projectDir;
}

async function runAgentMemory(projectDir, args, env) {
  return await runCommand("npm", ["exec", "--", "agent-memory", ...args], {
    cwd: projectDir,
    env,
  });
}

async function smokeHttpMcp(projectDir, env) {
  const child = spawn("npm", ["exec", "--", "agent-memory", "mcp", "--transport=http", "--port=0"], {
    cwd: projectDir,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  const baseUrl = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for MCP HTTP server.")), 5000);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/Listening on (\S+)/);
      if (!match) {
        return;
      }
      clearTimeout(timer);
      resolvePromise(match[1]);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`MCP HTTP server exited early with code ${code}.\n${stderr}`.trim()));
    });
  });

  child.kill("SIGTERM");
  await new Promise((resolvePromise) => child.on("close", resolvePromise));
  return baseUrl;
}

async function main() {
  const scratchPaths = [];

  try {
    console.log("Packing current build...");
    const packed = await packCurrentBuild();
    scratchPaths.push(packed.packDir);

    console.log("Creating consumer fixture...");
    const projectDir = await createConsumerProject();
    scratchPaths.push(projectDir);

    console.log("Installing packed tarball into consumer fixture...");
    await runCommand("npm", ["install", "--no-fund", "--no-audit", "-D", packed.tarballPath], {
      cwd: projectDir,
    });

    const providerDir = await mkdtemp(join(tmpdir(), "agent-memory-consumer-provider-"));
    scratchPaths.push(providerDir);
    const providers = await createFakeProviderBinaries(providerDir);
    const env = providerEnv(providers);

    console.log("Running consumer command smoke...");
    await runAgentMemory(projectDir, ["init", "--yes", "--provider=codex"], env);
    await runAgentMemory(projectDir, ["status"], env);
    await runAgentMemory(projectDir, ["query", "what should I do next?", "--provider=codex"], env);
    await runAgentMemory(projectDir, ["integrate", "--status"], env);
    await runAgentMemory(projectDir, ["integrate", "--dry-run"], env);

    console.log("Booting MCP HTTP transport...");
    const baseUrl = await smokeHttpMcp(projectDir, env);
    console.log(`Consumer smoke passed. MCP HTTP base URL: ${baseUrl}`);
  } finally {
    await Promise.all(scratchPaths.map(async (target) => {
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
    }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
