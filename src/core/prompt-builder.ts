import { stableStringify } from "./state-store";
import type { CollectedContext, ValidationResult } from "../types";

function buildContextPayload(context: CollectedContext): Record<string, unknown> {
  return {
    mode: context.mode,
    cwd: context.cwd,
    selectedEntryFile: context.selectedEntryFile,
    entryFileCandidates: context.entryFileCandidates,
    staticScan: context.scan,
    contextFiles: context.contextFiles,
    previousBundle: context.previousState?.bundle ?? null,
  };
}

export function buildDiscoveryPrompt(context: CollectedContext): string {
  return [
    "You are generating durable project memory for a software repository.",
    "Explore the repository with read-only inspection only. Do not edit files, do not write patches, and do not invent details that are not grounded in the repo.",
    "Return exactly one JSON object matching the provided schema and nothing else.",
    "Use repository-relative paths everywhere.",
    "Keep summaries concrete and high-signal.",
    "Recommend at most two validation commands that are actually useful for this repo.",
    "",
    "BEGIN_CONTEXT_JSON",
    stableStringify(buildContextPayload(context)),
    "END_CONTEXT_JSON",
  ].join("\n");
}

export function buildFinalizePrompt(
  context: CollectedContext,
  discoveryBundle: unknown,
  discoveryErrors: string[],
  validationResults: ValidationResult[],
): string {
  return [
    "You are repairing and finalizing a repository memory bundle.",
    "Explore the repository again if needed, but do not edit files.",
    "Return exactly one JSON object matching the provided schema and nothing else.",
    "You must address any schema issues, missing details, and validation results from the previous pass.",
    "Use repository-relative paths everywhere.",
    "",
    "BEGIN_CONTEXT_JSON",
    stableStringify(buildContextPayload(context)),
    "END_CONTEXT_JSON",
    "",
    "BEGIN_DISCOVERY_BUNDLE_JSON",
    stableStringify(discoveryBundle),
    "END_DISCOVERY_BUNDLE_JSON",
    "",
    "BEGIN_DISCOVERY_ERRORS_JSON",
    stableStringify(discoveryErrors),
    "END_DISCOVERY_ERRORS_JSON",
    "",
    "BEGIN_VALIDATION_RESULTS_JSON",
    stableStringify(validationResults),
    "END_VALIDATION_RESULTS_JSON",
  ].join("\n");
}
