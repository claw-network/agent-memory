import { runQuery as runQueryOrchestrator } from "../core/query-orchestrator";
import type { QueryOptions } from "../types";

export async function runQuery(options: QueryOptions): Promise<number> {
  const result = await runQueryOrchestrator(options);

  console.log("Answer:");
  console.log(result.answer);
  console.log("");
  console.log("Why this answer:");
  console.log(result.why);
  console.log("");
  console.log("Citations:");
  for (const citation of result.citations) {
    console.log(`- [${citation.sourceType}] ${citation.sourceId} ${citation.pathOrSection}: ${citation.summary}`);
  }

  return 0;
}
