import { access, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { detectEntryFile, getFallbackEntryFile, listExistingEntryFiles } from "./detect-entry-files";
import { readStateIfPresent } from "./state-store";
import { scanProject } from "./scan-project";
import type { CollectedContext, CommandMode, ContextFile } from "../types";

const MAX_CONTEXT_BYTES = 6000;
const MAX_CONTEXT_FILES = 8;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readContextFile(rootDir: string, relativePath: string): Promise<ContextFile | null> {
  const absolutePath = join(rootDir, relativePath);
  if (!(await exists(absolutePath))) {
    return null;
  }

  const content = await readFile(absolutePath, "utf8");
  return {
    path: relative(rootDir, absolutePath) || ".",
    content: content.length > MAX_CONTEXT_BYTES ? `${content.slice(0, MAX_CONTEXT_BYTES)}\n...[truncated]` : content,
    truncated: content.length > MAX_CONTEXT_BYTES,
  };
}

export async function collectContext(rootDir: string, mode: CommandMode): Promise<CollectedContext> {
  const scan = await scanProject(rootDir);
  const previousState = await (async () => {
    try {
      return await readStateIfPresent(rootDir);
    } catch (error) {
      if (mode === "init") {
        return null;
      }
      throw error;
    }
  })();
  const entryFileCandidates = (await listExistingEntryFiles(rootDir)).map((path) => relative(rootDir, path) || ".");
  const selectedEntryFile = relative(
    rootDir,
    (await detectEntryFile(rootDir)) ?? getFallbackEntryFile(rootDir),
  ) || ".";

  const candidateFiles = Array.from(
    new Set(
      [
        "package.json",
        "README.md",
        "AGENTS.md",
        "CLAUDE.md",
        ...scan.keyEntryFiles,
      ].filter(Boolean),
    ),
  ).slice(0, MAX_CONTEXT_FILES);

  const contextFiles = (
    await Promise.all(candidateFiles.map((path) => readContextFile(rootDir, path)))
  ).filter((file): file is ContextFile => file !== null);

  return {
    cwd: rootDir,
    mode,
    scan,
    entryFileCandidates,
    selectedEntryFile,
    contextFiles,
    previousState,
  };
}
