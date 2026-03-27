#!/usr/bin/env node

import { cwd, exit } from "node:process";
import {
  runAutomateDaemon,
  runAutomateEnsureRunning,
  runAutomateRunOnce,
  runAutomateStart,
  runAutomateStatus,
  runAutomateStop,
} from "./commands/automate";
import { runImportAdd, runImportList, runImportSync } from "./commands/import";
import { runInit } from "./commands/init";
import { runIntegrate } from "./commands/integrate";
import { runMcpServer } from "./commands/mcp";
import { runQuery } from "./commands/query";
import { runRecall } from "./commands/recall";
import { runStatus } from "./commands/status";
import { runUpdate } from "./commands/update";
import { runValidate } from "./commands/validate";
import type {
  IntegrationTarget,
  ProviderPreference,
  QueryOutputFormat,
  QueryScope,
  RecallPolicy,
  RecallSection,
  RecallSourceScope,
} from "./types";

interface CommonArgs {
  yes: boolean;
  validate: boolean;
  provider: ProviderPreference;
}

function printHelp(): void {
  console.log("agent-memory");
  console.log("");
  console.log("Usage:");
  console.log("  agent-memory init [--yes] [--validate] [--provider=auto|codex|claude]");
  console.log("  agent-memory update [--yes] [--validate] [--provider=auto|codex|claude]");
  console.log("  agent-memory recall [--yes] [--provider=auto|codex|claude] [--source=all|local|imports]");
  console.log("  agent-memory query <question> [--provider=auto|codex|claude] [--scope=state|history|all] [--output=text|json]");
  console.log("  agent-memory import add <type> <path> [--name <id>]");
  console.log("  agent-memory import sync [<id>|--all] [--provider=auto|codex|claude]");
  console.log("  agent-memory import list");
  console.log("  agent-memory integrate [claude|codex|all] [--dry-run] [--status] [--output=text|json]");
  console.log("  agent-memory mcp");
  console.log("  agent-memory automate start|stop|status|run-once|ensure-running");
  console.log("  agent-memory status [--checkpoint <id>] [--show-diff]");
  console.log("  agent-memory validate");
  console.log("");
  console.log("Commands:");
  console.log("  init      Rebuild canonical memory state, projections, history, and the initial checkpoint.");
  console.log("  update    Refresh canonical memory state and write a new checkpoint and tool-run event.");
  console.log("  recall    Consolidate history into the canonical memory with preview and diff output.");
  console.log("  query     Answer a memory question with citations from bundle, history, or checkpoints.");
  console.log("  import    Manage external session sources and sync them into history events.");
  console.log("  integrate Write Claude Code and Codex integration files.");
  console.log("  mcp       Start the local MCP stdio server.");
  console.log("  automate  Run local automation daemon commands for import-sync and recall maintenance.");
  console.log("  status    Show backlog, source health, and checkpoint drift before running recall.");
  console.log("  validate  Audit canonical state, history, checkpoints, projections, and recall health.");
}

function parseProvider(value: string): ProviderPreference {
  if (value === "auto" || value === "codex" || value === "claude") {
    return value;
  }

  throw new Error(`Unknown provider: ${value}`);
}

function parseRecallSource(value: string): RecallSourceScope {
  if (value === "all" || value === "local" || value === "imports") {
    return value;
  }

  throw new Error(`Unknown recall source: ${value}`);
}

function parseRecallSection(value: string): RecallSection {
  if (
    value === "all" ||
    value === "project" ||
    value === "project-map" ||
    value === "current-focus" ||
    value === "gotchas" ||
    value === "next-steps" ||
    value === "validation-commands"
  ) {
    return value;
  }

  throw new Error(`Unknown recall section: ${value}`);
}

function parseRecallPolicy(value: string): RecallPolicy {
  if (value === "balanced" || value === "imports-only" || value === "local-only" || value === "project-map-protected") {
    return value;
  }

  throw new Error(`Unknown recall policy: ${value}`);
}

function parseQueryScope(value: string): QueryScope {
  if (value === "state" || value === "history" || value === "all") {
    return value;
  }

  throw new Error(`Unknown query scope: ${value}`);
}

function parseQueryOutputFormat(value: string): QueryOutputFormat {
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error(`Unknown query output format: ${value}`);
}

function parseIntegrationTarget(value: string): IntegrationTarget {
  if (value === "all" || value === "claude" || value === "codex") {
    return value;
  }

  throw new Error(`Unknown integration target: ${value}`);
}

