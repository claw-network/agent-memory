import { access, readFile, readdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve, relative } from "node:path";
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
  ImporterItemFailure,
  ImporterSyncResult,
  ProviderPreference,
} from "../types";

const MAX_IMPORT_PAYLOAD_CHARS = 16000;
const SUPPORTED_SOURCE_TYPES = ["claude-local", "codex-local"] as const;

interface ParsedImportItem {
  externalItemId: string;
  createdAt: string;
  sourceRef: string;
  payload: string;
}

interface ParsedImportSuccess {
  ok: true;
  item: ParsedImportItem;
}

interface ParsedImportFailure {
  ok: false;
  failure: ImporterItemFailure;
}

type ParsedImportResult = ParsedImportSuccess | ParsedImportFailure;

type SessionIndexMap = Map<string, { threadName: string | null; updatedAt: string | null }>;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function isSupportedSourceType(type: string): boolean {
  return SUPPORTED_SOURCE_TYPES.includes(type as (typeof SUPPORTED_SOURCE_TYPES)[number]);
}

export function resolveImportPath(cwd: string, inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return inputPath.replace(/^~(?=\/)/, process.env.HOME ?? "~");
  }

  return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}

function sanitizeSourceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function withFailure(sourceRef: string, message: string): ParsedImportFailure {
  return {
    ok: false,
    failure: {
      sourceRef,
      message,
    },
  };
}

function asFailedItem(sourceRef: string, message: string): ImporterDiscoveredItem {
  return {
    externalItemId: basename(sourceRef, extname(sourceRef)) || `failed-${Date.now()}`,
    createdAt: new Date().toISOString(),
    sourceRef,
    contentHash: makeImportedContentHash(`${sourceRef}:${message}`),
    payload: "",
    failureMessage: message,
  };
}

function normalizePayloadText(value: string): string {
  const compact = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  return compact.length > MAX_IMPORT_PAYLOAD_CHARS ? `${compact.slice(0, MAX_IMPORT_PAYLOAD_CHARS)}...[truncated]` : compact;
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
    if (["text", "content", "summary", "thread_name", "title"].includes(key) && typeof nested === "string") {
      values.push(nested);
      continue;
    }
    values.push(...collectTextValues(nested));
  }

  return values;
}

