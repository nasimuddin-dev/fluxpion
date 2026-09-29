import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Collection, CollectionNode, Environment } from '../model/types.js';
import type { WorkspaceStore } from '../storage/workspace.js';
import { slugify } from '../util/ids.js';
import { importAny } from './importers.js';

export interface WorkspaceImportResult {
  format: string;
  collection?: Collection;
  environment?: Environment;
  /** OpenAPI / Swagger imports: where the document was kept (relative to the workspace). */
  specPath?: string;
  /** Requests that got an `openapi` contract check. */
  contractChecks?: number;
}

/**
 * Import an API definition, collection, environment or HAR file into a workspace (the app's Import,
 * `testpion import`). An OpenAPI / Swagger document is also kept in `specs/`, and every request made
 * from it gets an `openapi` check, so the new collection tests its own contract.
 */
export function importIntoWorkspace(store: WorkspaceStore, text: string, opts: { contractChecks?: boolean } = {}): WorkspaceImportResult {
  const r = importAny(text);
  const out: WorkspaceImportResult = { format: r.format };
  let collection = r.collection;
  if (collection && (r.format === 'openapi' || r.format === 'swagger')) {
    const ext = text.trimStart().startsWith('{') ? 'json' : 'yaml';
    const rel = `specs/${slugify(collection.name) || 'api'}.${r.format}.${ext}`;
    const file = store.safePath(rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    out.specPath = rel;
    if (opts.contractChecks !== false) {
      let added = 0;
      const withCheck = (nodes: CollectionNode[]): CollectionNode[] =>
        nodes.map((n) => {
          if (n.kind === 'folder') return { ...n, items: withCheck(n.items) };
          if (n.kind !== 'http' || n.assertions?.some((a) => a.type === 'openapi')) return n;
          added++;
          return { ...n, assertions: [...(n.assertions ?? []), { type: 'openapi', spec: rel }] };
        });
      collection = { ...collection, items: withCheck(collection.items) };
      out.contractChecks = added;
    }
  }
  if (collection) out.collection = store.saveCollection(collection);
  if (r.environment) {
    store.saveEnvironment(r.environment);
    out.environment = r.environment;
  }
  return out;
}
