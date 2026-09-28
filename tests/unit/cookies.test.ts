import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CookieJar,
  CookieJarStore,
  MemorySecretStore,
  EnvSecretStore,
  Redactor,
  VariableScope,
  ProviderRegistry,
  McpManager,
  applyCookieJarOps,
  executeHttp,
  parseSetCookieHeader,
  runScript,
  runTests,
  secretKeys,
  type ExecServices,
  type TestCase,
} from '../../packages/core/src/index.js';
// @ts-expect-error - plain JS example module
import { createRestServer } from '../../examples/servers/demo-servers.mjs';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createRestServer();
  base = await new Promise<string>((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('Set-Cookie parsing', () => {
  it('uses host-only domain and the default path', () => {
    const c = parseSetCookieHeader('sid=1; HttpOnly', 'https://api.example.com/v1/login')!;
    expect(c).toMatchObject({ name: 'sid', value: '1', domain: 'api.example.com', path: '/v1', hostOnly: true, httpOnly: true });
  });
  it('accepts a parent Domain and rejects a foreign one', () => {
    expect(parseSetCookieHeader('a=1; Domain=.example.com', 'https://api.example.com/')).toMatchObject({ domain: 'example.com', hostOnly: false });
    expect(parseSetCookieHeader('a=1; Domain=evil.com', 'https://api.example.com/')).toBeUndefined();
    expect(parseSetCookieHeader('a=1; Domain=com', 'https://api.example.com/')).toBeUndefined();
  });
  it('rejects Secure cookies from plain http (except localhost) and prefers Max-Age over Expires', () => {
    expect(parseSetCookieHeader('a=1; Secure', 'http://example.com/')).toBeUndefined();
    expect(parseSetCookieHeader('a=1; Secure', 'http://localhost:3000/')).toBeDefined();
    const now = Date.parse('2026-01-01T00:00:00Z');
    const c = parseSetCookieHeader('a=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=60', 'https://x.io/', now)!;
    expect(c.expires).toBe('2026-01-01T00:01:00.000Z');
  });
});

describe('CookieJar', () => {
  it('matches domain, path and Secure, longest path first', () => {
    const jar = new CookieJar();
    jar.storeFromResponse('https://api.example.com/app/login', ['a=1; Path=/', 'b=2; Path=/app', 'c=3; Domain=example.com; Path=/', 'd=4; Secure; Path=/']);
    expect(jar.headerFor('https://api.example.com/app/x')).toBe('b=2; a=1; c=3; d=4');
    expect(jar.headerFor('https://www.example.com/')).toBe('c=3');
    expect(jar.headerFor('http://api.example.com/other')).toBe('a=1; c=3');
    expect(jar.domains()).toEqual(['api.example.com', 'example.com']);
  });
  it('deletes a cookie on Max-Age=0 and drops expired cookies', () => {
    const jar = new CookieJar();
    jar.storeFromResponse('https://x.io/', ['s=1; Path=/']);
    jar.storeFromResponse('https://x.io/', ['s=; Path=/; Max-Age=0']);
    expect(jar.list()).toEqual([]);
    jar.set({ name: 'old', value: '1', domain: 'x.io', expires: '2000-01-01T00:00:00Z' });
    expect(jar.list()).toEqual([]);
  });
  it('supports manual set, remove and clear per domain', () => {
    const jar = new CookieJar();
    jar.set({ name: 'a', value: '1', domain: '.one.test' });
    jar.set({ name: 'b', value: '2', domain: 'one.test' });
    jar.set({ name: 'c', value: '3', domain: 'two.test' });
    expect(jar.headerFor('http://sub.one.test/')).toBe('a=1; b=2');
    expect(jar.remove('one.test', 'a')).toBe(1);
    expect(jar.clear('one.test')).toBe(1);
    expect(jar.list().map((c) => c.name)).toEqual(['c']);
  });
});

describe('CookieJarStore', () => {
  it('keeps the jar encrypted in the secret store, never elsewhere', async () => {
    const secrets = new MemorySecretStore();
    const store = new CookieJarStore(secrets, 'ws1', 0);
    store.jar.set({ name: 'sid', value: 'tok-SECRET', domain: 'x.io' });
    await store.flush();
    expect(secrets.get(secretKeys.cookies('ws1'))).toContain('tok-SECRET');
    expect(new CookieJarStore(secrets, 'ws1').jar.headerFor('https://x.io/')).toBe('sid=tok-SECRET');
    store.jar.clear();
    await store.flush();
    expect(secrets.get(secretKeys.cookies('ws1'))).toBeUndefined();
  });
  it('is memory-only with a read-only store (CLI)', async () => {
    const store = new CookieJarStore(new EnvSecretStore({}), 'ws1', 0);
    store.jar.set({ name: 'a', value: '1', domain: 'x.io' });
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.persistent).toBe(false);
  });
});

describe('HTTP client with a cookie jar', () => {
  it('keeps cookies set during a redirect and sends them on later requests', async () => {
    const jar = new CookieJar();
    const login = await executeHttp({ method: 'POST', url: `${base}/session/login`, body: { type: 'json', content: '{"username":"vet","password":"paws"}' } }, { cookieJar: jar });
    expect(login.response.status).toBe(200);
    expect(login.response.redirected).toBe(true);
    expect(login.response.url).toBe(`${base}/session/me`);
    expect(login.response.json).toEqual({ user: 'vet', clinic: 'north' });

    const me = await executeHttp({ method: 'GET', url: `${base}/session/me` }, { cookieJar: jar });
    expect(me.response.status).toBe(200);
    expect(me.prepared.headers.find(([k]) => k === 'cookie')?.[1]).toContain('vet_session=s-7f3a9');

    await executeHttp({ method: 'POST', url: `${base}/session/logout` }, { cookieJar: jar });
    expect(jar.list().map((c) => c.name)).toEqual(['clinic']);
    expect((await executeHttp({ method: 'GET', url: `${base}/session/me` }, { cookieJar: jar })).response.status).toBe(401);
  });
  it('lets request cookies override jar cookies with the same name', async () => {
    const jar = new CookieJar();
    jar.set({ name: 'theme', value: 'light', domain: '127.0.0.1' });
    jar.set({ name: 'lang', value: 'en', domain: '127.0.0.1' });
    const r = await executeHttp({ method: 'GET', url: `${base}/echo`, cookies: [{ key: 'theme', value: 'dark' }] }, { cookieJar: jar });
    expect((r.response.json as { headers: Record<string, string> }).headers.cookie).toBe('theme=dark; lang=en');
  });
  it('does not follow redirects manually when redirects are disabled', async () => {
    const jar = new CookieJar();
    const r = await executeHttp({ method: 'POST', url: `${base}/session/login`, body: { type: 'json', content: '{"username":"vet","password":"paws"}' }, settings: { followRedirects: false } }, { cookieJar: jar });
    expect(r.response.status).toBe(303);
    expect(jar.list().map((c) => c.name).sort()).toEqual(['clinic', 'vet_session']);
  });
});

describe('pm.cookies.jar()', () => {
  it('reads the jar and records changes for the host', async () => {
    const jar = new CookieJar();
    jar.set({ name: 'sid', value: 'abc', domain: 'api.test' });
    const out = await runScript(
      `const j = pm.cookies.jar();
       j.get('https://api.test/x', 'sid', (err, v) => pm.environment.set('sid', v));
       pm.environment.set('count', j.getAll('api.test').length);
       j.set('https://api.test', 'flag', 'on', () => {});
       j.unset('api.test', 'sid');`,
      { variables: {}, jar: jar.list() },
    );
    expect(out.error).toBeUndefined();
    expect(out.scopeSets.environment).toEqual({ sid: 'abc', count: 1 });
    applyCookieJarOps(jar, out.jarOps);
    expect(jar.list().map((c) => `${c.name}=${c.value}`)).toEqual(['flag=on']);
  });

  it('shares one jar across the requests of a run and exposes pm.cookies', async () => {
    const vars = new VariableScope(new MemorySecretStore(), new Redactor());
    const redactor = new Redactor();
    const svc: ExecServices = {
      vars,
      providers: new ProviderRegistry([], vars, redactor),
      mcp: new McpManager(() => undefined, redactor),
      mcpServers: [],
      redactor,
      pricing: [],
      defaultTimeoutMs: 5000,
      cookieJar: new CookieJar(),
    };
    const tests: TestCase[] = [
      { id: 'login', name: 'login', type: 'http', request: { method: 'POST', url: `${base}/session/login`, body: { type: 'json', content: '{"username":"vet","password":"paws"}' } } },
      {
        id: 'me',
        name: 'me',
        type: 'http',
        request: { method: 'GET', url: `${base}/session/me` },
        testScript: `pm.test('logged in', () => pm.response.to.have.status(200)); pm.test('clinic cookie', () => pm.expect(pm.cookies.get('clinic')).to.equal('north'));`,
      },
    ] as TestCase[];
    const summary = await runTests({ name: 'cookies', runId: 'r1', tests, services: svc, concurrency: 1 });
    expect(summary.passed).toBe(2);
  });

  it('pm.sendRequest in a pre-request script: fetch a token, then use it (and share the cookie jar)', async () => {
    const vars = new VariableScope(new MemorySecretStore(), new Redactor());
    const redactor = new Redactor();
    const svc: ExecServices = { vars, providers: new ProviderRegistry([], vars, redactor), mcp: new McpManager(() => undefined, redactor), mcpServers: [], redactor, pricing: [], defaultTimeoutMs: 5000, cookieJar: new CookieJar() };
    const tests = [
      {
        id: 'p',
        name: 'patients with a fetched token',
        type: 'http',
        request: { method: 'GET', url: `${base}/patients` },
        preRequestScript: `
          pm.sendRequest({ url: '${base}/auth/token', method: 'POST', header: { 'Content-Type': 'application/json' }, body: { mode: 'raw', raw: JSON.stringify({ client_id: 'demo', client_secret: 'demo-secret' }) } }, (err, res) => {
            pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + res.json().access_token });
          });
          pm.sendRequest({ url: '${base}/session/login', method: 'POST', header: { 'Content-Type': 'application/json' }, body: { mode: 'raw', raw: '{"username":"vet","password":"paws"}' } }, () => {});`,
        testScript: `pm.test('authorised', () => pm.response.to.have.status(200));`,
      },
    ] as TestCase[];
    let meta: Record<string, unknown> | undefined;
    const summary = await runTests({ name: 'send', runId: 'r2', tests, services: svc, concurrency: 1, onEvent: (e) => e.type === 'test-end' && (meta = e.result.metadata) });
    expect(summary.passed).toBe(1);
    // the calls are recorded on the result (for the Console and reports)
    expect((meta?.sentRequests as Array<{ method: string; status: number }>).map((r) => `${r.method} ${r.status}`)).toEqual(['POST 200', 'POST 200']);
    // the login inside the script went through the shared cookie jar
    expect(svc.cookieJar!.list().map((c) => c.name).sort()).toEqual(['clinic', 'vet_session']);
  });
});
