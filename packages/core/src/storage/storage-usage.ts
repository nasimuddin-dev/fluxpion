import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceStore } from './workspace.js';

export interface StorageUsage {
  /** What each kept-data folder (and the database) holds. */
  parts: Array<{ name: string; label: string; bytes: number; files: number }>;
  totalBytes: number;
  runs: number;
  history: number;
  traces: number;
  /** Start of the oldest kept run. */
  oldestRun?: string;
}

const PARTS: Array<[string, string]> = [
  ['runs', 'Runs (results and reports)'],
  ['traces', 'Traces'],
  ['payloads', 'Response bodies'],
  ['reports', 'Exported reports'],
  ['trash', 'Recently deleted'],
];

function sizeOf(path: string): { bytes: number; files: number } {
  if (!existsSync(path)) return { bytes: 0, files: 0 };
  const st = statSync(path);
  if (!st.isDirectory()) return { bytes: st.size, files: 1 };
  let bytes = 0;
  let files = 0;
  for (const e of readdirSync(path, { withFileTypes: true })) {
    const s = sizeOf(join(path, e.name));
    bytes += s.bytes;
    files += s.files;
  }
  return { bytes, files };
}

/** How much the workspace keeps besides its definitions: runs, traces, response bodies, the history database. */
export function workspaceStorage(store: Pick<WorkspaceStore, 'path' | 'meta' | 'root'>): StorageUsage {
  const parts = PARTS.map(([name, label]) => ({ name, label, ...sizeOf(store.path(name)) }));
  // the history / runs / traces index (SQLite, with its write-ahead log)
  const db = ['database.sqlite', 'database.sqlite-wal', 'database.sqlite-shm', 'metadata.jsonl'].map((f) => sizeOf(join(store.root, f))).reduce((a, b) => ({ bytes: a.bytes + b.bytes, files: a.files + b.files }), { bytes: 0, files: 0 });
  parts.push({ name: 'database', label: 'History and index', ...db });
  const runs = store.meta.listRuns({ limit: 1 });
  const oldest = runs.total ? store.meta.listRuns({ limit: 1, offset: runs.total - 1 }).items[0]?.startedAt : undefined;
  return {
    parts,
    totalBytes: parts.reduce((a, p) => a + p.bytes, 0),
    runs: runs.total,
    history: store.meta.listHistory({ limit: 1 }).total,
    traces: store.meta.listTraces({ limit: 1 }).total,
    oldestRun: oldest,
  };
}

/** Delete the runs (results, reports, index rows) that started before `before` (ISO time). Baselines are kept. */
export function deleteRunsBefore(store: Pick<WorkspaceStore, 'meta' | 'runDir'>, before: string): { deleted: number; bytes: number } {
  let deleted = 0;
  let bytes = 0;
  const all = store.meta.listRuns({ limit: 100_000 }).items.filter((r) => r.startedAt < before);
  for (const r of all) {
    const dir = store.runDir(r.id);
    bytes += sizeOf(dir).bytes;
    rmSync(dir, { recursive: true, force: true });
    store.meta.deleteRun(r.id);
    deleted++;
  }
  return { deleted, bytes };
}
