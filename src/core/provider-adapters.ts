import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProviderInvocation,
  ProviderInvocationResult,
  ProviderMetadata,
  ProviderName,
  ProviderPreference,
} from "../types";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

interface ResolvedProvider {
  name: ProviderName;
  binary: string;
}

const PROVIDER_BIN_ENV: Record<ProviderName, string> = {
  codex: "AGENT_MEMORY_CODEX_BIN",
  claude: "AGENT_MEMORY_CLAUDE_BIN",
};

function getConfiguredBinary(name: ProviderName): string {
  return process.env[PROVIDER_BIN_ENV[name]] || name;
}

function isAuthFailure(output: string): boolean {
  return /(auth|login|authenticate|subscription|token)/i.test(output);
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function tryParseJson(value: string): unknown {
  const normalized = stripCodeFence(value);
  return JSON.parse(normalized);
}

function tryExtractWrappedJson(value: string): unknown {
  const trimmed = value.trim();

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["result", "content", "message", "output", "text"]) {
      const candidate = parsed[key];
      if (typeof candidate === "string") {
        return tryParseJson(candidate);
      }
    }
  } catch {
    // Fall through to substring extraction.
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("Unable to locate JSON object in provider output.");
}

function parseStructuredOutput(raw: string): unknown {
  try {
    return tryParseJson(raw);
  } catch {
    return tryExtractWrappedJson(raw);
  }
}

function parseStructuredOutputOrRaw(raw: string): unknown {
  try {
    return parseStructuredOutput(raw);
  } catch {
    return raw;
  }
}

async function runCommand(
  binary: string,
  args: string[],
  options: {
    cwd: string;
    stdin?: string;
  },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        resolve({
          code: null,
          stdout,
          stderr,
          error,
        });
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        resolve({
          code,
          stdout,
          stderr,
          error: null,
        });
      }
    });

    child.stdin.end(options.stdin ?? "");
  });
}

async function isBinaryAvailable(binary: string, cwd: string): Promise<boolean> {
  const result = await runCommand(binary, ["--version"], { cwd });
  if (result.error) {
    return false;
  }

  return result.code === 0;
}

async function resolveProvider(preference: ProviderPreference, cwd: string): Promise<ResolvedProvider> {
  const order: ProviderName[] = preference === "auto" ? ["codex", "claude"] : [preference];

  for (const name of order) {
    const binary = getConfiguredBinary(name);
    if (await isBinaryAvailable(binary, cwd)) {
      return { name, binary };
    }
  }

  if (preference === "auto") {
    throw new Error(
      "No supported agent provider is available. Install Codex or Claude Code, or set AGENT_MEMORY_CODEX_BIN / AGENT_MEMORY_CLAUDE_BIN.",
    );
  }

  throw new Error(
    `Requested provider "${preference}" is not available. Install it or set ${PROVIDER_BIN_ENV[preference]}.`,
  );
}

async function invokeCodex(
  provider: ResolvedProvider,
  input: ProviderInvocation,
): Promise<ProviderInvocationResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "agent-memory-codex-"));
  const schemaPath = join(tempDir, "bundle-schema.json");
  const outputPath = join(tempDir, "provider-output.json");

  try {
    await writeFile(schemaPath, JSON.stringify(input.schema), "utf8");
    const result = await runCommand(
      provider.binary,
      [
        "exec",
        "-C",
        input.cwd,
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        "-",
      ],
      {
        cwd: input.cwd,
        stdin: input.prompt,
      },
    );

    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
    if (result.error) {
      throw new Error(`Failed to start Codex: ${result.error.message}`);
    }

    if (result.code !== 0) {
      if (isAuthFailure(combinedOutput)) {
        throw new Error(`Codex authentication failed: ${combinedOutput || "authentication is required."}`);
      }
      throw new Error(`Codex failed: ${combinedOutput || `exit code ${result.code}`}`);
    }

    const rawOutput = await readFile(outputPath, "utf8");
    return {
      provider: {
        name: "codex",
        binary: provider.binary,
        model: null,
        sessionId: null,
      },
      rawOutput,
      parsed: parseStructuredOutputOrRaw(rawOutput),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function invokeClaude(
  provider: ResolvedProvider,
  input: ProviderInvocation,
): Promise<ProviderInvocationResult> {
  const result = await runCommand(
    provider.binary,
    [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "text",
      "--json-schema",
      JSON.stringify(input.schema),
      "--tools",
      "Bash,Read",
      "--add-dir",
      input.cwd,
      input.prompt,
    ],
    { cwd: input.cwd },
  );

  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
  if (result.error) {
    throw new Error(`Failed to start Claude Code: ${result.error.message}`);
  }

  if (result.code !== 0) {
    if (isAuthFailure(combinedOutput)) {
      throw new Error(`Claude Code authentication failed: ${combinedOutput || "authentication is required."}`);
    }
    throw new Error(`Claude Code failed: ${combinedOutput || `exit code ${result.code}`}`);
  }

  const rawOutput = result.stdout.trim();
  return {
    provider: {
      name: "claude",
      binary: provider.binary,
      model: null,
      sessionId: null,
    },
    rawOutput,
    parsed: parseStructuredOutputOrRaw(rawOutput),
  };
}

export async function invokeProvider(
  preference: ProviderPreference,
  input: ProviderInvocation,
): Promise<ProviderInvocationResult> {
  const provider = await resolveProvider(preference, input.cwd);
  if (provider.name === "codex") {
    return invokeCodex(provider, input);
  }

  return invokeClaude(provider, input);
}
