import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { HistoryEntry, RunSummary } from '../model/types.js';
import { atomicWrite } from './fsutil.js';

export interface TraceMeta {
  id: string;
  name: string;
  kind: string;
  status: string;
  startTime: number;
  durationMs: number;
  spanCount: number;
  runId?: string;
  path: string;
}

export interface RunMeta {
  id: string;
  name: string;
  startedAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  environment?: string;
  dir: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface ListQuery {
  query?: string;
  kind?: string;
  /** History only: entries sent from this saved request. */
  requestId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Metadata store for history, runs and traces. Only small metadata rows live here —
 * large payloads, traces and results are separate files on disk (spec §25).
 */
export interface MetaStore {
  readonly backend: 'sqlite' | 'jsonl';
  addHistory(e: HistoryEntry): void;
  listHistory(q?: ListQuery): Page<HistoryEntry>;
  getHistory(id: string): HistoryEntry | undefined;
  deleteHistory(id: string): void;
  clearHistory(): void;
  addRun(summary: RunSummary, dir: string): void;
  listRuns(q?: ListQuery): Page<RunMeta>;
  deleteRun(id: string): void;
  addTrace(t: TraceMeta): void;
  listTraces(q?: ListQuery): Page<TraceMeta>;
  getTrace(id: string): TraceMeta | undefined;
  close(): void;
}

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; get(...a: unknown[]): unknown };
  close(): void;
};

