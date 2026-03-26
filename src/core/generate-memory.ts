import { buildCurrentFocusMetadata } from "./current-focus-metadata";
import { wrapManagedContent } from "./file-ownership";
import type { GenerationMode, MemoryFiles, ProjectScan, ValidationResult } from "../types";
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
  mode: GenerationMode,
  validations: ValidationResult[] = [],
): MemoryFiles {
  const validatedAt = validations.length > 0 ? new Date().toISOString() : "none";
  const currentFocusBody = `${buildCurrentFocusMetadata(scan.generatedAt, mode, validatedAt)}\n${renderCurrentFocus(
    scan,
    validations,
    mode,
  )}\n`;

  return {
    readme: wrapManagedContent("readme", `${renderMemoryReadme(scan)}\n`),
    projectMap: wrapManagedContent("project-map", `${renderProjectMap(scan)}\n`),
    currentFocus: wrapManagedContent("current-focus", currentFocusBody),
    gotchas: wrapManagedContent("gotchas", `${renderGotchas(scan)}\n`),
    nextSteps: wrapManagedContent("next-steps", renderNextSteps(scan, validations, mode)),
    entrySnippet: renderEntrySnippet(),
  };
}
