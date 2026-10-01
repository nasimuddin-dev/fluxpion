import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, summarizeTestHistory, testHistory, type RunSummary, type TestResult } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-testhist-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('test history across runs', () => {
  it('finds a test in each run, newest first, and counts flips', async () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'History');
    const run = (n: number, results: Array<Partial<TestResult>>) => {
      const runId = `run-${n}`;
      const d = store.runDir(runId);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'results.jsonl'), results.map((r) => JSON.stringify({ type: 'http', startedAt: '', durationMs: 10, attempts: 1, checks: [], ...r })).join('\n') + '\n');
      store.meta.addRun(
        { runId, name: 'API', startedAt: `2026-10-0${n}T10:00:00.000Z`, durationMs: 100, total: results.length, passed: 0, failed: 0, skipped: 0, errors: 0, environment: 'Staging' } as RunSummary,
        d,
      );
    };
    run(1, [{ id: 'login', name: 'Login', status: 'passed', latencyMs: 40 }]);
    run(2, [{ id: 'login', name: 'Login', status: 'failed', latencyMs: 90, checks: [{ type: 'status', name: 'status is 200', passed: false, source: 'deterministic', message: '' }] }]);
    run(3, [{ id: 'other', name: 'Other', status: 'passed' }]);
    run(4, [
      { id: 'login', name: 'Login', status: 'passed', latencyMs: 50, attempts: 2 },
      { id: 'login', name: 'Login', status: 'failed', latencyMs: 55 },
    ]);
    const points = await testHistory(store, { id: 'login' });
    expect(points.map((p) => [p.runId, p.status, p.latencyMs, p.attempts])).toEqual([
      ['run-4', 'passed', 50, 2],
      ['run-2', 'failed', 90, undefined],
      ['run-1', 'passed', 40, undefined],
    ]);
    expect(points[1]!.failures).toEqual(['status is 200']);
    expect(points[0]!.environment).toBe('Staging');
    expect(summarizeTestHistory(points)).toEqual({ runs: 3, passed: 2, failed: 1, flips: 2, medianMs: 50 });
    expect((await testHistory(store, { name: 'Other' })).map((p) => p.runId)).toEqual(['run-3']);
    expect(await testHistory(store, { id: 'login' }, { limit: 1 })).toHaveLength(1);
    store.close();
  });
});
