import { useCallback, useEffect, useMemo, useState } from 'react';
import { asError, call } from '../api';
import { useApp } from '../store';
import type { Library, LibraryItem } from '../types';
import { libraryOps, type FolderListOps } from '../components/FolderList';
import { uid } from './format';

/**
 * Saved items of one kind with folders (WebSocket connections, AI prompts …), stored in the workspace
 * (library/<kind>.json) through lib.get / lib.save. Reloads when the workspace changes.
 */
export function useLibrary<T>(kind: string) {
  const [lib, setLib] = useState<Library<T>>({ folders: [], items: [] });
  const workspace = useApp((s) => s.workspace?.id);
  const reload = useCallback(() => call<Library<T>>('lib.get', { kind }).then(setLib, () => undefined), [kind]);
  useEffect(() => {
    void reload();
  }, [reload, workspace]);
  const save = useCallback(
    async (next: Library<T>) => {
      setLib(next);
      try {
        setLib(await call<Library<T>>('lib.save', { kind, library: next }));
      } catch (e) {
        useApp.getState().toast(`Could not save: ${asError(e).message}`, 'error');
        void reload();
      }
    },
    [kind, reload],
  );
  const ops: FolderListOps = useMemo(() => libraryOps(lib, save, () => uid('lib-')), [lib, save]);
  /** Add or replace an item; returns its id. */
  const put = useCallback(
    async (item: Omit<LibraryItem<T>, 'id'> & { id?: string }) => {
      const id = item.id ?? uid('lib-');
      const next = { ...item, id, updatedAt: new Date().toISOString() } as LibraryItem<T>;
      const exists = lib.items.some((i) => i.id === id);
      await save({ ...lib, items: exists ? lib.items.map((i) => (i.id === id ? next : i)) : [...lib.items, next] });
      return id;
    },
    [lib, save],
  );
  return { lib, save, ops, put, reload };
}
