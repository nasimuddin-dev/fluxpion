import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { writtenByUs } from './fsutil.js';

/**
 * Watch a workspace folder for changes made outside the app (GIT-103): `git pull`, a branch switch, another editor.
 * Results and this computer's state are ignored, so are the app's own saves (`writtenByUs`). Changes arrive in
 * batches (a pull touches many files at once).
 */
export type WorkspaceChangeKind = 'collections' | 'environments' | 'tests' | 'library' | 'mcp' | 'providers' | 'workspace' | 'specs' | 'other';

export interface WorkspaceChange {
  /** Path inside the workspace, with forward slashes. */
  path: string;
  kind: WorkspaceChangeKind;
}

const IGNORED_TOP = new Set(['runs', 'traces', 'payloads', 'reports', 'baselines', 'trash', '.local', '.git', 'node_modules']);
const IGNORED_FILE = /(^|\/)(database\.sqlite.*|metadata\.jsonl|\.template-offered\.json)$|\.tmp-\d+-[0-9a-f]+$|~$|\.swp$/;

export function changeKind(path: string): WorkspaceChangeKind | undefined {
  const top = path.split('/')[0]!;
  if (IGNORED_TOP.has(top) || IGNORED_FILE.test(path)) return undefined;
  if (top === 'collections') return 'collections';
  if (top === 'environments') return 'environments';
  if (top === 'tests' || top === 'datasets') return 'tests';
  if (top === 'library') return 'library';
  if (top === 'specs') return 'specs';
  if (path === 'mcp-servers.json') return 'mcp';
  if (path === 'providers.json') return 'providers';
  if (path === 'workspace.json') return 'workspace';
  return 'other';
}

/**
 * Start watching; `onChange` gets each batch once things are quiet for `debounceMs`. `isQuiet()` (optional) tells
 * the watcher the app itself is saving right now, so the event is its own. Returns a function that stops it.
 */
export function watchWorkspace(root: string, onChange: (changes: WorkspaceChange[]) => void, opts: { debounceMs?: number; isOwnChange?: () => boolean } = {}): () => void {
  const pending = new Map<string, WorkspaceChange>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  /**
   * What each file was when last seen: its size and last write. Windows reports a file being read (its access time)
   * as a change, so an event only counts when the file itself is different (or appeared, or is gone).
   */
  const seen = new Map<string, string>();
  const fingerprint = (path: string) => {
    try {
      const full = join(root, path);
      const st = statSync(full);
      if (st.isDirectory()) return 'dir';
      // the content, not the times: a rewrite with the same bytes (git restoring a file) is no change either
      return st.size > 8 * 1024 * 1024 ? `${st.size}:${st.mtimeMs}` : `${st.size}:${createHash('sha1').update(readFileSync(full)).digest('hex')}`;
    } catch {
      return 'gone';
    }
  };
  const snapshot = (dir: string, depth = 0) => {
    if (depth > 8) return;
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = dir ? `${dir}/${e.name}` : e.name;
      if (!changeKind(path)) continue;
      if (e.isDirectory()) snapshot(path, depth + 1);
      else seen.set(path, fingerprint(path));
    }
  };
  snapshot('');
  const flush = () => {
    timer = undefined;
    if (!pending.size) return;
    const batch = [...pending.values()].filter((c) => {
      const now = fingerprint(c.path);
      const before = seen.get(c.path) ?? 'gone';
      if (now === 'gone') seen.delete(c.path);
      else seen.set(c.path, now);
      // a folder event says nothing by itself: its files report their own changes
      return now !== 'dir' && now !== before;
    });
    pending.clear();
    if (batch.length) onChange(batch);
  };
  try {
    watcher = watch(root, { recursive: true, persistent: false }, (_event, name) => {
      if (!name) return;
      const path = String(name).split(sep).join('/');
      const kind = changeKind(path);
      if (!kind) return;
      if (writtenByUs(join(root, path)) || opts.isOwnChange?.()) {
        // the app's own write: the file's new state is the known one
        const f = fingerprint(path);
        if (f === 'gone') seen.delete(path);
        else seen.set(path, f);
        return;
      }
      // a just-written temp file renamed into place reports the final name too: one entry per path
      pending.set(path, { path, kind });
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, opts.debounceMs ?? 400);
    });
    watcher.on('error', () => undefined);
  } catch {
    // a host without recursive watching: the app still works, it just won't notice outside changes
    return () => undefined;
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

/** A short description of a batch for the user: "2 collections and 1 environment changed on disk". */
export function describeChanges(changes: WorkspaceChange[]): string {
  const count = (k: WorkspaceChangeKind) => new Set(changes.filter((c) => c.kind === k).map((c) => c.path)).size;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n && parts.push(`${n} ${n === 1 ? one : many}`);
  add(count('collections'), 'collection', 'collections');
  add(count('environments'), 'environment', 'environments');
  add(count('tests'), 'test file', 'test files');
  add(count('library'), 'saved call list', 'saved call lists');
  add(count('mcp'), 'MCP server list', 'MCP server lists');
  add(count('specs'), 'API definition', 'API definitions');
  add(count('providers') + count('workspace') + count('other'), 'other file', 'other files');
  return parts.length ? `${parts.join(', ')} changed outside TestPion` : 'Files changed outside TestPion';
}
