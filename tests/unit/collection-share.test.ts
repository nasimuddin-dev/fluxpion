import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backend } from '../../apps/desktop/backend/backend.js';

// A collection exported in TestPion's format carries its gRPC calls and connections (`savedItems`), and
// importing the file puts them back in the imported collection, so sharing a collection shares all of it.
const home = mkdtempSync(join(tmpdir(), 'tp-share-'));
const be = new Backend({ appDir: home, emit: () => undefined });
afterAll(async () => {
  await be.dispose();
  rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});

describe('sharing a collection with its gRPC calls and connections', () => {
  it('exports them in TestPion format, notes them for Postman, and restores them on import', async () => {
    await be.invoke('col.save', { schemaVersion: '1.0', id: 'shop', name: 'Shop', version: 0, variables: [], updatedAt: '', items: [{ kind: 'http', id: 'r1', name: 'Health', request: { method: 'GET', url: 'http://x/health' } }] });
    await be.invoke('lib.save', { kind: 'grpc', library: { folders: [], items: [{ id: 'g1', name: 'Say hi', folder: 'greeter', collectionId: 'shop', data: { target: 'x:1', method: 'a.B/C' } }, { id: 'g2', name: 'Other', collectionId: 'elsewhere', data: { target: 'x:1', method: 'a.B/D' } }] } });
    await be.invoke('lib.save', { kind: 'websocket', library: { folders: [], items: [{ id: 'w1', name: 'Echo', collectionId: 'shop', data: { url: 'ws://x' } }] } });

    const native = (await be.invoke('col.export', { id: 'shop', format: 'testpion' })) as { collection: Record<string, any> };
    expect(native.collection.savedItems.grpc.map((i: any) => i.id)).toEqual(['g1']);
    expect(native.collection.savedItems.websocket.map((i: any) => i.id)).toEqual(['w1']);
    const postman = (await be.invoke('col.export', { id: 'shop', format: 'postman' })) as { notes: string[] };
    expect(postman.notes.join(' ')).toMatch(/2 gRPC call\(s\) or connection\(s\) aren't in the Postman file/);

    // import the file into the same workspace: the ids clash, so the copies get new ones (nothing replaced)
    const file = { ...native.collection, id: 'shop-copy', name: 'Shop copy' };
    const r = (await be.invoke('col.import', { text: JSON.stringify(file) })) as { collection: string; savedItems: Record<string, number> };
    expect(r).toMatchObject({ collection: 'Shop copy', savedItems: { grpc: 1, websocket: 1 } });
    const copy = (be.ws.listCollections() as Array<Record<string, unknown>>).find((c) => c.name === 'Shop copy')!;
    expect(copy.savedItems).toBeUndefined();
    const grpc = be.ws.getLibrary('grpc').items;
    expect(grpc.filter((i) => i.collectionId === copy.id)).toEqual([expect.objectContaining({ name: 'Say hi', folder: 'greeter', data: { target: 'x:1', method: 'a.B/C' } })]);
    expect(grpc.find((i) => i.collectionId === copy.id)!.id).not.toBe('g1');
    expect(grpc.find((i) => i.id === 'g1')!.collectionId).toBe('shop');
    expect(be.ws.getLibrary('websocket').items.filter((i) => i.collectionId === copy.id)).toHaveLength(1);
  });
});
