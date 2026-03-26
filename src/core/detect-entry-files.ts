import { access } from "node:fs/promises";
import { join } from "node:path";

const ENTRY_PRIORITY = ["AGENTS.md", "CLAUDE.md", "README.md"] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectEntryFile(rootDir: string): Promise<string | null> {
  for (const name of ENTRY_PRIORITY) {
    const candidate = join(rootDir, name);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function listExistingEntryFiles(rootDir: string): Promise<string[]> {
  const candidates = await Promise.all(
    ENTRY_PRIORITY.map(async (name) => {
      const candidate = join(rootDir, name);
      return (await exists(candidate)) ? candidate : null;
    }),
  );

  return candidates.filter((candidate): candidate is string => candidate !== null);
}

export function getFallbackEntryFile(rootDir: string): string {
  return join(rootDir, "AGENTS.md");
}
