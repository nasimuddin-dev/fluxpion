import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySecretStore, WorkspaceStore, createEngineContext, executeMonitor, listCertificates, setTlsTrust, type Monitor } from '../../packages/core/src/index.js';

// test-only certificates (tests/fixtures/tls): a server certificate for 127.0.0.1, valid until 2126, signed by a test CA
const pem = (f: string) => readFileSync(join('tests/fixtures/tls', f), 'utf8');

let server: Server;
let base: string;
let dir: string;
let store: WorkspaceStore;

beforeAll(async () => {
  setTlsTrust({ extraCa: pem('ca.crt') });
  server = createServer({ cert: pem('server.crt'), key: pem('server.key') }, (_req, res) => res.end('{"ok":true}'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(join(tmpdir(), 'tp-moncert-'));
  store = WorkspaceStore.create(join(dir, 'ws'), 'Certs');
  const req = (id: string, assertions: unknown[]) => ({ kind: 'http', id, name: id, request: { method: 'GET', url: `${base}/${id}`, headers: [], params: [] }, assertions });
  store.saveCollection({
    schemaVersion: '1.0',
    id: 'api',
    name: 'API',
    version: 0,
    variables: [],
    updatedAt: '',
    items: [req('health', [{ type: 'certificate', min: 30 }]), req('far', [{ type: 'certificate', min: 50000 }])],
  } as never);
});

afterAll(async () => {
  setTlsTrust({});
  store.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const context = (o: { environment?: string; collectionId: string }) => createEngineContext({ store, secrets: new MemorySecretStore(), environment: o.environment, collectionId: o.collectionId });

describe('certificates over HTTPS', () => {
  it('checks, monitors and records the server certificate', async () => {
    const monitor: Monitor = { id: 'mon-cert', name: 'Certs', collectionId: 'api', selection: ['health'], everyMinutes: 60, enabled: true, minCertDays: 30 };
    const r = await executeMonitor({ store, monitor, context });
    expect(r.status).toBe('passed');
    expect(r.certDaysLeft).toBeGreaterThan(36000);
    expect(r.reason).toBeUndefined();

    // the certificate check: valid for ~100 years, so a 50000-day minimum fails with the date and the issuer
    const far = await executeMonitor({ store, monitor: { ...monitor, selection: ['far'], minCertDays: undefined }, context });
    expect(far.status).toBe('failed');

    // every HTTPS response records its host's certificate for the workspace
    const seen = listCertificates(store);
    expect(seen.map((c) => c.host)).toEqual([new URL(base).host]);
    expect(seen[0]!.daysLeft).toBe(r.certDaysLeft);
  });
});
