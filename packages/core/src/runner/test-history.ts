/** One test across earlier runs: did it pass, how long it took, which checks failed. */
import { join } from 'node:path';
import type { WorkspaceStore } from '../storage/workspace.js';
import { readResultsFile } from './runner.js';

export interface TestHistoryPoint {
  runId: string;
  runName: string;
  startedAt: string;
  environment?: string;
  status: string;
  latencyMs?: number;
  attempts?: number;
  /** Names of the checks that failed (up to 5), or the error. */
  failures: string[];
}

/**
 * The result of a test in each of the latest `runs` runs that included it, newest first (one per run: the first
 * matching result, so a data-driven run counts once). A test is matched by id when given, otherwise by name.
 */
export async function testHistory(store: WorkspaceStore, test: { id?: string; name?: string }, opts: { runs?: number; limit?: number } = {}): Promise<TestHistoryPoint[]> {
  if (!test.id && !test.name) return [];
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  const runs = store.meta.listRuns({ limit: Math.min(Math.max(opts.runs ?? 60, 1), 500) }).items;
  const out: TestHistoryPoint[] = [];
  for (const run of runs) {
    if (out.length >= limit) break;
    for await (const r of await readResultsFile(join(store.runDir(run.id), 'results.jsonl'))) {
      if (test.id ? r.id !== test.id : r.name !== test.name) continue;
      out.push({
        runId: run.id,
        runName: run.name,
        startedAt: run.startedAt,
        environment: run.environment,
        status: r.status,
        latencyMs: r.latencyMs ?? r.durationMs,
        attempts: r.attempts > 1 ? r.attempts : undefined,
        failures: r.error
          ? [r.error.message]
          : (r.checks ?? [])
              .filter((c) => !c.passed)
              .slice(0, 5)
              .map((c) => c.name),
      });
      break;
    }
  }
  return out;
}

/** How a test has been doing: passes, failures and how often its result flipped (a sign of flakiness), oldest to newest. */
export function summarizeTestHistory(points: TestHistoryPoint[]): { runs: number; passed: number; failed: number; flips: number; medianMs?: number } {
  const ordered = [...points].reverse().filter((p) => p.status !== 'skipped');
  let flips = 0;
  for (let i = 1; i < ordered.length; i++) if ((ordered[i]!.status === 'passed') !== (ordered[i - 1]!.status === 'passed')) flips++;
  const ms = ordered
    .map((p) => p.latencyMs)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);
  return {
    runs: ordered.length,
    passed: ordered.filter((p) => p.status === 'passed').length,
    failed: ordered.filter((p) => p.status === 'failed' || p.status === 'error').length,
    flips,
    medianMs: ms.length ? Math.round(ms[Math.floor((ms.length - 1) / 2)]!) : undefined,
  };
}
