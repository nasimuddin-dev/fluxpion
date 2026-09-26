import { isIP } from 'node:net';
import type { HttpRequestSpec, LatencyStats, ModelRef, PriceEntry } from '../model/types.js';
import { ApsError, normalizeError } from '../errors.js';
import { buildUrl, executeHttp } from '../protocols/http/client.js';
import { LatencyRecorder, round } from '../util/stats.js';
import { sleep } from '../util/concurrency.js';
import { estimateCost, type ProviderRegistry } from '../ai/index.js';
import type { Redactor } from '../util/redact.js';

export type LoadTarget = { kind: 'http'; request: HttpRequestSpec } | { kind: 'llm'; model: ModelRef; prompt: string; stream?: boolean };

export interface LoadTestConfig {
  target: LoadTarget;
  virtualUsers: number;
  durationSec: number;
  rampUpSec?: number;
  rampDownSec?: number;
  /** Global cap on request starts per second (0/undefined = unlimited). */
  requestsPerSecond?: number;
  thinkTimeMs?: number;
  /** Safeguards (spec §21): remote hosts and production environments require explicit opt-in. */
  allowRemoteHosts?: boolean;
  allowProduction?: boolean;
  environmentIsProduction?: boolean;
  maxVirtualUsers?: number;
}

export interface LoadSnapshot {
  elapsedSec: number;
  done: boolean;
  activeVUs: number;
  requests: number;
  errors: number;
  connectionFailures: number;
  errorRate: number;
  throughput: number;
  currentRps: number;
  bytes: number;
  latency: LatencyStats;
  statusCodes: Record<string, number>;
  errorKinds: Record<string, number>;
  ai?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    tokensPerSec: number;
    costUsd?: number;
    ttft: LatencyStats;
    interTokenMsAvg?: number;
    generation: LatencyStats;
  };
  series: Array<{ t: number; rps: number; p95: number; errors: number; vus: number }>;
}

class TokenBucket {
  private tokens: number;
  private last = performance.now();
  constructor(private rate: number) {
    this.tokens = Math.min(rate, 1);
  }
  async take(signal: AbortSignal): Promise<void> {
    for (;;) {
      const now = performance.now();
      this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.max(1, ((1 - this.tokens) / this.rate) * 1000), signal);
    }
  }
}

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\.0\.0\.0$/];

/** Hosts considered local/non-production by default. */
export function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.test') || h.endsWith('.local') || h === '::1') return true;
  if (isIP(h) === 4) return PRIVATE_V4.some((r) => r.test(h));
  if (isIP(h) === 6) return h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  return false;
}

export function checkLoadSafeguards(cfg: LoadTestConfig, resolvedUrl?: string): void {
  if (cfg.maxVirtualUsers && cfg.virtualUsers > cfg.maxVirtualUsers)
    throw new ApsError('ConfigurationError', `Virtual users (${cfg.virtualUsers}) exceed the configured maximum (${cfg.maxVirtualUsers})`, {
      suggestions: ['Raise the limit in Settings → Load testing if this is intentional.'],
    });
  if (cfg.environmentIsProduction && !cfg.allowProduction)
    throw new ApsError('ConfigurationError', 'Load testing is blocked for environments marked as production', {
      why: 'Load tests can degrade or take down live systems.',
      suggestions: ['Run against a staging environment.', 'If you are authorised to load-test production, enable "Allow production" explicitly for this run.'],
    });
  if (resolvedUrl && !cfg.allowRemoteHosts) {
    const host = new URL(resolvedUrl).hostname;
    if (!isLocalHost(host))
      throw new ApsError('ConfigurationError', `Load testing remote host "${host}" requires explicit opt-in`, {
        why: 'By default load tests may only target local or private-network hosts.',
        suggestions: ['Only load-test systems you own or are authorised to test.', 'Enable "Allow remote hosts" for this run (or --allow-remote in the CLI).'],
      });
  }
}

