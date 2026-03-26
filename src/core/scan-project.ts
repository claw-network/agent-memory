import { access, readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type {
  PrimaryEcosystem,
  ProjectScan,
  ValidationCommand,
  WorkspaceModule,
} from "../types";

interface PackageJsonLike {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
}

const ROOT_SIGNAL_FILES = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pnpm-workspace.yaml",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
] as const;

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

const ROOT_SOURCE_HINTS = [
  "src",
  "packages",
  "apps",
  "app",
  "lib",
  "server",
  "client",
  "internal",
  "cmd",
  "crates",
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  if (!(await exists(path))) {
    return null;
  }

  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readText(path: string): Promise<string | null> {
  if (!(await exists(path))) {
    return null;
  }

  return readFile(path, "utf8");
}

function detectPrimaryEcosystem(signals: string[]): PrimaryEcosystem {
  if (signals.includes("package.json")) {
    return "node";
  }

  if (signals.includes("pyproject.toml")) {
    return "python";
  }

  if (signals.includes("Cargo.toml")) {
    return "rust";
  }

  if (signals.includes("go.mod")) {
    return "go";
  }

  return "generic";
}

async function listTopLevel(rootDir: string): Promise<{
  dirs: string[];
  files: string[];
}> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return { dirs, files };
}

function inferPackageManager(
  packageJson: PackageJsonLike | null,
  signals: string[],
): string | null {
  if (packageJson?.packageManager) {
    return packageJson.packageManager;
  }

  if (signals.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (signals.includes("yarn.lock")) {
    return "yarn";
  }

  if (signals.includes("package-lock.json")) {
    return "npm";
  }

  if (signals.includes("bun.lockb") || signals.includes("bun.lock")) {
    return "bun";
  }

  return null;
}

function inferWorkspaceManager(
  packageJson: PackageJsonLike | null,
  signals: string[],
  primaryEcosystem: PrimaryEcosystem,
): string | null {
  if (signals.includes("pnpm-workspace.yaml")) {
    return "pnpm workspace";
  }

  if (Array.isArray(packageJson?.workspaces) || packageJson?.workspaces?.packages) {
    return "package.json workspaces";
  }

  if (primaryEcosystem === "rust") {
    return "cargo workspace";
  }

  return null;
}

function parseWorkspacePatterns(packageJson: PackageJsonLike | null, pnpmWorkspace: string | null): string[] {
  const patterns = new Set<string>();

  const rawWorkspaces = packageJson?.workspaces;
  const packageJsonPatterns = Array.isArray(rawWorkspaces)
    ? rawWorkspaces
    : rawWorkspaces?.packages ?? [];

  for (const value of packageJsonPatterns) {
    if (value && !value.startsWith("!")) {
      patterns.add(value);
    }
  }

  if (pnpmWorkspace) {
    const lines = pnpmWorkspace.split(/\r?\n/);
    let inPackagesBlock = false;

    for (const line of lines) {
      if (/^\s*packages\s*:/.test(line)) {
        inPackagesBlock = true;
        continue;
      }

      if (inPackagesBlock && /^\S/.test(line)) {
        inPackagesBlock = false;
      }

      if (!inPackagesBlock) {
        continue;
      }

      const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
      if (match && !match[1].startsWith("!")) {
        patterns.add(match[1]);
      }
    }
  }

  return Array.from(patterns);
}

async function expandWorkspacePattern(rootDir: string, pattern: string): Promise<string[]> {
  const cleanedPattern = pattern.replace(/\\/g, "/").replace(/^\.?\//, "");
  const segments = cleanedPattern.split("/").filter(Boolean);
  const matches = new Set<string>();

  async function walk(baseDir: string, index: number): Promise<void> {
    if (index >= segments.length) {
      if (await exists(join(baseDir, "package.json"))) {
        matches.add(baseDir);
      }
      return;
    }

    const segment = segments[index];
    if (segment === "**") {
      await walk(baseDir, index + 1);

      const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        await walk(join(baseDir, entry.name), index);
      }
      return;
    }

    if (segment === "*") {
      const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        await walk(join(baseDir, entry.name), index + 1);
      }
      return;
    }

    await walk(join(baseDir, segment), index + 1);
  }

  await walk(rootDir, 0);
  return Array.from(matches).sort((a, b) => a.localeCompare(b));
}

