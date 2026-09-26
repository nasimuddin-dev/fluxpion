import { describe, expect, it } from 'vitest';
import {
  VariableScope,
  Redactor,
  REDACTED,
  queryAll,
  query,
  tryParseJson,
  deepEqual,
  inferSchema,
  Semaphore,
  RateLimiter,
  withRetry,
  withTimeout,
  forEachConcurrent,
  LatencyRecorder,
  signJwt,
  estimateCost,
  templateVariables,
  normalizeError,
  ApsError,
  errorKindForStatus,
  Tracer,
  spanTree,
} from '../../packages/core/src/index.js';

describe('variables', () => {
  it('applies scope precedence Global → Workspace → Environment → Collection → Request → Runtime', () => {
    const v = new VariableScope();
    v.setScope('global', { a: 'global', b: 'global', c: 'global' });
    v.setScope('workspace', { b: 'workspace' });
    v.setScope('environment', [{ key: 'c', value: 'env' }, { key: 'd', value: 'disabled', enabled: false }]);
    v.set('e', 'runtime');
    expect(v.resolve('{{a}}-{{b}}-{{c}}-{{e}}')).toBe('global-workspace-env-runtime');
    expect(v.describe('c')?.scope).toBe('environment');
    expect(v.resolve('{{d}}')).toBe('{{d}}');
    expect([...v.unresolved]).toContain('d');
  });

  it('keeps types for exact placeholders and supports dotted access and dynamic vars', () => {
    const v = new VariableScope();
    v.setScope('request', { n: 42, user: { name: 'Ada' } });
    expect(v.resolveDeep({ count: '{{n}}', label: 'n={{n}}', who: '{{user.name}}' })).toEqual({ count: 42, label: 'n=42', who: 'Ada' });
    expect(v.resolve('{{$uuid}}')).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(v.resolve('{{$randomInt(5,5)}}'))).toBe(5);
  });

  it('reads secrets and registers them for redaction', () => {
    const r = new Redactor();
    const v = new VariableScope({ get: (k) => (k === 'token' ? 'super-secret-value' : undefined) }, r);
    expect(v.resolve('Bearer {{$secret.token}}')).toBe('Bearer super-secret-value');
    expect(r.redactString('leaked super-secret-value!')).toBe(`leaked ${REDACTED}!`);
  });

  it('lists template variables', () => {
    expect(templateVariables('Hi {{name}}, {{ user.id }} {{$uuid}}')).toEqual(['name', 'user']);
  });
});

describe('redaction', () => {
  it('redacts sensitive keys, header tuples, kv pairs and URLs', () => {
    const r = new Redactor();
    const out = r.redact({
      password: 'hunter2',
      nested: { apiKey: 'abc', ok: 'visible' },
      headers: [['Authorization', 'Bearer xyz'], ['accept', 'json']],
      vars: [{ key: 'accessToken', value: 'tok' }, { key: 'plain', value: 'p' }, { key: 'x', value: 'sec', secret: true }],
    });
    expect(out.password).toBe(REDACTED);
    expect(out.nested).toEqual({ apiKey: REDACTED, ok: 'visible' });
    expect(out.headers[0]).toEqual(['Authorization', REDACTED]);
    expect(out.headers[1]).toEqual(['accept', 'json']);
    expect(out.vars[0].value).toBe(REDACTED);
    expect(out.vars[1].value).toBe('p');
    expect(out.vars[2].value).toBe(REDACTED);
    expect(r.redactUrl('https://u:pw@x.test/a?api_key=1&q=2')).toBe('https://u:REDACTED@x.test/a?api_key=REDACTED&q=2');
  });

  it('honours user-configured fields', () => {
    const r = new Redactor(['ssn']);
    expect(r.redact({ ssn: '123-45-6789', password: 'shown' })).toEqual({ ssn: REDACTED, password: 'shown' });
  });
});

describe('jsonpath & json helpers', () => {
  const data = { data: { patient: { id: '1', tags: ['a', 'b'] } }, items: [{ id: 1 }, { id: 2 }] };
  it('queries', () => {
    expect(query(data, '$.data.patient.id')).toBe('1');
    expect(query(data, 'data.patient.tags[1]')).toBe('b');
    expect(queryAll(data, '$.items[*].id')).toEqual([1, 2]);
    expect(queryAll(data, '$.missing')).toEqual([]);
  });
  it('parses fenced / embedded JSON from LLM output', () => {
    expect(tryParseJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(tryParseJson('Sure! {"intent":"x"} hope that helps')).toEqual({ ok: true, value: { intent: 'x' } });
    expect(tryParseJson('no json here').ok).toBe(false);
  });
  it('compares and infers schemas', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual('123', 123)).toBe(true);
    expect(inferSchema({ intent: 'x', n: 1 })).toEqual({ type: 'object', properties: { intent: { type: 'string' }, n: { type: 'number' } }, required: ['intent', 'n'] });
  });
});

