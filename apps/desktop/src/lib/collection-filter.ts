import type { CollectionNode } from '../types';

/** Whether a tree node belongs in the current text/favorites view. */
export function matchesCollectionNode(node: CollectionNode, filter = '', favoritesOnly = false): boolean {
  const query = filter.trim().toLowerCase();
  if (node.kind === 'folder') {
    const descendantsMatch = node.items.some((item) => matchesCollectionNode(item, filter, favoritesOnly));
    return favoritesOnly ? descendantsMatch : !query || node.name.toLowerCase().includes(query) || descendantsMatch;
  }
  const matchesText = !query || node.name.toLowerCase().includes(query) || (node.kind === 'http' && node.request.url.toLowerCase().includes(query));
  return matchesText && (!favoritesOnly || !!node.favorite);
}
