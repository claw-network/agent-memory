import { readLatestCheckpoint } from "../core/history-store";
import { formatUnrecalledHistorySummary } from "../core/command-helpers";
import { buildStatusReport } from "../core/status-orchestrator";

export async function runStatus(options: {
  cwd: string;
  checkpointId: string | null;
  showDiff: boolean;
}): Promise<number> {
  const checkpoint = options.checkpointId ? await readLatestCheckpoint(options.cwd, options.checkpointId) : null;
  const report = await buildStatusReport(options.cwd, checkpoint, options.showDiff);

  console.log("State:");
  console.log(`- schemaVersion: ${report.state.schemaVersion}`);
  console.log(`- bundleHash: ${report.state.bundleHash}`);
  console.log(`- latestCheckpointId: ${report.state.latestCheckpointId ?? "none"}`);
  console.log("");
  console.log("History:");
  console.log(`- total events: ${report.history.totalEvents}`);
  console.log(`- unrecalled all: ${report.history.unrecalledAll}`);
  console.log(`- unrecalled local: ${report.history.unrecalledLocal}`);
  console.log(`- unrecalled imports: ${report.history.unrecalledImports}`);
  console.log("");
  console.log("Unrecalled Summary:");
  console.log(formatUnrecalledHistorySummary(report.unrecalledSummary));
  console.log("");
  console.log("Sources:");
  if (report.sources.length === 0) {
    console.log("- none");
  } else {
    for (const source of report.sources) {
      console.log(
        `- ${source.id}: status=${source.status} lastSyncedAt=${source.lastSyncedAt ?? "never"} imported=${source.lastImportedCount}`,
      );
      if (source.lastSyncError) {
        console.log(`  lastSyncError: ${source.lastSyncError}`);
      }
    }
  }

  console.log("");
  console.log("Checkpoint Drift:");
  if (!report.checkpoint) {
    console.log("- no checkpoint comparison available");
  } else {
    console.log(`- checkpoint: ${report.checkpoint.checkpointId ?? "none"}`);
    console.log(`- changed sections: ${report.checkpoint.changedSections.join(", ") || "none"}`);
    console.log(`- added gotchas: ${report.checkpoint.addedGotchas.join(", ") || "none"}`);
    console.log(`- removed gotchas: ${report.checkpoint.removedGotchas.join(", ") || "none"}`);
    console.log(`- added next steps: ${report.checkpoint.addedNextSteps.join(", ") || "none"}`);
    console.log(`- removed next steps: ${report.checkpoint.removedNextSteps.join(", ") || "none"}`);
    if (options.showDiff) {
      console.log("");
      console.log("File Diffs:");
      if (report.checkpoint.fileDiffs.length === 0) {
        console.log("- none");
      } else {
        for (const diff of report.checkpoint.fileDiffs) {
          console.log(diff.diff);
          console.log("");
        }
      }
    }
  }

  console.log("");
  console.log("Retention:");
  console.log(`- enabled: ${report.retention.enabled ? "yes" : "no"}`);
  console.log(`- prune candidate events: ${report.retention.pruneCandidateEventCount}`);
  console.log(`- prune candidate checkpoints: ${report.retention.pruneCandidateCheckpointCount}`);
  console.log(`- archive batches: ${report.retention.archiveBatchCount}`);
  console.log(`- oldest archive createdAt: ${report.retention.oldestArchiveCreatedAt ?? "none"}`);

  console.log("");
  console.log("Suggested Next Action:");
  console.log(report.suggestedNextAction);
  return 0;
}
