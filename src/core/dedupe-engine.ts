import type {
  AgentGotcha,
  AgentMemoryBundle,
  AgentNextStep,
  DeduplicationResult,
} from "../types";

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length > 1));
}

function overlapRatio(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function richerString(...values: string[]): string {
  return values
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function dedupeGotchas(gotchas: AgentGotcha[]): { items: AgentGotcha[]; mergedTitles: string[] } {
  const mergedTitles: string[] = [];
  const result: AgentGotcha[] = [];

  for (const gotcha of gotchas) {
    const existing = result.find((candidate) => {
      const sameTitle = normalizeText(candidate.title) === normalizeText(gotcha.title);
      const similarTitle = overlapRatio(candidate.title, gotcha.title) >= 0.8;
      const similarCause =
        overlapRatio(candidate.cause, gotcha.cause) >= 0.8 ||
        overlapRatio(candidate.correctPath, gotcha.correctPath) >= 0.8;
      return sameTitle || (similarTitle && similarCause);
    });

    if (!existing) {
      result.push(gotcha);
      continue;
    }

    mergedTitles.push(gotcha.title);
    existing.title = richerString(existing.title, gotcha.title);
    existing.symptom = richerString(existing.symptom, gotcha.symptom);
    existing.cause = richerString(existing.cause, gotcha.cause);
    existing.correctPath = richerString(existing.correctPath, gotcha.correctPath);
  }

  return { items: result, mergedTitles };
}

function dedupeNextSteps(nextSteps: AgentNextStep[]): { items: AgentNextStep[]; mergedTitles: string[] } {
  const mergedTitles: string[] = [];
  const result: AgentNextStep[] = [];

  for (const step of nextSteps) {
    const existing = result.find((candidate) => {
      const similarTitle = overlapRatio(candidate.title, step.title) >= 0.8;
      const similarAction =
        overlapRatio(candidate.start, step.start) >= 0.8 ||
        overlapRatio(candidate.done, step.done) >= 0.8;
      return similarTitle && similarAction;
    });

    if (!existing) {
      result.push(step);
      continue;
    }

    mergedTitles.push(step.title);
    existing.title = richerString(existing.title, step.title);
    existing.why = richerString(existing.why, step.why);
    existing.start = richerString(existing.start, step.start);
    existing.done = richerString(existing.done, step.done);
  }

  return { items: result, mergedTitles };
}

function dedupeFlatStrings(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    const existing = seen.get(normalized);
    seen.set(normalized, richerString(existing ?? "", value));
  }

  return Array.from(seen.values());
}

function dedupeSimilarStrings(values: string[], threshold: number): string[] {
  const deduped = dedupeFlatStrings(values);
  const result: string[] = [];

  for (const value of deduped) {
    const existingIndex = result.findIndex((candidate) => {
      const normalizedCandidate = normalizeText(candidate);
      const normalizedValue = normalizeText(value);
      const sameText = normalizedCandidate === normalizedValue;
      const containedText =
        normalizedCandidate.includes(normalizedValue) || normalizedValue.includes(normalizedCandidate);
      const similarText = overlapRatio(candidate, value) >= threshold;
      return sameText || containedText || similarText;
    });

    if (existingIndex < 0) {
      result.push(value);
      continue;
    }

    result[existingIndex] = richerString(result[existingIndex], value);
  }

  return result;
}

export function dedupeBundle(bundle: AgentMemoryBundle): DeduplicationResult {
  const gotchas = dedupeGotchas(bundle.gotchas);
  const nextSteps = dedupeNextSteps(bundle.nextSteps);

  return {
    bundle: {
      ...bundle,
      gotchas: gotchas.items,
      nextSteps: nextSteps.items,
      currentFocus: {
        ...bundle.currentFocus,
        currentState: dedupeSimilarStrings(bundle.currentFocus.currentState, 0.8),
        knownRisks: dedupeSimilarStrings(bundle.currentFocus.knownRisks, 0.8),
        validationSnapshot: {
          ...bundle.currentFocus.validationSnapshot,
          suggestedNextActions: dedupeSimilarStrings(bundle.currentFocus.validationSnapshot.suggestedNextActions, 0.8),
        },
      },
    },
    mergedGotchas: gotchas.mergedTitles,
    mergedNextSteps: nextSteps.mergedTitles,
  };
}
