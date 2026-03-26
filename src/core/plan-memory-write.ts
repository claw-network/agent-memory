import { join } from "node:path";
import { detectManagedFile } from "./file-ownership";
import type { ManagedFileOwnership, MemoryFiles, MemoryTarget, PlannedChange } from "../types";

export function buildMemoryTargets(rootDir: string, memory: MemoryFiles): MemoryTarget[] {
  return [
    { fileId: "readme", path: join(rootDir, "docs/agent-memory/README.md"), content: memory.readme },
    { fileId: "project-map", path: join(rootDir, "docs/agent-memory/project-map.md"), content: memory.projectMap },
    { fileId: "current-focus", path: join(rootDir, "docs/agent-memory/current-focus.md"), content: memory.currentFocus },
    { fileId: "gotchas", path: join(rootDir, "docs/agent-memory/gotchas.md"), content: memory.gotchas },
    { fileId: "next-steps", path: join(rootDir, "docs/agent-memory/next-steps.md"), content: memory.nextSteps },
  ];
}

function planFromOwnership(ownership: ManagedFileOwnership, content: string): PlannedChange[] {
  switch (ownership.state) {
    case "missing":
      return [{ kind: "create", path: ownership.path, note: "Create missing managed memory file" }];
    case "managed":
      if (ownership.existingContent === content) {
        return [{ kind: "skip", path: ownership.path, note: "Managed memory file is already up to date" }];
      }
      return [{ kind: "overwrite", path: ownership.path, note: "Refresh existing managed memory file" }];
    case "unmanaged":
      return [
        { kind: "skip", path: ownership.path, note: "Preserve legacy or unmanaged file content" },
        { kind: "backup", path: ownership.path, note: "Write generated backup for manual merge (legacy/unmanaged file)" },
      ];
  }
}

export async function planManagedMemoryWrites(
  targets: MemoryTarget[],
): Promise<{ ownerships: Map<string, ManagedFileOwnership>; changes: PlannedChange[] }> {
  const ownerships = new Map<string, ManagedFileOwnership>();
  const changes: PlannedChange[] = [];

  for (const target of targets) {
    const ownership = await detectManagedFile(target.path, target.fileId);
    ownerships.set(target.path, ownership);
    changes.push(...planFromOwnership(ownership, target.content));
  }

  return { ownerships, changes };
}
