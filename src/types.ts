export type PrimaryEcosystem = "node" | "python" | "rust" | "go" | "generic";
export type GenerationMode = "init" | "update";
export type MemoryFileId = "readme" | "project-map" | "current-focus" | "gotchas" | "next-steps";
export type ManagedFileState = "missing" | "managed" | "unmanaged";
export type AuditStatus = "pass" | "fail" | "warn";

export interface WorkspaceModule {
  name: string;
  path: string;
  role: string;
}

export interface ValidationCommand {
  label: string;
  command: string[];
}

export interface ValidationResult {
  label: string;
  command: string;
  status: "passed" | "failed" | "skipped" | "unavailable";
  summary: string;
}

export interface ProjectScan {
  rootDir: string;
  generatedAt: string;
  projectName: string;
  projectSignals: string[];
  primaryEcosystem: PrimaryEcosystem;
  packageManager: string | null;
  workspaceManager: string | null;
  topLevelDirs: string[];
  topLevelFiles: string[];
  rootScripts: string[];
  workspaceModules: WorkspaceModule[];
  keyEntryFiles: string[];
  denseSourceDirs: string[];
  gotchas: string[];
  nextSteps: string[];
  validationCandidates: ValidationCommand[];
}

export interface MemoryFiles {
  readme: string;
  projectMap: string;
  currentFocus: string;
  gotchas: string;
  nextSteps: string;
  entrySnippet: string;
}

export interface MemoryTarget {
  fileId: MemoryFileId;
  path: string;
  content: string;
}

export interface PlannedChange {
  kind: "create" | "patch" | "backup" | "overwrite" | "skip";
  path: string;
  note: string;
}

export interface ManagedFileOwnership {
  state: ManagedFileState;
  expectedFileId: MemoryFileId;
  actualFileId: string | null;
  path: string;
  existingContent?: string;
}

export interface InitOptions {
  cwd: string;
  yes: boolean;
  validate: boolean;
}

export interface CurrentFocusMetadata {
  generatedAt: string;
  mode: GenerationMode;
  validatedAt: string | "none";
}

export interface AuditFinding {
  status: AuditStatus;
  code: string;
  message: string;
}
