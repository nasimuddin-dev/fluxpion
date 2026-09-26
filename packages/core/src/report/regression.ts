import type { RunSummary, TestResult, TestStatus } from '../model/types.js';
import { round } from '../util/stats.js';

export interface BaselineEntry {
  status: TestStatus;
  latencyMs?: number;
  totalTokens?: number;
  score?: number;
  model?: string;
}

export interface Baseline {
  schemaVersion: '1.0';
  name: string;
  createdAt: string;
  runId: string;
  summary: Pick<RunSummary, 'total' | 'passed' | 'failed' | 'latency' | 'tokens' | 'costUsd' | 'scores'>;
  tests: Record<string, BaselineEntry>;
}

export interface RegressionThresholds {
  /** Allowed latency increase in percent before flagging. */
  latencyPct: number;
  tokensPct: number;
  /** Allowed absolute drop in mean evaluation score. */
  scoreDrop: number;
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = { latencyPct: 25, tokensPct: 20, scoreDrop: 0.05 };

export interface RegressionItem {
  id: string;
  kind: 'new-failure' | 'fixed' | 'latency' | 'tokens' | 'score' | 'new-test' | 'missing-test';
  message: string;
  baseline?: number | string;
  current?: number | string;
  deltaPct?: number;
}

export interface RegressionReport {
  baseline: string;
  runId: string;
  regressions: RegressionItem[];
  improvements: RegressionItem[];
  summary: Array<{ metric: string; baseline: number; current: number; delta: number; deltaPct: number; regressed: boolean }>;
  passed: boolean;
}

function meanScore(r: TestResult): number | undefined {
  const s = r.checks.filter((c) => typeof c.score === 'number').map((c) => c.score!);
  return s.length ? round(s.reduce((a, b) => a + b, 0) / s.length, 4) : undefined;
}

export async function createBaseline(name: string, summary: RunSummary, results: AsyncIterable<TestResult>): Promise<Baseline> {
  const tests: Record<string, BaselineEntry> = {};
  for await (const r of results) tests[r.id] = { status: r.status, latencyMs: r.latencyMs, totalTokens: r.tokens?.totalTokens, score: meanScore(r), model: r.model };
  return {
    schemaVersion: '1.0',
    name,
    createdAt: new Date().toISOString(),
    runId: summary.runId,
    summary: { total: summary.total, passed: summary.passed, failed: summary.failed, latency: summary.latency, tokens: summary.tokens, costUsd: summary.costUsd, scores: summary.scores },
    tests,
  };
}

const pct = (a: number, b: number) => (a ? round(((b - a) / a) * 100, 1) : b ? 100 : 0);

/** Compare a run against a baseline, flagging differences beyond user-configured thresholds. */
export async function compareToBaseline(baseline: Baseline, summary: RunSummary, results: AsyncIterable<TestResult>, t: RegressionThresholds = DEFAULT_THRESHOLDS): Promise<RegressionReport> {
  const regressions: RegressionItem[] = [];
  const improvements: RegressionItem[] = [];
  const seen = new Set<string>();
  for await (const r of results) {
    seen.add(r.id);
    const b = baseline.tests[r.id];
    if (!b) {
      improvements.push({ id: r.id, kind: 'new-test', message: 'not in baseline' });
      continue;
    }
    if (b.status === 'passed' && r.status !== 'passed' && r.status !== 'skipped') regressions.push({ id: r.id, kind: 'new-failure', message: `was passing, now ${r.status}`, baseline: b.status, current: r.status });
    if (b.status !== 'passed' && r.status === 'passed') improvements.push({ id: r.id, kind: 'fixed', message: `was ${b.status}, now passing` });
    if (b.latencyMs && r.latencyMs !== undefined) {
      const d = pct(b.latencyMs, r.latencyMs);
      if (d > t.latencyPct) regressions.push({ id: r.id, kind: 'latency', message: `latency +${d}%`, baseline: b.latencyMs, current: r.latencyMs, deltaPct: d });
    }
    if (b.totalTokens && r.tokens) {
      const d = pct(b.totalTokens, r.tokens.totalTokens);
      if (d > t.tokensPct) regressions.push({ id: r.id, kind: 'tokens', message: `tokens +${d}%`, baseline: b.totalTokens, current: r.tokens.totalTokens, deltaPct: d });
    }
    const s = meanScore(r);
    if (b.score !== undefined && s !== undefined) {
      if (b.score - s > t.scoreDrop) regressions.push({ id: r.id, kind: 'score', message: `score ${b.score} → ${s}`, baseline: b.score, current: s });
      else if (s - b.score > t.scoreDrop) improvements.push({ id: r.id, kind: 'score', message: `score ${b.score} → ${s}`, baseline: b.score, current: s });
    }
  }
  for (const id of Object.keys(baseline.tests)) if (!seen.has(id)) regressions.push({ id, kind: 'missing-test', message: 'in baseline but not in this run' });

  const bs = baseline.summary;
  const metric = (m: string, a: number, b: number, higherIsWorse: boolean, limitPct?: number, limitAbs?: number) => {
    const delta = round(b - a, 4);
    const dp = pct(a, b);
    const regressed = higherIsWorse ? (limitPct !== undefined ? dp > limitPct : delta > 0) : limitAbs !== undefined ? -delta > limitAbs : delta < 0;
    return { metric: m, baseline: a, current: b, delta, deltaPct: dp, regressed };
  };
  const rows = [
    metric('pass rate', bs.total ? round(bs.passed / bs.total, 4) : 0, summary.total ? round(summary.passed / summary.total, 4) : 0, false, undefined, 0),
    metric('latency p50 (ms)', bs.latency.p50, summary.latency.p50, true, t.latencyPct),
    metric('latency p95 (ms)', bs.latency.p95, summary.latency.p95, true, t.latencyPct),
    metric('total tokens', bs.tokens.totalTokens, summary.tokens.totalTokens, true, t.tokensPct),
  ];
  for (const [k, v] of Object.entries(summary.scores)) {
    const b = bs.scores[k];
    if (b) rows.push(metric(`score: ${k}`, b.mean, v.mean, false, undefined, t.scoreDrop));
  }
  return { baseline: baseline.name, runId: summary.runId, regressions, improvements, summary: rows, passed: !regressions.some((r) => r.kind === 'new-failure' || r.kind === 'score') && !rows.some((r) => r.regressed) };
}
