import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, importIntoWorkspace } from '../../packages/core/src/index.js';

// A collection is stored as collections/<id>.json, but files can be named otherwise (the examples' graphql.json
// holds "graphql-public"). Saving one must update its file, not add a second file with the same id, which
// showed the collection twice and made both expand together.
const dir = mkdtempSync(join(tmpdir(), 'tp-col-files-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
const col = (id: string, name: string) => ({ schemaVersion: '1.0', id, name, version: 1, variables: [], items: [], updatedAt: '' });

describe('collection files', () => {
  it('a file named otherwise is found, saved in place and deleted by its id', () => {
    const store = WorkspaceStore.create(join(dir, 'a'), 'A');
    writeFileSync(join(store.root, 'collections', 'graphql.json'), JSON.stringify(col('graphql-public', 'GraphQL')));
    expect(store.getCollection('graphql-public').name).toBe('GraphQL');
    store.saveCollection({ ...store.getCollection('graphql-public'), name: 'GraphQL renamed' });
    expect(readdirSync(join(store.root, 'collections'))).toEqual(['graphql.json']);
    expect(store.listCollections().map((c) => [c.id, c.name])).toEqual([['graphql-public', 'GraphQL renamed']]);
    store.deleteCollection('graphql-public');
    expect(store.listCollections()).toEqual([]);
    store.close();
  });

  it('two files with the same id (left by the old behaviour) list, open and save separately', () => {
    const store = WorkspaceStore.create(join(dir, 'b'), 'B');
    writeFileSync(join(store.root, 'collections', 'graphql.json'), JSON.stringify(col('graphql-public', 'Original')));
    writeFileSync(join(store.root, 'collections', 'graphql-public.json'), JSON.stringify(col('graphql-public', 'Edited copy')));
    const listed = store.listCollections().map((c) => [c.id, c.name]);
    expect(new Set(listed.map(([id]) => id)).size).toBe(2);
    for (const [id, name] of listed) expect(store.getCollection(id!).name).toBe(name);
    const second = listed.find(([id]) => id !== 'graphql-public')!;
    store.saveCollection({ ...store.getCollection(second[0]!), name: 'Second, saved' });
    expect(store.listCollections().map((c) => c.name).sort()).toEqual(['Edited copy', 'Second, saved']);
    expect(readdirSync(join(store.root, 'collections')).sort()).toEqual(['graphql-public.json', 'graphql.json']);
    store.close();
  });

  it('importing a collection file the workspace already has adds a copy instead of replacing it', () => {
    const store = WorkspaceStore.create(join(dir, 'c'), 'C');
    store.saveCollection(col('shop', 'Shop'));
    const r = importIntoWorkspace(store, JSON.stringify(col('shop', 'Shop (from a colleague)')));
    expect(r.collection!.id).not.toBe('shop');
    expect(store.listCollections().map((c) => c.name).sort()).toEqual(['Shop', 'Shop (from a colleague)']);
    store.close();
  });
});
