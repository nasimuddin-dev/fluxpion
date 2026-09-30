import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSecureServer, type Http2SecureServer } from 'node:http2';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { executeHttp } from '../../packages/core/src/index.js';

// test-only certificates (tests/fixtures/tls): a server certificate for 127.0.0.1
const pem = (f: string) => readFileSync(join('tests/fixtures/tls', f), 'utf8');
let server: Http2SecureServer;
let url = '';

beforeAll(async () => {
  // HTTP/2 with HTTP/1.1 as the fallback, like most servers
  server = createSecureServer({ key: pem('server.key'), cert: pem('server.crt'), allowHTTP1: true }, (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ httpVersion: req.httpVersion, path: req.url }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/pets`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('HTTP/2', () => {
  it('uses HTTP/1.1 when the request says so', async () => {
    const { response } = await executeHttp({ method: 'GET', url, settings: { insecure: true, http1Only: true } });
    expect(response.httpVersion).toBe('1.1');
    expect(response.json).toEqual({ httpVersion: '1.1', path: '/pets' });
  });

  it('negotiates HTTP/2 with ALPN by default', async () => {
    const { response } = await executeHttp({ method: 'POST', url, settings: { insecure: true }, headers: [{ key: 'content-type', value: 'application/json' }], body: { type: 'json', content: '{"a":1}' } });
    expect(response.status).toBe(200);
    expect(response.httpVersion).toBe('2');
    // HTTP/2 has no reason phrase; the standard one is filled in
    expect(response.statusText).toBe('OK');
    expect(response.json).toEqual({ httpVersion: '2.0', path: '/pets' });
  });
});
