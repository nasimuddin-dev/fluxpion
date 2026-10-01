import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { WorkspaceStore, deleteRunsBefore, workspaceStorage, type RunSummary } from '@testpion/core';

const dir = mkdtempSync(join(tmpdir(), 'tp-storage-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const summary = (runId: string, startedAt: string) => ({ runId, name: runId, startedAt, durationMs: 1, total: 1, passed: 1, failed: 0, skipped: 0, errors: 0 }) as unknown as RunSummary;

describe('workspace storage', () => {
  it('measures the kept data and deletes runs older than a date', () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'S');
    for (const [id, at] of [
      ['run-old', '2026-01-01T00:00:00Z'],
      ['run-new', '2026-09-30T00:00:00Z'],
    ] as const) {
      const d = store.runDir(id);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'results.jsonl'), 'x'.repeat(1000));
      store.meta.addRun(summary(id, at), d);
    }
    const u = workspaceStorage(store);
    expect(u.runs).toBe(2);
    expect(u.oldestRun).toBe('2026-01-01T00:00:00Z');
    expect(u.parts.find((p) => p.name === 'runs')).toMatchObject({ files: 2, bytes: 2000 });
    expect(u.totalBytes).toBeGreaterThanOrEqual(2000);

    expect(deleteRunsBefore(store, '2026-06-01T00:00:00Z')).toEqual({ deleted: 1, bytes: 1000 });
    expect(existsSync(store.runDir('run-old'))).toBe(false);
    expect(existsSync(store.runDir('run-new'))).toBe(true);
    expect(store.meta.listRuns().items.map((r) => r.id)).toEqual(['run-new']);
    store.close();
  });
});
