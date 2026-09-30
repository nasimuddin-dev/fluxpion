import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Redactor, exportOtlp, otlpTargetFromEnv, tracesToOtlp, type Trace } from '../../packages/core/src/index.js';

const trace: Trace = {
  traceId: '0af7651916cd43dd8448eb211c80319c',
  name: 'Get patient',
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_000_120,
  status: 'error',
  spans: [
    { traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331', name: 'test Get patient', kind: 'test', startTime: 1_700_000_000_000, endTime: 1_700_000_000_120, status: 'error', error: 'status: expected 200, got 500', attributes: { 'test.id': 'get-patient' } },
    {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: '00f067aa0ba902b7',
      parentSpanId: 'b7ad6b7169203331',
      name: 'GET /patients/7',
      kind: 'http',
      startTime: 1_700_000_000_010,
      durationMs: 100.5,
      status: 'ok',
      attributes: { 'http.status_code': 500, 'http.url': 'http://api.test/patients/7', cached: false, ratio: 0.5 },
      input: { headers: { authorization: 'Bearer sekret-token' } },
      output: 'x'.repeat(5000),
    },
  ],
};

let server: Server;
let base = '';
const received: Array<{ url: string; auth?: string; body: any }> = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.headers['x-api-key'] === 'wrong') return res.writeHead(401).end('bad key');
      received.push({ url: req.url!, auth: req.headers['x-api-key'] as string, body: JSON.parse(b) });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('OpenTelemetry (OTLP) export', () => {
  it('converts traces to OTLP JSON: ids, parents, kinds, times, attributes, status', () => {
    const redactor = new Redactor();
    redactor.addSecret('sekret-token');
    const otlp = tracesToOtlp([trace], { redactor, resource: { 'testpion.run.id': 'run-1' } });
    const rs = otlp.resourceSpans[0]!;
    expect(rs.resource.attributes).toEqual(expect.arrayContaining([{ key: 'service.name', value: { stringValue: 'testpion' } }, { key: 'testpion.run.id', value: { stringValue: 'run-1' } }]));
    const [test, http] = rs.scopeSpans[0]!.spans;
    expect(test).toMatchObject({ traceId: trace.traceId, spanId: 'b7ad6b7169203331', kind: 1, startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000000120000000', status: { code: 2, message: 'status: expected 200, got 500' } });
    expect(test).not.toHaveProperty('parentSpanId');
    expect(http).toMatchObject({ parentSpanId: 'b7ad6b7169203331', kind: 3, endTimeUnixNano: '1700000000110500000', status: { code: 1 } });
    const attr = Object.fromEntries(http!.attributes.map((a) => [a.key, a.value]));
    expect(attr['http.status_code']).toEqual({ intValue: '500' });
    expect(attr.ratio).toEqual({ doubleValue: 0.5 });
    expect(attr.cached).toEqual({ boolValue: false });
    expect(JSON.stringify(attr['testpion.input'])).not.toContain('sekret-token');
    expect((attr['testpion.output'] as { stringValue: string }).stringValue).toMatch(/… \[truncated\]$/);
  });

  it('reads the standard OTEL_EXPORTER_OTLP_* variables', () => {
    expect(otlpTargetFromEnv({})).toBeUndefined();
    expect(otlpTargetFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/', OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=abc%3D1, team=qa' })).toEqual({ endpoint: 'http://collector:4318/v1/traces', headers: { 'x-api-key': 'abc=1', team: 'qa' } });
    expect(otlpTargetFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://a:4318', OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://b/traces' })?.endpoint).toBe('http://b/traces');
  });

  it('posts to the collector’s /v1/traces with the headers, and explains failures', async () => {
    const r = await exportOtlp([trace, { ...trace, traceId: 'ffffffffffffffffffffffffffffffff' }], { endpoint: base, headers: { 'x-api-key': 'k1' } });
    expect(r).toEqual({ spans: 4, url: `${base}/v1/traces` });
    expect(received[0]).toMatchObject({ url: '/v1/traces', auth: 'k1' });
    expect(received[0]!.body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(4);
    await expect(exportOtlp([trace], { endpoint: `${base}/v1/traces`, headers: { 'x-api-key': 'wrong' } })).rejects.toThrow(/answered 401: bad key/);
    await expect(exportOtlp([trace], { endpoint: 'http://127.0.0.1:1' })).rejects.toThrow(/Could not reach the OTLP endpoint/);
  });
});
