import type { MemoryFiles, ProjectScan, ValidationResult } from "../types";
import { renderEntrySnippet } from "../templates/entry-snippet";
import {
  renderCurrentFocus,
  renderGotchas,
  renderMemoryReadme,
  renderNextSteps,
  renderProjectMap,
} from "../templates/memory-files";

export function generateMemory(
  scan: ProjectScan,
  validations: ValidationResult[] = [],
): MemoryFiles {
  return {
    readme: `${renderMemoryReadme(scan)}\n`,
    projectMap: `${renderProjectMap(scan)}\n`,
    currentFocus: `${renderCurrentFocus(scan, validations)}\n`,
    gotchas: `${renderGotchas(scan)}\n`,
    nextSteps: renderNextSteps(scan, validations),
    entrySnippet: renderEntrySnippet(),
  };
}