function parseCommonFlags(argv: string[]): { rest: string[]; common: CommonArgs } {
  const args = [...argv];
  const rest: string[] = [];
  const common: CommonArgs = {
    yes: false,
    validate: false,
    provider: "auto",
  };

  while (args.length > 0) {
    const value = args.shift();
    if (!value) {
      continue;
    }

    if (value === "--yes" || value === "-y") {
      common.yes = true;
      continue;
    }

    if (value === "--validate") {
      common.validate = true;
      continue;
    }

    if (value.startsWith("--provider=")) {
      common.provider = parseProvider(value.slice("--provider=".length));
      continue;
    }

    if (value === "--provider") {
      const next = args.shift();
      if (!next) {
        throw new Error("Missing value for --provider");
      }
      common.provider = parseProvider(next);
      continue;
    }

    rest.push(value, ...args);
    break;
  }

  return { rest, common };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const [command, ...restArgs] = argv;
  switch (command) {
    case "init": {
      const { common, rest } = parseCommonFlags(restArgs);
      if (rest.length > 0) {
        throw new Error(`Unknown argument: ${rest[0]}`);
      }
      const code = await runInit({ cwd: cwd(), ...common });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "update": {
      const { common, rest } = parseCommonFlags(restArgs);
      if (rest.length > 0) {
        throw new Error(`Unknown argument: ${rest[0]}`);
      }
      const code = await runUpdate({ cwd: cwd(), ...common });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "recall": {
      const { common, rest } = parseCommonFlags(restArgs);
      let source: RecallSourceScope = "all";
      let section: RecallSection = "all";
      let policy: RecallPolicy | null = null;
      let showDiff = false;
      let checkpointId: string | null = null;
      const remaining = [...rest];
      while (remaining.length > 0) {
        const value = remaining.shift();
        if (!value) {
          continue;
        }

        if (value.startsWith("--source=")) {
          source = parseRecallSource(value.slice("--source=".length));
          continue;
        }

        if (value === "--source") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --source");
          }
          source = parseRecallSource(next);
          continue;
        }

        if (value.startsWith("--section=")) {
          section = parseRecallSection(value.slice("--section=".length));
          continue;
        }

        if (value === "--section") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --section");
          }
          section = parseRecallSection(next);
          continue;
        }

        if (value.startsWith("--policy=")) {
          policy = parseRecallPolicy(value.slice("--policy=".length));
          continue;
        }

        if (value === "--policy") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --policy");
          }
          policy = parseRecallPolicy(next);
          continue;
        }

        if (value === "--show-diff") {
          showDiff = true;
          continue;
        }

        if (value.startsWith("--checkpoint=")) {
          checkpointId = value.slice("--checkpoint=".length);
          continue;
        }

        if (value === "--checkpoint") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --checkpoint");
          }
          checkpointId = next;
          continue;
        }

        throw new Error(`Unknown argument: ${value}`);
      }

      const code = await runRecall({
        cwd: cwd(),
        yes: common.yes,
        provider: common.provider,
        source,
        section,
        policy,
        showDiff,
        checkpointId,
      });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "query": {
      let provider: ProviderPreference = "auto";
      let scope: QueryScope = "all";
      let output: QueryOutputFormat | null = null;
      const questionParts: string[] = [];
      const remaining = [...restArgs];
      while (remaining.length > 0) {
        const value = remaining.shift();
        if (!value) {
          continue;
        }

        if (value.startsWith("--provider=")) {
          provider = parseProvider(value.slice("--provider=".length));
          continue;
        }

        if (value === "--provider") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --provider");
          }
          provider = parseProvider(next);
          continue;
        }

        if (value.startsWith("--scope=")) {
          scope = parseQueryScope(value.slice("--scope=".length));
          continue;
        }

        if (value === "--scope") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --scope");
          }
          scope = parseQueryScope(next);
          continue;
        }

        if (value.startsWith("--output=")) {
          output = parseQueryOutputFormat(value.slice("--output=".length));
          continue;
        }

        if (value === "--output") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --output");
          }
          output = parseQueryOutputFormat(next);
          continue;
        }

        if (value.startsWith("--")) {
          throw new Error(`Unknown argument: ${value}`);
        }

        questionParts.push(value);
      }

      const question = questionParts.join(" ").trim();
      if (!question) {
        throw new Error("Query command requires a question.");
      }

      const code = await runQuery({
        cwd: cwd(),
        provider,
        scope,
        question,
        output,
      });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "import": {
      const [subcommand, ...importArgs] = restArgs;
      if (!subcommand) {
        throw new Error("Import command requires a subcommand: add, sync, or list.");
      }

      if (subcommand === "add") {
        const [type, pathValue, ...tail] = importArgs;
        if (!type || !pathValue) {
          throw new Error("Usage: agent-memory import add <type> <path> [--name <id>]");
        }
        let name: string | null = null;
        const remaining = [...tail];
        while (remaining.length > 0) {
          const value = remaining.shift();
          if (!value) {
            continue;
          }
          if (value === "--name") {
            const next = remaining.shift();
            if (!next) {
              throw new Error("Missing value for --name");
            }
            name = next;
            continue;
          }
          if (value.startsWith("--name=")) {
            name = value.slice("--name=".length);
            continue;
          }
          throw new Error(`Unknown argument: ${value}`);
        }
        const code = await runImportAdd({ cwd: cwd(), type, path: pathValue, name });
        if (code !== 0) {
          exit(code);
        }
        return;
      }

      if (subcommand === "list") {
        const code = await runImportList(cwd());
        if (code !== 0) {
          exit(code);
        }
        return;
      }

      if (subcommand === "sync") {
        let provider: ProviderPreference = "auto";
        let all = false;
        let target: string | null = null;
        const remaining = [...importArgs];
        while (remaining.length > 0) {
          const value = remaining.shift();
          if (!value) {
            continue;
          }
          if (value.startsWith("--provider=")) {
            provider = parseProvider(value.slice("--provider=".length));
            continue;
          }
          if (value === "--provider") {
            const next = remaining.shift();
            if (!next) {
              throw new Error("Missing value for --provider");
            }
            provider = parseProvider(next);
            continue;
          }
          if (value === "--all") {
            all = true;
            continue;
          }
          if (value.startsWith("--")) {
            throw new Error(`Unknown argument: ${value}`);
          }
          if (target) {
            throw new Error(`Unexpected extra argument: ${value}`);
          }
          target = value;
        }
        const code = await runImportSync({
          cwd: cwd(),
          provider,
          target,
          all,
        });
        if (code !== 0) {
          exit(code);
        }
        return;
      }

      throw new Error(`Unknown import subcommand: ${subcommand}`);
    }
    case "integrate": {
      let target: IntegrationTarget = "all";
      let dryRun = false;
      let status = false;
      let output: QueryOutputFormat | null = null;
      const remaining = [...restArgs];
      while (remaining.length > 0) {
        const value = remaining.shift();
        if (!value) {
          continue;
        }

        if (value === "--dry-run") {
          dryRun = true;
          continue;
        }

        if (value === "--status") {
          status = true;
          continue;
        }

        if (value.startsWith("--output=")) {
          output = parseQueryOutputFormat(value.slice("--output=".length));
          continue;
        }

        if (value === "--output") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --output");
          }
          output = parseQueryOutputFormat(next);
          continue;
        }

        if (value.startsWith("--")) {
          throw new Error(`Unknown argument: ${value}`);
        }

        if (target !== "all") {
          throw new Error(`Unexpected extra argument: ${value}`);
        }
        target = parseIntegrationTarget(value);
      }

      if (output && !status) {
        throw new Error("The --output flag is only supported together with --status.");
      }

      const code = await runIntegrate({
        cwd: cwd(),
        target,
        dryRun,
        status,
        output,
      });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "mcp": {
      const code = await runMcpServer({ cwd: cwd() });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "automate": {
      const [subcommand] = restArgs;
      if (!subcommand) {
        throw new Error("Automate command requires a subcommand: start, stop, status, run-once, or ensure-running.");
      }

      switch (subcommand) {
        case "start": {
          const code = await runAutomateStart({ cwd: cwd() });
          if (code !== 0) {
            exit(code);
          }
          return;
        }
        case "stop": {
          const code = await runAutomateStop({ cwd: cwd() });
          if (code !== 0) {
            exit(code);
          }
          return;
        }
        case "status": {
          const code = await runAutomateStatus({ cwd: cwd() });
          if (code !== 0) {
            exit(code);
          }
          return;
        }
        case "run-once": {
          const code = await runAutomateRunOnce({ cwd: cwd() });
          if (code !== 0) {
            exit(code);
          }
          return;
        }
        case "ensure-running": {
          const code = await runAutomateEnsureRunning({ cwd: cwd() });
          if (code !== 0) {
            exit(code);
          }
          return;
        }
        case "__daemon": {
          const code = await runAutomateDaemon({ cwd: cwd() });
          if (code !== 0) {
            exit(code);
          }
          return;
        }
        default:
          throw new Error(`Unknown automate subcommand: ${subcommand}`);
      }
    }
    case "validate": {
      const code = await runValidate(cwd());
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    case "status": {
      let showDiff = false;
      let checkpointId: string | null = null;
      const remaining = [...restArgs];
      while (remaining.length > 0) {
        const value = remaining.shift();
        if (!value) {
          continue;
        }
        if (value === "--show-diff") {
          showDiff = true;
          continue;
        }
        if (value.startsWith("--checkpoint=")) {
          checkpointId = value.slice("--checkpoint=".length);
          continue;
        }
        if (value === "--checkpoint") {
          const next = remaining.shift();
          if (!next) {
            throw new Error("Missing value for --checkpoint");
          }
          checkpointId = next;
          continue;
        }
        throw new Error(`Unknown argument: ${value}`);
      }

      const code = await runStatus({ cwd: cwd(), checkpointId, showDiff });
      if (code !== 0) {
        exit(code);
      }
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`agent-memory failed: ${message}`);
  exit(1);
});
