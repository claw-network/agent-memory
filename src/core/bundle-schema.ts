import { STATE_SCHEMA_VERSION } from "./constants";
import type {
  AgentMemoryBundle,
  AgentMemoryState,
  HistoryEvent,
  HistorySignalSet,
  HistorySource,
  QueryResult,
  ValidationSnapshotStatus,
  ValidationRunStatus,
} from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  return value;
}

function expectString(value: unknown, path: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string.`);
    return null;
  }

  return value;
}

function expectNullableString(value: unknown, path: string, errors: string[]): string | null {
  if (value === null) {
    return null;
  }

  return expectString(value, path, errors);
}

function expectNumber(value: unknown, path: string, errors: string[]): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${path} must be a number.`);
    return null;
  }

  return value;
}

function expectStringArray(value: unknown, path: string, errors: string[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of strings.`);
    return null;
  }

  const strings: string[] = [];
  for (const [index, item] of value.entries()) {
    const stringValue = expectString(item, `${path}[${index}]`, errors);
    if (stringValue !== null) {
      strings.push(stringValue);
    }
  }

  return strings;
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[],
): T | null {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}.`);
    return null;
  }

  return value as T;
}

function validateValidationRunStatus(value: unknown, path: string, errors: string[]): ValidationRunStatus | null {
  return expectEnum(value, ["passed", "failed", "unavailable"] as const, path, errors);
}

function validateValidationSnapshotStatus(
  value: unknown,
  path: string,
  errors: string[],
): ValidationSnapshotStatus | null {
  return expectEnum(value, ["not-run", "passed", "failed", "mixed"] as const, path, errors);
}

function validateValidationCommand(value: unknown, path: string, errors: string[]): void {
  const record = expectRecord(value, path, errors);
  if (!record) {
    return;
  }

  expectString(record.label, `${path}.label`, errors);
  const command = expectStringArray(record.command, `${path}.command`, errors);
  if (command && command.length === 0) {
    errors.push(`${path}.command must contain at least one shell token.`);
  }
  expectString(record.purpose, `${path}.purpose`, errors);
}

function validateValidationResult(value: unknown, path: string, errors: string[]): void {
  const record = expectRecord(value, path, errors);
  if (!record) {
    return;
  }

  expectString(record.label, `${path}.label`, errors);
  expectString(record.command, `${path}.command`, errors);
  validateValidationRunStatus(record.status, `${path}.status`, errors);
  expectString(record.summary, `${path}.summary`, errors);
}

function validateBundleModule(value: unknown, path: string, errors: string[]): void {
  const record = expectRecord(value, path, errors);
  if (!record) {
    return;
  }

  expectString(record.name, `${path}.name`, errors);
  expectString(record.path, `${path}.path`, errors);
  expectString(record.responsibility, `${path}.responsibility`, errors);
}

function validateBundleEntrypoint(value: unknown, path: string, errors: string[]): void {
  const record = expectRecord(value, path, errors);
  if (!record) {
    return;
  }

  expectString(record.path, `${path}.path`, errors);
  expectString(record.role, `${path}.role`, errors);
}

function validateBundlePathNote(value: unknown, path: string, errors: string[]): void {
  const record = expectRecord(value, path, errors);
  if (!record) {
    return;
  }

  expectString(record.path, `${path}.path`, errors);
  expectString(record.note, `${path}.note`, errors);
}

function validateGotcha(value: unknown, path: string, errors: string[]): void {
  const record = expectRecord(value, path, errors);
  if (!record) {
    return;
  }

  expectString(record.title, `${path}.title`, errors);
  expectString(record.symptom, `${path}.symptom`, errors);
  expectString(record.cause, `${path}.cause`, errors);
  expectString(record.correctPath, `${path}.correctPath`, errors);
}

function validateNextStep(value: unknown, path: string, errors: string[]): void {
  const record = expectRecord(value, path, errors);
  if (!record) {
    return;
  }

  expectString(record.title, `${path}.title`, errors);
  expectString(record.why, `${path}.why`, errors);
  expectString(record.start, `${path}.start`, errors);
  expectString(record.done, `${path}.done`, errors);
}

export function validateHistorySignalsShape(value: unknown, path = "signals"): string[] {
  const errors: string[] = [];
  const record = expectRecord(value, path, errors);
  if (!record) {
    return errors;
  }

  expectStringArray(record.decisions, `${path}.decisions`, errors);
  expectStringArray(record.gotchas, `${path}.gotchas`, errors);
  expectStringArray(record.nextStepHints, `${path}.nextStepHints`, errors);
  expectStringArray(record.keyPaths, `${path}.keyPaths`, errors);
  expectStringArray(record.validationObservations, `${path}.validationObservations`, errors);
  return errors;
}