function inferModuleRole(modulePath: string): string {
  const normalized = modulePath.replace(/\\/g, "/").toLowerCase();

  if (normalized.includes("demo") || normalized.includes("example")) {
    return "demo or example surface";
  }

  if (normalized.includes("cli")) {
    return "command-line entrypoint";
  }

  if (normalized.includes("app") || normalized.includes("web")) {
    return "application shell or runtime surface";
  }

  if (normalized.includes("doc") || normalized.includes("site")) {
    return "documentation or site module";
  }

  if (normalized.includes("test") || normalized.includes("bench")) {
    return "tests or verification support";
  }

  if (normalized.includes("core") || normalized.includes("shared") || normalized.includes("lib")) {
    return "shared library or core logic";
  }

  return "role needs confirmation";
}

async function collectWorkspaceModules(
  rootDir: string,
  packageJson: PackageJsonLike | null,
  pnpmWorkspace: string | null,
): Promise<WorkspaceModule[]> {
  const patterns = parseWorkspacePatterns(packageJson, pnpmWorkspace);
  const moduleDirs = new Set<string>();

  for (const pattern of patterns) {
    for (const match of await expandWorkspacePattern(rootDir, pattern)) {
      moduleDirs.add(match);
    }
  }

  if (moduleDirs.size === 0) {
    for (const hint of ["packages", "apps", "services", "crates"] as const) {
      const baseDir = join(rootDir, hint);
      if (!(await exists(baseDir))) {
        continue;
      }

      const entries = await readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const candidate = join(baseDir, entry.name);
        if (await exists(join(candidate, "package.json"))) {
          moduleDirs.add(candidate);
        }
      }
    }
  }

  const modules: WorkspaceModule[] = [];

  for (const moduleDir of Array.from(moduleDirs).sort((a, b) => a.localeCompare(b))) {
    const manifest = await readJson<PackageJsonLike>(join(moduleDir, "package.json"));
    modules.push({
      name: manifest?.name ?? basename(moduleDir),
      path: relative(rootDir, moduleDir) || ".",
      role: inferModuleRole(relative(rootDir, moduleDir) || "."),
    });
  }

  return modules;
}

function collectExportPaths(packageJson: PackageJsonLike | null): string[] {
  if (!packageJson) {
    return [];
  }

  const paths = new Set<string>();

  if (typeof packageJson.main === "string") {
    paths.add(packageJson.main);
  }

  if (typeof packageJson.module === "string") {
    paths.add(packageJson.module);
  }

  if (typeof packageJson.bin === "string") {
    paths.add(packageJson.bin);
  } else if (packageJson.bin && typeof packageJson.bin === "object") {
    for (const value of Object.values(packageJson.bin)) {
      if (typeof value === "string") {
        paths.add(value);
      }
    }
  }

  function walkExports(value: unknown): void {
    if (typeof value === "string") {
      paths.add(value);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      walkExports(nestedValue);
    }
  }

  walkExports(packageJson.exports);
  return Array.from(paths);
}

async function collectKeyEntryFiles(
  rootDir: string,
  packageJson: PackageJsonLike | null,
  workspaceModules: WorkspaceModule[],
): Promise<string[]> {
  const candidates = new Set<string>();

  for (const file of [
    "package.json",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "src/index.ts",
    "src/main.ts",
    "src/cli.ts",
    "src/index.js",
    "src/main.py",
    "main.go",
    "go.mod",
    "Cargo.toml",
    "pyproject.toml",
  ]) {
    if (await exists(join(rootDir, file))) {
      candidates.add(file);
    }
  }

  for (const exportPath of collectExportPaths(packageJson)) {
    if (await exists(join(rootDir, exportPath))) {
      candidates.add(exportPath);
    }
  }

  for (const moduleInfo of workspaceModules.slice(0, 4)) {
    const moduleManifest = join(rootDir, moduleInfo.path, "package.json");
    if (await exists(moduleManifest)) {
      candidates.add(relative(rootDir, moduleManifest));
    }

    for (const file of ["src/index.ts", "src/main.ts", "src/cli.ts"]) {
      const candidate = join(rootDir, moduleInfo.path, file);
      if (await exists(candidate)) {
        candidates.add(relative(rootDir, candidate));
      }
    }
  }

  return Array.from(candidates).sort((a, b) => a.localeCompare(b)).slice(0, 8);
}

