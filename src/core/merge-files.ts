import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { PlannedChange } from "../types";

const ENTRY_START = "<!-- agent-memory:start -->";
const ENTRY_END = "<!-- agent-memory:end -->";

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

function makeBackupPath(path: string): string {
  const ext = extname(path);
  const base = basename(path, ext);
  return join(dirname(path), `${base}.generated.bak${ext}`);
}

function insertEntrySnippet(existing: string, snippet: string): string {
  if (existing.includes(ENTRY_START)) {
    return existing;
  }

  const headingMatch = existing.match(/^# .+$/m);
  if (!headingMatch || headingMatch.index === undefined) {
    return `${snippet}\n\n${existing}`.trimEnd() + "\n";
  }

  const headingEnd = headingMatch.index + headingMatch[0].length;
  return `${existing.slice(0, headingEnd)}\n\n${snippet}\n${existing.slice(headingEnd).replace(/^\n*/, "\n")}`;
}

export function wrapEntrySnippet(content: string): string {
  return `${ENTRY_START}\n${content}\n${ENTRY_END}`;
}

export async function planFileWrite(path: string, content: string): Promise<PlannedChange[]> {
  if (!(await exists(path))) {
    return [{ kind: "create", path, note: "Create missing file" }];
  }

  const existing = await readFile(path, "utf8");
  if (existing === content) {
    return [{ kind: "skip", path, note: "File already matches generated content" }];
  }

  return [
    { kind: "skip", path, note: "Preserve existing file content" },
    { kind: "backup", path: makeBackupPath(path), note: "Write generated backup for manual merge" },
  ];
}

export async function applyFileWrite(path: string, content: string): Promise<void> {
  await ensureParent(path);

  if (!(await exists(path))) {
    await writeFile(path, content, "utf8");
    return;
  }

  const existing = await readFile(path, "utf8");
  if (existing === content) {
    return;
  }

  await writeFile(makeBackupPath(path), content, "utf8");
}

export async function planEntryPatch(path: string, wrappedSnippet: string): Promise<PlannedChange[]> {
  if (!(await exists(path))) {
    return [{ kind: "create", path, note: "Create entry file with project memory section" }];
  }

  const existing = await readFile(path, "utf8");
  if (existing.includes(ENTRY_START)) {
    return [{ kind: "skip", path, note: "Entry snippet already exists" }];
  }

  return [{ kind: "patch", path, note: "Insert project memory section" }];
}

export async function applyEntryPatch(path: string, wrappedSnippet: string): Promise<void> {
  await ensureParent(path);

  if (!(await exists(path))) {
    await writeFile(path, `${wrappedSnippet}\n`, "utf8");
    return;
  }

  const existing = await readFile(path, "utf8");
  if (existing.includes(ENTRY_START)) {
    return;
  }

  await writeFile(path, insertEntrySnippet(existing, wrappedSnippet), "utf8");
}
