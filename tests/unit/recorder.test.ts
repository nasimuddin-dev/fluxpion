import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Redactor, recordingToCollection, startMockServer, startRecorder, type SavedHttpRequest } from '../../packages/core/src/index.js';

let api: Server;
let target: string;
beforeAll(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/old') return res.writeHead(302, { location: `${target}/pets?limit=1` }).end();
      if (req.headers.authorization !== 'Bearer sk-live-777') return res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"auth"}');
      if (req.method === 'POST') return res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': 'sid=abc; Domain=api.example.com; Path=/; Secure' }).end(JSON.stringify({ id: 9, ...JSON.parse(body) }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ id: 1, name: 'Rex' }]));
    });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  target = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => api.close(() => r())));

describe('recording traffic', () => {
  it('forwards and records, keeps redirects on the proxy, and becomes a mockable collection', async () => {
    const seen: string[] = [];
    const rec = await startRecorder({ target, onExchange: (e) => seen.push(`${e.method} ${e.path} ${e.status}`) });
    try {
      const auth = { authorization: 'Bearer sk-live-777' };
      const list = await fetch(`${rec.url}/pets?limit=2`, { headers: auth });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([{ id: 1, name: 'Rex' }]);
      const created = await fetch(`${rec.url}/pets`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'sec-fetch-mode': 'cors' }, body: '{"name":"Tom"}' });
      expect(created.status).toBe(201);
      // cookies lose the target's Domain and Secure, so the browser keeps them for the proxy
      expect(created.headers.get('set-cookie')).toBe('sid=abc; Path=/');
      // a redirect to the target comes back through the proxy
      const moved = await fetch(`${rec.url}/old`, { redirect: 'manual' });
      expect(moved.headers.get('location')).toBe(`${rec.url}/pets?limit=1`);
      // CORS preflight answered locally
      const pre = await fetch(`${rec.url}/pets`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(seen).toEqual(['GET /pets?limit=2 200', 'POST /pets 201', 'GET /old 302']);
      expect(rec.exchanges[1]!.requestBody).toBe('{"name":"Tom"}');

      const { collection, placeholders, requests } = recordingToCollection(rec.exchanges, { name: 'Recorded', target, redactor: new Redactor() });
      expect(requests).toBe(3);
      expect(placeholders.map((p) => p.variable)).toEqual(['authorization']);
      expect(collection.variables).toEqual([{ key: 'baseUrl', value: target, enabled: true }]);
      const nodes = collection.items as SavedHttpRequest[];
      const post = nodes.find((n) => n.name === 'POST /pets')!;
      expect(post.request).toMatchObject({ method: 'POST', url: '{{baseUrl}}/pets', body: { type: 'json' } });
      expect(JSON.parse((post.request.body as { content: string }).content)).toEqual({ name: 'Tom' });
      // secrets became variables, browser noise is gone
      expect(post.request.headers!.map((h) => [h.key, h.value])).toEqual([
        ['authorization', '{{authorization}}'],
        ['content-type', 'application/json'],
      ]);
      expect(JSON.stringify(collection)).not.toContain('sk-live-777');
      const get = nodes.find((n) => n.name === 'GET /pets')!;
      expect(get.request.params).toEqual([{ key: 'limit', value: '2', enabled: true }]);
      expect(get.examples![0]).toMatchObject({ status: 200, body: '[{"id":1,"name":"Rex"}]' });

      // the recording can be served back without the real API
      const mock = await startMockServer(collection);
      try {
        expect(await (await fetch(`${mock.url}/pets`)).json()).toEqual([{ id: 1, name: 'Rex' }]);
      } finally {
        await mock.close();
      }
    } finally {
      await rec.close();
    }
  });

  it('reports an unreachable target as 502 and refuses bad targets', async () => {
    const rec = await startRecorder({ target: 'http://127.0.0.1:1' });
    try {
      const r = await fetch(`${rec.url}/x`);
      expect(r.status).toBe(502);
      expect(rec.exchanges[0]!.error).toBeTruthy();
    } finally {
      await rec.close();
    }
    await expect(startRecorder({ target: 'ftp://x' })).rejects.toThrow(/http or https/);
  });
});
