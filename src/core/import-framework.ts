import { access, readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, relative } from "node:path";
import { asHistorySignals, importedSessionOutputSchema, validateImportedSessionShape } from "./bundle-schema";
import {
  addSource,
  appendHistoryEvents,
  createEventIdAllocator,
  ensureHistoryLayout,
  findImportedEventMatch,
  makeImportedContentHash,
  readHistoryEvents,
  readSources,
  updateSource,
} from "./history-store";
import { buildImportNormalizationPrompt } from "./prompt-builder";
import { invokeProvider } from "./provider-adapters";
import { stableStringify } from "./state-store";
import type {
  HistoryEvent,
  HistorySignalSet,
  HistorySource,
  ImportAddOptions,
  ImportSyncOptions,
  Importer,
  ImporterDiscoveredItem,
  ImporterSyncResult,
  ProviderPreference,
} from "../types";

const MAX_IMPORT_PAYLOAD_CHARS = 16000;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sanitizeSourceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function gatherJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await gatherJsonlFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const values: string[] = [];
  for (const [key, nested] of Object.entries(record)) {
    if (["text", "content", "summary"].includes(key) && typeof nested === "string") {
      values.push(nested);
      continue;
    }
    values.push(...collectTextValues(nested));
  }

  return values;
}

function normalizePayloadText(value: string): string {
  const compact = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  return compact.length > MAX_IMPORT_PAYLOAD_CHARS ? `${compact.slice(0, MAX_IMPORT_PAYLOAD_CHARS)}...[truncated]` : compact;
}

function parseJsonlLines(raw: string): unknown[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return line;
      }
    });
}

function firstString(values: string[]): string | null {
  return values.find((value) => value.trim().length > 0) ?? null;
}

function extractClaudeCandidate(path: string, raw: string): ImporterDiscoveredItem {
  const lines = parseJsonlLines(raw);
  const texts = lines.flatMap((line) => collectTextValues(line));
  const createdAt = firstString(
    lines.flatMap((line) =>
      line && typeof line === "object" && !Array.isArray(line) && typeof (line as Record<string, unknown>).timestamp === "string"
        ? [String((line as Record<string, unknown>).timestamp)]
        : [],
    ),
  ) ?? new Date().toISOString();

  const payload = normalizePayloadText(
    lines
      .map((line) => (typeof line === "string" ? line : stableStringify(line)))
      .join("\n")
      .concat(texts.length > 0 ? `\n\nTEXT_SNIPPETS:\n${texts.slice(0, 24).join("\n")}` : ""),
  );

  return {
    externalItemId: basename(path, ".jsonl"),
    createdAt,
    sourceRef: path,
    contentHash: makeImportedContentHash(payload),
    payload,
  };
}

function extractCodexCandidate(path: string, raw: string): ImporterDiscoveredItem {
  const lines = parseJsonlLines(raw);
  const texts = lines.flatMap((line) => collectTextValues(line));
  const createdAt = firstString(
    lines.flatMap((line) =>
      line && typeof line === "object" && !Array.isArray(line) && typeof (line as Record<string, unknown>).timestamp === "string"
        ? [String((line as Record<string, unknown>).timestamp)]
        : [],
    ),
  ) ?? new Date().toISOString();

  const payload = normalizePayloadText(
    lines
      .map((line) => (typeof line === "string" ? line : stableStringify(line)))
      .join("\n")
      .concat(texts.length > 0 ? `\n\nTEXT_SNIPPETS:\n${texts.slice(0, 24).join("\n")}` : ""),
  );

  const externalItemId =
    firstString(
      lines.flatMap((line) => {
        if (!line || typeof line !== "object" || Array.isArray(line)) {
          return [];
        }
        const payloadValue = (line as Record<string, unknown>).payload;
        if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
          return [];
        }
        const id = (payloadValue as Record<string, unknown>).id;
        return typeof id === "string" ? [id] : [];
      }),
    ) ?? basename(path, ".jsonl");

  return {
    externalItemId,
    createdAt,
    sourceRef: path,
    contentHash: makeImportedContentHash(payload),
    payload,
  };
}

function createClaudeLocalImporter(): Importer {
  return {
    type: "claude-local",
    async discover(source) {
      const root = (await exists(join(source.path, "transcripts"))) ? join(source.path, "transcripts") : source.path;
      const files = (await gatherJsonlFiles(root)).filter((path) => path.endsWith(".jsonl"));
      const items: ImporterDiscoveredItem[] = [];
      for (const file of files) {
        const raw = await readFile(file, "utf8").catch(() => "");
        if (!raw.trim()) {
          continue;
        }
        items.push(extractClaudeCandidate(file, raw));
      }
      return items;
    },
  };
}

