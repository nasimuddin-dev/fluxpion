import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CookieJar, executeHttp, type HttpRequestSpec } from '../../packages/core/src/index.js';

/** Postman-style per-request settings: redirect behaviour, URL encoding, cookie jar opt-out. */

let a: Server;
let b: Server;
let A = '';
let B = '';

const readBody = (req: IncomingMessage) => new Promise<string>((ok) => {
  let s = '';
  req.on('data', (c) => (s += c)).on('end', () => ok(s));
});

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, 'http://x');
  const reply = async () =>
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'seen=1; Path=/' }).end(
      JSON.stringify({ method: req.method, body: await readBody(req), auth: req.headers.authorization ?? null, referer: req.headers.referer ?? null, cookie: req.headers.cookie ?? null, rawQuery: req.url!.split('?')[1] ?? '' }),
    );
  if (url.pathname === '/r302') return res.writeHead(302, { location: '/echo' }).end();
  if (url.pathname === '/r303') return res.writeHead(303, { location: '/echo' }).end();
  if (url.pathname === '/cross') return res.writeHead(302, { location: `${B}/echo` }).end();
  return reply();
}

beforeAll(async () => {
  a = createServer(handler);
  b = createServer(handler);
  await Promise.all([a, b].map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))));
  A = `http://127.0.0.1:${(a.address() as AddressInfo).port}`;
  // another origin: a different port on localhost
  B = `http://localhost:${(b.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.all([a, b].map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const send = async (spec: Partial<HttpRequestSpec>, opts = {}) => JSON.parse((await executeHttp({ method: 'GET', url: `${A}/echo`, ...spec } as HttpRequestSpec, opts)).response.bodyPreview);
const post = { method: 'POST', body: { type: 'text' as const, content: 'hello' } };

describe('request settings', () => {
  it('follows 301/302 with GET by default, or with the original method', async () => {
    expect(await send({ ...post, url: `${A}/r302` })).toMatchObject({ method: 'GET', body: '' });
    expect(await send({ ...post, url: `${A}/r302`, settings: { followOriginalMethod: true } })).toMatchObject({ method: 'POST', body: 'hello' });
    // 303 always becomes GET
    expect(await send({ ...post, url: `${A}/r303`, settings: { followOriginalMethod: true } })).toMatchObject({ method: 'GET' });
  });

  it('drops Authorization on a cross-origin redirect unless told to keep it', async () => {
    const auth = { type: 'bearer' as const, token: 't0k3n' };
    expect((await send({ url: `${A}/cross`, auth })).auth).toBeNull();
    expect((await send({ url: `${A}/cross`, auth, settings: { followAuthorizationHeader: true } })).auth).toBe('Bearer t0k3n');
  });

  it('can remove the Referer header on redirect', async () => {
    const headers = [{ key: 'Referer', value: 'https://app.example/page' }];
    expect((await send({ url: `${A}/r302`, headers })).referer).toBe('https://app.example/page');
    expect((await send({ url: `${A}/r302`, headers, settings: { removeRefererOnRedirect: true } })).referer).toBeNull();
  });

  it('encodes query values by default and sends them as typed when turned off', async () => {
    const params = [{ key: 'q', value: 'a+b/c' }];
    expect((await send({ params })).rawQuery).toBe('q=a%2Bb%2Fc');
    expect((await send({ params, settings: { encodeUrl: false } })).rawQuery).toBe('q=a+b/c');
    // characters that can't be sent at all are still escaped
    expect((await send({ params: [{ key: 'q', value: 'a b' }], settings: { encodeUrl: false } })).rawQuery).toBe('q=a%20b');
  });

  it('can leave the cookie jar out of a request', async () => {
    const jar = new CookieJar();
    jar.set({ domain: '127.0.0.1', name: 'session', value: 'abc', path: '/' });
    expect((await send({}, { cookieJar: jar })).cookie).toContain('session=abc');
    expect(jar.list().map((c) => c.name).sort()).toEqual(['seen', 'session']);

    const jar2 = new CookieJar();
    jar2.set({ domain: '127.0.0.1', name: 'session', value: 'abc', path: '/' });
    expect((await send({ settings: { disableCookieJar: true } }, { cookieJar: jar2 })).cookie).toBeNull();
    expect(jar2.list().map((c) => c.name)).toEqual(['session']);
  });
});
