import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { TestResult } from '../model/types.js';
import type { WorkspaceStore } from '../storage/workspace.js';
import { readResultsFile } from './runner.js';
import { runBreakdown, type RunBreakdown } from './breakdown.js';

/** Reading a finished run's results (runs/<id>/results.jsonl), streamed: the app, the MCP tools and the CLI share these. */

export const runResultsFile = (store: Pick<WorkspaceStore, 'runDir'>, runId: string) => join(store.runDir(runId), 'results.jsonl');

/** Every result of a run, in order. */
export async function* runResults(store: Pick<WorkspaceStore, 'runDir'>, runId: string): AsyncGenerator<TestResult> {
  const file = runResultsFile(store, runId);
  if (!existsSync(file)) return;
  for await (const r of await readResultsFile(file)) yield r;
}

export interface ResultsPage {
  items: TestResult[];
  /** How many results match (before offset and limit). */
  total: number;
}

/** A page of a run's results, filtered by status ('failed' means failed or error) and a name substring. */
export async function pageRunResults(store: Pick<WorkspaceStore, 'runDir'>, q: { runId: string; offset?: number; limit?: number; status?: string; query?: string }): Promise<ResultsPage> {
  const file = runResultsFile(store, q.runId);
  const items: TestResult[] = [];
  let total = 0;
  if (!existsSync(file)) return { items, total };
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 100;
  const needle = q.query?.toLowerCase();
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r: TestResult;
    try {
      r = JSON.parse(line) as TestResult;
    } catch {
      continue; // a torn line (the run was interrupted while writing)
    }
    if (q.status && q.status !== 'all' && (q.status === 'failed' ? r.status !== 'failed' && r.status !== 'error' : r.status !== q.status)) continue;
    if (needle && !r.name.toLowerCase().includes(needle)) continue;
    if (total >= offset && items.length < limit) items.push(r);
    total++;
  }
  return { items, total };
}

/** Latency histogram, slowest results, results per type and most failed checks of a finished run. */
export async function breakdownOfRun(store: Pick<WorkspaceStore, 'runDir'>, runId: string): Promise<RunBreakdown> {
  const b = runBreakdown();
  for await (const r of runResults(store, runId)) b.add(r);
  return b.result();
}
