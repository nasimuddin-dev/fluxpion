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

/** What a saved request is, for the explorer's categories (gRPC and WebSocket items live in libraries). */
export type RequestCategory = 'rest' | 'soap' | 'graphql' | 'grpc' | 'websocket';

/** SOAP is an HTTP request with an XML envelope or a SOAPAction header. */
export function requestCategory(node: CollectionNode): 'rest' | 'soap' | 'graphql' | undefined {
  if (node.kind === 'folder') return undefined;
  if (node.kind === 'graphql') return 'graphql';
  const r = node.request;
  const soapHeader = r.headers?.some((h) => h.key.toLowerCase() === 'soapaction' || (h.key.toLowerCase() === 'content-type' && /application\/soap\+xml/i.test(h.value)));
  const soapBody = r.body && 'content' in r.body && /<(\w+:)?Envelope[\s>]/.test(r.body.content);
  return soapHeader || soapBody ? 'soap' : 'rest';
}

/** Whether these nodes hold a request of this category (anywhere in their folders). */
export function hasCategory(nodes: CollectionNode[], cat: RequestCategory): boolean {
  return nodes.some((n) => (n.kind === 'folder' ? hasCategory(n.items, cat) : requestCategory(n) === cat));
}

/** Requests of this category in these nodes. */
export function countCategory(nodes: CollectionNode[], cat: RequestCategory): number {
  return nodes.reduce((sum, n) => sum + (n.kind === 'folder' ? countCategory(n.items, cat) : requestCategory(n) === cat ? 1 : 0), 0);
}

/** Folders with no requests at all (they show under the collection's first category). */
export function isEmptyFolder(node: CollectionNode): boolean {
  return node.kind === 'folder' && node.items.every(isEmptyFolder);
}
