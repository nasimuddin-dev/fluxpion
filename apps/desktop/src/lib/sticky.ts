import { useCallback, useState, type SetStateAction } from 'react';

/**
 * Component state that survives unmounting (switching tabs, servers or views) for the rest of the
 * session. Kept in memory only, never written to disk: it may hold responses with secrets.
 */
const memory = new Map<string, unknown>();

export function useSticky<T>(key: string, initial: T | (() => T)): [T, (v: SetStateAction<T>) => void] {
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
        return next;
      }),
    [key],
  );
  return [current, set];
}

/** Forget everything kept under a prefix (e.g. a server that was removed). */
export function forgetSticky(prefix: string): void {
  for (const k of memory.keys()) if (k.startsWith(prefix)) memory.delete(k);
}