function parseJsonlLines(raw: string): unknown[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function firstString(values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
}

function gatherStructuredContent(lines: unknown[]): string[] {
  const snippets = lines.flatMap((line) => collectTextValues(line));
  return Array.from(new Set(snippets.map((snippet) => snippet.trim()).filter(Boolean))).slice(0, 32);
}

function structuredPayload(lines: unknown[], snippets: string[], extra: string[] = []): string {
  return normalizePayloadText(
    lines
      .map((line) => stableStringify(line))
      .join("\n")
      .concat(snippets.length > 0 ? `\n\nTEXT_SNIPPETS:\n${snippets.join("\n")}` : "")
      .concat(extra.length > 0 ? `\n\nEXTRA:\n${extra.join("\n")}` : ""),
  );
}

function parseClaudeTranscriptFile(path: string, raw: string): ParsedImportResult {
  let lines: unknown[];
  try {
    lines = parseJsonlLines(raw);
  } catch (error) {
    return withFailure(path, `Invalid JSONL transcript: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (lines.length === 0) {
    return withFailure(path, "Transcript file is empty.");
  }

  const snippets = gatherStructuredContent(lines);
  if (snippets.length === 0) {
    return withFailure(path, "Transcript did not contain readable content.");
  }

  const createdAt = firstString(
    lines.map((line) =>
      line && typeof line === "object" && !Array.isArray(line) ? String((line as Record<string, unknown>).timestamp ?? "") : "",
    ),
  ) ?? new Date().toISOString();

  return {
    ok: true,
    item: {
      externalItemId: basename(path, extname(path)),
      createdAt,
      sourceRef: path,
      payload: structuredPayload(lines, snippets),
    },
  };
}

function parseCodexSessionFile(path: string, raw: string, sessionIndex: SessionIndexMap): ParsedImportResult {
  let lines: unknown[];
  try {
    lines = parseJsonlLines(raw);
  } catch (error) {
    return withFailure(path, `Invalid JSONL session: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (lines.length === 0) {
    return withFailure(path, "Session file is empty.");
  }

  const snippets = gatherStructuredContent(lines);
  const sessionMeta = lines.find(
    (line) =>
      line &&
      typeof line === "object" &&
      !Array.isArray(line) &&
      (line as Record<string, unknown>).type === "session_meta",
  );
  const sessionId =
    firstString(
      lines.flatMap((line) => {
        if (!line || typeof line !== "object" || Array.isArray(line)) {
          return [];
        }
        const payload = (line as Record<string, unknown>).payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return [];
        }
        return [String((payload as Record<string, unknown>).id ?? "")];
      }),
    ) ?? basename(path, extname(path));
  const createdAt =
    firstString(
      lines.map((line) =>
        line && typeof line === "object" && !Array.isArray(line) ? String((line as Record<string, unknown>).timestamp ?? "") : "",
      ),
    ) ?? new Date().toISOString();
  const sessionMetaInfo = sessionIndex.get(sessionId) ?? { threadName: null, updatedAt: null };

  if (snippets.length === 0 && !sessionMeta) {
    return withFailure(path, "Session did not contain readable content.");
  }

  const extra: string[] = [];
  if (sessionMetaInfo.threadName) {
    extra.push(`THREAD_NAME: ${sessionMetaInfo.threadName}`);
  }
  if (sessionMetaInfo.updatedAt) {
    extra.push(`UPDATED_AT: ${sessionMetaInfo.updatedAt}`);
  }

  return {
    ok: true,
    item: {
      externalItemId: sessionId,
      createdAt,
      sourceRef: path,
      payload: structuredPayload(lines, snippets, extra),
    },
  };
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

async function readSessionIndex(root: string): Promise<SessionIndexMap> {
  const path = join(root, "session_index.jsonl");
  if (!(await exists(path))) {
    return new Map();
  }

  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw.trim()) {
    return new Map();
  }

  const map: SessionIndexMap = new Map();
  for (const line of raw.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = typeof parsed.id === "string" ? parsed.id : null;
      if (!id) {
        continue;
      }
      map.set(id, {
        threadName: typeof parsed.thread_name === "string" ? parsed.thread_name : null,
        updatedAt: typeof parsed.updated_at === "string" ? parsed.updated_at : null,
      });
    } catch {
      continue;
    }
  }

  return map;
}

function createClaudeLocalImporter(): Importer {
  return {
    type: "claude-local",
    async discover(source) {
      const candidates = new Set<string>();

      if (await exists(join(source.path, "transcripts"))) {
        for (const file of await gatherJsonlFiles(join(source.path, "transcripts"))) {
          candidates.add(file);
        }
      }

      if (source.path.endsWith(".jsonl") && (await exists(source.path))) {
        candidates.add(source.path);
      }

      if (await exists(join(source.path, "history.jsonl"))) {
        candidates.add(join(source.path, "history.jsonl"));
      }

      const items: ImporterDiscoveredItem[] = [];
      for (const file of Array.from(candidates).sort((left, right) => left.localeCompare(right))) {
        const raw = await readFile(file, "utf8").catch(() => "");
        if (!raw.trim()) {
          continue;
        }
        const parsed = parseClaudeTranscriptFile(file, raw);
        if (!parsed.ok) {
          items.push(asFailedItem(parsed.failure.sourceRef, parsed.failure.message));
          continue;
        }
        items.push({
          ...parsed.item,
          contentHash: makeImportedContentHash(parsed.item.payload),
        });
      }
      return items;
    },
  };
}

function createCodexLocalImporter(): Importer {
  return {
    type: "codex-local",
    async discover(source) {
      const candidates = new Set<string>();
      const sessionIndex = await readSessionIndex(source.path);

      if (await exists(join(source.path, "sessions"))) {
        for (const file of await gatherJsonlFiles(join(source.path, "sessions"))) {
          candidates.add(file);
        }
      }

      if (await exists(join(source.path, "archived_sessions"))) {
        for (const file of await gatherJsonlFiles(join(source.path, "archived_sessions"))) {
          candidates.add(file);
        }
      }

      if (source.path.endsWith(".jsonl") && (await exists(source.path))) {
        candidates.add(source.path);
      }

      const items: ImporterDiscoveredItem[] = [];
      for (const file of Array.from(candidates).sort((left, right) => left.localeCompare(right))) {
        const raw = await readFile(file, "utf8").catch(() => "");
        if (!raw.trim()) {
          continue;
        }
        const parsed = parseCodexSessionFile(file, raw, sessionIndex);
        if (!parsed.ok) {
          items.push(asFailedItem(parsed.failure.sourceRef, parsed.failure.message));
          continue;
        }
        items.push({
          ...parsed.item,
          contentHash: makeImportedContentHash(parsed.item.payload),
        });
      }
      return items;
    },
  };
}

const IMPORTERS: Record<string, Importer> = {
  "claude-local": createClaudeLocalImporter(),
  "codex-local": createCodexLocalImporter(),
};

export function getImporter(type: string): Importer {
  const importer = IMPORTERS[type];
  if (!importer) {
    throw new Error(`Unsupported import source type "${type}".`);
  }

  return importer;
}

export async function registerSource(options: ImportAddOptions): Promise<HistorySource> {
  const normalizedPath = resolveImportPath(options.cwd, options.path);
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
    lastSyncStatus: "never",
    lastSyncError: null,
    lastImportedCount: 0,
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
    throw new Error(errors.join(" "));
  }

  const parsed = result.parsed as { summary: string; signals: HistorySignalSet };
  const signals = asHistorySignals(parsed.signals);
  if (!signals) {
    throw new Error("Imported session signals were invalid.");
  }

  return {
    summary: parsed.summary,
    ...signals,
  };
}

