import { useCallback, useState, type SetStateAction } from 'react';

/**
 * Component state that survives unmounting (switching tabs, servers or views) for the rest of the
 * session. Kept in memory only, never written to disk: it may hold responses with secrets.
 */
const memory = new Map<string, unknown>();

const STORE = 'aps.sticky.';
const stored = <T,>(key: string): T | undefined => {
  try {
    const v = localStorage.getItem(STORE + key);
    return v === null ? undefined : (JSON.parse(v) as T);
  } catch {
    return undefined;
  }
};

/** Forget kept values (memory and disk), e.g. those of a tab that was closed. */
export function forgetStickyKeys(keys: string[]): void {
  for (const k of keys) {
    memory.delete(k);
    try {
      localStorage.removeItem(STORE + k);
    } catch {
      /* storage unavailable */
    }
  }
}

/**
 * `persist`: also keep it across restarts (on disk, in the window's storage). Only for small values that hold no
 * secrets, such as which saved item a tab shows, or a tab's own title.
 */
export function useSticky<T>(key: string, initial: T | (() => T), opts: { persist?: boolean } = {}): [T, (v: SetStateAction<T>) => void] {
  if (opts.persist && !memory.has(key)) {
    const v = stored<T>(key);
    if (v !== undefined) memory.set(key, v);
  }
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial));
  // a different key (another server or tool) starts from what was kept for it
  const [shownKey, setShownKey] = useState(key);
  let current = value;
  if (shownKey !== key) {
    current = memory.has(key) ? (memory.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial;
    setShownKey(key);
    setValue(current);
  }
  const set = useCallback(
    (v: SetStateAction<T>) =>
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        memory.set(key, next);
        if (opts.persist)
          try {
            if (next === undefined) localStorage.removeItem(STORE + key);
            else localStorage.setItem(STORE + key, JSON.stringify(next));
          } catch {
            /* storage unavailable */
          }
        return next;
      }),
    [key, opts.persist],
  );
  return [current, set];
}

/** Forget everything kept under a prefix (e.g. a server that was removed). */
export function forgetSticky(prefix: string): void {
  for (const k of memory.keys()) if (k.startsWith(prefix)) memory.delete(k);
}
