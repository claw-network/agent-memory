import { readHistoryEvents } from "../core/history-store";
import { registerSource, listRegisteredSources, syncSources } from "../core/import-framework";
import { readState, writeState } from "../core/state-store";
import type { ImportAddOptions, ImportSyncOptions } from "../types";

export async function runAddSource(options: ImportAddOptions): Promise<number> {
  const state = await readState(options.cwd);
  const source = await registerSource(options);
  const sources = await listRegisteredSources(options.cwd);

  await writeState(options.cwd, {
    ...state,
    maintenance: {
      ...state.maintenance,
      importSourceCount: sources.length,
    },
  });

  console.log(`Registered import source ${source.id} (${source.type}) -> ${source.path}`);
  return 0;
}

export async function runSyncSources(options: ImportSyncOptions): Promise<number> {
  const state = await readState(options.cwd);
  const results = await syncSources(options);
  const events = await readHistoryEvents(options.cwd);
  const sources = await listRegisteredSources(options.cwd);

  await writeState(options.cwd, {
    ...state,
    maintenance: {
      ...state.maintenance,
      historyEventCount: events.length,
      importSourceCount: sources.length,
    },
  });

  for (const result of results) {
    console.log(
      `- ${result.sourceId}: imported=${result.importedCount} skipped=${result.skippedCount} failed=${result.failedCount}`,
    );
    for (const failure of result.failures) {
      console.log(`  failed ${failure.sourceRef}: ${failure.message}`);
    }
  }

  return 0;
}
