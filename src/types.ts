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
export type QueryMode = "answer" | "changes" | "next" | "traps";
export type QueryOutputFormat = "text" | "json";
export type CitationSourceType = "bundle" | "event" | "checkpoint";
export type SourceSyncStatus = "never" | "passed" | "failed";
export type AutomationRunStatus = "idle" | "imported" | "recalled" | "recalled_noop" | "failed";
export type WorkflowStatus = "ok" | "warn" | "fail";
export type MemoryHealthStatus = "healthy" | "attention" | "unhealthy";
export type IntegrationHealthStatus = "healthy" | "attention";
export type IntegrationTarget = "all" | "claude" | "codex";
export type IntegrationActionType = "create" | "update" | "unchanged";
export type IntegrationScope = "project" | "user";
export type IntegrationComponent =
  | "claude-mcp"
  | "claude-hooks"
  | "claude-skill"
  | "codex-agents"
  | "codex-global-mcp";
export type IntegrationComponentStatus = "present" | "missing" | "managed_mismatch" | "unreadable";
export type RecallSection =
  | "all"
  | "project"
  | "project-map"
  | "current-focus"
  | "gotchas"
  | "next-steps"
  | "validation-commands";
export type RecallPolicy = "balanced" | "imports-only" | "local-only" | "project-map-protected";

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