export function validateHistoryEventShape(value: unknown): string[] {
  const errors: string[] = [];
  const record = expectRecord(value, "event", errors);
  if (!record) {
    return errors;
  }

  expectString(record.id, "event.id", errors);
  expectEnum(record.kind, ["tool_run", "imported_session"] as const, "event.kind", errors);
  expectString(record.sourceId, "event.sourceId", errors);
  expectNullableString(record.externalItemId, "event.externalItemId", errors);
  expectString(record.createdAt, "event.createdAt", errors);
  expectString(record.contentHash, "event.contentHash", errors);
  expectString(record.summary, "event.summary", errors);
  expectString(record.sourceRef, "event.sourceRef", errors);
  errors.push(...validateHistorySignalsShape(record.signals, "event.signals"));
  return errors;
}

export function validateHistorySourceShape(value: unknown): string[] {
  const errors: string[] = [];
  const record = expectRecord(value, "source", errors);
  if (!record) {
    return errors;
  }

  expectString(record.id, "source.id", errors);
  expectString(record.type, "source.type", errors);
  expectString(record.path, "source.path", errors);
  expectString(record.createdAt, "source.createdAt", errors);
  expectString(record.updatedAt, "source.updatedAt", errors);
  expectNullableString(record.lastSyncedAt, "source.lastSyncedAt", errors);
  return errors;
}

export function validateBundleShape(value: unknown): string[] {
  const errors: string[] = [];
  const bundle = expectRecord(value, "bundle", errors);
  if (!bundle) {
    return errors;
  }

  const project = expectRecord(bundle.project, "bundle.project", errors);
  if (project) {
    expectString(project.name, "bundle.project.name", errors);
    expectString(project.summary, "bundle.project.summary", errors);
    expectString(project.primaryEcosystem, "bundle.project.primaryEcosystem", errors);
    expectString(project.packageManager, "bundle.project.packageManager", errors);
    expectString(project.workspaceManager, "bundle.project.workspaceManager", errors);
    expectString(project.recommendedEntryFile, "bundle.project.recommendedEntryFile", errors);
    expectStringArray(project.keyPaths, "bundle.project.keyPaths", errors);
  }

  const projectMap = expectRecord(bundle.projectMap, "bundle.projectMap", errors);
  if (projectMap) {
    if (!Array.isArray(projectMap.modules)) {
      errors.push("bundle.projectMap.modules must be an array.");
    } else {
      for (const [index, item] of projectMap.modules.entries()) {
        validateBundleModule(item, `bundle.projectMap.modules[${index}]`, errors);
      }
    }

    if (!Array.isArray(projectMap.entrypoints)) {
      errors.push("bundle.projectMap.entrypoints must be an array.");
    } else {
      for (const [index, item] of projectMap.entrypoints.entries()) {
        validateBundleEntrypoint(item, `bundle.projectMap.entrypoints[${index}]`, errors);
      }
    }

    if (!Array.isArray(projectMap.denseSourceAreas)) {
      errors.push("bundle.projectMap.denseSourceAreas must be an array.");
    } else {
      for (const [index, item] of projectMap.denseSourceAreas.entries()) {
        validateBundlePathNote(item, `bundle.projectMap.denseSourceAreas[${index}]`, errors);
      }
    }

    expectStringArray(projectMap.architectureNotes, "bundle.projectMap.architectureNotes", errors);
    expectStringArray(projectMap.firstFilesToRead, "bundle.projectMap.firstFilesToRead", errors);
  }

  const currentFocus = expectRecord(bundle.currentFocus, "bundle.currentFocus", errors);
  if (currentFocus) {
    expectString(currentFocus.summary, "bundle.currentFocus.summary", errors);
    expectStringArray(currentFocus.currentState, "bundle.currentFocus.currentState", errors);
    expectStringArray(currentFocus.knownRisks, "bundle.currentFocus.knownRisks", errors);

    const snapshot = expectRecord(currentFocus.validationSnapshot, "bundle.currentFocus.validationSnapshot", errors);
    if (snapshot) {
      validateValidationSnapshotStatus(snapshot.status, "bundle.currentFocus.validationSnapshot.status", errors);
      expectNullableString(snapshot.validatedAt, "bundle.currentFocus.validationSnapshot.validatedAt", errors);
      expectString(snapshot.summary, "bundle.currentFocus.validationSnapshot.summary", errors);
      expectStringArray(
        snapshot.suggestedNextActions,
        "bundle.currentFocus.validationSnapshot.suggestedNextActions",
        errors,
      );

      if (!Array.isArray(snapshot.results)) {
        errors.push("bundle.currentFocus.validationSnapshot.results must be an array.");
      } else {
        for (const [index, item] of snapshot.results.entries()) {
          validateValidationResult(item, `bundle.currentFocus.validationSnapshot.results[${index}]`, errors);
        }
      }
    }
  }

  if (!Array.isArray(bundle.gotchas)) {
    errors.push("bundle.gotchas must be an array.");
  } else {
    for (const [index, item] of bundle.gotchas.entries()) {
      validateGotcha(item, `bundle.gotchas[${index}]`, errors);
    }
  }

  if (!Array.isArray(bundle.nextSteps)) {
    errors.push("bundle.nextSteps must be an array.");
  } else {
    for (const [index, item] of bundle.nextSteps.entries()) {
      validateNextStep(item, `bundle.nextSteps[${index}]`, errors);
    }
  }

  if (!Array.isArray(bundle.validationCommands)) {
    errors.push("bundle.validationCommands must be an array.");
  } else {
    if (bundle.validationCommands.length > 2) {
      errors.push("bundle.validationCommands must contain at most two commands.");
    }
    for (const [index, item] of bundle.validationCommands.entries()) {
      validateValidationCommand(item, `bundle.validationCommands[${index}]`, errors);
    }
  }

  return errors;
}

