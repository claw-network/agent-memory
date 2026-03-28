import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { readConfig } from "./config-store";
import {
  getCheckpointsDir,
  getEventsPath,
  listCheckpointIds,
  readCheckpoint,
  readHistoryEvents,
} from "./history-store";
import { getStatePath, readState, stableStringify } from "./state-store";
import type {
  AgentMemoryConfig,
  AgentMemoryState,
  ArchiveBatchManifest,
  AutomationPruneSnapshot,
  CheckpointState,
  HistoryEvent,
  StatusReport,
} from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ArchiveBatchSummary {
  batchId: string;
  path: string;
  manifest: ArchiveBatchManifest | null;
}

interface RetentionPlan {
  enabled: boolean;
  eligibleEvents: HistoryEvent[];
  eligibleCheckpoints: CheckpointState[];
  retainedEvents: HistoryEvent[];
  retainedCheckpointIds: string[];
  summary: StatusReport["retention"];
  config: AgentMemoryConfig["retention"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseEventOrdinal(eventId: string): number {
  const match = eventId.match(/^evt-(\d+)$/);
  return match ? Number(match[1]) : -1;
}

function timestampValue(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }

  return Date.parse(value);
}

function cutoffMs(maxAgeDays: number): number {
  return Date.now() - Math.max(maxAgeDays, 0) * DAY_MS;
}

function archiveBatchId(createdAt: string): string {
  return `prune-${createdAt.replace(/[^\dTZ]/g, "")}`;
}

function tempPath(path: string): string {
  return `${path}.tmp-${process.pid}-${Date.now()}`;
}

function batchDir(rootDir: string, batchId: string): string {
  return join(getArchiveDir(rootDir), batchId);
}

export function getArchiveDir(rootDir: string): string {
  return join(rootDir, ".agent-memory", "archive");
}

export function getArchiveManifestPath(rootDir: string, batchId: string): string {
  return join(batchDir(rootDir, batchId), "manifest.json");
}

function retainedCheckpointIds(checkpoints: CheckpointState[], keepRecent: number, latestCheckpointId: string | null): string[] {
  const orderedIds = checkpoints
    .map((checkpoint) => checkpoint.id)
    .sort((left, right) => left.localeCompare(right));
  const keepRecentIds = new Set(orderedIds.slice(-Math.max(keepRecent, 0)));
  if (latestCheckpointId) {
    keepRecentIds.add(latestCheckpointId);
  }

  return Array.from(keepRecentIds);
}

function validatePositiveNumber(value: unknown, path: string, errors: string[]): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${path} must be a number.`);
    return null;
  }

  if (value < 0) {
    errors.push(`${path} must be >= 0.`);
    return null;
  }

  return value;
}

export function validateArchiveBatchManifestShape(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["archive manifest must be an object."];
  }

  if (typeof value.createdAt !== "string" || value.createdAt.trim().length === 0) {
    errors.push("archiveManifest.createdAt must be a non-empty string.");
  }

  for (const key of ["archivedEventIds", "archivedCheckpointIds"] as const) {
    const field = value[key];
    if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      errors.push(`archiveManifest.${key} must be an array of non-empty strings.`);
    }
  }

  validatePositiveNumber(value.historyMaxAgeDays, "archiveManifest.historyMaxAgeDays", errors);
  validatePositiveNumber(value.checkpointMaxAgeDays, "archiveManifest.checkpointMaxAgeDays", errors);
  validatePositiveNumber(value.keepRecent, "archiveManifest.keepRecent", errors);
  validatePositiveNumber(value.expireAfterDays, "archiveManifest.expireAfterDays", errors);

  return errors;
}

async function readArchiveManifest(path: string): Promise<ArchiveBatchManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const errors = validateArchiveBatchManifestShape(parsed);
    if (errors.length > 0) {
      return null;
    }
    return parsed as ArchiveBatchManifest;
  } catch {
    return null;
  }
}

async function readAllCheckpoints(rootDir: string): Promise<CheckpointState[]> {
  const checkpointIds = await listCheckpointIds(rootDir);
  const checkpoints = await Promise.all(checkpointIds.map((checkpointId) => readCheckpoint(rootDir, checkpointId)));
  return checkpoints.filter((checkpoint): checkpoint is CheckpointState => checkpoint !== null);
}

async function readArchiveBatches(rootDir: string): Promise<ArchiveBatchSummary[]> {
  const archiveDir = getArchiveDir(rootDir);
  if (!(await exists(archiveDir))) {
    return [];
  }

  const entries = await readdir(archiveDir, { withFileTypes: true });
  const batchIds = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("prune-"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const batches: ArchiveBatchSummary[] = [];
  for (const batchId of batchIds) {
    const manifestPath = getArchiveManifestPath(rootDir, batchId);
    batches.push({
      batchId,
      path: join(".agent-memory", "archive", batchId),
      manifest: await readArchiveManifest(manifestPath),
    });
  }

  return batches;
}

function buildRetentionSummary(enabled: boolean, plan: {
  eligibleEvents: HistoryEvent[];
  eligibleCheckpoints: CheckpointState[];
}, batches: ArchiveBatchSummary[]): StatusReport["retention"] {
  const oldestArchiveCreatedAt = batches
    .map((batch) => batch.manifest?.createdAt ?? null)
    .filter((value): value is string => value !== null)
    .sort((left, right) => left.localeCompare(right))[0] ?? null;

  return {
    enabled,
    pruneCandidateEventCount: plan.eligibleEvents.length,
    pruneCandidateCheckpointCount: plan.eligibleCheckpoints.length,
    archiveBatchCount: batches.length,
    oldestArchiveCreatedAt,
  };
}

function createArchiveManifest(
  createdAt: string,
  retention: AgentMemoryConfig["retention"],
  events: HistoryEvent[],
  checkpoints: CheckpointState[],
): ArchiveBatchManifest {
  return {
    createdAt,
    archivedEventIds: events.map((event) => event.id),
    archivedCheckpointIds: checkpoints.map((checkpoint) => checkpoint.id),
    historyMaxAgeDays: retention.history.maxAgeDays,
    checkpointMaxAgeDays: retention.checkpoints.maxAgeDays,
    keepRecent: retention.checkpoints.keepRecent,
    expireAfterDays: retention.archive.expireAfterDays,
  };
}

async function writeArchiveBatch(
  rootDir: string,
  createdAt: string,
  retention: AgentMemoryConfig["retention"],
  events: HistoryEvent[],
  checkpoints: CheckpointState[],
): Promise<string> {
  const batchId = archiveBatchId(createdAt);
  const archivePath = batchDir(rootDir, batchId);
  const checkpointsPath = join(archivePath, "checkpoints");
  const eventsPath = join(archivePath, "events.jsonl");
  const manifestPath = join(archivePath, "manifest.json");

  await mkdir(checkpointsPath, { recursive: true });
  await writeFile(
    eventsPath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}${events.length > 0 ? "\n" : ""}`,
    "utf8",
  );

  for (const checkpoint of checkpoints) {
    await writeFile(join(checkpointsPath, `${checkpoint.id}.json`), `${stableStringify(checkpoint)}\n`, "utf8");
  }

  const manifest = createArchiveManifest(createdAt, retention, events, checkpoints);
  await writeFile(manifestPath, `${stableStringify(manifest)}\n`, "utf8");
  return join(".agent-memory", "archive", batchId);
}

