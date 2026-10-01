import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, recordCertificate, saveMonitor, workspaceAttention, type RunSummary } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-attention-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('what needs attention', () => {
  it('lists a failing monitor, an expiring certificate, a failed latest run and a failing request, most severe first', async () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'Attention');
    store.saveCollection({
      schemaVersion: '1.0',
      id: 'api',
      name: 'API',
      version: 0,
      variables: [],
      updatedAt: '',
      items: [{ kind: 'http', id: 'r1', name: 'Login', request: { method: 'POST', url: 'https://api.example.com/login', headers: [], params: [] } }],
    } as never);
    saveMonitor(store, { id: 'm1', name: 'Health', collectionId: 'api', everyMinutes: 5, enabled: true });
    mkdirSync(store.path('runs', 'monitors'), { recursive: true });
    writeFileSync(
      store.path('runs', 'monitors', 'm1.jsonl'),
      JSON.stringify({ monitorId: 'm1', runId: 'run-m', startedAt: new Date().toISOString(), durationMs: 1, status: 'failed', total: 1, passed: 0, failed: 1, errors: 0, trigger: 'schedule' }) + '\n',
    );
    recordCertificate(store, 'https://api.example.com/', { subject: 'api.example.com', validTo: new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString() });
    store.meta.addRun(
      { runId: 'run-1', name: 'Smoke', startedAt: new Date().toISOString(), durationMs: 1, total: 2, passed: 1, failed: 1, skipped: 0, errors: 0 } as RunSummary,
      store.runDir('run-1'),
    );
    store.meta.addHistory({ id: 'h1', timestamp: new Date().toISOString(), kind: 'http', name: 'Login', status: 500, collectionId: 'api', requestId: 'r1' });
    const items = await workspaceAttention(store);
    expect(items.map((i) => [i.kind, i.severity])).toEqual([
      ['monitor', 'high'],
      ['certificate', 'high'],
      ['run', 'medium'],
      ['request', 'low'],
    ]);
    expect(items[0]!.message).toBe('Monitor "Health" is failing: 1 of 1 requests failed');
    expect(items[1]!.message).toBe('The certificate of api.example.com expires in 3 days');
    expect(items[3]!.message).toBe('API › Login: the latest response was 500');
    store.close();
  });

  it('is empty when all is well', async () => {
    const store = WorkspaceStore.create(join(dir, 'ok'), 'Fine');
    expect(await workspaceAttention(store)).toEqual([]);
    store.close();
  });
});
