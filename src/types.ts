export type PrimaryEcosystem = "node" | "python" | "rust" | "go" | "generic";
export type CommandMode = "init" | "update" | "recall" | "query" | "import-sync";
export type ProviderName = "codex" | "claude";
export type ProviderPreference = ProviderName | "auto";
export type ProjectionFileId = "readme" | "project-map" | "current-focus" | "gotchas" | "next-steps";
export type AuditStatus = "pass" | "fail" | "warn";
export type ValidationRunStatus = "passed" | "failed" | "unavailable";
export type ValidationSnapshotStatus = "not-run" | "passed" | "failed" | "mixed";
export type HistoryEventKind = "tool_run" | "imported_session";
export type RecallSourceScope = "all" | "local" | "imports";
export type QueryScope = "state" | "history" | "all";
export type CitationSourceType = "bundle" | "event" | "checkpoint";
export type SourceSyncStatus = "never" | "passed" | "failed";

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

export interface RecallCursor {
  lastRecalledAt: string | null;
  lastRecalledEventId: string | null;
}

export interface MaintenanceMetadata {
  lastRecalledAt: string | null;
  lastRecalledEventId: string | null;
  latestCheckpointId: string | null;
  historyEventCount: number;
  importSourceCount: number;
  recallCursors: {
    all: RecallCursor;
    local: RecallCursor;
    imports: RecallCursor;
  };
}

export interface AgentMemoryState {
  schemaVersion: number;
  generatorVersion: string;
  provider: ProviderMetadata;
  generatedAt: string;
  bundleHash: string;
  bundle: AgentMemoryBundle;
  maintenance: MaintenanceMetadata;
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

export interface RecallOptions {
  cwd: string;
  yes: boolean;
  provider: ProviderPreference;
  source: RecallSourceScope;
}

export interface QueryOptions {
  cwd: string;
  provider: ProviderPreference;
  scope: QueryScope;
  question: string;
}

export interface ImportAddOptions {
  cwd: string;
  type: string;
  path: string;
  name: string | null;
}

export interface ImportSyncOptions {
  cwd: string;
  provider: ProviderPreference;
  target: string | null;
  all: boolean;
}

export interface HistorySignalSet {
  decisions: string[];
  gotchas: string[];
  nextStepHints: string[];
  keyPaths: string[];
  validationObservations: string[];
}

export interface HistoryEvent {
  id: string;
  kind: HistoryEventKind;
  sourceId: string;
  externalItemId: string | null;
  createdAt: string;
  contentHash: string;
  summary: string;
  signals: HistorySignalSet;
  sourceRef: string;
}

export interface HistorySource {
  id: string;
  type: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  lastSyncStatus: SourceSyncStatus;
  lastSyncError: string | null;
  lastImportedCount: number;
}

export interface CheckpointState {
  id: string;
  createdAt: string;
  eventId: string | null;
  bundleHash: string;
  bundle: AgentMemoryBundle;
  summary: string;
}

export interface ImporterDiscoveredItem {
  externalItemId: string;
  createdAt: string;
  sourceRef: string;
  contentHash: string;
  payload: string;
  failureMessage?: string;
}

export interface Importer {
  type: string;
  discover(source: HistorySource): Promise<ImporterDiscoveredItem[]>;
}

export interface ImporterItemFailure {
  sourceRef: string;
  message: string;
}

export interface ImporterSyncResult {
  sourceId: string;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: ImporterItemFailure[];
}

export interface FileDiff {
  path: string;
  diff: string;
}

export interface RecallDiffSummary {
  changedSections: string[];
  addedGotchas: string[];
  removedGotchas: string[];
  addedNextSteps: string[];
  removedNextSteps: string[];
  currentFocusChanged: boolean;
  validationChanged: boolean;
}

export interface RecallCandidate {
  state: AgentMemoryState;
  summary: RecallDiffSummary;
  fileDiffs: FileDiff[];
  noopReason: string | null;
}

export interface Citation {
  sourceType: CitationSourceType;
  sourceId: string;
  pathOrSection: string;
  summary: string;
}

export interface QueryResult {
  answer: string;
  why: string;
  citations: Citation[];
}

export interface QueryShortlistItem {
  sourceType: CitationSourceType;
  sourceId: string;
  pathOrSection: string;
  summary: string;
  content: string;
  createdAt: string | null;
}

export interface AuditFinding {
  status: AuditStatus;
  code: string;
  message: string;
}
