import { rm } from "node:fs/promises";
import { createCheckpoint } from "./checkpoint-store";
import { projectState } from "./bundle-projector";
import { appendHistoryEvents, ensureHistoryLayout, nextCheckpointId, nextEventId, readHistoryEvents, readSources, writeSources } from "./history-store";
import { cloneMaintenance, createToolRunEvent, summarizeRecallDiff } from "./history-event-builders";
import { applyEntrySnippet, writeProjectionFile } from "./merge-files";
import { buildState, createEmptyMaintenance, writeState } from "./state-store";
import type {
  AgentMemoryBundle,
  AgentMemoryState,
  MaintenanceMetadata,
  ProviderMetadata,
  RecallDiffSummary,
  ValidationResult,
} from "../types";

export async function resetAgentMemoryRoot(rootDir: string): Promise<void> {
  await rm(`${rootDir}/.agent-memory`, { recursive: true, force: true });
}

export async function bootstrapHistoryFiles(rootDir: string): Promise<void> {
  await ensureHistoryLayout(rootDir);
  await writeSources(rootDir, []);
}

export async function persistCanonicalState(input: {
  rootDir: string;
  bundle: AgentMemoryBundle;
  provider: ProviderMetadata;
  commandName: "init" | "update" | "recall";
  generatedAt?: string;
  maintenance?: MaintenanceMetadata;
  diffSummary?: RecallDiffSummary | null;
  validations?: ValidationResult[];
  reservedCheckpointId?: string | null;
  checkpointSummary?: string | null;
}): Promise<AgentMemoryState> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const existingEvents = await readHistoryEvents(input.rootDir);
  const sources = await readSources(input.rootDir);
  const checkpointId = input.reservedCheckpointId ?? (await nextCheckpointId(input.rootDir));
  const maintenance = cloneMaintenance(input.maintenance ?? createEmptyMaintenance());
  maintenance.latestCheckpointId = checkpointId;
  maintenance.historyEventCount = existingEvents.length + 1;
  maintenance.importSourceCount = sources.length;

  const state = buildState(input.bundle, input.provider, maintenance, generatedAt);
  const toolRunEvent = createToolRunEvent({
    eventId: await nextEventId(input.rootDir),
    commandName: input.commandName,
    state,
    diffSummary: input.diffSummary ?? null,
    validations: input.validations ?? [],
    createdAt: generatedAt,
  });

  const checkpoint = await createCheckpoint(
    input.rootDir,
    state.bundle,
    state.bundleHash,
    input.checkpointSummary ??
      (input.commandName === "recall" ? summarizeRecallDiff(input.diffSummary) : state.bundle.currentFocus.summary),
    toolRunEvent.id,
    generatedAt,
    checkpointId,
  );

  const finalState: AgentMemoryState = {
    ...state,
    maintenance: {
      ...state.maintenance,
      latestCheckpointId: checkpoint.id,
      historyEventCount: existingEvents.length + 1,
      importSourceCount: sources.length,
    },
  };

  const projection = projectState(input.rootDir, finalState);
  await writeState(input.rootDir, finalState);
  for (const file of projection.files) {
    await writeProjectionFile(file);
  }
  await applyEntrySnippet(projection.entryFile, projection.entrySnippet);
  await appendHistoryEvents(input.rootDir, [toolRunEvent]);

  return finalState;
}
