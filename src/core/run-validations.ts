import { spawn } from "node:child_process";
import type { ValidationCommand, ValidationResult } from "../types";

function summarizeOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "No output captured.";
  }

  return lines.slice(-5).join(" | ");
}

async function runCommand(cwd: string, command: ValidationCommand): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const child = spawn(command.command[0], command.command.slice(1), {
      cwd,
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

    child.on("error", (error) => {
      resolve({
        label: command.label,
        command: command.command.join(" "),
        purpose: command.purpose,
        status: "unavailable",
        summary: `Unable to start command: ${error.message}`,
        exitCode: null,
      });
    });

    child.on("close", (code) => {
      resolve({
        label: command.label,
        command: command.command.join(" "),
        purpose: command.purpose,
        status: code === 0 ? "passed" : "failed",
        summary: summarizeOutput(stdout || stderr),
        exitCode: code,
      });
    });
  });
}

export async function runValidations(cwd: string, commands: ValidationCommand[]): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const command of commands.slice(0, 2)) {
    results.push(await runCommand(cwd, command));
  }

  return results;
}