/** Run a load test. The target must already have variables resolved. */
export async function runLoadTest(
  cfg: LoadTestConfig,
  deps: { providers?: ProviderRegistry; pricing?: PriceEntry[]; redactor?: Redactor; signal?: AbortSignal; onSnapshot?: (s: LoadSnapshot) => void },
): Promise<LoadSnapshot> {
  const url = cfg.target.kind === 'http' ? buildUrl(cfg.target.request.url, cfg.target.request.params).toString() : undefined;
  checkLoadSafeguards(cfg, url);
  if (cfg.virtualUsers < 1 || cfg.durationSec <= 0) throw new ApsError('ConfigurationError', 'virtualUsers and durationSec must be positive');

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  deps.signal?.addEventListener('abort', onAbort, { once: true });
  const signal = ctrl.signal;

  const latency = new LatencyRecorder();
  const ttft = new LatencyRecorder();
  const gen = new LatencyRecorder();
  const status: Record<string, number> = {};
  const errKinds: Record<string, number> = {};
  const series: LoadSnapshot['series'] = [];
  let requests = 0;
  let errors = 0;
  let connFail = 0;
  let bytes = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let costKnown = false;
  let interSum = 0;
  let interN = 0;
  let secReq = 0;
  let secErr = 0;
  let secLat = new LatencyRecorder();

  const start = performance.now();
  const endAt = start + cfg.durationSec * 1000;
  const up = (cfg.rampUpSec ?? 0) * 1000;
  const down = (cfg.rampDownSec ?? 0) * 1000;
  const targetVUs = (now: number) => {
    const t = now - start;
    const remaining = endAt - now;
    let f = 1;
    if (up > 0 && t < up) f = t / up;
    if (down > 0 && remaining < down) f = Math.min(f, remaining / down);
    return Math.max(1, Math.ceil(cfg.virtualUsers * Math.max(0, f)));
  };
  let active = 0;
  const bucket = cfg.requestsPerSecond ? new TokenBucket(cfg.requestsPerSecond) : undefined;

  const llm = cfg.target.kind === 'llm' ? deps.providers?.resolveModel(cfg.target.model) : undefined;
  if (cfg.target.kind === 'llm' && !llm) throw new ApsError('ConfigurationError', 'No provider registry for LLM load test');

  const once = async () => {
    const t0 = performance.now();
    try {
      if (cfg.target.kind === 'http') {
        const { response } = await executeHttp(cfg.target.request, { signal, discardBody: true, redactor: deps.redactor });
        const ms = performance.now() - t0;
        bytes += response.size;
        status[response.status] = (status[response.status] ?? 0) + 1;
        latency.record(ms);
        secLat.record(ms);
        if (response.status >= 400) {
          errors++;
          secErr++;
        }
      } else {
        const tgt = cfg.target;
        const r = await llm!.provider.chat({ model: llm!.model, messages: [{ role: 'user', content: tgt.prompt }], stream: tgt.stream ?? true, temperature: tgt.model.temperature, maxTokens: tgt.model.maxTokens, signal });
        const ms = performance.now() - t0;
        latency.record(ms);
        secLat.record(ms);
        gen.record(r.timing.totalMs);
        if (r.timing.firstTokenMs !== undefined) ttft.record(r.timing.firstTokenMs);
        if (r.timing.interTokenMsAvg !== undefined) {
          interSum += r.timing.interTokenMsAvg;
          interN++;
        }
        tokensIn += r.usage.inputTokens;
        tokensOut += r.usage.outputTokens;
        const c = estimateCost(deps.pricing ?? [], llm!.provider.config, r.model || llm!.model, r.usage);
        if (c.cost !== undefined) {
          cost += c.cost;
          costKnown = true;
        }
        status['200'] = (status['200'] ?? 0) + 1;
      }
    } catch (e) {
      if (signal.aborted) return;
      const err = normalizeError(e);
      errors++;
      secErr++;
      errKinds[err.kind] = (errKinds[err.kind] ?? 0) + 1;
      if (err.kind === 'NetworkError' || err.kind === 'TimeoutError') connFail++;
      const st = (err.details?.status as number | undefined) ?? err.kind;
      status[st] = (status[st] ?? 0) + 1;
    } finally {
      requests++;
      secReq++;
    }
  };

  const vu = async (i: number) => {
    while (!signal.aborted && performance.now() < endAt) {
      if (i >= targetVUs(performance.now())) {
        await sleep(100, signal).catch(() => undefined);
        continue;
      }
      if (bucket) await bucket.take(signal).catch(() => undefined);
      if (signal.aborted || performance.now() >= endAt) break;
      active++;
      await once();
      active--;
      if (cfg.thinkTimeMs) await sleep(cfg.thinkTimeMs, signal).catch(() => undefined);
    }
  };

  const snapshot = (done: boolean): LoadSnapshot => {
    const elapsed = (performance.now() - start) / 1000;
    const snap: LoadSnapshot = {
      elapsedSec: round(elapsed, 1),
      done,
      activeVUs: done ? 0 : targetVUs(performance.now()),
      requests,
      errors,
      connectionFailures: connFail,
      errorRate: requests ? round(errors / requests, 4) : 0,
      throughput: elapsed ? round(requests / elapsed, 2) : 0,
      currentRps: series.length ? series[series.length - 1]!.rps : 0,
      bytes,
      latency: latency.stats(),
      statusCodes: { ...status },
      errorKinds: { ...errKinds },
      series: series.slice(-600),
    };
    if (cfg.target.kind === 'llm')
      snap.ai = {
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        totalTokens: tokensIn + tokensOut,
        tokensPerSec: elapsed ? round(tokensOut / elapsed, 1) : 0,
        costUsd: costKnown ? round(cost, 6) : undefined,
        ttft: ttft.stats(),
        interTokenMsAvg: interN ? round(interSum / interN, 2) : undefined,
        generation: gen.stats(),
      };
    return snap;
  };

  const ticker = setInterval(() => {
    const p95 = secLat.stats().p95;
    series.push({ t: round((performance.now() - start) / 1000, 0), rps: secReq, p95, errors: secErr, vus: targetVUs(performance.now()) });
    secReq = 0;
    secErr = 0;
    secLat = new LatencyRecorder();
    deps.onSnapshot?.(snapshot(false));
  }, 1000);

  try {
    await Promise.all(Array.from({ length: cfg.virtualUsers }, (_, i) => vu(i)));
  } finally {
    clearInterval(ticker);
    deps.signal?.removeEventListener('abort', onAbort);
  }
  void active;
  const final = snapshot(true);
  deps.onSnapshot?.(final);
  return final;
}