export interface AgentMemoryConfig {
  recall: {
    defaultSection: RecallSection;
    defaultSource: RecallSourceScope;
    policy: RecallPolicy;
    backlogWarnThreshold: number;
    preview: {
      showDiffByDefault: boolean;
    };
  };
  query: {
    defaultOutput: QueryOutputFormat;
    templates: {
      answer: {
        instructions: string;
      };
      changes: {
        instructions: string;
      };
      next: {
        instructions: string;
      };
      traps: {
        instructions: string;
      };
    };
  };
  automation: {
    intervalMinutes: number;
    provider: ProviderPreference;
    importSyncBeforeRecall: boolean;
    autoRecall: boolean;
  };
  retention: {
    enabled: boolean;
    history: {
      maxAgeDays: number;
    };
    checkpoints: {
      maxAgeDays: number;
      keepRecent: number;
    };
    archive: {
      expireAfterDays: number;
    };
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
  section: RecallSection;
  policy: RecallPolicy | null;
  showDiff: boolean;
  checkpointId: string | null;
}

export interface QueryOptions {
  cwd: string;
  provider: ProviderPreference;
  scope: QueryScope;
  question: string;
  output: QueryOutputFormat | null;
}

export interface AutomationCommandOptions {
  cwd: string;
}

export interface IntegrateCommandOptions {
  cwd: string;
  target: IntegrationTarget;
  dryRun: boolean;
  status: boolean;
  repair: boolean;
  output: QueryOutputFormat | null;
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
  mergedGotchas: string[];
  mergedNextSteps: string[];
  currentFocusChanged: boolean;
  validationChanged: boolean;
  selectedSection: RecallSection;
  protectedSections: string[];
}

export interface RecallCandidate {
  state: AgentMemoryState;
  summary: RecallDiffSummary;
  fileDiffs: FileDiff[];
  noopReason: string | null;
}

export interface DeduplicationResult {
  bundle: AgentMemoryBundle;
  mergedGotchas: string[];
  mergedNextSteps: string[];
}

export interface RecallEvidenceGroup {
  groupId: string;
  sourceScopeLabel: "local" | "imports" | "mixed";
  eventIds: string[];
  sourceIds: string[];
  createdAtFirst: string;
  createdAtLast: string;
  representativeSummary: string;
  signals: HistorySignalSet;
}

export interface UnrecalledHistorySummary {
  rawEventCount: number;
  groupedItemCount: number;
  groups: RecallEvidenceGroup[];
}

export interface CheckpointComparisonSummary {
  checkpointId: string | null;
  changedSections: string[];
  addedGotchas: string[];
  removedGotchas: string[];
  addedNextSteps: string[];
  removedNextSteps: string[];
  mergedGotchas: string[];
  mergedNextSteps: string[];
  currentFocusChanged: boolean;
  validationChanged: boolean;
  fileDiffs: FileDiff[];
}

export interface Citation {
  sourceType: CitationSourceType;
  sourceId: string;
  pathOrSection: string;
  summary: string;
  projectionPath: string | null;
}

export interface QueryResult {
  mode: QueryMode;
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
  projectionPath: string | null;
  category:
    | "project"
    | "project-map"
    | "current-focus"
    | "suggested-action"
    | "gotcha"
    | "next-step"
    | "event"
    | "checkpoint";
  tags: QueryMode[];
}

export interface StatusReport {
  state: {
    schemaVersion: number;
    bundleHash: string;
    latestCheckpointId: string | null;
  };
  history: {
    totalEvents: number;
    unrecalledAll: number;
    unrecalledLocal: number;
    unrecalledImports: number;
  };
  sources: Array<{
    id: string;
    status: SourceSyncStatus;
    lastSyncedAt: string | null;
    lastImportedCount: number;
    lastSyncError: string | null;
    }>;
  checkpoint: CheckpointComparisonSummary | null;
  unrecalledSummary: UnrecalledHistorySummary;
  retention: {
    enabled: boolean;
    pruneCandidateEventCount: number;
    pruneCandidateCheckpointCount: number;
    archiveBatchCount: number;
    oldestArchiveCreatedAt: string | null;
  };
  suggestedNextAction: string;
}

export interface AuditFinding {
  status: AuditStatus;
  code: string;
  message: string;
}

export interface AutomationDaemonState {
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  intervalMinutes: number;
  provider: ProviderPreference;
}

export interface AutomationLockState {
  pid: number;
  createdAt: string;
}

export interface AutomationImportSyncSnapshot {
  attempted: boolean;
  results: ImporterSyncResult[];
}

export interface AutomationRecallSnapshot {
  attempted: boolean;
  applied: boolean;
  rawEventCount: number;
  groupedItemCount: number;
  noopReason: string | null;
}

export interface AutomationPruneSnapshot {
  attempted: boolean;
  archivedEventCount: number;
  archivedCheckpointCount: number;
  expiredArchiveBatchCount: number;
  archiveBatchPath: string | null;
  skippedReason: string | null;
}

export interface AutomationRunResult {
  startedAt: string;
  finishedAt: string;
  status: AutomationRunStatus;
  provider: ProviderPreference;
  importSync: AutomationImportSyncSnapshot;
  recall: AutomationRecallSnapshot;
  prune: AutomationPruneSnapshot;
  errors: string[];
  warnings: string[];
}

export interface ArchiveBatchManifest {
  createdAt: string;
  archivedEventIds: string[];
  archivedCheckpointIds: string[];
  historyMaxAgeDays: number;
  checkpointMaxAgeDays: number;
  keepRecent: number;
  expireAfterDays: number;
}

export interface IntegrationActionResult {
  path: string;
  scope: IntegrationScope;
  action: IntegrationActionType;
  component: IntegrationComponent;
  note: string;
}

export interface IntegrationStatusItem {
  status: IntegrationComponentStatus;
  path: string;
  scope: IntegrationScope;
  note: string;
}

export interface IntegrationStatusReport {
  target: IntegrationTarget;
  healthy: boolean;
  claude: {
    mcpProjectConfig: IntegrationStatusItem;
    settingsHooks: IntegrationStatusItem;
    skills: IntegrationStatusItem;
  };
  codex: {
    agentsGuidance: IntegrationStatusItem;
    globalMcpConfig: IntegrationStatusItem;
  };
  warnings: string[];
  missingItems: string[];
  suggestedNextAction: string;
}

export interface WorkflowResult<TDetails> {
  status: WorkflowStatus;
  summary: string;
  suggestedNextAction: string;
  details: TDetails;
  warnings: string[];
  errors: string[];
}

export interface MemoryAssessWorkflowDetails {
  memoryHealth: MemoryHealthStatus;
  backlog: {
    unrecalledAll: number;
    unrecalledLocal: number;
    unrecalledImports: number;
  };
  automation: {
    running: boolean;
    lastRunStatus: AutomationRunStatus | null;
    lastRunFinishedAt: string | null;
  };
  integration: {
    claude: IntegrationHealthStatus;
    codex: IntegrationHealthStatus;
    healthy: boolean;
  };
  validate: {
    failCount: number;
    warnCount: number;
    topFindings: string[];
  };
  retention: {
    enabled: boolean;
    pruneCandidateEventCount: number;
    pruneCandidateCheckpointCount: number;
    archiveBatchCount: number;
    oldestArchiveCreatedAt: string | null;
  };
}

export interface MemoryMaintainWorkflowDetails {
  daemon: {
    wasRunning: boolean;
    startedNow: boolean;
  };
  run: {
    status: AutomationRunStatus;
    importAttempted: boolean;
    recallAttempted: boolean;
    recallApplied: boolean;
    groupedItemCount: number;
  };
  prune: AutomationPruneSnapshot;
  changedFiles: string[];
  latestRunPath: string;
}

export interface MemoryCompactHandoffWorkflowDetails {
  currentFocusSummary: string;
  topGotchas: string[];
  topNextSteps: string[];
  unrecalledGroupedCount: number;
  automationSummary: string;
  retentionSummary: string;
  recommendedResumeActions: string[];
}

export type MemoryAssessWorkflowResult = WorkflowResult<MemoryAssessWorkflowDetails>;
export type MemoryMaintainWorkflowResult = WorkflowResult<MemoryMaintainWorkflowDetails>;
export type MemoryCompactHandoffWorkflowResult = WorkflowResult<MemoryCompactHandoffWorkflowDetails>;
