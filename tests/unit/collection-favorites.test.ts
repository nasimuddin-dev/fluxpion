import { describe, expect, it } from 'vitest';
import { matchesCollectionNode } from '../../apps/desktop/src/lib/collection-filter';
import type { CollectionFolder, SavedHttpRequest } from '../../apps/desktop/src/types';

const request = (name: string, favorite = false): SavedHttpRequest => ({
  kind: 'http',
  id: name,
  name,
  favorite,
  request: { method: 'GET', url: `https://api.example.test/${name}` },
});

describe('collection favorites', () => {
  const folder: CollectionFolder = {
    kind: 'folder',
    id: 'accounts',
    name: 'Accounts',
    items: [request('list-users', true), request('create-user')],
  };

  it('shows a folder only when it contains a favorite in favorites mode', () => {
    expect(matchesCollectionNode(folder, '', true)).toBe(true);
    expect(matchesCollectionNode(request('create-user'), '', true)).toBe(false);
    expect(matchesCollectionNode(request('list-users', true), '', true)).toBe(true);
  });

  it('combines text and favorites filters without losing matching ancestors', () => {
    expect(matchesCollectionNode(folder, 'list', true)).toBe(true);
    expect(matchesCollectionNode(folder, 'create', true)).toBe(false);
    expect(matchesCollectionNode(folder, 'accounts')).toBe(true);
  });
});
