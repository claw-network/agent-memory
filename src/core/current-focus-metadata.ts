import type { CurrentFocusMetadata, GenerationMode } from "../types";

const CURRENT_FOCUS_METADATA_REGEX =
  /^<!-- agent-memory:current-focus generatedAt=([^ ]+) mode=(init|update) validatedAt=([^ ]+) -->\n?/;

export function buildCurrentFocusMetadata(
  generatedAt: string,
  mode: GenerationMode,
  validatedAt: string | "none",
): string {
  return `<!-- agent-memory:current-focus generatedAt=${generatedAt} mode=${mode} validatedAt=${validatedAt} -->`;
}

export function parseCurrentFocusMetadata(content: string): CurrentFocusMetadata | null {
  const match = content.match(CURRENT_FOCUS_METADATA_REGEX);
  if (!match) {
    return null;
  }

  return {
    generatedAt: match[1],
    mode: match[2] as GenerationMode,
    validatedAt: match[3] === "none" ? "none" : match[3],
  };
}

export function stripCurrentFocusMetadata(content: string): string {
  return content.replace(CURRENT_FOCUS_METADATA_REGEX, "");
}
