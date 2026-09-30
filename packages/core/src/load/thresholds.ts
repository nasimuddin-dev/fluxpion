import { ApsError } from '../errors.js';
import type { LoadSnapshot } from './load.js';

/**
 * Pass/fail rules for a load test, like k6 thresholds: "p95<500", "errors<1%", "rps>=50",
 * "p99[Get pet]<800" (one request of a collection). Latencies are in ms.
 */
export interface LoadThreshold {
  expr: string;
  metric: string;
  request?: string;
  op: '<' | '<=' | '>' | '>=';
  value: number;
  /** "errors<1%": the value is a percentage (compared with the error rate). */
  percent?: boolean;
}

export interface ThresholdResult extends LoadThreshold {
  actual: number | undefined;
  passed: boolean;
}

const METRICS = ['p50', 'p90', 'p95', 'p99', 'avg', 'mean', 'min', 'max', 'errors', 'error_rate', 'rps', 'requests', 'ttft_p95', 'tokens_per_sec'];

export function parseThreshold(expr: string): LoadThreshold {
  const m = /^\s*([a-z_0-9]+)\s*(?:\[([^\]]+)\])?\s*(<=|>=|<|>)\s*([\d.]+)\s*(%|ms|s)?\s*$/i.exec(expr);
  if (!m || !METRICS.includes(m[1]!.toLowerCase()))
    throw new ApsError('ValidationError', `Not a load threshold: "${expr}"`, { suggestions: [`Write metric<value, e.g. p95<500, errors<1%, rps>=50, p99[Get pet]<800. Metrics: ${METRICS.join(', ')}.`] });
  const unit = m[5]?.toLowerCase();
  return {
    expr: expr.trim(),
    metric: m[1]!.toLowerCase(),
    ...(m[2] ? { request: m[2].trim() } : {}),
    op: m[3] as LoadThreshold['op'],
    value: Number(m[4]) * (unit === 's' ? 1000 : 1),
    ...(unit === '%' ? { percent: true } : {}),
  };
}

function actualOf(t: LoadThreshold, s: LoadSnapshot): number | undefined {
  const scope = t.request ? s.perRequest?.find((r) => r.name === t.request) : undefined;
  if (t.request && !scope) return undefined;
  const lat = scope ? scope.latency : s.latency;
  const requests = scope ? scope.requests : s.requests;
  const errors = scope ? scope.errors : s.errors;
  switch (t.metric) {
    case 'p50':
    case 'p90':
    case 'p95':
    case 'p99':
    case 'min':
    case 'max':
      return lat[t.metric];
    case 'avg':
    case 'mean':
      return lat.mean;
    case 'errors':
      // "errors<1%" is the error rate; "errors<5" a count
      return t.percent ? (requests ? (errors / requests) * 100 : 0) : errors;
    case 'error_rate':
      return requests ? (errors / requests) * (t.percent ? 100 : 1) : 0;
    case 'rps':
      return scope ? undefined : s.throughput;
    case 'requests':
      return requests;
    case 'ttft_p95':
      return s.ai?.ttft.p95;
    case 'tokens_per_sec':
      return s.ai?.tokensPerSec;
    default:
      return undefined;
  }
}

/** Check thresholds against the final numbers of a load test. A metric that isn't there fails. */
export function evaluateThresholds(exprs: Array<string | LoadThreshold>, s: LoadSnapshot): ThresholdResult[] {
  return exprs.map((e) => {
    const t = typeof e === 'string' ? parseThreshold(e) : e;
    const actual = actualOf(t, s);
    const passed = actual !== undefined && (t.op === '<' ? actual < t.value : t.op === '<=' ? actual <= t.value : t.op === '>' ? actual > t.value : actual >= t.value);
    return { ...t, actual: actual === undefined ? undefined : Math.round(actual * 100) / 100, passed };
  });
}
