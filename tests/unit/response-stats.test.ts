import { describe, expect, it } from 'vitest';
import { percentile, responseFailed, responseTimeStats } from '@testpion/core';

describe('responseTimeStats', () => {
  it('summarises durations with nearest-rank percentiles and counts failures', () => {
    const entries = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000].map((durationMs, i) => ({ durationMs, status: i === 9 ? 500 : 200 }));
    expect(responseTimeStats(entries)).toEqual({ count: 10, failed: 1, minMs: 10, meanMs: 145, p50Ms: 50, p95Ms: 1000, maxMs: 1000 });
  });

  it('ignores entries without a duration and treats a missing status as failed', () => {
    expect(responseTimeStats([{ status: 200 }, { durationMs: 5, status: 'ERR' }, { durationMs: 7 }])).toMatchObject({ count: 2, failed: 2, p50Ms: 5, maxMs: 7 });
    expect(responseTimeStats([])).toEqual({ count: 0, failed: 0 });
  });

  it('percentile and failure rules', () => {
    expect(percentile([], 0.5)).toBeUndefined();
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(responseFailed(399)).toBe(false);
    expect(responseFailed(404)).toBe(true);
    expect(responseFailed(undefined)).toBe(true);
  });
});
