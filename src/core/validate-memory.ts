import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ENTRY_VERSION, PROJECTION_VERSION, RECALL_WARN_EVENT_COUNT, VALIDATION_MAX_AGE_DAYS } from "./constants";
import { parseEntryMarker, parseProjectionMarker, projectState } from "./bundle-projector";
import { validateConfigShape, validateHistoryEventShape, validateHistorySourceShape, validateStateShape } from "./bundle-schema";
import { getConfigPath, readConfig } from "./config-store";
import { isSupportedSourceType } from "./import-framework";
import { getCheckpointsDir, getEventsPath, getSourcesPath, listCheckpointIds, readHistoryEvents, readLatestCheckpoint, readSources } from "./history-store";
import { computeBundleHash, getStatePath } from "./state-store";
import type { AgentMemoryState, AuditFinding } from "../types";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isValidIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isValidationFresh(validatedAt: string): boolean {
  const validatedMs = Date.parse(validatedAt);
  if (Number.isNaN(validatedMs)) {
    return false;
  }

  const maxAgeMs = VALIDATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - validatedMs <= maxAgeMs;
}

function parseEventOrdinal(eventId: string): number {
  const match = eventId.match(/^evt-(\d+)$/);
  return match ? Number(match[1]) : -1;
}

function collectReferencedPaths(state: AgentMemoryState): string[] {
  return Array.from(
    new Set([
      state.bundle.project.recommendedEntryFile,
      ...state.bundle.project.keyPaths,
      ...state.bundle.projectMap.modules.map((module) => module.path),
      ...state.bundle.projectMap.entrypoints.map((entrypoint) => entrypoint.path),
      ...state.bundle.projectMap.denseSourceAreas.map((area) => area.path),
      ...state.bundle.projectMap.firstFilesToRead,
    ]),
  );
}

function estimateQueryCoverage(state: AgentMemoryState, historyEventCount: number, hasCheckpoint: boolean): number {
  let coverage = 0;
  coverage += 3; // project / projectMap / currentFocus
  coverage += Math.min(state.bundle.gotchas.length, 3);
  coverage += Math.min(state.bundle.nextSteps.length, 3);
  coverage += Math.min(historyEventCount, 3);
  if (hasCheckpoint) {
    coverage += 1;
  }
  return coverage;
}

