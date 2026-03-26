#!/usr/bin/env node

import { cwd, exit } from "node:process";
import { runInit } from "./commands/init";
import { runUpdate } from "./commands/update";
import { runValidate } from "./commands/validate";

interface ParsedArgs {
  command: string | null;
  yes: boolean;
  validate: boolean;
}

function printHelp(): void {
  console.log("agent-memory");
  console.log("");
  console.log("Usage:");
  console.log("  agent-memory init [--yes] [--validate]");
  console.log("  agent-memory update [--yes] [--validate]");
  console.log("  agent-memory validate");
  console.log("");
  console.log("Commands:");
  console.log("  init    Generate docs/agent-memory and wire in a Project Memory entry snippet.");
  console.log("  update  Refresh managed project memory and repair missing memory pieces.");
  console.log("  validate  Audit project memory health and current-focus validation freshness.");
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let yes = false;
  let validate = false;
  let command: string | null = null;

  while (args.length > 0) {
    const value = args.shift();
    if (!value) {
      continue;
    }

    if (value === "--yes" || value === "-y") {
      yes = true;
      continue;
    }

    if (value === "--validate") {
      validate = true;
      continue;
    }

    if (value === "--help" || value === "-h") {
      printHelp();
      exit(0);
    }

    if (!command) {
      command = value;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return { command, yes, validate };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.command) {
    printHelp();
    return;
  }

  switch (parsed.command) {
    case "init": {
      const code = await runInit({ cwd: cwd(), yes: parsed.yes, validate: parsed.validate });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "update": {
      const code = await runUpdate({ cwd: cwd(), yes: parsed.yes, validate: parsed.validate });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "validate": {
      const code = await runValidate(cwd());
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`agent-memory failed: ${message}`);
  exit(1);
});
