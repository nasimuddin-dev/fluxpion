import { describe, expect, it } from 'vitest';
import { runChecks, securityLint, type Collection } from '../../packages/core/src/index.js';

describe('security-headers check', () => {
  const run = (headers: Array<[string, string]>, url = 'https://api.test/x', values?: string[]) => runChecks([{ type: 'security-headers', ...(values ? { values } : {}) }], { testType: 'http', status: 200, headers, request: { method: 'GET', url } });

  it('passes a well-configured response', async () => {
    const [c] = await run([
      ['strict-transport-security', 'max-age=63072000'],
      ['x-content-type-options', 'nosniff'],
      ['content-type', 'application/json'],
    ]);
    expect(c).toMatchObject({ passed: true, message: 'security headers look good' });
  });

  it('lists what is missing or risky, and skips what you exclude', async () => {
    const [c] = await run([
      ['content-type', 'text/html'],
      ['access-control-allow-origin', '*'],
      ['access-control-allow-credentials', 'true'],
      ['server', 'nginx/1.18.0'],
    ]);
    expect(c!.passed).toBe(false);
    expect(c!.message).toBe('no Strict-Transport-Security; no X-Content-Type-Options: nosniff; HTML without X-Frame-Options or CSP frame-ancestors; CORS allows any origin with credentials; server version exposed (nginx/1.18.0)');
    // http: no HSTS expected; exclusions
    const [d] = await run([['x-content-type-options', 'nosniff'], ['server', 'nginx/1.18.0']], 'http://localhost/x', ['server-version']);
    expect(d!.passed).toBe(true);
  });
});

describe('security lint of a collection', () => {
  it('finds typed-in secrets, secrets in URLs, plain http and disabled TLS checks', () => {
    const c: Collection = {
      schemaVersion: '1.0',
      id: 'c',
      name: 'Shop',
      version: 1,
      variables: [],
      updatedAt: new Date(0).toISOString(),
      auth: { type: 'bearer', token: 'sk-live-1' },
      items: [
        { kind: 'http', id: 'a', name: 'Good', request: { method: 'GET', url: 'https://api.shop.test/x', auth: { type: 'bearer', token: '{{token}}' }, headers: [{ key: 'X-Api-Key', value: '{{apiKey}}', enabled: true }] } },
        { kind: 'http', id: 'b', name: 'Key in URL', request: { method: 'GET', url: 'https://api.shop.example/x', params: [{ key: 'api_key', value: '{{apiKey}}', enabled: true }] } },
        { kind: 'http', id: 'c', name: 'Plain http', request: { method: 'POST', url: 'http://api.shop.example/login', auth: { type: 'basic', username: 'u', password: '{{pw}}' }, body: { type: 'json', content: '{"user":"a","password":"hunter2"}' } } },
        { kind: 'http', id: 'd', name: 'Insecure', request: { method: 'GET', url: 'https://self-signed.example/x', headers: [{ key: 'Authorization', value: 'Bearer abc.def', enabled: true }], settings: { insecure: true } } },
        { kind: 'http', id: 'e', name: 'Local http is fine', request: { method: 'GET', url: 'http://localhost:3000/x', auth: { type: 'bearer', token: '{{t}}' } } },
      ],
    };
    expect(securityLint(c).map((f) => `${f.severity} | ${f.where} | ${f.message}`)).toEqual([
      "high | Shop | The collection's auth has a bearer token typed in: use a secret variable",
      'high | Shop › Plain http | Credentials (basic) over plain http to api.shop.example',
      'high | Shop › Plain http | The body field "password" holds a value typed in: use a secret variable',
      'high | Shop › Insecure | Header Authorization holds a value typed in: use a secret variable',
      'medium | Shop › Key in URL | The secret "api_key" is sent in the query string, where proxies and server logs keep it: send it in a header',
      'medium | Shop › Plain http | Plain http to api.shop.example: requests and credentials travel unencrypted',
      'medium | Shop › Insecure | TLS certificate verification is turned off for this request',
    ]);
  });
});
