import { generateMemory } from "../core/generate-memory";
import { scanProject } from "../core/scan-project";
import { validateMemory } from "../core/validate-memory";

export async function runValidate(cwd: string): Promise<number> {
  const scan = await scanProject(cwd);
  const memory = generateMemory(scan, "update");
  const findings = await validateMemory(scan, memory);

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const finding of findings) {
    const label = finding.status.toUpperCase();
    console.log(`${label} ${finding.code}: ${finding.message}`);

    switch (finding.status) {
      case "pass":
        passCount += 1;
        break;
      case "warn":
        warnCount += 1;
        break;
      case "fail":
        failCount += 1;
        break;
    }
  }

  console.log("");
  console.log(`Summary: ${passCount} passed, ${warnCount} warnings, ${failCount} failed.`);

  return failCount > 0 ? 1 : 0;
}
