import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, scoreTrend, type RunSummary } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-scores-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('score trend', () => {
  it("lists each evaluator's mean score run by run, oldest first, skipping runs without scores", () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'Scores');
    const run = (n: number, name: string, scores: RunSummary['scores']) => {
      const runId = `run-${n}`;
      const d = store.runDir(runId);
      mkdirSync(d, { recursive: true });
      const s = { runId, name, startedAt: `2026-10-0${n}T00:00:00.000Z`, durationMs: 1, total: 1, passed: 1, failed: 0, skipped: 0, errors: 0, scores } as RunSummary;
      writeFileSync(join(d, 'summary.json'), JSON.stringify(s));
      store.meta.addRun(s, d);
    };
    run(1, 'Intent eval', { similarity: { mean: 0.61234, count: 3 }, 'exact-match': { mean: 1, count: 3 } });
    run(2, 'API smoke', {});
    run(3, 'Intent eval', { similarity: { mean: 0.8, count: 3 } });
    const t = scoreTrend(store);
    expect(t.map((p) => [p.runId, p.scores])).toEqual([
      ['run-1', { similarity: 0.612, 'exact-match': 1 }],
      ['run-3', { similarity: 0.8 }],
    ]);
    expect(scoreTrend(store, { runIds: ['run-3'] }).map((p) => p.runId)).toEqual(['run-3']);
    expect(scoreTrend(store, { name: 'smoke' })).toEqual([]);
    store.close();
  });
});
