import type {
  HistoryEvent,
  HistorySignalSet,
  RecallEvidenceGroup,
  UnrecalledHistorySummary,
} from "../types";

interface CanonicalizedEvent {
  event: HistoryEvent;
  gotchaTopics: Set<string>;
  nextStepTopics: Set<string>;
  decisionTopics: Set<string>;
  validationTopics: Set<string>;
  pathKeys: Set<string>;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function richerString(...values: string[]): string {
  return values
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0] ?? "";
}

function uniqueRicherStrings(values: string[]): string[] {
  return uniqueRicherStringsBy(values, (value) => normalizeText(value));
}

function uniqueRicherStringsBy(values: string[], mapper: (value: string) => string): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const normalized = mapper(value);
    if (!normalized) {
      continue;
    }

    seen.set(normalized, richerString(seen.get(normalized) ?? "", value));
  }

  return Array.from(seen.values());
}

function extractTopic(value: string, prefixes: string[] = []): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  let withoutPrefix = trimmed;
  for (const prefix of prefixes) {
    if (withoutPrefix.toUpperCase().startsWith(prefix.toUpperCase())) {
      withoutPrefix = withoutPrefix.slice(prefix.length).trim();
      break;
    }
  }

  const topic = withoutPrefix.includes(":") ? withoutPrefix.slice(0, withoutPrefix.indexOf(":")).trim() : withoutPrefix;
  return normalizeText(topic || withoutPrefix);
}

function setFrom(values: string[], mapper: (value: string) => string): Set<string> {
  return new Set(
    values
      .map((value) => mapper(value))
      .filter((value) => value.length > 0),
  );
}

