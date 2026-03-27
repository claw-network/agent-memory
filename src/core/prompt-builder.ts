import { stableStringify } from "./state-store";
import type {
  AgentMemoryState,
  CheckpointState,
  CollectedContext,
  HistorySource,
  ImporterDiscoveredItem,
  QueryScope,
  QueryShortlistItem,
  RecallSourceScope,
  ValidationResult,
} from "../types";

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

export function buildRecallPrompt(
  context: CollectedContext,
  currentState: AgentMemoryState,
  checkpoint: CheckpointState | null,
  unrecalledEvidence: unknown[],
  sourceScope: RecallSourceScope,
): string {
  return [
    "You are consolidating durable project memory for a software repository.",
    "Do not edit files. Return exactly one JSON object matching the provided bundle schema and nothing else.",
    "Your job is to consolidate the current bundle with new grouped history signals.",
    "You must merge duplicate gotchas, drop outdated or completed next steps, compress repetitive current-focus noise, and keep the project map stable unless the evidence strongly requires a change.",
    "Preserve the repository's core structural understanding. Avoid gratuitous rewrites.",
    "The unrecalled evidence is pre-grouped. Treat each item as one grouped history signal bundle, not as one raw event.",
    "",
    "BEGIN_CONTEXT_JSON",
    stableStringify(buildContextPayload(context)),
    "END_CONTEXT_JSON",
    "",
    "BEGIN_CURRENT_STATE_JSON",
    stableStringify(currentState),
    "END_CURRENT_STATE_JSON",
    "",
    "BEGIN_BASE_CHECKPOINT_JSON",
    stableStringify(checkpoint),
    "END_BASE_CHECKPOINT_JSON",
    "",
    "BEGIN_UNRECALLED_EVIDENCE_JSON",
    stableStringify(unrecalledEvidence),
    "END_UNRECALLED_EVIDENCE_JSON",
    "",
    "BEGIN_RECALL_SCOPE",
    sourceScope,
    "END_RECALL_SCOPE",
  ].join("\n");
}

export function buildQueryPrompt(
  question: string,
  scope: QueryScope,
  shortlist: QueryShortlistItem[],
): string {
  return [
    "You are answering a question from project memory.",
    "Use only the supplied shortlist evidence. Do not invent unsupported facts.",
    "Return exactly one JSON object matching the provided query-result schema and nothing else.",
    "Keep the answer concise and include only citations that support the answer.",
    "",
    "BEGIN_QUERY_SCOPE",
    scope,
    "END_QUERY_SCOPE",
    "",
    "BEGIN_QUERY_QUESTION",
    question,
    "END_QUERY_QUESTION",
    "",
    "BEGIN_QUERY_SHORTLIST_JSON",
    stableStringify(shortlist),
    "END_QUERY_SHORTLIST_JSON",
  ].join("\n");
}

export function buildImportNormalizationPrompt(source: HistorySource, item: ImporterDiscoveredItem): string {
  return [
    "You are normalizing an external coding-agent session into a durable history event for project memory.",
    "Return exactly one JSON object matching the provided schema and nothing else.",
    "Focus on durable signals only: decisions, gotchas, next-step hints, key paths, and validation observations.",
    "Do not restate the whole session. Summarize only what is likely to matter across future sessions.",
    "",
    "BEGIN_IMPORT_SOURCE_JSON",
    stableStringify(source),
    "END_IMPORT_SOURCE_JSON",
    "",
    "BEGIN_IMPORT_ITEM_JSON",
    stableStringify(item),
    "END_IMPORT_ITEM_JSON",
  ].join("\n");
}
