import { describe, expect, it } from 'vitest';
import { decodeJwt, describeExpiry, findJwts, runChecks, type CheckContext } from '../../packages/core/src/index.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;
const now = Math.floor(Date.now() / 1000);

describe('JWT', () => {
  it('decodes header and claims, with expiry relative to now', () => {
    const d = decodeJwt(`Bearer ${jwt({ sub: 'u1', iat: now - 60, exp: now + 300 })}`);
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.payload.sub).toBe('u1');
    expect(d.signed).toBe(true);
    expect(d.expired).toBe(false);
    expect(d.expiresInSec).toBeGreaterThan(290);
    expect(d.issuedAt).toBe(new Date((now - 60) * 1000).toISOString());
    expect(() => decodeJwt('not.a.jwt')).toThrow(/Not a JWT/);
    expect(describeExpiry(300)).toBe('in 5 min');
    expect(describeExpiry(-7200)).toBe('2 h ago');
  });

  it('finds tokens in a text, each once', () => {
    const t = jwt({ sub: 'a' });
    expect(findJwts(`{"access_token":"${t}","again":"${t}","other":"eyJxx.eyJyy.zz"}`)).toEqual([t]);
  });

  it('checks a token: found, not expired, expected claims', async () => {
    const good = jwt({ iss: 'https://auth.example.com', aud: ['api', 'web'], exp: now + 3600 });
    const ctx = (body: unknown, headers: Array<[string, string]> = []): CheckContext => ({ testType: 'http', body, text: JSON.stringify(body), headers });
    const [ok] = await runChecks([{ type: 'jwt', path: '$.access_token', claims: { iss: 'https://auth.example.com', aud: 'api' } }], ctx({ access_token: good }));
    expect(ok).toMatchObject({ passed: true });
    expect(ok!.message).toMatch(/^valid JWT \(HS256\), expires in 60 min$/);
    const [claims] = await runChecks([{ type: 'jwt', claims: { iss: 'other' } }], ctx({ token: good }));
    expect(claims!.message).toBe('claims differ: iss is "https://auth.example.com", expected "other"');
    const [expired] = await runChecks([{ type: 'jwt', header: 'authorization' }], ctx({}, [['authorization', `Bearer ${jwt({ exp: now - 120 })}`]]));
    expect(expired).toMatchObject({ passed: false, message: 'the token expired 2 min ago' });
    const [soon] = await runChecks([{ type: 'jwt', min: 7200 }], ctx({ t: good }));
    expect(soon!.message).toMatch(/less than 7200 s/);
    const [none] = await runChecks([{ type: 'jwt' }], ctx({ a: 1 }));
    expect(none).toMatchObject({ passed: false, message: 'no JWT in the response' });
  });
});
