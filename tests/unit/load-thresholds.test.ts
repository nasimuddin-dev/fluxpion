import { describe, expect, it } from 'vitest';
import { evaluateThresholds, parseThreshold, type LoadSnapshot } from '../../packages/core/src/index.js';

const lat = (p95: number) => ({ count: 100, min: 5, max: 900, mean: 80, p50: 60, p90: p95 - 20, p95, p99: p95 + 100 });
const snap = {
  elapsedSec: 10,
  done: true,
  activeVUs: 0,
  requests: 200,
  errors: 3,
  connectionFailures: 0,
  errorRate: 0.015,
  throughput: 19.8,
  currentRps: 0,
  bytes: 0,
  latency: lat(240),
  statusCodes: {},
  errorKinds: {},
  series: [],
  perRequest: [
    { name: 'Log in', requests: 100, errors: 0, latency: lat(90) },
    { name: 'Get pet', requests: 100, errors: 3, latency: lat(410) },
  ],
} as LoadSnapshot;

describe('load test thresholds', () => {
  it('parses rules with units and per-request scopes', () => {
    expect(parseThreshold('p95 < 500')).toEqual({ expr: 'p95 < 500', metric: 'p95', op: '<', value: 500 });
    expect(parseThreshold('p99[Get pet]<=1s')).toMatchObject({ metric: 'p99', request: 'Get pet', op: '<=', value: 1000 });
    expect(parseThreshold('errors<1%')).toMatchObject({ metric: 'errors', value: 1, percent: true });
    expect(() => parseThreshold('latency<5')).toThrow(/Not a load threshold/);
  });

  it('checks them against the results', () => {
    const r = evaluateThresholds(['p95<500', 'errors<1%', 'errors<=3', 'rps>=15', 'p95[Get pet]<300', 'p95[Log in]<300', 'p95[Missing]<300', 'avg<100'], snap);
    expect(r.map((x) => [x.expr, x.actual, x.passed])).toEqual([
      ['p95<500', 240, true],
      ['errors<1%', 1.5, false],
      ['errors<=3', 3, true],
      ['rps>=15', 19.8, true],
      ['p95[Get pet]<300', 410, false],
      ['p95[Log in]<300', 90, true],
      ['p95[Missing]<300', undefined, false],
      ['avg<100', 80, true],
    ]);
  });
});