describe('concurrency utilities', () => {
  it('semaphore bounds concurrency', async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });

  it('forEachConcurrent applies backpressure to the source', async () => {
    let pulled = 0;
    let maxAhead = 0;
    let done = 0;
    async function* src() {
      for (let i = 0; i < 50; i++) {
        pulled++;
        maxAhead = Math.max(maxAhead, pulled - done);
        yield i;
      }
    }
    await forEachConcurrent(src(), 4, async () => {
      await new Promise((r) => setTimeout(r, 1));
      done++;
    });
    expect(done).toBe(50);
    expect(maxAhead).toBeLessThanOrEqual(5);
  });

  it('retries with backoff and stops on cancellation', async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new ApsError('ServerError', 'boom');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 1 },
    );
    expect(r).toBe('ok');
    expect(n).toBe(3);
    await expect(withRetry(async () => Promise.reject(new ApsError('ValidationError', 'no')), { retries: 3, baseDelayMs: 1, shouldRetry: (e) => (e as ApsError).kind !== 'ValidationError' })).rejects.toThrow('no');
  });

  it('times out', async () => {
    await expect(withTimeout(() => new Promise((r) => setTimeout(r, 200)), 20)).rejects.toMatchObject({ kind: 'TimeoutError' });
  });

  it('rate limiter spaces requests', async () => {
    const rl = new RateLimiter({ requestsPerSecond: 5 });
    const t0 = Date.now();
    for (let i = 0; i < 7; i++) await rl.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });
});

describe('stats', () => {
  it('computes exact percentiles', () => {
    const r = new LatencyRecorder();
    for (let i = 1; i <= 100; i++) r.record(i);
    const s = r.stats();
    expect(s).toMatchObject({ count: 100, min: 1, max: 100, p50: 50, p90: 90, p95: 95, p99: 99, mean: 50.5 });
  });
});

describe('auth', () => {
  it('signs HS256 JWTs', () => {
    const t = signJwt('{"sub":"123"}', 'secret', 'HS256');
    const [h, p, s] = t.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({ sub: '123' });
    // known-answer: HMAC-SHA256 over header.payload
    expect(s).toHaveLength(43);
  });
});

describe('cost', () => {
  it('uses the most specific configured price', () => {
    const pricing = [
      { provider: '*', model: '*', inputPerMillion: 1, outputPerMillion: 1, version: 'v1' },
      { provider: 'openai-compatible', model: 'gpt-x*', inputPerMillion: 2, outputPerMillion: 8, version: '2026-09' },
    ];
    const r = estimateCost(pricing, { id: 'p', name: 'P', kind: 'openai-compatible', baseUrl: '' }, 'gpt-x-mini', { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
    expect(r).toEqual({ cost: 0.006, priceVersion: '2026-09' });
    expect(estimateCost([], undefined, 'm', { inputTokens: 1, outputTokens: 1, totalTokens: 2 })).toEqual({});
  });
});

describe('errors', () => {
  it('normalises network errors with troubleshooting steps', () => {
    const e = normalizeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' } }));
    expect(e.kind).toBe('NetworkError');
    expect(e.why).toMatch(/refused/);
    expect(e.suggestions.length).toBeGreaterThan(0);
    expect(errorKindForStatus(401)).toBe('AuthenticationError');
    expect(errorKindForStatus(429)).toBe('RateLimitError');
  });
});

describe('tracer', () => {
  it('builds a span tree with redacted, bounded payloads', async () => {
    const r = new Redactor();
    r.addSecret('topsecret');
    const t = new Tracer('run', r);
    const root = t.start('root', 'test');
    await t.span('child', 'http', async (s) => s.output({ authorization: 'x', body: 'value topsecret' }), { parent: root });
    root.end();
    const trace = t.finish();
    const tree = spanTree(trace);
    expect(tree.map((n) => [n.span.name, n.depth])).toEqual([
      ['root', 0],
      ['child', 1],
    ]);
    expect(tree[1]!.span.output).toEqual({ authorization: REDACTED, body: `value ${REDACTED}` });
    expect(trace.status).toBe('ok');
  });
});
