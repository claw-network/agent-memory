import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { computeContentHash, readStateIfPresent, stableStringify } from "./state-store";
import type {
  CheckpointState,
  HistoryEvent,
  HistorySource,
  ImporterDiscoveredItem,
  RecallSourceScope,
} from "../types";

const EVENT_ID_PREFIX = "evt";
const CHECKPOINT_ID_PREFIX = "chk";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseNumericId(value: string, prefix: string): number {
  const match = value.match(new RegExp(`^${prefix}-(\\d+)$`));
  return match ? Number(match[1]) : 0;
}

function formatNumericId(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(6, "0")}`;
}

function maxEventOrdinal(events: HistoryEvent[]): number {
  return events.reduce((max, event) => Math.max(max, parseNumericId(event.id, EVENT_ID_PREFIX)), 0);
}

async function eventOrdinalFloor(rootDir: string): Promise<number> {
  const state = await readStateIfPresent(rootDir).catch(() => null);
  return Math.max(0, parseNumericId(state?.maintenance.lastRecalledEventId ?? "", EVENT_ID_PREFIX));
}

export function getHistoryDir(rootDir: string): string {
  return join(rootDir, ".agent-memory", "history");
}

export function getEventsPath(rootDir: string): string {
  return join(getHistoryDir(rootDir), "events.jsonl");
}

export function getCheckpointsDir(rootDir: string): string {
  return join(getHistoryDir(rootDir), "checkpoints");
}

export function getSourcesPath(rootDir: string): string {
  return join(rootDir, ".agent-memory", "sources.json");
}

export async function ensureHistoryLayout(rootDir: string): Promise<void> {
  await mkdir(getCheckpointsDir(rootDir), { recursive: true });
}

export async function readHistoryEvents(rootDir: string): Promise<HistoryEvent[]> {
  const path = getEventsPath(rootDir);
  if (!(await exists(path))) {
    return [];
  }

  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HistoryEvent);
}

export async function appendHistoryEvents(rootDir: string, events: HistoryEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await ensureHistoryLayout(rootDir);
  const path = getEventsPath(rootDir);
  const existing = (await exists(path)) ? await readFile(path, "utf8") : "";
  const next = `${existing}${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  await writeFile(path, next, "utf8");
}

export async function writeHistoryEvents(rootDir: string, events: HistoryEvent[]): Promise<void> {
  await ensureHistoryLayout(rootDir);
  const path = getEventsPath(rootDir);
  const next = `${events.map((event) => JSON.stringify(event)).join("\n")}${events.length > 0 ? "\n" : ""}`;
  await writeFile(path, next, "utf8");
}

export async function readSources(rootDir: string): Promise<HistorySource[]> {
  const path = getSourcesPath(rootDir);
  if (!(await exists(path))) {
    return [];
  }

  return JSON.parse(await readFile(path, "utf8")) as HistorySource[];
}

export async function writeSources(rootDir: string, sources: HistorySource[]): Promise<void> {
  const path = getSourcesPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(sources)}\n`, "utf8");
}

export async function addSource(rootDir: string, source: HistorySource): Promise<void> {
  const sources = await readSources(rootDir);
  if (sources.some((item) => item.id === source.id)) {
    throw new Error(`A history source named "${source.id}" already exists.`);
  }

  sources.push(source);
  await writeSources(rootDir, sources);
}

export async function updateSource(rootDir: string, source: HistorySource): Promise<void> {
  const sources = await readSources(rootDir);
  const index = sources.findIndex((item) => item.id === source.id);
  if (index < 0) {
    throw new Error(`Unknown history source "${source.id}".`);
  }

  sources[index] = source;
  await writeSources(rootDir, sources);
}

export async function writeCheckpoint(rootDir: string, checkpoint: CheckpointState): Promise<void> {
  await ensureHistoryLayout(rootDir);
  const path = join(getCheckpointsDir(rootDir), `${checkpoint.id}.json`);
  await writeFile(path, `${stableStringify(checkpoint)}\n`, "utf8");
}

export async function readCheckpoint(rootDir: string, checkpointId: string): Promise<CheckpointState | null> {
  const path = join(getCheckpointsDir(rootDir), `${checkpointId}.json`);
  if (!(await exists(path))) {
    return null;
  }

  return JSON.parse(await readFile(path, "utf8")) as CheckpointState;
}

export async function readLatestCheckpoint(rootDir: string, checkpointId: string | null): Promise<CheckpointState | null> {
  if (!checkpointId) {
    return null;
  }

  return readCheckpoint(rootDir, checkpointId);
}

export async function listCheckpointIds(rootDir: string): Promise<string[]> {
  const dir = getCheckpointsDir(rootDir);
  if (!(await exists(dir))) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => basename(entry.name, ".json"))
    .sort((left, right) => left.localeCompare(right));
}

export async function readRecentCheckpoints(rootDir: string, limit: number): Promise<CheckpointState[]> {
  const checkpointIds = (await listCheckpointIds(rootDir)).slice(-Math.max(limit, 0)).reverse();
  const checkpoints = await Promise.all(checkpointIds.map((checkpointId) => readCheckpoint(rootDir, checkpointId)));
  return checkpoints.filter((checkpoint): checkpoint is CheckpointState => checkpoint !== null);
}

export async function nextEventId(rootDir: string): Promise<string> {
  const events = await readHistoryEvents(rootDir);
  const next = Math.max(maxEventOrdinal(events), await eventOrdinalFloor(rootDir)) + 1;
  return formatNumericId(EVENT_ID_PREFIX, next);
}

export function createEventIdAllocator(existingEvents: HistoryEvent[], floor = 0): () => string {
  let next = Math.max(maxEventOrdinal(existingEvents), floor) + 1;
  return () => {
    const id = formatNumericId(EVENT_ID_PREFIX, next);
    next += 1;
    return id;
  };
}

export async function nextCheckpointId(rootDir: string): Promise<string> {
  const checkpointIds = await listCheckpointIds(rootDir);
  const next = checkpointIds.reduce((max, id) => Math.max(max, parseNumericId(id, CHECKPOINT_ID_PREFIX)), 0) + 1;
  return formatNumericId(CHECKPOINT_ID_PREFIX, next);
}

export function filterEventsBySource(events: HistoryEvent[], scope: RecallSourceScope): HistoryEvent[] {
  switch (scope) {
    case "local":
      return events.filter((event) => event.kind === "tool_run");
    case "imports":
      return events.filter((event) => event.kind === "imported_session");
    case "all":
    default:
      return events;
  }
}

export function eventsAfterCursor(events: HistoryEvent[], cursorId: string | null): HistoryEvent[] {
  if (!cursorId) {
    return [...events];
  }

  const cursorValue = parseNumericId(cursorId, EVENT_ID_PREFIX);
  return events.filter((event) => parseNumericId(event.id, EVENT_ID_PREFIX) > cursorValue);
}

export function findImportedEventMatch(
  events: HistoryEvent[],
  sourceId: string,
  item: ImporterDiscoveredItem,
): HistoryEvent | null {
  return (
    events.find(
      (event) =>
        event.kind === "imported_session" &&
        event.sourceId === sourceId &&
        event.externalItemId === item.externalItemId &&
        event.contentHash === item.contentHash,
    ) ?? null
  );
}

export function makeImportedContentHash(payload: string): string {
  return computeContentHash({ payload });
}
