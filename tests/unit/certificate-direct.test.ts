import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { checkCertificate, setTlsTrust } from '../../packages/core/src/index.js';

// test-only certificates (tests/fixtures/tls): a server certificate for 127.0.0.1, valid until 2126, signed by a test CA
const pem = (f: string) => readFileSync(join('tests/fixtures/tls', f), 'utf8');
let server: Server;
let target: string;

beforeAll(async () => {
  server = createServer({ cert: pem('server.crt'), key: pem('server.key') }, (_req, res) => res.end('ok'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  target = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  setTlsTrust({});
  await new Promise((r) => server.close(r));
});

describe('checking a certificate directly', () => {
  it('reads the certificate and says whether it is trusted here', async () => {
    setTlsTrust({});
    const untrusted = await checkCertificate(target);
    expect(untrusted).toMatchObject({ host: '127.0.0.1', subject: 'localhost', trusted: false });
    expect(untrusted.trustError).toBeTruthy();
    expect(untrusted.daysLeft).toBeGreaterThan(36000);
    expect(untrusted.validTo!.slice(0, 4)).toBe('2126');

    setTlsTrust({ extraCa: pem('ca.crt') });
    const trusted = await checkCertificate(`https://${target}/anything`);
    expect(trusted.trusted).toBe(true);
    expect(trusted.protocol).toMatch(/^TLSv1\.[23]$/);
  });

  it('refuses plain http', async () => {
    await expect(checkCertificate('http://example.com')).rejects.toThrow(/not an https address/);
  });
});