export function validateQueryResultShape(value: unknown): string[] {
  const errors: string[] = [];
  const result = expectRecord(value, "query", errors);
  if (!result) {
    return errors;
  }

  expectString(result.answer, "query.answer", errors);
  expectString(result.why, "query.why", errors);

  if (!Array.isArray(result.citations)) {
    errors.push("query.citations must be an array.");
    return errors;
  }

  for (const [index, item] of result.citations.entries()) {
    const citation = expectRecord(item, `query.citations[${index}]`, errors);
    if (!citation) {
      continue;
    }

    expectEnum(citation.sourceType, ["bundle", "event", "checkpoint"] as const, `query.citations[${index}].sourceType`, errors);
    expectString(citation.sourceId, `query.citations[${index}].sourceId`, errors);
    expectString(citation.pathOrSection, `query.citations[${index}].pathOrSection`, errors);
    expectString(citation.summary, `query.citations[${index}].summary`, errors);
  }

  return errors;
}

export function validateImportedSessionShape(value: unknown): string[] {
  const errors: string[] = [];
  const normalized = expectRecord(value, "normalized", errors);
  if (!normalized) {
    return errors;
  }

  expectString(normalized.summary, "normalized.summary", errors);
  errors.push(...validateHistorySignalsShape(normalized.signals, "normalized.signals"));
  return errors;
}

export function validateStateShape(value: unknown): string[] {
  const errors: string[] = [];
  const state = expectRecord(value, "state", errors);
  if (!state) {
    return errors;
  }

  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    errors.push(`state.schemaVersion must equal ${STATE_SCHEMA_VERSION}.`);
  }

  expectString(state.generatorVersion, "state.generatorVersion", errors);
  expectString(state.generatedAt, "state.generatedAt", errors);
  expectString(state.bundleHash, "state.bundleHash", errors);

  const provider = expectRecord(state.provider, "state.provider", errors);
  if (provider) {
    expectEnum(provider.name, ["codex", "claude"] as const, "state.provider.name", errors);
    expectString(provider.binary, "state.provider.binary", errors);
    expectNullableString(provider.model, "state.provider.model", errors);
    expectNullableString(provider.sessionId, "state.provider.sessionId", errors);
  }

  errors.push(...validateBundleShape(state.bundle).map((message) => message.replace(/^bundle/, "state.bundle")));

  const maintenance = expectRecord(state.maintenance, "state.maintenance", errors);
  if (maintenance) {
    expectNullableString(maintenance.lastRecalledAt, "state.maintenance.lastRecalledAt", errors);
    expectNullableString(maintenance.lastRecalledEventId, "state.maintenance.lastRecalledEventId", errors);
    expectNullableString(maintenance.latestCheckpointId, "state.maintenance.latestCheckpointId", errors);
    expectNumber(maintenance.historyEventCount, "state.maintenance.historyEventCount", errors);
    expectNumber(maintenance.importSourceCount, "state.maintenance.importSourceCount", errors);

    const recallCursors = expectRecord(maintenance.recallCursors, "state.maintenance.recallCursors", errors);
    if (recallCursors) {
      for (const scope of ["all", "local", "imports"] as const) {
        const cursor = expectRecord(recallCursors[scope], `state.maintenance.recallCursors.${scope}`, errors);
        if (!cursor) {
          continue;
        }
        expectNullableString(cursor.lastRecalledAt, `state.maintenance.recallCursors.${scope}.lastRecalledAt`, errors);
        expectNullableString(
          cursor.lastRecalledEventId,
          `state.maintenance.recallCursors.${scope}.lastRecalledEventId`,
          errors,
        );
      }
    }
  }

  return errors;
}

