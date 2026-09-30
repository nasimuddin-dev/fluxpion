import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager, WorkspaceStore, listTrash, purgeTrash, restoreFromTrash, TRASH_DAYS } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-trash-'));
const store = WorkspaceStore.create(join(dir, 'ws'), 'Trash');
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
const collection = (id: string, name: string) =>
  ({ schemaVersion: '1.0', id, name, version: 0, variables: [], updatedAt: '', items: [{ kind: 'folder', id: 'f', name: 'F', items: [{ kind: 'http', id: 'r', name: 'R', request: { method: 'GET', url: 'x' } }] }] }) as never;

describe('recently deleted', () => {
  it('deleting moves collections and environments to a git-ignored trash, restorable', () => {
    store.saveCollection(collection('api', 'My API'));
    store.saveEnvironment({ id: 'staging', name: 'Staging', variables: [{ key: 'a', value: '1', enabled: true }] });
    store.deleteCollection('api');
    store.deleteEnvironment('staging');
    expect(store.listCollections().map((c) => c.id)).not.toContain('api');
    expect(readFileSync(store.path('trash', '.gitignore'), 'utf8')).toContain('*');
    const items = listTrash(store);
    expect(items.map((i) => [i.kind, i.name, i.size])).toEqual(expect.arrayContaining([['collection', 'My API', 1], ['environment', 'Staging', 1]]));

    const r = restoreFromTrash(store, items.find((i) => i.kind === 'collection')!.id);
    expect(r).toEqual({ kind: 'collection', id: 'api', name: 'My API' });
    expect(store.getCollection('api').items).toHaveLength(1);
    expect(listTrash(store).map((i) => i.kind)).toEqual(['environment']);
  });

  it('a restored item never overwrites one with the same name', () => {
    store.saveEnvironment({ id: 'staging', name: 'Staging', variables: [] });
    const r = restoreFromTrash(store, listTrash(store)[0]!.id);
    expect(r.name).toBe('Staging (restored)');
    expect(r.id).not.toBe('staging');
    expect(store.getEnvironment('staging')?.variables).toEqual([]);
    expect(store.getEnvironment('Staging (restored)')?.variables).toHaveLength(1);
  });

  it('forgets items after 30 days, purges on request, and is left out of copies', () => {
    store.saveCollection(collection('old', 'Old'));
    store.deleteCollection('old');
    // pretend it was deleted 31 days ago
    const d = store.path('trash', 'collections');
    const f = readdirSync(d)[0]!;
    renameSync(join(d, f), join(d, f.replace(/^\d+/, String(Date.now() - (TRASH_DAYS + 1) * 86_400_000))));
    expect(listTrash(store)).toEqual([]);

    store.saveCollection(collection('b', 'B'));
    store.deleteCollection('b');
    const copy = new WorkspaceManager(join(dir, 'app')).duplicate(store.root, 'Copy');
    expect(existsSync(join(copy.path, 'trash'))).toBe(false);
    expect(purgeTrash(store)).toBe(1);
    expect(listTrash(store)).toEqual([]);
    expect(() => restoreFromTrash(store, 'collection/../../workspace.json')).toThrow(/Not a trash entry/);
  });
});
