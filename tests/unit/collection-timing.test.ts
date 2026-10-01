import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, collectionTiming } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-coltiming-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('collection timing', () => {
  it("adds up the phases of the collection's responses, new and reused connections", () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'Timing');
    let n = 0;
    const add = (collectionId: string, timing?: Record<string, unknown>) =>
      store.meta.addHistory({
        id: `h${++n}`,
        timestamp: `2026-10-01T00:00:0${n}.000Z`,
        kind: 'http',
        name: 'GET /',
        status: 200,
        collectionId,
        requestId: 'r',
        responseMeta: timing ? { timing } : {},
      });
    add('c1', { dnsMs: 5, tcpMs: 10, tlsMs: 20, ttfbMs: 40, downloadMs: 2, reusedConnection: false });
    add('c1', { ttfbMs: 30, downloadMs: 1, reusedConnection: true });
    add('c1');
    add('c2', { ttfbMs: 999 });
    expect(collectionTiming(store, 'c1')).toEqual({ requests: 2, newConnections: 1, reused: 1, dnsMs: 5, tcpMs: 10, tlsMs: 20, ttfbMs: 70, downloadMs: 3 });
    expect(collectionTiming(store, 'none')).toBeUndefined();
    store.close();
  });
});
