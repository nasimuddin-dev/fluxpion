import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { rootCertificates } from 'node:tls';
import { describeCertificates, executeHttp, getTlsTrust, setTlsTrust, trustedCa } from '../../packages/core/src/index.js';

// test-only certificates (tests/fixtures/tls): a CA and a server certificate for 127.0.0.1 signed by it
const pem = (f: string) => readFileSync(join('tests/fixtures/tls', f), 'utf8');
const CA = pem('ca.crt');

let server: Server;
let url: string;
beforeAll(async () => {
  server = createServer({ cert: pem('server.crt'), key: pem('server.key') }, (_req, res) => res.end('secure hello'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(async () => {
  setTlsTrust({});
  await new Promise((r) => server.close(r));
});

describe('trusted certificate authorities', () => {
  it('describes PEM certificates and rejects malformed ones', () => {
    const [c] = describeCertificates(CA);
    expect(c).toMatchObject({ ca: true, expired: false });
    expect(c!.subject.length).toBeGreaterThan(0);
    expect(() => setTlsTrust({ extraCa: '-----BEGIN CERTIFICATE-----\nnot base64\n-----END CERTIFICATE-----' })).toThrow(/not a valid PEM/);
  });

  it('a private CA is untrusted until it is added, for requests and global fetch', async () => {
    setTlsTrust({});
    expect(trustedCa()).toBeUndefined();
    const before = await executeHttp({ method: 'GET', url }).then((r) => r.response.status, (e: Error) => e.message);
    expect(String(before)).not.toBe('200');

    setTlsTrust({ extraCa: CA });
    expect(trustedCa()!.length).toBe(rootCertificates.length + 1);
    const r = await executeHttp({ method: 'GET', url });
    expect(r.response.status).toBe(200);
    expect(await (await fetch(url)).text()).toBe('secure hello');

    setTlsTrust({});
    await expect(fetch(url)).rejects.toThrow();
  });

  it('can add the operating system store', () => {
    setTlsTrust({ systemCa: true });
    const info = getTlsTrust();
    expect(info.systemCa).toBe(true);
    expect(trustedCa()!.length).toBe(rootCertificates.length + info.systemCertificates);
    setTlsTrust({});
  });
});
