import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { applyAuth, clearTokenCache, loopbackRedirect, Redactor, type AuthConfig } from '../../packages/core/src/index.js';

/** A small OAuth 2.0 provider: /authorize redirects with a code, /token trades codes and refresh tokens. */
let server: Server;
let base: string;
const seen: Array<{ grant: string; basic?: string; clientIdInBody?: string; redirect?: string }> = [];
let refreshAllowed = true;
beforeAll(async () => {
  let n = 0;
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/authorize') {
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'code-1');
      back.searchParams.set('state', u.searchParams.get('state')!);
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const f = new URLSearchParams(body);
      const grant = f.get('grant_type')!;
      seen.push({ grant, basic: req.headers.authorization, clientIdInBody: f.get('client_id') ?? undefined, redirect: f.get('redirect_uri') ?? undefined });
      if (grant === 'refresh_token' && (!refreshAllowed || f.get('refresh_token') !== 'refresh-1')) {
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_grant"}');
        return;
      }
      // expires at once, so the next request needs a new token
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `access-${++n}`, token_type: 'bearer', expires_in: 1, ...(grant === 'authorization_code' ? { refresh_token: 'refresh-1' } : {}) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  seen.length = 0;
  refreshAllowed = true;
  clearTokenCache();
});

/** The "browser": follow the provider's redirect to the app's loopback callback. */
const browser = async (url: string) => {
  const r = await fetch(url, { redirect: 'manual' });
  await fetch(r.headers.get('location')!);
};

const authorization = async (auth: AuthConfig, redactor?: Redactor) => {
  const headers = new Headers();
  await applyAuth(auth, headers, new URL('https://api.test/'), { openExternal: (u) => void browser(u), redactor });
  return headers.get('authorization');
};

describe('OAuth 2.0 authorization code', () => {
  it('gets a token through the browser, then refreshes it without the browser; Basic client auth', async () => {
    const port = await new Promise<number>((r) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => r(p));
      });
    });
    const auth: AuthConfig = {
      type: 'oauth2',
      grantType: 'authorization_code',
      authUrl: `${base}/authorize`,
      tokenUrl: `${base}/token`,
      clientId: 'my app',
      clientSecret: 's3cret:x',
      clientAuth: 'header',
      redirectUri: `http://localhost:${port}/oauth/callback`,
    };
    const redactor = new Redactor();
    expect(await authorization(auth, redactor)).toBe('Bearer access-1');
    // the registered callback URL is used as is, and the client authenticates with Basic (form-encoded parts)
    expect(seen[0]).toEqual({ grant: 'authorization_code', basic: `Basic ${Buffer.from('my%20app:s3cret%3Ax').toString('base64')}`, clientIdInBody: undefined, redirect: `http://localhost:${port}/oauth/callback` });

    // expired: refreshed with the refresh token (no browser: openExternal would hang the test otherwise)
    expect(await authorization({ ...auth, authUrl: 'http://127.0.0.1:1/never' })).toBe('Bearer access-2');
    expect(seen[1]!.grant).toBe('refresh_token');
    expect(redactor.redactString('refresh-1 access-1')).not.toMatch(/refresh-1|access-1/);

    // the refresh token is refused: the full flow runs again
    refreshAllowed = false;
    expect(await authorization(auth)).toBe('Bearer access-3');
    expect(seen.slice(2).map((s) => s.grant)).toEqual(['refresh_token', 'authorization_code']);
  });

  it('client credentials go in the body by default', async () => {
    await authorization({ type: 'oauth2', grantType: 'client_credentials', tokenUrl: `${base}/token`, clientId: 'cid', clientSecret: 'sec' });
    expect(seen[0]).toMatchObject({ grant: 'client_credentials', basic: undefined, clientIdInBody: 'cid' });
  });

  it('only accepts loopback callback URLs with a port', () => {
    expect(loopbackRedirect('http://localhost:8080/cb')).toEqual({ hosts: ['127.0.0.1', '::1'], port: 8080, path: '/cb' });
    expect(loopbackRedirect('http://127.0.0.1:9000/')).toEqual({ hosts: ['127.0.0.1'], port: 9000, path: '/' });
    expect(() => loopbackRedirect('https://example.com/cb')).toThrow(/must be http:\/\/localhost/);
    expect(() => loopbackRedirect('http://localhost/cb')).toThrow(/must be http:\/\/localhost/);
    expect(() => loopbackRedirect('nope')).toThrow(/not a URL/);
  });
});
