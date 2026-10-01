import { useEffect } from 'react';
import { create } from 'zustand';
import { call, on } from '../api';
import type { Collection } from '../types';

/**
 * The workspace's collections (every request of every collection), fetched once for the whole app: the
 * Collections sidebar, the REST editor and the breadcrumbs share this list instead of each fetching it, and
 * it is fetched again once after a burst of changes (`data.changed`: a save, an import, a run), not once per
 * listener.
 */
const useStore = create<{ list: Collection[]; loaded: boolean }>(() => ({ list: [], loaded: false }));

let pending: Promise<Collection[]> | undefined;
/** Fetch the collections now (callers that just saved one can await the fresh list). */
export function refreshCollections(): Promise<Collection[]> {
  pending ??= call<Collection[]>('col.list')
    .then((list) => {
      useStore.setState({ list, loaded: true });
      return list;
    })
    .catch(() => useStore.getState().list)
    .finally(() => (pending = undefined));
  return pending;
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  on('data.changed', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refreshCollections(), 100);
  });
}

/** The collections, kept up to date (corrupted files included, with `problem` set). */
export function useCollections(): Collection[] {
  const list = useStore((s) => s.list);
  useEffect(() => {
    wire();
    if (!useStore.getState().loaded) void refreshCollections();
  }, []);
  return list;
}

/** The list as it is now, without subscribing (event handlers). */
export const currentCollections = () => useStore.getState().list;