function createCodexLocalImporter(): Importer {
  return {
    type: "codex-local",
    async discover(source) {
      const root = (await exists(join(source.path, "sessions"))) ? join(source.path, "sessions") : source.path;
      const files = (await gatherJsonlFiles(root)).filter((path) => path.endsWith(".jsonl"));
      const items: ImporterDiscoveredItem[] = [];
      for (const file of files) {
        const raw = await readFile(file, "utf8").catch(() => "");
        if (!raw.trim()) {
          continue;
        }
        items.push(extractCodexCandidate(file, raw));
      }
      return items;
    },
  };
}

const IMPORTERS: Record<string, Importer> = {
  "claude-local": createClaudeLocalImporter(),
  "codex-local": createCodexLocalImporter(),
};

function getImporter(type: string): Importer {
  const importer = IMPORTERS[type];
  if (!importer) {
    throw new Error(`Unsupported import source type "${type}".`);
  }

  return importer;
}

export async function registerSource(options: ImportAddOptions): Promise<HistorySource> {
  const normalizedPath = (() => {
    if (options.path.startsWith("~")) {
      return options.path.replace(/^~(?=\/)/, process.env.HOME ?? "~");
    }

    return isAbsolute(options.path) ? options.path : resolve(options.cwd, options.path);
  })();
  if (!(await exists(normalizedPath))) {
    throw new Error(`Import source path does not exist: ${options.path}`);
  }

  const importer = getImporter(options.type);
  const now = new Date().toISOString();
  const source: HistorySource = {
    id: options.name ? sanitizeSourceId(options.name) : sanitizeSourceId(`${options.type}-${basename(normalizedPath)}`),
    type: importer.type,
    path: normalizedPath,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
  };

  await addSource(options.cwd, source);
  return source;
}

export async function listRegisteredSources(rootDir: string): Promise<HistorySource[]> {
  return readSources(rootDir);
}

async function normalizeImportedItem(
  source: HistorySource,
  item: ImporterDiscoveredItem,
  provider: ProviderPreference,
  cwd: string,
): Promise<HistorySignalSet & { summary: string }> {
  const result = await invokeProvider(provider, {
    cwd,
    prompt: buildImportNormalizationPrompt(source, item),
    schema: importedSessionOutputSchema,
  });

  const errors = validateImportedSessionShape(result.parsed);
  if (errors.length > 0) {
    throw new Error(`Imported session normalization failed for ${item.sourceRef}: ${errors.join(" ")}`);
  }

  const parsed = result.parsed as { summary: string; signals: HistorySignalSet };
  const signals = asHistorySignals(parsed.signals);
  if (!signals) {
    throw new Error(`Imported session signals were invalid for ${item.sourceRef}.`);
  }

  return {
    summary: parsed.summary,
    ...signals,
  };
}

export async function syncSources(options: ImportSyncOptions): Promise<ImporterSyncResult[]> {
  const sources = await readSources(options.cwd);
  if (sources.length === 0) {
    throw new Error("No import sources are registered. Run `agent-memory import add ...` first.");
  }

  await ensureHistoryLayout(options.cwd);
  const selectedSources = options.all
    ? sources
    : options.target
      ? sources.filter((source) => source.id === options.target)
      : [];

  if (selectedSources.length === 0) {
    throw new Error(options.target ? `Unknown import source "${options.target}".` : "No import source was selected.");
  }

  const existingEvents = await readHistoryEvents(options.cwd);
  const allocateEventId = createEventIdAllocator(existingEvents);
  const results: ImporterSyncResult[] = [];

  for (const source of selectedSources) {
    const importer = getImporter(source.type);
    const discovered = await importer.discover(source);
    let importedCount = 0;
    let skippedCount = 0;
    const newEvents: HistoryEvent[] = [];

    for (const item of discovered) {
      if (findImportedEventMatch(existingEvents, source.id, item) || findImportedEventMatch(newEvents, source.id, item)) {
        skippedCount += 1;
        continue;
      }

      const normalized = await normalizeImportedItem(source, item, options.provider, options.cwd);
      const event: HistoryEvent = {
        id: allocateEventId(),
        kind: "imported_session",
        sourceId: source.id,
        externalItemId: item.externalItemId,
        createdAt: item.createdAt,
        contentHash: item.contentHash,
        summary: normalized.summary,
        signals: {
          decisions: normalized.decisions,
          gotchas: normalized.gotchas,
          nextStepHints: normalized.nextStepHints,
          keyPaths: normalized.keyPaths,
          validationObservations: normalized.validationObservations,
        },
        sourceRef: relative(options.cwd, item.sourceRef) || item.sourceRef,
      };

      newEvents.push(event);
      importedCount += 1;
    }

    await appendHistoryEvents(options.cwd, newEvents);
    source.updatedAt = new Date().toISOString();
    source.lastSyncedAt = source.updatedAt;
    await updateSource(options.cwd, source);
    existingEvents.push(...newEvents);

    results.push({
      sourceId: source.id,
      importedCount,
      skippedCount,
    });
  }

  return results;
}
