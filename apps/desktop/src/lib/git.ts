import { useEffect, useSyncExternalStore } from 'react';
import { call, on } from '../api';
import type { GitStatusInfo, SemanticChange } from '../views/GitView';

/**
 * The workspace's git state, shared by the status bar, the explorer's change marks and the Git view (GIT-204): read
 * once, refreshed when the workspace or git changes. Nothing is read when the workspace is not in git.
 */
interface GitState {
  status?: GitStatusInfo;
  /** Change by collection item id (the explorer marks those rows). */
  items: Map<string, SemanticChange['change']>;
  /** Collections with any change. */
  collections: Set<string>;
}

let state: GitState = { items: new Map(), collections: new Set() };
const listeners = new Set<() => void>();
let users = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let offs: Array<() => void> = [];

async function refresh() {
  try {
    const status = await call<GitStatusInfo>('git.status');
    const items = new Map<string, SemanticChange['change']>();
    const collections = new Set<string>();
    if (status.repository && status.files.length) {
      const { changes } = await call<{ changes: SemanticChange[] }>('git.changes');
      for (const c of changes) {
        if (c.itemId) items.set(c.itemId, c.change);
        if (c.collectionId) collections.add(c.collectionId);
      }
    }
    state = { status, items, collections };
  } catch {
    state = { items: new Map(), collections: new Set() };
  }
  listeners.forEach((l) => l());
}

const soon = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), 400);
};

export function useGit(): GitState {
  useEffect(() => {
    if (users++ === 0) {
      void refresh();
      offs = ['git.changed', 'data.changed', 'workspace.changedOnDisk'].map((ch) => on(ch, soon));
    }
    return () => {
      if (--users === 0) offs.forEach((o) => o());
    };
  }, []);
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}
