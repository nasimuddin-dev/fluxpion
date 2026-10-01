import type { TestResult } from '../model/types.js';

/** Upper bounds (ms) of the latency histogram's buckets; the last bucket is open-ended. */
export const LATENCY_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000] as const;

export interface LatencyBucket {
  /** Lower bound in ms (inclusive). */
  fromMs: number;
  /** Upper bound in ms (exclusive); absent for the last, open-ended bucket. */
  toMs?: number;
  passed: number;
  /** Failed or errored. */
  failed: number;
}

export interface RunBreakdown {
  /** How many results had a latency (or duration). */
  timed: number;
  histogram: LatencyBucket[];
  /** Slowest results, slowest first. */
  slowest: Array<{ id: string; name: string; type: string; status: string; latencyMs: number }>;
  /** Results per test type (http, graphql, grpc, mcp, llm, …). */
  byType: Record<string, { passed: number; failed: number; skipped: number }>;
  /** Checks that failed most often, by name. */
  failingChecks: Array<{ name: string; count: number }>;
}

/**
 * Summary of a run's results for charts: a latency histogram (passed and failed per bucket),
 * the slowest results, results per type and the checks that failed most. Feed results one at a
 * time (they are streamed from results.jsonl), then call `result()`.
 */
export function runBreakdown() {
  const histogram: LatencyBucket[] = [0, ...LATENCY_BUCKETS].map((fromMs, i) => ({ fromMs, toMs: LATENCY_BUCKETS[i], passed: 0, failed: 0 }));
  let slowest: RunBreakdown['slowest'] = [];
  const byType: RunBreakdown['byType'] = {};
  const checks = new Map<string, number>();
  let timed = 0;
  return {
    add(r: TestResult) {
      const bad = r.status === 'failed' || r.status === 'error';
      const t = (byType[r.type] ??= { passed: 0, failed: 0, skipped: 0 });
      if (bad) t.failed++;
      else if (r.status === 'skipped') t.skipped++;
      else t.passed++;
      for (const c of r.checks ?? []) if (!c.passed) checks.set(c.name, (checks.get(c.name) ?? 0) + 1);
      if (r.status === 'skipped') return;
      const ms = r.latencyMs ?? r.durationMs;
      if (typeof ms !== 'number' || !(ms >= 0)) return;
      timed++;
      let i = LATENCY_BUCKETS.findIndex((b) => ms < b);
      if (i < 0) i = LATENCY_BUCKETS.length;
      if (bad) histogram[i]!.failed++;
      else histogram[i]!.passed++;
      if (slowest.length < 5 || ms > slowest[slowest.length - 1]!.latencyMs) {
        slowest.push({ id: r.id, name: r.name, type: r.type, status: r.status, latencyMs: Math.round(ms) });
        slowest.sort((a, b) => b.latencyMs - a.latencyMs);
        slowest = slowest.slice(0, 5);
      }
    },
    result(): RunBreakdown {
      // trailing empty buckets are dropped so the chart is not mostly blank; leading ones stay (they show "nothing was that fast")
      let last = histogram.length - 1;
      while (last > 0 && histogram[last]!.passed + histogram[last]!.failed === 0) last--;
      const failingChecks = [...checks].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
      return { timed, histogram: histogram.slice(0, last + 1), slowest, byType, failingChecks };
    },
  };
}