async function countSourceFiles(dir: string, depth: number): Promise<number> {
  if (depth > 4) {
    return 0;
  }

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      count += await countSourceFiles(join(dir, entry.name), depth + 1);
      continue;
    }

    if (entry.isFile() && /\.(cjs|cts|go|js|jsx|mjs|mts|py|rs|ts|tsx)$/i.test(entry.name)) {
      count += 1;
    }
  }

  return count;
}

async function collectDenseSourceDirs(rootDir: string, workspaceModules: WorkspaceModule[]): Promise<string[]> {
  const candidates = new Set<string>();

  for (const hint of ROOT_SOURCE_HINTS) {
    const candidate = join(rootDir, hint);
    if (await exists(candidate)) {
      candidates.add(candidate);
    }
  }

  for (const moduleInfo of workspaceModules) {
    const moduleSrc = join(rootDir, moduleInfo.path, "src");
    if (await exists(moduleSrc)) {
      candidates.add(moduleSrc);
    }
  }

  const scored: Array<{ label: string; count: number }> = [];
  for (const candidate of candidates) {
    const count = await countSourceFiles(candidate, 0);
    if (count > 0) {
      scored.push({
        label: relative(rootDir, candidate) || ".",
        count,
      });
    }
  }

  return scored
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map((item) => `${item.label} (${item.count} source files)`);
}

function inferGotchas(scan: {
  projectSignals: string[];
  packageManager: string | null;
  workspaceManager: string | null;
  topLevelDirs: string[];
  topLevelFiles: string[];
  workspaceModules: WorkspaceModule[];
  keyEntryFiles: string[];
}): string[] {
  const gotchas: string[] = [];

  if (!scan.projectSignals.some((signal) => signal === ".git" || signal === "package.json")) {
    gotchas.push("Project signals are weak. Review the generated map manually before trusting it.");
  }

  if (scan.packageManager?.startsWith("pnpm") && scan.topLevelFiles.includes("package-lock.json")) {
    gotchas.push("Both pnpm and npm lockfile signals are present. Confirm the authoritative package manager.");
  }

  if (scan.workspaceManager && scan.workspaceModules.length > 0) {
    gotchas.push("Workspace module roles are inferred from paths. Replace generic role labels with project-specific ones.");
  }

  if (scan.topLevelDirs.some((dir) => ["dist", "build", "out"].includes(dir))) {
    gotchas.push("Generated artifacts exist in-repo. Confirm whether contributors should read from src or dist/build outputs.");
  }

  if (scan.keyEntryFiles.some((file) => /browser|server|worker/i.test(file))) {
    gotchas.push("Runtime-specific entrypoints are present. Keep browser/server/worker boundaries explicit in project memory.");
  }

  if (
    scan.topLevelFiles.includes("AGENTS.md") &&
    scan.topLevelFiles.includes("CLAUDE.md") &&
    scan.topLevelFiles.includes("README.md")
  ) {
    gotchas.push("Multiple human/agent entry files exist. Keep one primary entry authoritative and avoid duplicated guidance.");
  }

  return gotchas.slice(0, 5);
}

function inferValidationCandidates(
  primaryEcosystem: PrimaryEcosystem,
  packageManager: string | null,
  rootScripts: string[],
  projectSignals: string[],
): ValidationCommand[] {
  const commands: ValidationCommand[] = [];

  if (primaryEcosystem === "node") {
    const usesPnpm = (packageManager ?? "").startsWith("pnpm") || projectSignals.includes("pnpm-lock.yaml");
    const usesNpm = (packageManager ?? "").startsWith("npm") || projectSignals.includes("package-lock.json");

    if (rootScripts.includes("build")) {
      commands.push({
        label: usesPnpm ? "pnpm build" : "build",
        command: usesPnpm ? ["pnpm", "build"] : usesNpm ? ["npm", "run", "build"] : ["npm", "run", "build"],
      });
    }

    if (rootScripts.includes("test")) {
      commands.push({
        label: usesPnpm ? "pnpm test" : "test",
        command: usesPnpm ? ["pnpm", "test"] : usesNpm ? ["npm", "test"] : ["npm", "test"],
      });
    }

    return commands;
  }

  if (primaryEcosystem === "python") {
    commands.push({ label: "pytest", command: ["pytest"] });
    return commands;
  }

  if (primaryEcosystem === "rust") {
    commands.push({ label: "cargo test", command: ["cargo", "test"] });
    return commands;
  }

  if (primaryEcosystem === "go") {
    commands.push({ label: "go test ./...", command: ["go", "test", "./..."] });
    return commands;
  }

  return commands;
}

