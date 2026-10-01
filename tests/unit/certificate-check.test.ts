import { describe, expect, it } from 'vitest';
import { certificateLint, runChecks, type CheckContext, type Collection } from '../../packages/core/src/index.js';

const ctx = (certificate?: CheckContext['certificate'], url = 'https://api.example.com/'): CheckContext => ({ testType: 'http', body: '', text: '', certificate, request: { method: 'GET', url } });
const cert = (daysLeft: number) => ({ subject: 'api.example.com', issuer: 'R11, Let’s Encrypt', validTo: '2026-11-20T00:00:00.000Z', daysLeft });

describe('certificate check', () => {
  it('passes while the certificate has at least the minimum days left (default 14)', async () => {
    const [ok] = await runChecks([{ type: 'certificate' }], ctx(cert(50)));
    expect(ok).toMatchObject({ passed: true, actual: 50, expected: '≥ 14 days' });
    expect(ok!.message).toBe('valid for 50 more days, until 2026-11-20 (api.example.com, issued by R11, Let’s Encrypt)');
  });

  it('fails when it expires sooner than the minimum, or has expired', async () => {
    const [soon] = await runChecks([{ type: 'certificate', min: 30 }], ctx(cert(1)));
    expect(soon).toMatchObject({ passed: false });
    expect(soon!.message).toMatch(/^expires in 1 day, on 2026-11-20: less than 30/);
    const [gone] = await runChecks([{ type: 'certificate' }], ctx(cert(-3)));
    expect(gone!.message).toMatch(/^expired on 2026-11-20/);
  });

  it('fails clearly without a certificate', async () => {
    const [plain] = await runChecks([{ type: 'certificate' }], ctx(undefined, 'http://api.example.com/'));
    expect(plain).toMatchObject({ passed: false, message: 'not an HTTPS request: no certificate to check' });
  });

  it('the security review flags hosts whose recorded certificate expires within 30 days, once per host', () => {
    const req = (id: string, url: string) => ({ kind: 'http', id, name: id, request: { method: 'GET', url, headers: [], params: [] } });
    const c = {
      id: 'c',
      name: 'API',
      items: [req('a', '{{base}}/pets'), req('b', '{{base}}/owners'), req('c', 'https://ok.example.com/'), req('d', 'http://plain.example.com/')],
    } as unknown as Collection;
    const certs = [
      { host: 'api.example.com', daysLeft: 5, validTo: '2026-10-06T00:00:00Z' },
      { host: 'ok.example.com', daysLeft: 200 },
    ];
    const f = certificateLint(c, (u) => u.replace('{{base}}', 'https://api.example.com'), certs);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'high', requestId: 'a', message: 'The TLS certificate of api.example.com expires in 5 days (2026-10-06): renew it before clients start failing' });
  });
});
