import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, monitorRequestStats } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-monreq-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('monitor requests', () => {
  it('aggregates each request over the latest runs, slowest first, with the latest failure', async () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'Mon');
    const runs: string[] = [];
    const run = (n: number, results: Array<{ name: string; status: string; latencyMs: number; failed?: string }>) => {
      const runId = `run-${n}`;
      runs.push(JSON.stringify({ monitorId: 'm1', runId, startedAt: `2026-10-0${n}T00:00:00Z`, durationMs: 10, status: 'passed', total: results.length, passed: 0, failed: 0, errors: 0, trigger: 'schedule' }));
      mkdirSync(store.runDir(runId), { recursive: true });
      writeFileSync(
        join(store.runDir(runId), 'results.jsonl'),
        results.map((r) => JSON.stringify({ id: r.name, name: r.name, type: 'http', status: r.status, latencyMs: r.latencyMs, durationMs: r.latencyMs, attempts: 1, startedAt: '', checks: r.failed ? [{ type: 'status', name: r.failed, passed: false, source: 'deterministic', message: '' }] : [] })).join('\n') + '\n',
      );
    };
    run(1, [
      { name: 'Login', status: 'passed', latencyMs: 100 },
      { name: 'Search', status: 'failed', latencyMs: 900, failed: 'old failure' },
    ]);
    run(2, [
      { name: 'Login', status: 'passed', latencyMs: 120 },
      { name: 'Search', status: 'failed', latencyMs: 700, failed: 'status is 200' },
    ]);
    mkdirSync(store.path('runs', 'monitors'), { recursive: true });
    writeFileSync(store.path('runs', 'monitors', 'm1.jsonl'), runs.join('\n') + '\n');
    const stats = await monitorRequestStats(store, 'm1');
    expect(stats.map((s) => [s.name, s.runs, s.failed, s.medianMs, s.p95Ms, s.lastFailure])).toEqual([
      ['Search', 2, 2, 700, 900, 'status is 200'],
      ['Login', 2, 0, 100, 120, undefined],
    ]);
    expect(await monitorRequestStats(store, 'm1', { runs: 1 })).toHaveLength(2);
    store.close();
  });
});