function sharesAny(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function eventIdValue(eventId: string): number {
  const match = eventId.match(/^evt-(\d+)$/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function compareEventIds(left: string, right: string): number {
  return eventIdValue(left) - eventIdValue(right) || left.localeCompare(right);
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function compareByCreatedAtThenEventId(left: HistoryEvent, right: HistoryEvent): number {
  const leftTime = timestampValue(left.createdAt);
  const rightTime = timestampValue(right.createdAt);
  const leftHasTime = !Number.isNaN(leftTime);
  const rightHasTime = !Number.isNaN(rightTime);

  if (leftHasTime && rightHasTime && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (leftHasTime !== rightHasTime) {
    return leftHasTime ? -1 : 1;
  }

  return compareEventIds(left.id, right.id);
}

function summarizeSignals(events: HistoryEvent[]): HistorySignalSet {
  return {
    decisions: uniqueRicherStrings(events.flatMap((event) => event.signals.decisions)),
    gotchas: uniqueRicherStringsBy(events.flatMap((event) => event.signals.gotchas), (value) => extractTopic(value)),
    nextStepHints: uniqueRicherStringsBy(
      events.flatMap((event) => event.signals.nextStepHints),
      (value) => extractTopic(value, ["NEXT:", "DONE:"]),
    ),
    keyPaths: uniqueRicherStrings(events.flatMap((event) => event.signals.keyPaths)),
    validationObservations: uniqueRicherStringsBy(
      events.flatMap((event) => event.signals.validationObservations),
      (value) => extractTopic(value),
    ),
  };
}

function canonicalizeEvent(event: HistoryEvent): CanonicalizedEvent {
  return {
    event,
    gotchaTopics: setFrom(event.signals.gotchas, (value) => extractTopic(value)),
    nextStepTopics: setFrom(event.signals.nextStepHints, (value) => extractTopic(value, ["NEXT:", "DONE:"])),
    decisionTopics: setFrom(event.signals.decisions, (value) => normalizeText(value)),
    validationTopics: setFrom(event.signals.validationObservations, (value) => normalizeText(value)),
    pathKeys: setFrom(event.signals.keyPaths, (value) => normalizeText(value)),
  };
}

function shouldMerge(left: CanonicalizedEvent, right: CanonicalizedEvent): boolean {
  if (sharesAny(left.gotchaTopics, right.gotchaTopics)) {
    return true;
  }

  if (sharesAny(left.nextStepTopics, right.nextStepTopics)) {
    return true;
  }

  if (!sharesAny(left.pathKeys, right.pathKeys)) {
    return false;
  }

  return (
    sharesAny(left.decisionTopics, right.decisionTopics) ||
    sharesAny(left.validationTopics, right.validationTopics)
  );
}

function sourceScopeLabel(events: HistoryEvent[]): RecallEvidenceGroup["sourceScopeLabel"] {
  const kinds = new Set(events.map((event) => event.kind));
  if (kinds.size > 1) {
    return "mixed";
  }

  return events[0]?.kind === "tool_run" ? "local" : "imports";
}

function representativeSummary(events: HistoryEvent[]): string {
  return events
    .map((event) => event.summary)
    .filter((summary) => summary.trim().length > 0)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0] ?? "No summary recorded.";
}

function buildGroup(events: HistoryEvent[]): Omit<RecallEvidenceGroup, "groupId"> {
  const sortedEvents = [...events].sort(compareByCreatedAtThenEventId);
  const signals = summarizeSignals(sortedEvents);

  return {
    sourceScopeLabel: sourceScopeLabel(sortedEvents),
    eventIds: sortedEvents.map((event) => event.id),
    sourceIds: Array.from(new Set(sortedEvents.map((event) => event.sourceId))).sort((left, right) => left.localeCompare(right)),
    createdAtFirst: sortedEvents[0]?.createdAt ?? new Date(0).toISOString(),
    createdAtLast: sortedEvents[sortedEvents.length - 1]?.createdAt ?? new Date(0).toISOString(),
    representativeSummary: representativeSummary(sortedEvents),
    signals,
  };
}

function compareGroups(left: Omit<RecallEvidenceGroup, "groupId">, right: Omit<RecallEvidenceGroup, "groupId">): number {
  const leftTime = timestampValue(left.createdAtLast);
  const rightTime = timestampValue(right.createdAtLast);
  const leftHasTime = !Number.isNaN(leftTime);
  const rightHasTime = !Number.isNaN(rightTime);

  if (leftHasTime && rightHasTime && leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  if (leftHasTime !== rightHasTime) {
    return leftHasTime ? -1 : 1;
  }

  return compareEventIds(left.eventIds[0] ?? "evt-999999", right.eventIds[0] ?? "evt-999999");
}

export function summarizeUnrecalledHistory(events: HistoryEvent[]): UnrecalledHistorySummary {
  if (events.length === 0) {
    return {
      rawEventCount: 0,
      groupedItemCount: 0,
      groups: [],
    };
  }

  const canonicalized = events.map(canonicalizeEvent);
  const visited = new Set<number>();
  const groups: Array<Omit<RecallEvidenceGroup, "groupId">> = [];

  for (let index = 0; index < canonicalized.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const stack = [index];
    const componentIndexes: number[] = [];
    visited.add(index);

    while (stack.length > 0) {
      const currentIndex = stack.pop();
      if (currentIndex === undefined) {
        continue;
      }

      componentIndexes.push(currentIndex);
      for (let candidateIndex = 0; candidateIndex < canonicalized.length; candidateIndex += 1) {
        if (visited.has(candidateIndex)) {
          continue;
        }

        if (!shouldMerge(canonicalized[currentIndex], canonicalized[candidateIndex])) {
          continue;
        }

        visited.add(candidateIndex);
        stack.push(candidateIndex);
      }
    }

    groups.push(buildGroup(componentIndexes.map((componentIndex) => canonicalized[componentIndex].event)));
  }

  const sortedGroups = groups.sort(compareGroups).map((group, index) => ({
    groupId: `grp-${String(index + 1).padStart(6, "0")}`,
    ...group,
  }));

  return {
    rawEventCount: events.length,
    groupedItemCount: sortedGroups.length,
    groups: sortedGroups,
  };
}