function inferNextSteps(scan: {
  validationCandidates: ValidationCommand[];
  workspaceModules: WorkspaceModule[];
  gotchas: string[];
  keyEntryFiles: string[];
  packageManager: string | null;
}): string[] {
  const nextSteps: string[] = [];

  if (scan.validationCandidates.length > 0) {
    nextSteps.push("Establish a build/test baseline so current-focus.md reflects real verification status.");
  }

  if (scan.workspaceModules.length > 0) {
    nextSteps.push("Replace inferred workspace module roles with domain-specific ownership and responsibility notes.");
  }

  if (scan.keyEntryFiles.length > 3) {
    nextSteps.push("Confirm the narrowest public entrypoints so project-map.md does not overstate import surfaces.");
  }

  if (scan.packageManager) {
    nextSteps.push("Document the authoritative package manager and workspace workflow in the primary entry file.");
  }

  nextSteps.push("Add the first project-specific gotchas once the team hits a costly build, runtime, or integration surprise.");

  return nextSteps.slice(0, 5);
}

export async function scanProject(rootDir: string): Promise<ProjectScan> {
  const { dirs, files } = await listTopLevel(rootDir);
  const allSignals = new Set<string>(files);

  for (const signal of ROOT_SIGNAL_FILES) {
    if (signal === ".git") {
      if (dirs.includes(".git")) {
        allSignals.add(".git");
      }
      continue;
    }

    if (files.includes(signal)) {
      allSignals.add(signal);
    }
  }

  const projectSignals = Array.from(allSignals).sort((a, b) => a.localeCompare(b));
  const packageJson = await readJson<PackageJsonLike>(join(rootDir, "package.json"));
  const pnpmWorkspace = await readText(join(rootDir, "pnpm-workspace.yaml"));
  const primaryEcosystem = detectPrimaryEcosystem(projectSignals);
  const packageManager = inferPackageManager(packageJson, projectSignals);
  const workspaceManager = inferWorkspaceManager(packageJson, projectSignals, primaryEcosystem);
  const workspaceModules = await collectWorkspaceModules(rootDir, packageJson, pnpmWorkspace);
  const rootScripts = Object.keys(packageJson?.scripts ?? {}).sort((a, b) => a.localeCompare(b));
  const keyEntryFiles = await collectKeyEntryFiles(rootDir, packageJson, workspaceModules);
  const denseSourceDirs = await collectDenseSourceDirs(rootDir, workspaceModules);
  const validationCandidates = inferValidationCandidates(
    primaryEcosystem,
    packageManager,
    rootScripts,
    projectSignals,
  );
  const gotchas = inferGotchas({
    projectSignals,
    packageManager,
    workspaceManager,
    topLevelDirs: dirs,
    topLevelFiles: files,
    workspaceModules,
    keyEntryFiles,
  });
  const nextSteps = inferNextSteps({
    validationCandidates,
    workspaceModules,
    gotchas,
    keyEntryFiles,
    packageManager,
  });

  return {
    rootDir,
    generatedAt: new Date().toISOString(),
    projectName: packageJson?.name ?? basename(rootDir),
    projectSignals,
    primaryEcosystem,
    packageManager,
    workspaceManager,
    topLevelDirs: dirs,
    topLevelFiles: files,
    rootScripts,
    workspaceModules,
    keyEntryFiles,
    denseSourceDirs,
    gotchas,
    nextSteps,
    validationCandidates,
  };
}
