import { readConfig } from "../core/config-store";
import { runQuery as runQueryOrchestrator } from "../core/query-orchestrator";
import type { QueryOptions } from "../types";

export async function runQuery(options: QueryOptions): Promise<number> {
  const config = await readConfig(options.cwd);
  const effectiveOutput = options.output ?? config.query.defaultOutput;
  const result = await runQueryOrchestrator(options);

  if (effectiveOutput === "json") {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log("Answer:");
  console.log(result.answer);
  console.log("");
  console.log(`Mode: ${result.mode}`);
  console.log("");
  console.log("Why this answer:");
  console.log(result.why);
  console.log("");
  console.log("Citations:");
  for (const citation of result.citations) {
    const projection = citation.projectionPath ? ` -> ${citation.projectionPath}` : "";
    console.log(`- [${citation.sourceType}] ${citation.sourceId} ${citation.pathOrSection}: ${citation.summary}${projection}`);
  }

  return 0;
}