let sqliteModule: { DatabaseSync: new (path: string) => SqliteDb } | null | undefined;
function loadSqlite() {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    // silence the ExperimentalWarning printed by some Node versions
    const emit = process.emitWarning;
    process.emitWarning = (() => undefined) as typeof process.emitWarning;
    try {
      // getBuiltinModule works in both ESM and bundled CJS (Electron main process)
      const gbm = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
      sqliteModule = (gbm ? gbm('node:sqlite') : createRequire(import.meta.url)('node:sqlite')) as typeof sqliteModule;
    } finally {
      process.emitWarning = emit;
    }
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

export const SQLITE_SCHEMA_VERSION = 1;

class SqliteMetaStore implements MetaStore {
  readonly backend = 'sqlite' as const;
  private db: SqliteDb;

  constructor(path: string, Db: new (p: string) => SqliteDb) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Db(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    const row = this.db.prepare("SELECT value FROM meta WHERE key='schema'").get() as { value: string } | undefined;
    const v = row ? Number(row.value) : 0;
    if (v < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, name TEXT, method TEXT, url TEXT, status TEXT, duration REAL, size INTEGER, trace_id TEXT, payload TEXT, doc TEXT);
        CREATE INDEX IF NOT EXISTS history_ts ON history(ts DESC);
        CREATE INDEX IF NOT EXISTS history_kind ON history(kind);
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, name TEXT, started TEXT, duration REAL, total INTEGER, passed INTEGER, failed INTEGER, skipped INTEGER, errors INTEGER, environment TEXT, dir TEXT);
        CREATE INDEX IF NOT EXISTS runs_started ON runs(started DESC);
        CREATE TABLE IF NOT EXISTS traces (id TEXT PRIMARY KEY, name TEXT, kind TEXT, status TEXT, start INTEGER, duration REAL, spans INTEGER, run_id TEXT, path TEXT);
        CREATE INDEX IF NOT EXISTS traces_start ON traces(start DESC);
      `);
      this.db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema', ?)").run(String(SQLITE_SCHEMA_VERSION));
    }
  }

  addHistory(e: HistoryEntry): void {
    this.db
      .prepare('INSERT OR REPLACE INTO history (id, ts, kind, name, method, url, status, duration, size, trace_id, payload, doc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(e.id, e.timestamp, e.kind, e.name, e.method ?? null, e.url ?? null, e.status === undefined ? null : String(e.status), e.durationMs ?? null, e.size ?? null, e.traceId ?? null, e.payloadPath ?? null, JSON.stringify({ request: e.request, responseMeta: e.responseMeta, collectionId: e.collectionId, requestId: e.requestId }));
    // bound history size
    this.db.exec('DELETE FROM history WHERE id IN (SELECT id FROM history ORDER BY ts DESC LIMIT -1 OFFSET 20000)');
  }

  private where(q: ListQuery, cols: string[]): { sql: string; args: unknown[] } {
    const parts: string[] = [];
    const args: unknown[] = [];
    if (q.kind) {
      parts.push('kind = ?');
      args.push(q.kind);
    }
    if (q.query) {
      parts.push('(' + cols.map((c) => `${c} LIKE ?`).join(' OR ') + ')');
      for (const _ of cols) args.push(`%${q.query}%`);
    }
    return { sql: parts.length ? 'WHERE ' + parts.join(' AND ') : '', args };
  }

  listHistory(q: ListQuery = {}): Page<HistoryEntry> {
    const w = this.where(q, ['name', 'url', 'method', 'status']);
    if (q.requestId) {
      w.sql = (w.sql ? w.sql + ' AND ' : 'WHERE ') + "json_extract(doc, '$.requestId') = ?";
      w.args.push(q.requestId);
    }
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM history ${w.sql}`).get(...w.args) as { n: number }).n;
    const rows = this.db.prepare(`SELECT * FROM history ${w.sql} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...w.args, q.limit ?? 100, q.offset ?? 0) as Array<Record<string, unknown>>;
    return { total, items: rows.map(historyRow) };
  }

  getHistory(id: string): HistoryEntry | undefined {
    const r = this.db.prepare('SELECT * FROM history WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? historyRow(r) : undefined;
  }

  deleteHistory(id: string): void {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(id);
  }

  clearHistory(): void {
    this.db.exec('DELETE FROM history');
  }

  addRun(s: RunSummary, dir: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO runs (id, name, started, duration, total, passed, failed, skipped, errors, environment, dir) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(s.runId, s.name, s.startedAt, s.durationMs, s.total, s.passed, s.failed, s.skipped, s.errors, s.environment ?? null, dir);
  }

  listRuns(q: ListQuery = {}): Page<RunMeta> {
    const w = this.where({ query: q.query }, ['name']);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM runs ${w.sql}`).get(...w.args) as { n: number }).n;
    const rows = this.db.prepare(`SELECT * FROM runs ${w.sql} ORDER BY started DESC LIMIT ? OFFSET ?`).all(...w.args, q.limit ?? 100, q.offset ?? 0) as Array<Record<string, unknown>>;
    return {
      total,
      items: rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        startedAt: r.started as string,
        durationMs: r.duration as number,
        total: r.total as number,
        passed: r.passed as number,
        failed: r.failed as number,
        skipped: r.skipped as number,
        errors: r.errors as number,
        environment: (r.environment as string) ?? undefined,
        dir: r.dir as string,
      })),
    };
  }

  deleteRun(id: string): void {
    this.db.prepare('DELETE FROM runs WHERE id = ?').run(id);
  }

  addTrace(t: TraceMeta): void {
    this.db
      .prepare('INSERT OR REPLACE INTO traces (id, name, kind, status, start, duration, spans, run_id, path) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(t.id, t.name, t.kind, t.status, t.startTime, t.durationMs, t.spanCount, t.runId ?? null, t.path);
    this.db.exec('DELETE FROM traces WHERE id IN (SELECT id FROM traces ORDER BY start DESC LIMIT -1 OFFSET 50000)');
  }

  listTraces(q: ListQuery = {}): Page<TraceMeta> {
    const w = this.where(q, ['name', 'status']);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM traces ${w.sql}`).get(...w.args) as { n: number }).n;
    const rows = this.db.prepare(`SELECT * FROM traces ${w.sql} ORDER BY start DESC LIMIT ? OFFSET ?`).all(...w.args, q.limit ?? 100, q.offset ?? 0) as Array<Record<string, unknown>>;
    return { total, items: rows.map(traceRow) };
  }

  getTrace(id: string): TraceMeta | undefined {
    const r = this.db.prepare('SELECT * FROM traces WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? traceRow(r) : undefined;
  }

  close(): void {
    this.db.close();
  }
}

function historyRow(r: Record<string, unknown>): HistoryEntry {
  const doc = r.doc ? JSON.parse(r.doc as string) : {};
  return {
    id: r.id as string,
    timestamp: r.ts as string,
    kind: r.kind as HistoryEntry['kind'],
    name: r.name as string,
    method: (r.method as string) ?? undefined,
    url: (r.url as string) ?? undefined,
    status: r.status === null ? undefined : isNaN(Number(r.status)) ? (r.status as string) : Number(r.status),
    durationMs: (r.duration as number) ?? undefined,
    size: (r.size as number) ?? undefined,
    traceId: (r.trace_id as string) ?? undefined,
    payloadPath: (r.payload as string) ?? undefined,
    request: doc.request,
    responseMeta: doc.responseMeta,
    collectionId: doc.collectionId,
    requestId: doc.requestId,
  };
}

function traceRow(r: Record<string, unknown>): TraceMeta {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as string,
    status: r.status as string,
    startTime: r.start as number,
    durationMs: r.duration as number,
    spanCount: r.spans as number,
    runId: (r.run_id as string) ?? undefined,
    path: r.path as string,
  };
}

/** Fallback when `node:sqlite` is unavailable: append-only JSON-lines files with periodic compaction. */
class JsonlMetaStore implements MetaStore {
  readonly backend = 'jsonl' as const;
  private data: { history: HistoryEntry[]; runs: RunMeta[]; traces: TraceMeta[] } = { history: [], runs: [], traces: [] };

  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const { t, v, op } = JSON.parse(line);
          const arr = this.data[t as keyof typeof this.data] as Array<{ id: string }>;
          const i = arr.findIndex((x) => x.id === (op === 'del' ? v : v.id));
          if (op === 'del') {
            if (i >= 0) arr.splice(i, 1);
          } else if (op === 'clear') arr.length = 0;
          else if (i >= 0) arr[i] = v;
          else arr.push(v);
        } catch {
          /* skip corrupt line */
        }
      }
    }
  }

  private log(t: string, v: unknown, op = 'put'): void {
    appendFileSync(this.path, JSON.stringify({ t, v, op }) + '\n');
  }

  private page<T>(arr: T[], q: ListQuery, match: (x: T, s: string) => boolean, sortKey: (x: T) => string | number): Page<T> {
    let items = q.query ? arr.filter((x) => match(x, q.query!.toLowerCase())) : arr;
    if (q.kind) items = items.filter((x) => (x as { kind?: string }).kind === q.kind);
    items = [...items].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
    return { total: items.length, items: items.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100)) };
  }

  addHistory(e: HistoryEntry) {
    this.data.history.push(e);
    this.log('history', e);
  }
  listHistory(q: ListQuery = {}) {
    return this.page(q.requestId ? this.data.history.filter((h) => h.requestId === q.requestId) : this.data.history, q, (h, s) => `${h.name} ${h.url} ${h.method} ${h.status}`.toLowerCase().includes(s), (h) => h.timestamp);
  }
  getHistory(id: string) {
    return this.data.history.find((h) => h.id === id);
  }
  deleteHistory(id: string) {
    this.data.history = this.data.history.filter((h) => h.id !== id);
    this.log('history', id, 'del');
  }
  clearHistory() {
    this.data.history = [];
    this.log('history', null, 'clear');
  }
  addRun(s: RunSummary, dir: string) {
    const r: RunMeta = { id: s.runId, name: s.name, startedAt: s.startedAt, durationMs: s.durationMs, total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped, errors: s.errors, environment: s.environment, dir };
    this.data.runs.push(r);
    this.log('runs', r);
  }
  listRuns(q: ListQuery = {}) {
    return this.page(this.data.runs, q, (r, s) => r.name.toLowerCase().includes(s), (r) => r.startedAt);
  }
  deleteRun(id: string) {
    this.data.runs = this.data.runs.filter((r) => r.id !== id);
    this.log('runs', id, 'del');
  }
  addTrace(t: TraceMeta) {
    this.data.traces.push(t);
    this.log('traces', t);
  }
  listTraces(q: ListQuery = {}) {
    return this.page(this.data.traces, q, (t, s) => `${t.name} ${t.status}`.toLowerCase().includes(s), (t) => t.startTime);
  }
  getTrace(id: string) {
    return this.data.traces.find((t) => t.id === id);
  }
  close() {
    // compact
    const lines = [
      ...this.data.history.map((v) => ({ t: 'history', v })),
      ...this.data.runs.map((v) => ({ t: 'runs', v })),
      ...this.data.traces.map((v) => ({ t: 'traces', v })),
    ];
    atomicWrite(this.path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
}

export function openMetaStore(dir: string): MetaStore {
  const sqlite = loadSqlite();
  if (sqlite) {
    try {
      return new SqliteMetaStore(`${dir}/database.sqlite`, sqlite.DatabaseSync);
    } catch {
      /* fall through */
    }
  }
  return new JsonlMetaStore(`${dir}/metadata.jsonl`);
}
