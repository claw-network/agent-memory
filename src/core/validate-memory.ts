import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECTION_VERSION, ENTRY_VERSION, VALIDATION_MAX_AGE_DAYS } from "./constants";
import { parseEntryMarker, parseProjectionMarker, projectState } from "./bundle-projector";
import { validateStateShape } from "./bundle-schema";
import { computeBundleHash, getStatePath } from "./state-store";
import type { AuditFinding, AgentMemoryState } from "../types";

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

export async function validateMemory(rootDir: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const statePath = getStatePath(rootDir);

  if (!(await exists(statePath))) {
    findings.push({
      status: "fail",
      code: "state:missing",
      message: ".agent-memory/state.json is missing. Run `agent-memory init` first.",
    });
    return findings;
  }

  findings.push({
    status: "pass",
    code: "state:file",
    message: ".agent-memory/state.json exists.",
  });

  let rawState = "";
  try {
    rawState = await readFile(statePath, "utf8");
  } catch (error) {
    findings.push({
      status: "fail",
      code: "state:read",
      message: `Unable to read .agent-memory/state.json: ${error instanceof Error ? error.message : String(error)}`,
    });
    return findings;
  }

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

  const computedHash = computeBundleHash(state.bundle);
  if (computedHash !== state.bundleHash) {
    findings.push({
      status: "fail",
      code: "state:bundle-hash",
      message: "state.json bundleHash does not match the stored bundle content.",
    });
  } else {
    findings.push({
      status: "pass",
      code: "state:bundle-hash",
      message: "state.json bundleHash matches the bundle content.",
    });
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
