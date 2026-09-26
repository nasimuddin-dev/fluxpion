import { statSync } from 'node:fs';
import type { CollectionNode } from '../model/types.js';
import type { TestFileNode, WorkspaceStore } from './workspace.js';

export interface SearchHit {
  kind: 'request' | 'graphql' | 'collection' | 'test' | 'environment-variable' | 'mcp-server' | 'provider' | 'history' | 'trace' | 'run';
  id: string;
  title: string;
  subtitle?: string;
  /** Where to navigate: collection id, test file path, etc. */
  ref: Record<string, string>;
  score: number;
}

interface IndexedDoc {
  hit: Omit<SearchHit, 'score'>;
  text: string;
}

/**
 * Workspace search. Workspace definitions are indexed in memory and re-indexed only for files whose
 * mtime changed; history, traces and runs are queried through the indexed metadata database.
 */
export class WorkspaceSearch {
  private fileCache = new Map<string, { mtime: number; docs: IndexedDoc[] }>();

  constructor(private store: WorkspaceStore) {}

  private cached(path: string, build: () => IndexedDoc[]): IndexedDoc[] {
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      return [];
    }
    const c = this.fileCache.get(path);
    if (c && c.mtime === mtime) return c.docs;
    const docs = build();
    this.fileCache.set(path, { mtime, docs });
    return docs;
  }

  private definitionDocs(): IndexedDoc[] {
    const docs: IndexedDoc[] = [];
    for (const c of this.store.listCollections()) {
      docs.push(
        ...this.cached(this.store.path('collections', `${c.id}.json`), () => {
          const out: IndexedDoc[] = [{ hit: { kind: 'collection', id: c.id, title: c.name, subtitle: 'Collection', ref: { collectionId: c.id } }, text: `${c.name} ${c.description ?? ''}` }];
          const walk = (nodes: CollectionNode[], path: string[]) => {
            for (const n of nodes) {
              if (n.kind === 'folder') walk(n.items, [...path, n.name]);
              else if (n.kind === 'http')
                out.push({ hit: { kind: 'request', id: n.id, title: n.name, subtitle: `${n.request.method} ${n.request.url} · ${[c.name, ...path].join(' / ')}`, ref: { collectionId: c.id, requestId: n.id } }, text: `${n.name} ${n.request.method} ${n.request.url}` });
              else out.push({ hit: { kind: 'graphql', id: n.id, title: n.name, subtitle: `GraphQL · ${[c.name, ...path].join(' / ')}`, ref: { collectionId: c.id, requestId: n.id } }, text: `${n.name} ${n.request.query}` });
            }
          };
          walk(c.items, []);
          return out;
        }),
      );
    }
    for (const e of this.store.listEnvironments())
      for (const v of e.variables)
        docs.push({ hit: { kind: 'environment-variable', id: `${e.id}:${v.key}`, title: v.key, subtitle: `Variable in ${e.name}${v.secret ? ' (secret)' : ''}`, ref: { environmentId: e.id } }, text: `${v.key} ${v.secret ? '' : v.value}` });
    for (const s of this.store.getMcpServers()) docs.push({ hit: { kind: 'mcp-server', id: s.id, title: s.name, subtitle: `MCP · ${s.transport}`, ref: { serverId: s.id } }, text: `${s.name} ${'command' in s ? s.command : ''} ${'url' in s ? s.url : ''}` });
    for (const p of this.store.getProviders()) docs.push({ hit: { kind: 'provider', id: p.id, title: p.name, subtitle: `AI provider · ${p.kind}`, ref: { providerId: p.id } }, text: `${p.name} ${p.kind} ${p.defaultModel ?? ''}` });
    const walkTests = (nodes: TestFileNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'dir') walkTests(n.children ?? []);
        else
          docs.push(
            ...this.cached(this.store.path('tests', n.path), () => {
              let content = '';
              try {
                content = this.store.readTestFile(n.path).slice(0, 200_000);
              } catch {
                /* ignore */
              }
              const names = [...content.matchAll(/^\s*-?\s*name:\s*(.+)$/gm)].map((m) => m[1]!.trim().replace(/^["']|["']$/g, ''));
              return [{ hit: { kind: 'test', id: n.path, title: names[0] ?? n.name, subtitle: `Test file · ${n.path}${names.length > 1 ? ` · ${names.length} tests` : ''}`, ref: { testPath: n.path } }, text: `${n.path} ${content}` }];
            }),
          );
      }
    };
    walkTests(this.store.testTree());
    return docs;
  }

  search(query: string, limit = 50): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/);
    const hits: SearchHit[] = [];
    for (const d of this.definitionDocs()) {
      const title = d.hit.title.toLowerCase();
      const text = d.text.toLowerCase();
      if (!terms.every((t) => text.includes(t) || title.includes(t))) continue;
      const score = (title === q ? 100 : 0) + (title.startsWith(q) ? 50 : 0) + terms.filter((t) => title.includes(t)).length * 10 + 1;
      hits.push({ ...d.hit, score });
    }
    for (const h of this.store.meta.listHistory({ query, limit: 20 }).items)
      hits.push({ kind: 'history', id: h.id, title: h.name, subtitle: `History · ${h.method ?? h.kind} ${h.url ?? ''} · ${h.status ?? ''}`, ref: { historyId: h.id }, score: 0.5 });
    for (const t of this.store.meta.listTraces({ query, limit: 10 }).items)
      hits.push({ kind: 'trace', id: t.id, title: t.name, subtitle: `Trace · ${t.kind} · ${t.status}`, ref: { traceId: t.id }, score: 0.4 });
    for (const r of this.store.meta.listRuns({ query, limit: 10 }).items)
      hits.push({ kind: 'run', id: r.id, title: r.name, subtitle: `Run · ${r.passed}/${r.total} passed`, ref: { runId: r.id }, score: 0.3 });
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
