import { access, readFile } from "node:fs/promises";
import type { ManagedFileOwnership, MemoryFileId } from "../types";

const MARKER_REGEX = /^<!-- agent-memory:file=([a-z-]+) version=(\d+) managed=true -->\n?/;
const MANAGED_VERSION = 1;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function wrapManagedContent(fileId: MemoryFileId, body: string): string {
  const normalizedBody = body.endsWith("\n") ? body : `${body}\n`;
  return `<!-- agent-memory:file=${fileId} version=${MANAGED_VERSION} managed=true -->\n${normalizedBody}`;
}

export function stripManagedMarker(content: string): string {
  return content.replace(MARKER_REGEX, "");
}

export function parseManagedMarker(content: string): { fileId: string; version: number } | null {
  const match = content.match(MARKER_REGEX);
  if (!match) {
    return null;
  }

  return {
    fileId: match[1],
    version: Number(match[2]),
  };
}

export async function detectManagedFile(
  path: string,
  expectedFileId: MemoryFileId,
): Promise<ManagedFileOwnership> {
  if (!(await exists(path))) {
    return {
      state: "missing",
      expectedFileId,
      actualFileId: null,
      path,
    };
  }

  const existing = await readFile(path, "utf8");
  const marker = parseManagedMarker(existing);

  if (marker && marker.fileId === expectedFileId) {
    return {
      state: "managed",
      expectedFileId,
      actualFileId: marker.fileId,
      existingContent: existing,
      path,
    };
  }

  return {
    state: "unmanaged",
    expectedFileId,
    actualFileId: marker?.fileId ?? null,
    existingContent: existing,
    path,
  };
}
