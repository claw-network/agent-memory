import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PlannedChange, ProjectedMemory, ProjectionFile } from "../types";

const ENTRY_BLOCK_REGEX = /<!-- agent-memory:entry[\s\S]*?<!-- agent-memory:entry end -->\n?/;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function insertEntrySnippet(existing: string, snippet: string): string {
  const headingMatch = existing.match(/^# .+$/m);
  if (!headingMatch || headingMatch.index === undefined) {
    return `${snippet}\n\n${existing}`.trimEnd() + "\n";
  }

  const headingEnd = headingMatch.index + headingMatch[0].length;
  return `${existing.slice(0, headingEnd)}\n\n${snippet}\n${existing.slice(headingEnd).replace(/^\n*/, "\n")}`;
}

export function renderEntryContent(existing: string | null, snippet: string): string {
  if (existing === null) {
    return `${snippet}\n`;
  }

  return ENTRY_BLOCK_REGEX.test(existing)
    ? existing.replace(ENTRY_BLOCK_REGEX, `${snippet}\n`)
    : insertEntrySnippet(existing, snippet);
}

function nextFileWriteKind(existsAlready: boolean): PlannedChange["kind"] {
  return existsAlready ? "overwrite" : "create";
}

export async function planProjectionWrites(
  projection: ProjectedMemory,
  statePath: string,
): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = [];

  changes.push({
    kind: nextFileWriteKind(await exists(statePath)),
    path: statePath,
    note: "Write canonical memory state",
  });

  for (const file of projection.files) {
    changes.push({
      kind: nextFileWriteKind(await exists(file.path)),
      path: file.path,
      note: `Write ${file.fileId} projection`,
    });
  }

  const entryExists = await exists(projection.entryFile);
  const entryContent = entryExists ? await readFile(projection.entryFile, "utf8") : "";
  const hasEntryBlock = entryExists ? ENTRY_BLOCK_REGEX.test(entryContent) : false;
  changes.push({
    kind: entryExists && hasEntryBlock ? "overwrite" : entryExists ? "patch" : "create",
    path: projection.entryFile,
    note: entryExists
      ? hasEntryBlock
        ? "Replace existing project memory entry block"
        : "Insert project memory entry block"
      : "Create entry file with project memory block",
  });

  return changes;
}

export async function writeProjectionFile(file: ProjectionFile): Promise<void> {
  await ensureParent(file.path);
  await writeFile(file.path, file.content, "utf8");
}

export async function applyEntrySnippet(path: string, snippet: string): Promise<void> {
  await ensureParent(path);

  if (!(await exists(path))) {
    await writeFile(path, `${snippet}\n`, "utf8");
    return;
  }

  const existing = await readFile(path, "utf8");
  const nextContent = renderEntryContent(existing, snippet);

  await writeFile(path, nextContent, "utf8");
}