function markSourceSyncResult(
  source: HistorySource,
  outcome: {
    importedCount: number;
    failures: ImporterItemFailure[];
  },
): HistorySource {
  const now = new Date().toISOString();
  return {
    ...source,
    updatedAt: now,
    lastSyncedAt: now,
    lastSyncStatus: outcome.failures.length > 0 ? "failed" : "passed",
    lastSyncError: outcome.failures.length > 0 ? outcome.failures[0].message : null,
    lastImportedCount: outcome.importedCount,
  };
}

export async function syncSources(options: ImportSyncOptions): Promise<ImporterSyncResult[]> {
  const sources = await readSources(options.cwd);
  if (sources.length === 0) {
    throw new Error("No import sources are registered. Run `agent-memory add ...` first.");
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
    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const failures: ImporterItemFailure[] = [];
    const newEvents: HistoryEvent[] = [];

    if (!(await exists(source.path))) {
      failures.push({
        sourceRef: source.path,
        message: `Import source path is no longer reachable: ${source.path}`,
      });
      failedCount += 1;
      const updatedSource = markSourceSyncResult(source, { importedCount, failures });
      await updateSource(options.cwd, updatedSource);
      results.push({ sourceId: source.id, importedCount, skippedCount, failedCount, failures });
      continue;
    }

    if (!isSupportedSourceType(source.type)) {
      failures.push({
        sourceRef: source.path,
        message: `Import source type is not supported: ${source.type}`,
      });
      failedCount += 1;
      const updatedSource = markSourceSyncResult(source, { importedCount, failures });
      await updateSource(options.cwd, updatedSource);
      results.push({ sourceId: source.id, importedCount, skippedCount, failedCount, failures });
      continue;
    }

    const importer = getImporter(source.type);
    let discovered: ImporterDiscoveredItem[] = [];
    try {
      discovered = await importer.discover(source);
    } catch (error) {
      failures.push({
        sourceRef: source.path,
        message: error instanceof Error ? error.message : String(error),
      });
      failedCount += 1;
      const updatedSource = markSourceSyncResult(source, { importedCount, failures });
      await updateSource(options.cwd, updatedSource);
      results.push({ sourceId: source.id, importedCount, skippedCount, failedCount, failures });
      continue;
    }

    for (const item of discovered) {
      if (item.failureMessage) {
        failures.push({
          sourceRef: item.sourceRef,
          message: item.failureMessage,
        });
        failedCount += 1;
        continue;
      }

      if (findImportedEventMatch(existingEvents, source.id, item) || findImportedEventMatch(newEvents, source.id, item)) {
        skippedCount += 1;
        continue;
      }

      try {
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
      } catch (error) {
        failures.push({
          sourceRef: item.sourceRef,
          message: error instanceof Error ? error.message : String(error),
        });
        failedCount += 1;
      }
    }

    await appendHistoryEvents(options.cwd, newEvents);
    const updatedSource = markSourceSyncResult(source, { importedCount, failures });
    await updateSource(options.cwd, updatedSource);
    existingEvents.push(...newEvents);

    results.push({
      sourceId: source.id,
      importedCount,
      skippedCount,
      failedCount,
      failures,
    });
  }

  return results;
}
