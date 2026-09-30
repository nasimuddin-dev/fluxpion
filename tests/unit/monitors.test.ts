import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  MemorySecretStore,
  MonitorScheduler,
  WorkspaceStore,
  createEngineContext,
  deleteMonitor,
  executeMonitor,
  findMonitor,
  formatEvery,
  isDue,
  listMonitors,
  monitorResults,
  nextRunAt,
  parseEvery,
  saveMonitor,
  type Monitor,
  type MonitorResult,
} from '../../packages/core/src/index.js';

let dir: string;
let server: Server;
let base: string;
let store: WorkspaceStore;
let healthy = true;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tp-monitors-'));
  server = createServer((req, res) => {
    res.writeHead(req.url === '/health' && healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  store = WorkspaceStore.create(join(dir, 'ws'), 'Monitors');
  store.saveEnvironment({ id: 'local', name: 'Local', variables: [{ key: 'baseUrl', value: base, enabled: true }] });
  store.saveCollection({
    schemaVersion: '1.0',
    id: 'api',
    name: 'API',
    version: 0,
    variables: [],
    updatedAt: '',
    items: [
      {
        kind: 'folder',
        id: 'f-health',
        name: 'Health',
        items: [{ kind: 'request', id: 'r-health', name: 'Health', request: { method: 'GET', url: '{{baseUrl}}/health', headers: [], params: [] }, assertions: [{ type: 'status', expected: 200 }] }],
      },
    ],
  } as never);
});

afterAll(async () => {
  store.close();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const context = (o: { environment?: string; collectionId: string }) => createEngineContext({ store, secrets: new MemorySecretStore(), environment: o.environment, collectionId: o.collectionId });
const monitor: Monitor = { id: 'mon-health', name: 'Health check', collectionId: 'api', selection: ['f-health'], environment: 'Local', everyMinutes: 5, enabled: true };

describe('monitor schedule rules', () => {
  it('parses and formats intervals', () => {
    expect(parseEvery('15')).toBe(15);
    expect(parseEvery('15m')).toBe(15);
    expect(parseEvery('2h')).toBe(120);
    expect(parseEvery('1d')).toBe(1440);
    expect(() => parseEvery('0')).toThrow(/1 minute to 7 days/);
    expect(() => parseEvery('8d')).toThrow(/1 minute to 7 days/);
    expect(() => parseEvery('soon')).toThrow(/not an interval/);
    expect(formatEvery(1)).toBe('every minute');
    expect(formatEvery(15)).toBe('every 15 minutes');
    expect(formatEvery(60)).toBe('hourly');
    expect(formatEvery(180)).toBe('every 3 hours');
    expect(formatEvery(1440)).toBe('daily');
  });

  it('is due when it never ran or its interval passed, and never when paused', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    const last = { startedAt: '2026-09-29T11:56:00Z' } as MonitorResult;
    expect(isDue(monitor, undefined, now)).toBe(true);
    expect(isDue(monitor, last, now)).toBe(false);
    expect(nextRunAt(monitor, last, now)).toBe(Date.parse('2026-09-29T12:01:00Z'));
    expect(isDue(monitor, last, Date.parse('2026-09-29T12:01:00Z'))).toBe(true);
    expect(isDue({ ...monitor, enabled: false }, undefined, now)).toBe(false);
  });
});

describe('monitors in a workspace', () => {
  it('saves, validates, finds and deletes definitions (library/monitors.json)', () => {
    saveMonitor(store, monitor);
    expect(listMonitors(store)).toEqual([expect.objectContaining({ id: 'mon-health', name: 'Health check', everyMinutes: 5 })]);
    expect(findMonitor(store, 'health check').id).toBe('mon-health');
    expect(() => findMonitor(store, 'nope')).toThrow(/Health check/);
    expect(() => saveMonitor(store, { ...monitor, id: 'x', collectionId: 'missing' })).toThrow();
    expect(() => saveMonitor(store, { ...monitor, id: 'x', environment: 'Nope' })).toThrow(/No environment/);
    expect(() => saveMonitor(store, { ...monitor, id: 'x', selection: ['no-such-folder'] })).toThrow(/Nothing to run/);
    expect(JSON.parse(readFileSync(store.path('library', 'monitors.json'), 'utf8')).items).toHaveLength(1);
    // exported with the workspace
    expect(store.exportBundle().library?.monitors?.items).toHaveLength(1);
  });

  it('runs a monitor, records passed and failed results and a normal run', async () => {
    healthy = true;
    const ok = await executeMonitor({ store, monitor, context });
    expect(ok).toMatchObject({ monitorId: 'mon-health', status: 'passed', total: 1, passed: 1, trigger: 'manual' });
    healthy = false;
    const bad = await executeMonitor({ store, monitor, context, trigger: 'schedule' });
    expect(bad).toMatchObject({ status: 'failed', failed: 1, trigger: 'schedule' });
    expect(monitorResults(store, 'mon-health').map((r) => r.status)).toEqual(['failed', 'passed']);
    expect(store.meta.listRuns().items.map((r) => r.name)).toContain('Monitor · Health check');
    expect(readFileSync(join(store.runDir(ok.runId), 'report.html'), 'utf8')).toContain('Monitor · Health check');
  });

  it('records a run that cannot start as an error instead of throwing', async () => {
    const r = await executeMonitor({ store, monitor: { ...monitor, id: 'mon-broken', collectionId: 'gone' }, context });
    expect(r.status).toBe('error');
    expect(r.error).toBeTruthy();
  });

  it('the scheduler runs due monitors once and reports status changes', async () => {
    healthy = true;
    const changes: string[] = [];
    const s = new MonitorScheduler({
      list: () => listMonitors(store),
      last: (id) => monitorResults(store, id, 1)[0],
      run: (m) => executeMonitor({ store, monitor: m, context, trigger: 'schedule' }),
      onResult: (m, r, prev) => changes.push(`${m.name}: ${prev?.status} -> ${r.status}`),
    });
    const later = Date.now() + 10 * 60_000;
    expect(await s.tick(later)).toBe(1);
    expect(changes).toEqual(['Health check: failed -> passed']);
    // it just ran: not due again until its interval passes
    expect(await s.tick(Date.now())).toBe(0);
    deleteMonitor(store, 'mon-health');
    expect(listMonitors(store)).toEqual([]);
    expect(await s.tick(later + 60 * 60_000)).toBe(0);
  });
});
