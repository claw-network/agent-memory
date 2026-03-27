import { computeContentHash } from "./state-store";
import type {
  AgentMemoryBundle,
  AgentMemoryState,
  HistoryEvent,
  HistorySignalSet,
  MaintenanceMetadata,
  RecallDiffSummary,
  RecallSourceScope,
  ValidationResult,
} from "../types";

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function buildSignalsFromBundle(bundle: AgentMemoryBundle, validations: ValidationResult[] = []): HistorySignalSet {
  return {
    decisions: uniqueStrings([
      ...bundle.projectMap.architectureNotes,
      ...bundle.projectMap.modules.map((module) => `${module.path}: ${module.responsibility}`),
    ]).slice(0, 12),
    gotchas: uniqueStrings(bundle.gotchas.map((gotcha) => `${gotcha.title}: ${gotcha.cause}`)).slice(0, 12),
    nextStepHints: uniqueStrings(bundle.nextSteps.map((step) => `${step.title}: ${step.start}`)).slice(0, 12),
    keyPaths: uniqueStrings([
      ...bundle.project.keyPaths,
      ...bundle.projectMap.entrypoints.map((entrypoint) => entrypoint.path),
      ...bundle.projectMap.firstFilesToRead,
    ]).slice(0, 16),
    validationObservations: uniqueStrings([
      bundle.currentFocus.validationSnapshot.summary,
      ...bundle.currentFocus.validationSnapshot.results.map((result) => `${result.command}: ${result.summary}`),
      ...validations.map((result) => `${result.command}: ${result.summary}`),
    ]).slice(0, 12),
  };
}

export function createToolRunEvent(input: {
  eventId: string;
  commandName: "init" | "update" | "recall";
  state: AgentMemoryState;
  diffSummary?: RecallDiffSummary | null;
  validations?: ValidationResult[];
  createdAt?: string;
}): HistoryEvent {
  const createdAt = input.createdAt ?? input.state.generatedAt;
  const summary =
    input.commandName === "recall"
      ? `Recalled project memory for ${input.state.bundle.project.name}.`
      : `${input.commandName} refreshed canonical memory for ${input.state.bundle.project.name}.`;

  return {
    id: input.eventId,
    kind: "tool_run",
    sourceId: "agent-memory.local",
    externalItemId: null,
    createdAt,
    contentHash: computeContentHash({
      commandName: input.commandName,
      bundleHash: input.state.bundleHash,
      diffSummary: input.diffSummary ?? null,
    }),
    summary,
    signals: buildSignalsFromBundle(input.state.bundle, input.validations ?? []),
    sourceRef: `agent-memory:${input.commandName}`,
  };
}

export function cloneMaintenance(maintenance: MaintenanceMetadata): MaintenanceMetadata {
  return {
    lastRecalledAt: maintenance.lastRecalledAt,
    lastRecalledEventId: maintenance.lastRecalledEventId,
    latestCheckpointId: maintenance.latestCheckpointId,
    historyEventCount: maintenance.historyEventCount,
    importSourceCount: maintenance.importSourceCount,
    recallCursors: {
      all: { ...maintenance.recallCursors.all },
      local: { ...maintenance.recallCursors.local },
      imports: { ...maintenance.recallCursors.imports },
    },
  };
}

export function updateRecallMaintenance(
  maintenance: MaintenanceMetadata,
  scope: RecallSourceScope,
  eventId: string | null,
  recalledAt: string,
): MaintenanceMetadata {
  const next = cloneMaintenance(maintenance);
  if (scope === "all") {
    next.lastRecalledAt = recalledAt;
    next.lastRecalledEventId = eventId;
    next.recallCursors.all = {
      lastRecalledAt: recalledAt,
      lastRecalledEventId: eventId,
    };
    return next;
  }

  next.recallCursors[scope] = {
    lastRecalledAt: recalledAt,
    lastRecalledEventId: eventId,
  };
  return next;
}
