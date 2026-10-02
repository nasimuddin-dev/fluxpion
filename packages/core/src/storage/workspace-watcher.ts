import { watch, type FSWatcher } from 'node:fs';
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
  const flush = () => {
    timer = undefined;
    if (!pending.size) return;
    const batch = [...pending.values()];
    pending.clear();
    onChange(batch);
  };
  try {
    watcher = watch(root, { recursive: true, persistent: false }, (_event, name) => {
      if (!name) return;
      const path = String(name).split(sep).join('/');
      const kind = changeKind(path);
      if (!kind) return;
      if (writtenByUs(join(root, path)) || opts.isOwnChange?.()) return;
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
