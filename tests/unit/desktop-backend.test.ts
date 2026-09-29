import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backend } from '../../apps/desktop/backend/backend.js';

// The desktop backend is the app's whole RPC surface (and a future server's); its handlers live in one
// module per domain (apps/desktop/backend/handlers). This checks they compose and work end to end.
const home = mkdtempSync(join(tmpdir(), 'tp-backend-'));
const events: string[] = [];
const be = new Backend({ appDir: home, emit: (channel) => void events.push(channel) });
const call = (method: string, params: unknown = {}) => {
  const h = be.handlers[method];
  if (!h) throw new Error(`no RPC method ${method}`);
  return h(params);
};

afterAll(async () => {
  await be.dispose();
  rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});

describe('desktop backend', () => {
  it('exposes every domain through one RPC table', () => {
    const domains = new Set(Object.keys(be.handlers).map((m) => m.split('.')[0]));
    for (const d of ['app', 'settings', 'ws', 'env', 'col', 'http', 'gql', 'mcp', 'ai', 'tests', 'runs', 'load', 'wsock', 'grpc']) expect(domains).toContain(d);
    expect(Object.keys(be.handlers).length).toBeGreaterThan(100);
  });

  it('opens a starter workspace and answers calls from each domain', async () => {
    const info = (await call('app.info')) as { version: string; checkTypes: string[] };
    expect(info.version).toMatch(/\d+\.\d+\.\d+/);
    expect(info.checkTypes).toContain('status');
    const ws = (await call('ws.current')) as { name: string };
    expect(ws.name).toBe('My Workspace');
    expect(await call('col.list')).toEqual([]);
    expect(Array.isArray(await call('env.list'))).toBe(true);
    expect(await call('mcp.servers')).toEqual([]);
    expect(await call('prompt.variables', { template: 'Hi {{name}}' })).toEqual(['name']);
    expect((await call('settings.get')) as object).toHaveProperty('theme');
  });

  it('reports errors as structured values, not crashes', async () => {
    await expect(Promise.resolve().then(() => call('mcp.ping', { serverId: 'nope' }))).rejects.toThrow(/not connected|nope/i);
  });
});
