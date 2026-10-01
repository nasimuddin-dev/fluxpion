import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadHistory, loadRunRecord, recordLoadRun, type LoadSnapshot } from '@testpion/core';

const dir = mkdtempSync(join(tmpdir(), 'tp-loadhist-'));
const store = { path: (...p: string[]) => join(dir, ...p) };
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const snap = (p95: number, errorRate = 0) =>
  ({ requests: 100, throughput: 50.5, errorRate, latency: { count: 100, min: 1, max: p95 * 2, mean: p95 / 2, p50: p95 / 2, p90: p95, p95, p99: p95 * 1.5 }, statusCodes: { 200: 100 } }) as unknown as LoadSnapshot;

describe('load test history', () => {
  it('records finished load tests and lists them newest first, by saved load test or text', () => {
    recordLoadRun(store, loadRunRecord(snap(100), { id: 'a', startedAt: '2026-10-01T01:00:00Z', savedId: 's1', name: 'Pets', target: 'GET http://localhost/pets', virtualUsers: 5, durationSec: 10 }));
    recordLoadRun(store, loadRunRecord(snap(80.4), { id: 'b', startedAt: '2026-10-01T02:00:00Z', name: 'GET http://localhost/users', target: 'GET http://localhost/users', virtualUsers: 5, durationSec: 10, thresholds: [{ expr: 'p95<90', passed: true, actual: 80 }] }));
    recordLoadRun(store, loadRunRecord(snap(120, 0.05), { id: 'c', startedAt: '2026-10-01T03:00:00Z', savedId: 's1', name: 'Pets', target: 'GET http://localhost/pets', virtualUsers: 5, durationSec: 10, thresholds: [{ expr: 'errors<1%', passed: false, actual: 5 }] }));
    expect(loadHistory(store).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(loadHistory(store, { savedId: 's1' }).map((r) => r.id)).toEqual(['c', 'a']);
    expect(loadHistory(store, { query: 'users' }).map((r) => r.id)).toEqual(['b']);
    expect(loadHistory(store, { limit: 1 })[0]).toMatchObject({ id: 'c', p95: 120, p99: 180, errorRate: 0.05, passed: false, requests: 100 });
    expect(loadHistory(store, { query: 'users' })[0]).toMatchObject({ p95: 80, passed: true });
    expect(loadHistory(store, { query: 'users' })[0]!.passed).toBe(true);
    expect('passed' in loadHistory(store, { savedId: 's1' })[1]!).toBe(false);
  });
});