export async function validateMemory(rootDir: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const statePath = getStatePath(rootDir);
  const configPath = getConfigPath(rootDir);
  let configuredBacklogThreshold = RECALL_WARN_EVENT_COUNT;

  if (!(await exists(statePath))) {
    findings.push({
      status: "fail",
      code: "state:missing",
      message: ".agent-memory/state.json is missing. Run `agent-memory init` to rebuild the canonical system.",
    });
    return findings;
  }

  const rawState = await readFile(statePath, "utf8");
  let parsedState: unknown;
  try {
    parsedState = JSON.parse(rawState) as unknown;
  } catch (error) {
    findings.push({
      status: "fail",
      code: "state:json",
      message: `state.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return findings;
  }

  const stateErrors = validateStateShape(parsedState);
  if (stateErrors.length > 0) {
    findings.push({
      status: "fail",
      code: "state:schema",
      message: `state.json failed schema validation: ${stateErrors.join(" ")}`,
    });
    return findings;
  }

  const state = parsedState as AgentMemoryState;
  findings.push({
    status: "pass",
    code: "state:schema",
    message: "state.json passed schema validation.",
  });

  if (computeBundleHash(state.bundle) !== state.bundleHash) {
    findings.push({
      status: "fail",
      code: "state:bundle-hash",
      message: "state.json bundleHash does not match the stored bundle content.",
    });
  } else {
    findings.push({
      status: "pass",
      code: "state:bundle-hash",
      message: "state.json bundleHash matches the stored bundle content.",
    });
  }

  if (!(await exists(configPath))) {
    findings.push({
      status: "fail",
      code: "config:missing",
      message: ".agent-memory/config.json is missing.",
    });
  } else {
    const rawConfig = await readFile(configPath, "utf8");
    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(rawConfig) as unknown;
    } catch (error) {
      findings.push({
        status: "fail",
        code: "config:json",
        message: `config.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      return findings;
    }

    const configErrors = validateConfigShape(parsedConfig);
    if (configErrors.length > 0) {
      findings.push({
        status: "fail",
        code: "config:schema",
        message: `config.json failed validation: ${configErrors.join(" ")}`,
      });
      return findings;
    }

    findings.push({
      status: "pass",
      code: "config:schema",
      message: "config.json is valid.",
    });

    try {
      configuredBacklogThreshold = (await readConfig(rootDir)).recall.backlogWarnThreshold;
    } catch {
      configuredBacklogThreshold = RECALL_WARN_EVENT_COUNT;
    }
  }

  const eventsPath = getEventsPath(rootDir);
  if (!(await exists(eventsPath))) {
    findings.push({
      status: "fail",
      code: "history:events-missing",
      message: ".agent-memory/history/events.jsonl is missing.",
    });
  } else {
    let events;
    try {
      events = await readHistoryEvents(rootDir);
    } catch (error) {
      findings.push({
        status: "fail",
        code: "history:events-read",
        message: `events.jsonl could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return findings;
    }
    let historyValid = true;
    let previousOrdinal = 0;
    for (const event of events) {
      const errors = validateHistoryEventShape(event);
      if (errors.length > 0) {
        findings.push({
          status: "fail",
          code: `history:event:${event.id}`,
          message: errors.join(" "),
        });
        historyValid = false;
        continue;
      }

      const ordinal = parseEventOrdinal(event.id);
      if (ordinal !== previousOrdinal + 1) {
        findings.push({
          status: "fail",
          code: "history:continuity",
          message: `Event ids are not continuous around ${event.id}.`,
        });
        historyValid = false;
        break;
      }
      previousOrdinal = ordinal;
    }

    if (historyValid) {
      findings.push({
        status: "pass",
        code: "history:events",
        message: "History events are readable and continuous.",
      });
    }

    if (state.maintenance.historyEventCount !== events.length) {
      findings.push({
        status: "fail",
        code: "history:event-count",
        message: `state.json expects ${state.maintenance.historyEventCount} history events, but ${events.length} were found.`,
      });
    } else {
      findings.push({
        status: "pass",
        code: "history:event-count",
        message: "state.json historyEventCount matches the event log.",
      });
    }

    const unrecalledEvents = events.filter((event) => parseEventOrdinal(event.id) > parseEventOrdinal(state.maintenance.lastRecalledEventId ?? "evt-000000"));
    if (unrecalledEvents.length > configuredBacklogThreshold) {
      findings.push({
        status: "warn",
        code: "recall:backlog",
        message: `${unrecalledEvents.length} unrecalled history events are waiting to be consolidated. Run \`agent-memory recall\`.`,
      });
    } else {
      findings.push({
        status: "pass",
        code: "recall:backlog",
        message: "Recall backlog is within the healthy threshold.",
      });
    }
  }

  const sourcesPath = getSourcesPath(rootDir);
  if (!(await exists(sourcesPath))) {
    findings.push({
      status: "fail",
      code: "sources:missing",
      message: ".agent-memory/sources.json is missing.",
    });
  } else {
    let sources;
    try {
      sources = await readSources(rootDir);
    } catch (error) {
      findings.push({
        status: "fail",
        code: "sources:read",
        message: `sources.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return findings;
    }
    const invalidSource = sources.find((source) => validateHistorySourceShape(source).length > 0);
    if (invalidSource) {
      findings.push({
        status: "fail",
        code: "sources:schema",
        message: `History source ${invalidSource.id} is invalid.`,
      });
    } else {
      findings.push({
        status: "pass",
        code: "sources:schema",
        message: "sources.json is valid.",
      });
    }

    if (state.maintenance.importSourceCount !== sources.length) {
      findings.push({
        status: "fail",
        code: "sources:count",
        message: `state.json expects ${state.maintenance.importSourceCount} import sources, but ${sources.length} were found.`,
      });
    } else {
      findings.push({
        status: "pass",
        code: "sources:count",
        message: "state.json importSourceCount matches the source registry.",
      });
    }

    for (const source of sources) {
      if (!isSupportedSourceType(source.type)) {
        findings.push({
          status: "fail",
          code: `sources:type:${source.id}`,
          message: `History source ${source.id} uses an unsupported type: ${source.type}`,
        });
      } else {
        findings.push({
          status: "pass",
          code: `sources:type:${source.id}`,
          message: `History source ${source.id} uses a supported type.`,
        });
      }

      if (!(await exists(source.path))) {
        findings.push({
          status: "fail",
          code: `sources:path:${source.id}`,
          message: `History source ${source.id} path is not reachable: ${source.path}`,
        });
      } else {
        findings.push({
          status: "pass",
          code: `sources:path:${source.id}`,
          message: `History source ${source.id} path is reachable.`,
        });
      }

      if (source.lastSyncStatus === "failed") {
        findings.push({
          status: "warn",
          code: `sources:sync:${source.id}`,
          message: `History source ${source.id} last sync failed${source.lastSyncError ? `: ${source.lastSyncError}` : "."} Imported state is still usable, but this source should be resynced.`,
        });
      } else {
        findings.push({
          status: "pass",
          code: `sources:sync:${source.id}`,
          message: `History source ${source.id} has no active sync failure.`,
        });
      }
    }
  }

  const checkpointsDir = getCheckpointsDir(rootDir);
  if (!(await exists(checkpointsDir))) {
    findings.push({
      status: "fail",
      code: "checkpoints:missing",
      message: ".agent-memory/history/checkpoints is missing.",
    });
  } else {
    const checkpointIds = await listCheckpointIds(rootDir);
    if (checkpointIds.length === 0) {
      findings.push({
        status: "fail",
        code: "checkpoints:empty",
        message: "No checkpoints were found.",
      });
    } else if (!state.maintenance.latestCheckpointId || !checkpointIds.includes(state.maintenance.latestCheckpointId)) {
      findings.push({
        status: "fail",
        code: "checkpoints:latest",
        message: "state.json latestCheckpointId does not reference an existing checkpoint.",
      });
    } else {
      const latestCheckpoint = await readLatestCheckpoint(rootDir, state.maintenance.latestCheckpointId);
      if (!latestCheckpoint) {
        findings.push({
          status: "fail",
          code: "checkpoints:read",
          message: "The latest checkpoint could not be read.",
        });
      } else if (latestCheckpoint.bundleHash !== state.bundleHash) {
        findings.push({
          status: "warn",
          code: "checkpoints:bundle-drift",
          message: "The latest checkpoint bundleHash differs from the current canonical state.",
        });
      } else {
        findings.push({
          status: "pass",
          code: "checkpoints:latest",
          message: "The latest checkpoint is present and aligned with the canonical state.",
        });
      }
    }

    const queryCoverage = estimateQueryCoverage(state, state.maintenance.historyEventCount, checkpointIds.length > 0);
    if (queryCoverage < 5) {
      findings.push({
        status: "warn",
        code: "query:coverage",
        message: "Query evidence coverage is still sparse. Import more history or run `agent-memory recall` before relying on query output.",
      });
    } else {
      findings.push({
        status: "pass",
        code: "query:coverage",
        message: "Query evidence coverage is healthy.",
      });
    }
  }

  const projection = projectState(rootDir, state);
  for (const file of projection.files) {
    if (!(await exists(file.path))) {
      findings.push({
        status: "fail",
        code: `projection:${file.fileId}`,
        message: `${file.path} is missing.`,
      });
      continue;
    }

    const content = await readFile(file.path, "utf8");
    const marker = parseProjectionMarker(content);
    if (!marker) {
      findings.push({
        status: "fail",
        code: `projection:${file.fileId}:marker`,
        message: `${file.path} is missing a valid projection marker.`,
      });
      continue;
    }

    if (marker.fileId !== file.fileId || marker.version !== PROJECTION_VERSION || marker.bundleHash !== state.bundleHash) {
      findings.push({
        status: "fail",
        code: `projection:${file.fileId}:drift`,
        message: `${file.path} projection marker does not match the canonical state.`,
      });
      continue;
    }

    findings.push({
      status: "pass",
      code: `projection:${file.fileId}`,
      message: `${file.path} matches the canonical projection marker.`,
    });
  }

  if (!(await exists(projection.entryFile))) {
    findings.push({
      status: "fail",
      code: "entry:file",
      message: `Entry file ${projection.entryFile} is missing.`,
    });
  } else {
    const entryContent = await readFile(projection.entryFile, "utf8");
    const marker = parseEntryMarker(entryContent);
    if (!marker) {
      findings.push({
        status: "fail",
        code: "entry:marker",
        message: `Entry file ${projection.entryFile} is missing the project memory block.`,
      });
    } else if (marker.version !== ENTRY_VERSION || marker.bundleHash !== state.bundleHash) {
      findings.push({
        status: "fail",
        code: "entry:drift",
        message: `Entry file ${projection.entryFile} does not match the canonical memory bundle.`,
      });
    } else {
      findings.push({
        status: "pass",
        code: "entry:file",
        message: `Entry file ${projection.entryFile} contains the current project memory block.`,
      });
    }
  }

  const missingPaths: string[] = [];
  for (const relativePath of collectReferencedPaths(state)) {
    if (!(await exists(join(rootDir, relativePath)))) {
      missingPaths.push(relativePath);
    }
  }

  if (missingPaths.length > 0) {
    findings.push({
      status: "fail",
      code: "bundle:paths",
      message: `The canonical bundle references missing paths: ${missingPaths.join(", ")}`,
    });
  } else {
    findings.push({
      status: "pass",
      code: "bundle:paths",
      message: "All referenced bundle paths currently exist.",
    });
  }

  const snapshot = state.bundle.currentFocus.validationSnapshot;
  if (snapshot.status === "not-run" || snapshot.validatedAt === null) {
    findings.push({
      status: "fail",
      code: "validation:baseline",
      message: "No validation baseline is recorded in the canonical state.",
    });
  } else if (!isValidIsoTimestamp(snapshot.validatedAt)) {
    findings.push({
      status: "fail",
      code: "validation:timestamp",
      message: "The recorded validation timestamp is not a valid ISO date.",
    });
  } else if (!isValidationFresh(snapshot.validatedAt)) {
    findings.push({
      status: "fail",
      code: "validation:freshness",
      message: `The validation baseline is older than ${VALIDATION_MAX_AGE_DAYS} days.`,
    });
  } else {
    findings.push({
      status: "pass",
      code: "validation:freshness",
      message: "The validation baseline is present and still fresh.",
    });
  }

  return findings;
}
