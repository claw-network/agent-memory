import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { asAgentMemoryConfig, validateConfigShape } from "./bundle-schema";
import type { AgentMemoryConfig } from "../types";

const DEFAULT_CONFIG: AgentMemoryConfig = {
  recall: {
    defaultSection: "all",
    defaultSource: "all",
    policy: "balanced",
    backlogWarnThreshold: 10,
    preview: {
      showDiffByDefault: false,
    },
  },
  query: {
    defaultOutput: "text",
    templates: {
      answer: {
        instructions: "Answer the question directly using the strongest available evidence. Prefer clarity over exhaustiveness.",
      },
      changes: {
        instructions: "Summarize the most relevant recent changes first. Prefer recent checkpoints and history events over static project structure.",
      },
      next: {
        instructions: "Recommend the most relevant next actions first. Prefer concrete follow-ups and suggested actions over general descriptions.",
      },
      traps: {
        instructions: "Highlight the most relevant gotchas, pitfalls, and risky areas first. Prefer durable warnings over generic cautionary advice.",
      },
    },
  },
  automation: {
    intervalMinutes: 15,
    provider: "auto",
    importSyncBeforeRecall: true,
    autoRecall: true,
  },
};

function configPath(rootDir: string): string {
  return join(rootDir, ".agent-memory", "config.json");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultConfig(): AgentMemoryConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AgentMemoryConfig;
}

export async function readConfig(rootDir: string): Promise<AgentMemoryConfig> {
  const path = configPath(rootDir);
  if (!(await exists(path))) {
    return getDefaultConfig();
  }

  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const errors = validateConfigShape(parsed);
  if (errors.length > 0) {
    throw new Error(`Invalid config at ${path}: ${errors.join(" ")}`);
  }

  const config = asAgentMemoryConfig(parsed) ?? getDefaultConfig();
  return {
    recall: {
      ...DEFAULT_CONFIG.recall,
      ...(config.recall ?? {}),
      preview: {
        ...DEFAULT_CONFIG.recall.preview,
        ...(config.recall?.preview ?? {}),
      },
    },
    query: {
      ...DEFAULT_CONFIG.query,
      ...(config.query ?? {}),
      templates: {
        ...DEFAULT_CONFIG.query.templates,
        ...(config.query?.templates ?? {}),
        answer: {
          ...DEFAULT_CONFIG.query.templates.answer,
          ...(config.query?.templates?.answer ?? {}),
        },
        changes: {
          ...DEFAULT_CONFIG.query.templates.changes,
          ...(config.query?.templates?.changes ?? {}),
        },
        next: {
          ...DEFAULT_CONFIG.query.templates.next,
          ...(config.query?.templates?.next ?? {}),
        },
        traps: {
          ...DEFAULT_CONFIG.query.templates.traps,
          ...(config.query?.templates?.traps ?? {}),
        },
      },
    },
    automation: {
      ...DEFAULT_CONFIG.automation,
      ...(config.automation ?? {}),
    },
  };
}

export async function writeConfig(rootDir: string, config: AgentMemoryConfig): Promise<void> {
  const path = configPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function getConfigPath(rootDir: string): string {
  return configPath(rootDir);
}
