import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, mcpToolUsage } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-mcpuse-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('MCP tool usage', () => {
  it('counts calls, failures and times per tool, most called first, optionally for one server', () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'MCP');
    let n = 0;
    const call = (serverId: string, server: string, tool: string, ok: boolean, ms: number) =>
      store.meta.addHistory({ id: `h${++n}`, timestamp: `2026-10-01T00:00:${String(n).padStart(2, '0')}.000Z`, kind: 'mcp', name: `${server} · ${tool}`, status: ok ? 'ok' : 'error', durationMs: ms, request: { serverId, tool, args: {} } });
    call('s1', 'weather', 'forecast', true, 10);
    call('s1', 'weather', 'forecast', true, 30);
    call('s1', 'weather', 'forecast', false, 20);
    call('s1', 'weather', 'alerts', true, 5);
    call('s2', 'crm', 'search_customer', true, 40);
    store.meta.addHistory({ id: 'x', timestamp: '2026-10-01T00:01:00.000Z', kind: 'http', name: 'GET /', status: 200 });
    const all = mcpToolUsage(store);
    expect(all.map((u) => [u.server, u.tool, u.calls, u.failed, u.medianMs, u.p95Ms])).toEqual([
      ['weather', 'forecast', 3, 1, 20, 30],
      ['weather', 'alerts', 1, 0, 5, 5],
      ['crm', 'search_customer', 1, 0, 40, 40],
    ]);
    expect(all[0]!.lastAt).toBe('2026-10-01T00:00:03.000Z');
    expect(mcpToolUsage(store, { serverId: 's2' }).map((u) => u.tool)).toEqual(['search_customer']);
    store.close();
  });
});
