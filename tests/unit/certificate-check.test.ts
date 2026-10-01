import { describe, expect, it } from 'vitest';
import { runChecks, type CheckContext } from '../../packages/core/src/index.js';

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
});
