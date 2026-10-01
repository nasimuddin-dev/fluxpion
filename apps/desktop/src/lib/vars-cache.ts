import { call, on } from '../api';

export interface VarInfo {
  name: string;
  scope?: string;
  value?: string;
  secret?: boolean;
}

/**
 * `vars.inspect` with a short-lived cache shared by every field that highlights {{variables}}: a request
 * with many headers and params (or switching environment) then makes one call per distinct question
 * instead of one per field. Entries expire after a few seconds (scripts can change runtime values) and
 * are dropped whenever workspace data changes.
 */
const TTL_MS = 4000;
const MAX = 300;
const cache = new Map<string, { at: number; value: Promise<VarInfo[]> }>();
let listening = false;

export function inspectVariables(params: { environment?: string; collectionId?: string; template?: string }): Promise<VarInfo[]> {
  if (!listening) {
    listening = true;
    on('data.changed', () => cache.clear());
  }
  const key = JSON.stringify([params.environment ?? '', params.collectionId ?? '', params.template ?? null]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = call<VarInfo[]>('vars.inspect', params).catch((e: unknown) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  // oldest first (insertion order): keep the cache small
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return value;
}

/** Forget cached answers (after changing a variable). */
export function clearVariablesCache(): void {
  cache.clear();
}
