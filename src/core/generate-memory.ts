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
  return {
    readme: wrapManagedContent("readme", `${renderMemoryReadme(scan)}\n`),
    projectMap: wrapManagedContent("project-map", `${renderProjectMap(scan)}\n`),
    currentFocus: wrapManagedContent("current-focus", `${renderCurrentFocus(scan, validations, mode)}\n`),
    gotchas: wrapManagedContent("gotchas", `${renderGotchas(scan)}\n`),
    nextSteps: wrapManagedContent("next-steps", renderNextSteps(scan, validations, mode)),
    entrySnippet: renderEntrySnippet(),
  };
}
