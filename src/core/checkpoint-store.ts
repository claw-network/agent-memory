import { nextCheckpointId, readLatestCheckpoint, writeCheckpoint } from "./history-store";
import type { AgentMemoryBundle, CheckpointState } from "../types";

export async function createCheckpoint(
  rootDir: string,
  bundle: AgentMemoryBundle,
  bundleHash: string,
  summary: string,
  eventId: string | null,
  createdAt = new Date().toISOString(),
  explicitId?: string,
): Promise<CheckpointState> {
  const checkpoint: CheckpointState = {
    id: explicitId ?? (await nextCheckpointId(rootDir)),
    createdAt,
    eventId,
    bundleHash,
    bundle,
    summary,
  };

  await writeCheckpoint(rootDir, checkpoint);
  return checkpoint;
}

export { readLatestCheckpoint };
