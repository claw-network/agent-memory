import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectEntryFile, getFallbackEntryFile } from "./detect-entry-files";
import { parseCurrentFocusMetadata, stripCurrentFocusMetadata } from "./current-focus-metadata";
import { detectManagedFile, stripManagedMarker } from "./file-ownership";
import { buildMemoryTargets } from "./plan-memory-write";
import type { AuditFinding, MemoryFiles, ProjectScan } from "../types";

const VALIDATION_MAX_AGE_DAYS = 14;
const ENTRY_MARKER = "<!-- agent-memory:start -->";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isValidIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isValidationFresh(validatedAt: string): boolean {
  const validatedMs = Date.parse(validatedAt);
  if (Number.isNaN(validatedMs)) {
    return false;
  }

  const maxAgeMs = VALIDATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - validatedMs <= maxAgeMs;
}

export async function validateMemory(
  scan: ProjectScan,
  memory: MemoryFiles,
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const memoryDir = join(scan.rootDir, "docs/agent-memory");
  const targets = buildMemoryTargets(scan.rootDir, memory);

  if (await exists(memoryDir)) {
    findings.push({
      status: "pass",
      code: "memory-directory",
      message: "docs/agent-memory exists.",
    });
  } else {
    findings.push({
      status: "fail",
      code: "memory-directory",
      message: "docs/agent-memory is missing.",
    });
  }

  for (const target of targets) {
    const ownership = await detectManagedFile(target.path, target.fileId);
    switch (ownership.state) {
      case "missing":
        findings.push({
          status: "fail",
          code: `memory-file:${target.fileId}`,
          message: `${target.fileId} is missing.`,
        });
        break;
      case "managed":
        findings.push({
          status: "pass",
          code: `memory-file:${target.fileId}`,
          message: `${target.fileId} is present and managed.`,
        });
        break;
      case "unmanaged":
        findings.push({
          status: "fail",
          code: `memory-file:${target.fileId}`,
          message: `${target.fileId} is present but missing a valid managed marker.`,
        });
        break;
    }
  }

  const entryFile = (await detectEntryFile(scan.rootDir)) ?? getFallbackEntryFile(scan.rootDir);
  if (!(await exists(entryFile))) {
    findings.push({
      status: "fail",
      code: "entry-file",
      message: "No supported entry file with Project Memory snippet was found.",
    });
  } else {
    const entryContent = await readFile(entryFile, "utf8");
    if (entryContent.includes(ENTRY_MARKER)) {
      findings.push({
        status: "pass",
        code: "entry-file",
        message: `Entry integration exists in ${entryFile}.`,
      });
    } else {
      findings.push({
        status: "fail",
        code: "entry-file",
        message: `Entry file ${entryFile} is missing the Project Memory snippet.`,
      });
    }
  }

  const currentFocusTarget = targets.find((target) => target.fileId === "current-focus");
  if (currentFocusTarget && (await exists(currentFocusTarget.path))) {
    const currentFocusContent = await readFile(currentFocusTarget.path, "utf8");
    const currentFocusBody = stripCurrentFocusMetadata(stripManagedMarker(currentFocusContent));
    const metadata = parseCurrentFocusMetadata(stripManagedMarker(currentFocusContent));

    if (!currentFocusBody.includes("## Validation Snapshot")) {
      findings.push({
        status: "fail",
        code: "current-focus:validation-section",
        message: "current-focus.md is missing the Validation Snapshot section.",
      });
    } else {
      findings.push({
        status: "pass",
        code: "current-focus:validation-section",
        message: "current-focus.md includes the Validation Snapshot section.",
      });
    }

    if (!metadata) {
      findings.push({
        status: "fail",
        code: "current-focus:metadata",
        message: "current-focus.md is missing readable metadata.",
      });
    } else if (!isValidIsoTimestamp(metadata.generatedAt)) {
      findings.push({
        status: "fail",
        code: "current-focus:generated-at",
        message: "current-focus.md has an invalid generatedAt timestamp.",
      });
    } else {
      findings.push({
        status: "pass",
        code: "current-focus:generated-at",
        message: "current-focus.md has readable generation metadata.",
      });

      if (metadata.validatedAt === "none" || /Status: Not run during/i.test(currentFocusBody)) {
        findings.push({
          status: "fail",
          code: "current-focus:validated-at",
          message: "current-focus.md does not record a completed validation baseline.",
        });
      } else if (!isValidIsoTimestamp(metadata.validatedAt)) {
        findings.push({
          status: "fail",
          code: "current-focus:validated-at",
          message: "current-focus.md has an invalid validatedAt timestamp.",
        });
      } else if (!isValidationFresh(metadata.validatedAt)) {
        findings.push({
          status: "fail",
          code: "current-focus:freshness",
          message: `current-focus.md validation baseline is older than ${VALIDATION_MAX_AGE_DAYS} days.`,
        });
      } else {
        findings.push({
          status: "pass",
          code: "current-focus:freshness",
          message: "current-focus.md validation baseline is fresh.",
        });
      }
    }
  }

  if (!scan.projectSignals.some((signal) => signal === ".git" || signal === "package.json")) {
    findings.push({
      status: "warn",
      code: "project-signals",
      message: "Project signals are weak; review the generated memory manually.",
    });
  } else {
    findings.push({
      status: "pass",
      code: "project-signals",
      message: "Project signals are strong enough for reliable memory generation.",
    });
  }

  return findings;
}
