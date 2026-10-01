import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Tracer, executeHttp, timingSpans, timingSummary } from '../../packages/core/src/index.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((_req, res) => setTimeout(() => res.end('{"ok":true}'), 20));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('HTTP timing phases', () => {
  it('a new connection has a TCP phase, a reused one only the wait and download', async () => {
    const first = (await executeHttp({ method: 'GET', url: `${base}/a`, headers: [], params: [] })).response;
    expect(first.connection).toMatchObject({ reused: false, remoteAddress: '127.0.0.1' });
    expect(first.timeline.map((p) => p.name)).toEqual(['prepare', 'TCP connect', 'waiting (TTFB)', 'download', 'total']);
    const t = timingSummary(first);
    expect(t.ttfbMs).toBeGreaterThanOrEqual(15);
    expect(t.reusedConnection).toBe(false);

    // let the connection go back to the pool (undici opens another one while it is still finishing)
    await new Promise((r) => setTimeout(r, 50));
    const second = (await executeHttp({ method: 'GET', url: `${base}/b?x=1`, headers: [], params: [] })).response;
    expect(second.connection?.reused).toBe(true);
    expect(second.timeline.map((p) => p.name)).toEqual(['prepare', 'waiting (TTFB)', 'download', 'total']);
    expect(timingSummary(second)).not.toHaveProperty('tcpMs');
  });

  it('the phases become child spans of the request span, at their own times', () => {
    const tracer = new Tracer('send');
    const root = tracer.start('GET /', 'http');
    timingSpans(
      root,
      [
        { name: 'prepare', startMs: 0, durationMs: 1 },
        { name: 'TCP connect', startMs: 2, durationMs: 10 },
        { name: 'waiting (TTFB)', startMs: 12, durationMs: 30 },
        { name: 'download', startMs: 42, durationMs: 3 },
        { name: 'total', startMs: 0, durationMs: 45 },
      ],
      1000,
    );
    root.end();
    const kids = tracer.finish().spans.filter((x) => x.parentSpanId === root.id);
    expect(kids.map((k) => [k.name, k.startTime, k.endTime, k.status])).toEqual([
      ['TCP connect', 1002, 1012, 'ok'],
      ['waiting (TTFB)', 1012, 1042, 'ok'],
      ['download', 1042, 1045, 'ok'],
    ]);
  });
});
