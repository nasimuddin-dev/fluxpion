import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { executeHttp, parseSse, SseParser, type SseEvent } from '../../packages/core/src/index.js';

describe('Server-Sent Events parser', () => {
  it('follows the event stream format', () => {
    const events = parseSse(': comment\n\ndata: one\n\nevent: tick\nid: 7\nretry: 1500\ndata: {"n":1}\ndata: line 2\n\ndata\n\n');
    expect(events.map(({ atMs: _a, ...e }) => e)).toEqual([
      { event: 'message', data: 'one' },
      { event: 'tick', data: '{"n":1}\nline 2', id: '7', retry: 1500 },
      { event: 'message', data: '', id: '7' },
    ]);
  });

  it('handles events split across chunks and CRLF / CR line endings', () => {
    const p = new SseParser();
    const out = [...p.push('\uFEFFdata: hel', 5), ...p.push('lo\r', 6), ...p.push('\n\r\nevent: x\rdata: y\r\r', 9)];
    expect(out).toEqual([
      { event: 'message', data: 'hello', atMs: 9 },
      { event: 'x', data: 'y', atMs: 9 },
    ]);
    // an unterminated event at the end is dropped, as browsers do
    expect(parseSse('data: partial')).toEqual([]);
  });
});

describe('SSE responses', () => {
  const server = (count: number | 'forever') =>
    new Promise<{ url: string; close(): void }>((ok) => {
      const s = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let n = 0;
        const t = setInterval(() => {
          res.write(`event: tick\nid: ${n}\ndata: {"n":${n}}\n\n`);
          if (count !== 'forever' && ++n >= count) {
            clearInterval(t);
            res.end();
          } else if (count === 'forever') n++;
        }, 20);
        req.on('close', () => clearInterval(t));
      });
      s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/events`, close: () => s.close() }));
    });

  it('parses events with arrival times and reports each one live', async () => {
    const srv = await server(4);
    try {
      const live: SseEvent[] = [];
      const { response } = await executeHttp({ method: 'GET', url: srv.url }, { onSseEvent: (e) => live.push(e) });
      expect(response.events?.map((e) => e.data)).toEqual(['{"n":0}', '{"n":1}', '{"n":2}', '{"n":3}']);
      expect(live).toHaveLength(4);
      expect(response.events![3]!.atMs).toBeGreaterThanOrEqual(response.events![0]!.atMs);
      expect(response.streamStopped).toBeUndefined();
    } finally {
      srv.close();
    }
  });

  it('stopping an endless stream keeps the events received so far', async () => {
    const srv = await server('forever');
    const ctrl = new AbortController();
    let started = false;
    try {
      const { response } = await executeHttp(
        { method: 'GET', url: srv.url },
        {
          signal: ctrl.signal,
          onResponseStart: () => (started = true),
          onSseEvent: (e) => {
            if (e.id === '2') ctrl.abort();
          },
        },
      );
      expect(started).toBe(true);
      expect(response.streamStopped).toBe(true);
      expect(response.events!.length).toBeGreaterThanOrEqual(3);
      expect(response.status).toBe(200);
    } finally {
      srv.close();
    }
  });

  it('a normal response has no events', async () => {
    const s = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"a":1}'));
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
    try {
      const { response } = await executeHttp({ method: 'GET', url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/` });
      expect(response.events).toBeUndefined();
      expect(response.json).toEqual({ a: 1 });
    } finally {
      s.close();
    }
  });
});
