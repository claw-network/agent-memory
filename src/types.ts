export type PrimaryEcosystem = "node" | "python" | "rust" | "go" | "generic";
export type CommandMode = "init" | "update";
export type ProviderName = "codex" | "claude";
export type ProviderPreference = ProviderName | "auto";
export type ProjectionFileId = "readme" | "project-map" | "current-focus" | "gotchas" | "next-steps";
export type AuditStatus = "pass" | "fail" | "warn";
export type ValidationRunStatus = "passed" | "failed" | "unavailable";
export type ValidationSnapshotStatus = "not-run" | "passed" | "failed" | "mixed";

export interface WorkspaceModule {
  name: string;
  path: string;
  role: string;
}

export interface ValidationCommand {
  label: string;
  command: string[];
  purpose: string;
}

export interface ValidationResult {
  label: string;
  command: string;
  purpose: string;
  status: ValidationRunStatus;
  summary: string;
  exitCode: number | null;
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

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ProviderMetadata {
  name: ProviderName;
  binary: string;
  model: string | null;
  sessionId: string | null;
}

export interface BundleModule {
  name: string;
  path: string;
  responsibility: string;
}

export interface BundleEntrypoint {
  path: string;
  role: string;
}

export interface BundlePathNote {
  path: string;
  note: string;
}

export interface ValidationSnapshotResult {
  label: string;
  command: string;
  status: ValidationRunStatus;
  summary: string;
}

export interface AgentGotcha {
  title: string;
  symptom: string;
  cause: string;
  correctPath: string;
}

export interface AgentNextStep {
  title: string;
  why: string;
  start: string;
  done: string;
}

export interface AgentMemoryBundle {
  project: {
    name: string;
    summary: string;
    primaryEcosystem: string;
    packageManager: string;
    workspaceManager: string;
    recommendedEntryFile: string;
    keyPaths: string[];
  };
  projectMap: {
    modules: BundleModule[];
    entrypoints: BundleEntrypoint[];
    denseSourceAreas: BundlePathNote[];
    architectureNotes: string[];
    firstFilesToRead: string[];
  };
  currentFocus: {
    summary: string;
    currentState: string[];
    knownRisks: string[];
    validationSnapshot: {
      status: ValidationSnapshotStatus;
      validatedAt: string | null;
      summary: string;
      results: ValidationSnapshotResult[];
      suggestedNextActions: string[];
    };
  };
  gotchas: AgentGotcha[];
  nextSteps: AgentNextStep[];
  validationCommands: ValidationCommand[];
}

export interface AgentMemoryState {
  schemaVersion: number;
  generatorVersion: string;
  provider: ProviderMetadata;
  generatedAt: string;
  bundleHash: string;
  bundle: AgentMemoryBundle;
}

export interface CollectedContext {
  cwd: string;
  mode: CommandMode;
  scan: ProjectScan;
  entryFileCandidates: string[];
  selectedEntryFile: string;
  contextFiles: ContextFile[];
  previousState: AgentMemoryState | null;
}

export interface ProjectionFile {
  fileId: ProjectionFileId;
  path: string;
  content: string;
}

export interface ProjectedMemory {
  files: ProjectionFile[];
  entryFile: string;
  entrySnippet: string;
}

export interface ProviderInvocation {
  cwd: string;
  prompt: string;
  schema: Record<string, unknown>;
}

export interface ProviderInvocationResult {
  provider: ProviderMetadata;
  rawOutput: string;
  parsed: unknown;
}

export interface PlannedChange {
  kind: "create" | "overwrite" | "patch";
  path: string;
  note: string;
}

export interface CommandOptions {
  cwd: string;
  yes: boolean;
  validate: boolean;
  provider: ProviderPreference;
}

export interface AuditFinding {
  status: AuditStatus;
  code: string;
  message: string;
}
