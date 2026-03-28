import { compareStateWithCheckpoint } from "./checkpoint-comparison";
import { readConfig } from "./config-store";
import { eventsAfterCursor, readHistoryEvents, readSources } from "./history-store";
import { summarizeUnrecalledHistory } from "./recall-evidence";
import { readRetentionSummary } from "./retention-orchestrator";
import { readState } from "./state-store";
import type { CheckpointState, StatusReport } from "../types";

function suggestedNextAction(input: {
  unrecalledAll: number;
  hasFailedSource: boolean;
  changedSections: string[];
  retentionCandidates: number;
}): string {
  if (input.hasFailedSource) {
    return "Run `agent-memory sync --all` to retry failed sources.";
  }
  if (input.unrecalledAll > 0) {
    return "Run `agent-memory recall` to consolidate unrecalled history.";
  }
  if (input.retentionCandidates > 0) {
    return "Run `agent-memory automate run-once` to archive aged history and checkpoints.";
  }
  if (input.changedSections.length > 0) {
    return "Run `agent-memory update` if the active bundle no longer reflects repository reality.";
  }
  return "No immediate action is required.";
}

export async function buildStatusReport(
  rootDir: string,
  checkpoint: CheckpointState | null,
  includeDiffs: boolean,
): Promise<StatusReport> {
  const state = await readState(rootDir);
  const events = await readHistoryEvents(rootDir);
  const sources = await readSources(rootDir);
  const config = await readConfig(rootDir);

  const comparison = await compareStateWithCheckpoint(rootDir, state, checkpoint, includeDiffs);
  const unrecalledAllEvents = eventsAfterCursor(events, state.maintenance.recallCursors.all.lastRecalledEventId);
  const unrecalledAll = unrecalledAllEvents.length;
  const unrecalledLocal = eventsAfterCursor(events.filter((event) => event.kind === "tool_run"), state.maintenance.recallCursors.local.lastRecalledEventId).length;
  const unrecalledImports = eventsAfterCursor(events.filter((event) => event.kind === "imported_session"), state.maintenance.recallCursors.imports.lastRecalledEventId).length;
  const hasFailedSource = sources.some((source) => source.lastSyncStatus === "failed");
  const unrecalledSummary = summarizeUnrecalledHistory(unrecalledAllEvents);
  const retention = await readRetentionSummary(rootDir, { state, config, events });

  return {
    state: {
      schemaVersion: state.schemaVersion,
      bundleHash: state.bundleHash,
      latestCheckpointId: state.maintenance.latestCheckpointId,
    },
    history: {
      totalEvents: events.length,
      unrecalledAll,
      unrecalledLocal,
      unrecalledImports,
    },
    sources: sources.map((source) => ({
      id: source.id,
      status: source.lastSyncStatus,
      lastSyncedAt: source.lastSyncedAt,
      lastImportedCount: source.lastImportedCount,
      lastSyncError: source.lastSyncError,
    })),
    checkpoint: comparison,
    unrecalledSummary,
    retention,
    suggestedNextAction:
      unrecalledAll > config.recall.backlogWarnThreshold
        ? "Run `agent-memory recall` because the backlog is above the configured threshold."
        : suggestedNextAction({
            unrecalledAll,
            hasFailedSource,
            changedSections: comparison?.changedSections ?? [],
            retentionCandidates: retention.pruneCandidateEventCount + retention.pruneCandidateCheckpointCount,
          }),
  };
}
