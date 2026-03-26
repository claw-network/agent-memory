import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { GENERATOR_VERSION, STATE_SCHEMA_VERSION } from "./constants";
import { validateStateShape } from "./bundle-schema";
import type { AgentMemoryBundle, AgentMemoryState, ProviderMetadata } from "../types";

export function getStateDir(rootDir: string): string {
  return join(rootDir, ".agent-memory");
}

export function getStatePath(rootDir: string): string {
  return join(getStateDir(rootDir), "state.json");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)]),
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

export function computeBundleHash(bundle: AgentMemoryBundle): string {
  return createHash("sha256").update(stableStringify(bundle)).digest("hex");
}

export function buildState(
  bundle: AgentMemoryBundle,
  provider: ProviderMetadata,
  generatedAt = new Date().toISOString(),
): AgentMemoryState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    provider,
    generatedAt,
    bundleHash: computeBundleHash(bundle),
    bundle,
  };
}

export async function readState(rootDir: string): Promise<AgentMemoryState> {
  const path = getStatePath(rootDir);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const errors = validateStateShape(parsed);
  if (errors.length > 0) {
    throw new Error(`Invalid state at ${path}: ${errors.join(" ")}`);
  }

  return parsed as AgentMemoryState;
}

export async function readStateIfPresent(rootDir: string): Promise<AgentMemoryState | null> {
  const path = getStatePath(rootDir);
  if (!(await exists(path))) {
    return null;
  }

  return readState(rootDir);
}

export async function writeState(rootDir: string, state: AgentMemoryState): Promise<void> {
  const path = getStatePath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(state)}\n`, "utf8");
}
