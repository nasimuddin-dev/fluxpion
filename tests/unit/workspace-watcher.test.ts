import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite, changeKind, describeChanges, watchWorkspace, type WorkspaceChange } from '@testpion/core';

// GIT-103: a workspace notices changes made outside the app (git pull, another editor), not its own saves.
const root = mkdtempSync(join(tmpdir(), 'tp-watch-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('workspace watcher', () => {
  it('sorts paths by what they are, and ignores results and local state', () => {
    expect(changeKind('collections/shop.json')).toBe('collections');
    expect(changeKind('environments/dev.json')).toBe('environments');
    expect(changeKind('tests/rest/a.yaml')).toBe('tests');
    expect(changeKind('mcp-servers.json')).toBe('mcp');
    expect(changeKind('workspace.json')).toBe('workspace');
    for (const p of ['runs/r1/results.jsonl', 'traces/t.json', '.local/meta.json', '.git/index', 'database.sqlite-wal', 'collections/shop.json.tmp-123-abcd1234']) expect(changeKind(p)).toBeUndefined();
  });

  it('describes a batch in words', () => {
    const c: WorkspaceChange[] = [
      { path: 'collections/a.json', kind: 'collections' },
      { path: 'collections/b.json', kind: 'collections' },
      { path: 'environments/dev.json', kind: 'environments' },
    ];
    expect(describeChanges(c)).toBe('2 collections, 1 environment changed outside TestPion');
  });

  it('reports outside changes once things are quiet, and not the app’s own writes', async () => {
    for (const d of ['collections', 'runs']) mkdirSync(join(root, d), { recursive: true });
    const batches: WorkspaceChange[][] = [];
    const stop = watchWorkspace(root, (b) => batches.push(b), { debounceMs: 150 });
    try {
      await sleep(200);
      atomicWrite(join(root, 'collections', 'own.json'), '{}\n'); // the app's own save
      writeFileSync(join(root, 'runs', 'r.json'), '{}'); // a result
      await sleep(600);
      expect(batches.flat().map((c) => c.path)).not.toContain('collections/own.json');
      writeFileSync(join(root, 'collections', 'pulled.json'), '{}'); // another program
      writeFileSync(join(root, 'collections', 'pulled.json'), '{"a":1}');
      await sleep(800);
      const paths = batches.flat().map((c) => c.path);
      expect(paths).toContain('collections/pulled.json');
      expect(paths.filter((p) => p === 'collections/pulled.json')).toHaveLength(1); // one entry per batch
      expect(paths.some((p) => p.startsWith('runs/'))).toBe(false);
    } finally {
      stop();
    }
  });
});
