import { describe, expect, it } from 'vitest';
import { runBreakdown, type TestResult } from '@testpion/core';

const r = (name: string, status: TestResult['status'], latencyMs: number, type = 'http', failedCheck?: string): TestResult =>
  ({ id: name, name, type, status, startedAt: '', durationMs: latencyMs + 5, latencyMs, attempts: 1, checks: failedCheck ? [{ type: 'assert', name: failedCheck, passed: false, source: 'assertion', message: '' }] : [] }) as TestResult;

describe('runBreakdown', () => {
  it('buckets latencies, ranks the slowest and counts per type and failing check', () => {
    const b = runBreakdown();
    for (const x of [r('a', 'passed', 20), r('b', 'passed', 70), r('c', 'failed', 300, 'http', 'status is 200'), r('d', 'error', 1200, 'grpc', 'status is 200'), r('e', 'skipped', 0), r('f', 'passed', 90, 'graphql')]) b.add(x);
    const out = b.result();
    expect(out.timed).toBe(5);
    // < 50, 50–100, 100–250, 250–500, 500–1000, 1000–2500 (trailing empty buckets dropped)
    expect(out.histogram.map((h) => [h.fromMs, h.passed, h.failed])).toEqual([
      [0, 1, 0],
      [50, 2, 0],
      [100, 0, 0],
      [250, 0, 1],
      [500, 0, 0],
      [1000, 0, 1],
    ]);
    expect(out.slowest.map((s) => s.name)).toEqual(['d', 'c', 'f', 'b', 'a']);
    expect(out.byType).toEqual({ http: { passed: 2, failed: 1, skipped: 1 }, grpc: { passed: 0, failed: 1, skipped: 0 }, graphql: { passed: 1, failed: 0, skipped: 0 } });
    expect(out.failingChecks).toEqual([{ name: 'status is 200', count: 2 }]);
  });

  it('puts very slow results in the open-ended last bucket', () => {
    const b = runBreakdown();
    b.add(r('slow', 'passed', 9000));
    const h = b.result().histogram;
    expect(h).toHaveLength(8);
    expect(h[7]).toEqual({ fromMs: 5000, toMs: undefined, passed: 1, failed: 0 });
  });
});