async function stageRetainedEvents(rootDir: string, events: HistoryEvent[]): Promise<string> {
  const stagedPath = tempPath(getEventsPath(rootDir));
  await mkdir(dirname(stagedPath), { recursive: true });
  await writeFile(
    stagedPath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}${events.length > 0 ? "\n" : ""}`,
    "utf8",
  );
  return stagedPath;
}

async function stageRetainedCheckpoints(rootDir: string, checkpointIds: string[]): Promise<string> {
  const activeDir = getCheckpointsDir(rootDir);
  const stagedDir = tempPath(activeDir);
  await mkdir(stagedDir, { recursive: true });

  for (const checkpointId of checkpointIds) {
    const checkpoint = await readCheckpoint(rootDir, checkpointId);
    if (!checkpoint) {
      throw new Error(`Retention staging could not find checkpoint ${checkpointId}.`);
    }
    await writeFile(join(stagedDir, `${checkpoint.id}.json`), `${stableStringify(checkpoint)}\n`, "utf8");
  }

  return stagedDir;
}

async function stageUpdatedState(rootDir: string, state: AgentMemoryState, retainedEventCount: number): Promise<string> {
  const stagedPath = tempPath(getStatePath(rootDir));
  const updatedState: AgentMemoryState = {
    ...state,
    maintenance: {
      ...state.maintenance,
      historyEventCount: retainedEventCount,
    },
  };
  await mkdir(dirname(stagedPath), { recursive: true });
  await writeFile(stagedPath, `${stableStringify(updatedState)}\n`, "utf8");
  return stagedPath;
}

async function rollbackPath(backupPath: string, targetPath: string): Promise<void> {
  if (await exists(backupPath)) {
    if (await exists(targetPath)) {
      await rm(targetPath, { recursive: true, force: true });
    }
    await rename(backupPath, targetPath);
  }
}

async function replaceActiveStores(input: {
  rootDir: string;
  stagedEventsPath: string;
  stagedCheckpointsPath: string;
  stagedStatePath: string;
}): Promise<void> {
  const eventsPath = getEventsPath(input.rootDir);
  const checkpointsPath = getCheckpointsDir(input.rootDir);
  const statePath = getStatePath(input.rootDir);
  const eventsBackup = tempPath(`${eventsPath}.bak`);
  const checkpointsBackup = tempPath(`${checkpointsPath}.bak`);
  const stateBackup = tempPath(`${statePath}.bak`);

  try {
    if (await exists(eventsPath)) {
      await rename(eventsPath, eventsBackup);
    }
    await rename(input.stagedEventsPath, eventsPath);

    if (await exists(checkpointsPath)) {
      await rename(checkpointsPath, checkpointsBackup);
    }
    await rename(input.stagedCheckpointsPath, checkpointsPath);

    if (await exists(statePath)) {
      await rename(statePath, stateBackup);
    }
    await rename(input.stagedStatePath, statePath);

    await rm(eventsBackup, { force: true });
    await rm(checkpointsBackup, { recursive: true, force: true });
    await rm(stateBackup, { force: true });
  } catch (error) {
    await rm(input.stagedEventsPath, { force: true }).catch(() => undefined);
    await rm(input.stagedCheckpointsPath, { recursive: true, force: true }).catch(() => undefined);
    await rm(input.stagedStatePath, { force: true }).catch(() => undefined);
    await rollbackPath(eventsBackup, eventsPath).catch(() => undefined);
    await rollbackPath(checkpointsBackup, checkpointsPath).catch(() => undefined);
    await rollbackPath(stateBackup, statePath).catch(() => undefined);
    throw error;
  }
}

async function expireArchiveBatches(
  rootDir: string,
  expireAfterDays: number,
  excludeBatchIds: string[] = [],
): Promise<{ expiredArchiveBatchCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  let expiredArchiveBatchCount = 0;
  const archiveBatches = await readArchiveBatches(rootDir);
  const cutoff = cutoffMs(expireAfterDays);
  const excluded = new Set(excludeBatchIds);

  for (const batch of archiveBatches) {
    if (excluded.has(batch.batchId)) {
      continue;
    }

    if (!batch.manifest) {
      warnings.push(`Archive batch ${batch.batchId} is unreadable and was not expired.`);
      continue;
    }

    const createdAt = timestampValue(batch.manifest.createdAt);
    if (Number.isNaN(createdAt) || createdAt > cutoff) {
      continue;
    }

    await rm(join(getArchiveDir(rootDir), batch.batchId), { recursive: true, force: true });
    expiredArchiveBatchCount += 1;
  }

  return {
    expiredArchiveBatchCount,
    warnings,
  };
}

export async function buildRetentionPlan(rootDir: string, input?: {
  state?: AgentMemoryState;
  config?: AgentMemoryConfig;
  events?: HistoryEvent[];
  checkpoints?: CheckpointState[];
}): Promise<RetentionPlan> {
  const state = input?.state ?? await readState(rootDir);
  const config = input?.config ?? await readConfig(rootDir);
  const events = input?.events ?? await readHistoryEvents(rootDir);
  const checkpoints = input?.checkpoints ?? await readAllCheckpoints(rootDir);
  const archiveBatches = await readArchiveBatches(rootDir).catch(() => []);

  if (!config.retention.enabled) {
    return {
      enabled: false,
      eligibleEvents: [],
      eligibleCheckpoints: [],
      retainedEvents: events,
      retainedCheckpointIds: checkpoints.map((checkpoint) => checkpoint.id),
      summary: buildRetentionSummary(false, { eligibleEvents: [], eligibleCheckpoints: [] }, archiveBatches),
      config: config.retention,
    };
  }

  const historyCutoff = cutoffMs(config.retention.history.maxAgeDays);
  const checkpointCutoff = cutoffMs(config.retention.checkpoints.maxAgeDays);
  const lastRecalledOrdinal = parseEventOrdinal(state.maintenance.lastRecalledEventId ?? "evt-000000");
  const keepCheckpointIds = new Set(
    retainedCheckpointIds(checkpoints, config.retention.checkpoints.keepRecent, state.maintenance.latestCheckpointId),
  );

  const eligibleEvents = events.filter((event) => {
    const createdAt = timestampValue(event.createdAt);
    return (
      !Number.isNaN(createdAt) &&
      createdAt <= historyCutoff &&
      parseEventOrdinal(event.id) <= lastRecalledOrdinal
    );
  });
  const eligibleEventIds = new Set(eligibleEvents.map((event) => event.id));
  const retainedEvents = events.filter((event) => !eligibleEventIds.has(event.id));

  const eligibleCheckpoints = checkpoints.filter((checkpoint) => {
    const createdAt = timestampValue(checkpoint.createdAt);
    return (
      checkpoint.id !== state.maintenance.latestCheckpointId &&
      !keepCheckpointIds.has(checkpoint.id) &&
      !Number.isNaN(createdAt) &&
      createdAt <= checkpointCutoff
    );
  });
  const eligibleCheckpointIds = new Set(eligibleCheckpoints.map((checkpoint) => checkpoint.id));
  const retainedCheckpointIdsValue = checkpoints
    .map((checkpoint) => checkpoint.id)
    .filter((checkpointId) => !eligibleCheckpointIds.has(checkpointId))
    .sort((left, right) => left.localeCompare(right));

  return {
    enabled: true,
    eligibleEvents,
    eligibleCheckpoints,
    retainedEvents,
    retainedCheckpointIds: retainedCheckpointIdsValue,
    summary: buildRetentionSummary(true, { eligibleEvents, eligibleCheckpoints }, archiveBatches),
    config: config.retention,
  };
}

export async function readRetentionSummary(rootDir: string, input?: {
  state?: AgentMemoryState;
  config?: AgentMemoryConfig;
  events?: HistoryEvent[];
  checkpoints?: CheckpointState[];
}): Promise<StatusReport["retention"]> {
  return (await buildRetentionPlan(rootDir, input)).summary;
}

export async function runRetentionCycle(rootDir: string, input?: {
  state?: AgentMemoryState;
  config?: AgentMemoryConfig;
  events?: HistoryEvent[];
  checkpoints?: CheckpointState[];
}): Promise<{ prune: AutomationPruneSnapshot; warnings: string[] }> {
  const warnings: string[] = [];
  const plan = await buildRetentionPlan(rootDir, input);

  if (!plan.enabled) {
    return {
      prune: {
        attempted: false,
        archivedEventCount: 0,
        archivedCheckpointCount: 0,
        expiredArchiveBatchCount: 0,
        archiveBatchPath: null,
        skippedReason: "Retention is disabled.",
      },
      warnings,
    };
  }

  const createdAt = new Date().toISOString();
  let archiveBatchPath: string | null = null;
  let archiveBatchIdValue: string | null = null;

  if (plan.eligibleEvents.length > 0 || plan.eligibleCheckpoints.length > 0) {
    archiveBatchIdValue = archiveBatchId(createdAt);
    archiveBatchPath = await writeArchiveBatch(
      rootDir,
      createdAt,
      plan.config,
      plan.eligibleEvents,
      plan.eligibleCheckpoints,
    );

    const state = input?.state ?? await readState(rootDir);
    const stagedEventsPath = await stageRetainedEvents(rootDir, plan.retainedEvents);
    const stagedCheckpointsPath = await stageRetainedCheckpoints(rootDir, plan.retainedCheckpointIds);
    const stagedStatePath = await stageUpdatedState(rootDir, state, plan.retainedEvents.length);
    await replaceActiveStores({
      rootDir,
      stagedEventsPath,
      stagedCheckpointsPath,
      stagedStatePath,
    });
  }

  const expiry = await expireArchiveBatches(
    rootDir,
    plan.config.archive.expireAfterDays,
    archiveBatchIdValue ? [archiveBatchIdValue] : [],
  );
  warnings.push(...expiry.warnings);

  const hadActiveWork = plan.eligibleEvents.length > 0 || plan.eligibleCheckpoints.length > 0;
  const hadExpiryWork = expiry.expiredArchiveBatchCount > 0;

  return {
    prune: {
      attempted: true,
      archivedEventCount: plan.eligibleEvents.length,
      archivedCheckpointCount: plan.eligibleCheckpoints.length,
      expiredArchiveBatchCount: expiry.expiredArchiveBatchCount,
      archiveBatchPath,
      skippedReason: hadActiveWork || hadExpiryWork ? null : "No prune candidates or expired archive batches were found.",
    },
    warnings,
  };
}

export async function listArchiveBatchSummaries(rootDir: string): Promise<Array<{
  batchId: string;
  path: string;
  manifest: ArchiveBatchManifest | null;
}>> {
  return await readArchiveBatches(rootDir);
}

export function relativeArchiveBatchPath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath) || basename(absolutePath);
}