export function asAgentMemoryBundle(value: unknown): AgentMemoryBundle | null {
  return validateBundleShape(value).length === 0 ? (value as AgentMemoryBundle) : null;
}

export function asAgentMemoryState(value: unknown): AgentMemoryState | null {
  return validateStateShape(value).length === 0 ? (value as AgentMemoryState) : null;
}

export function asQueryResult(value: unknown): QueryResult | null {
  return validateQueryResultShape(value).length === 0 ? (value as QueryResult) : null;
}

export function asHistorySignals(value: unknown): HistorySignalSet | null {
  return validateHistorySignalsShape(value).length === 0 ? (value as HistorySignalSet) : null;
}

export function asHistoryEvent(value: unknown): HistoryEvent | null {
  return validateHistoryEventShape(value).length === 0 ? (value as HistoryEvent) : null;
}

export function asHistorySource(value: unknown): HistorySource | null {
  return validateHistorySourceShape(value).length === 0 ? (value as HistorySource) : null;
}

export const bundleOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["project", "projectMap", "currentFocus", "gotchas", "nextSteps", "validationCommands"],
  properties: {
    project: {
      type: "object",
      additionalProperties: false,
      required: [
        "name",
        "summary",
        "primaryEcosystem",
        "packageManager",
        "workspaceManager",
        "recommendedEntryFile",
        "keyPaths",
      ],
      properties: {
        name: { type: "string" },
        summary: { type: "string" },
        primaryEcosystem: { type: "string" },
        packageManager: { type: "string" },
        workspaceManager: { type: "string" },
        recommendedEntryFile: { type: "string" },
        keyPaths: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    projectMap: {
      type: "object",
      additionalProperties: false,
      required: ["modules", "entrypoints", "denseSourceAreas", "architectureNotes", "firstFilesToRead"],
      properties: {
        modules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "path", "responsibility"],
            properties: {
              name: { type: "string" },
              path: { type: "string" },
              responsibility: { type: "string" },
            },
          },
        },
        entrypoints: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "role"],
            properties: {
              path: { type: "string" },
              role: { type: "string" },
            },
          },
        },
        denseSourceAreas: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "note"],
            properties: {
              path: { type: "string" },
              note: { type: "string" },
            },
          },
        },
        architectureNotes: {
          type: "array",
          items: { type: "string" },
        },
        firstFilesToRead: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    currentFocus: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "currentState", "knownRisks", "validationSnapshot"],
      properties: {
        summary: { type: "string" },
        currentState: { type: "array", items: { type: "string" } },
        knownRisks: { type: "array", items: { type: "string" } },
        validationSnapshot: {
          type: "object",
          additionalProperties: false,
          required: ["status", "validatedAt", "summary", "results", "suggestedNextActions"],
          properties: {
            status: {
              type: "string",
              enum: ["not-run", "passed", "failed", "mixed"],
            },
            validatedAt: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
            summary: { type: "string" },
            results: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "command", "status", "summary"],
                properties: {
                  label: { type: "string" },
                  command: { type: "string" },
                  status: { type: "string", enum: ["passed", "failed", "unavailable"] },
                  summary: { type: "string" },
                },
              },
            },
            suggestedNextActions: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    gotchas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "symptom", "cause", "correctPath"],
        properties: {
          title: { type: "string" },
          symptom: { type: "string" },
          cause: { type: "string" },
          correctPath: { type: "string" },
        },
      },
    },
    nextSteps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "start", "done"],
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          start: { type: "string" },
          done: { type: "string" },
        },
      },
    },
    validationCommands: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "command", "purpose"],
        properties: {
          label: { type: "string" },
          command: { type: "array", minItems: 1, items: { type: "string" } },
          purpose: { type: "string" },
        },
      },
    },
  },
};

export const queryOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "why", "citations"],
  properties: {
    answer: { type: "string" },
    why: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceType", "sourceId", "pathOrSection", "summary"],
        properties: {
          sourceType: { type: "string", enum: ["bundle", "event", "checkpoint"] },
          sourceId: { type: "string" },
          pathOrSection: { type: "string" },
          summary: { type: "string" },
        },
      },
    },
  },
};

export const importedSessionOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "signals"],
  properties: {
    summary: { type: "string" },
    signals: {
      type: "object",
      additionalProperties: false,
      required: ["decisions", "gotchas", "nextStepHints", "keyPaths", "validationObservations"],
      properties: {
        decisions: { type: "array", items: { type: "string" } },
        gotchas: { type: "array", items: { type: "string" } },
        nextStepHints: { type: "array", items: { type: "string" } },
        keyPaths: { type: "array", items: { type: "string" } },
        validationObservations: { type: "array", items: { type: "string" } },
      },
    },
  },
};
