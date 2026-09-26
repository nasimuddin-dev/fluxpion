import type { HttpRequestSpec, KeyValue } from '../types';

/**
 * Postman-style URL editing: the URL bar shows the query string, and the Params table mirrors it.
 * The engine stores the base URL and the params separately, so requests are converted at the edges.
 */
export function splitUrl(raw: string): { base: string; query: string | null } {
  const i = raw.indexOf('?');
  return i < 0 ? { base: raw, query: null } : { base: raw.slice(0, i), query: raw.slice(i + 1) };
}

function dec(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Parse a query string without touching {{variables}}. */
export function parseQuery(q: string): KeyValue[] {
  return q
    .split('&')
    .filter((p) => p !== '')
    .map((p) => {
      const e = p.indexOf('=');
      return { key: dec(e >= 0 ? p.slice(0, e) : p), value: dec(e >= 0 ? p.slice(e + 1) : ''), enabled: true };
    });
}

/** Serialise enabled params for display in the URL bar (unencoded, like Postman). */
export function serializeParams(params: KeyValue[] | undefined): string {
  return (params ?? [])
    .filter((p) => p.enabled !== false && p.key)
    .map((p) => `${p.key}=${p.value}`)
    .join('&');
}

/** When the URL bar changes: keep disabled params, replace enabled ones with the query string's. */
export function paramsFromUrl(raw: string, current: KeyValue[] | undefined): KeyValue[] {
  const { query } = splitUrl(raw);
  const disabled = (current ?? []).filter((p) => p.enabled === false);
  return [...(query === null ? [] : parseQuery(query)), ...disabled];
}

/** When the Params table changes: rebuild the URL's query string. */
export function urlFromParams(raw: string, params: KeyValue[] | undefined): string {
  const { base } = splitUrl(raw);
  const q = serializeParams(params);
  return q ? `${base}?${q}` : base;
}

export function pathVariableNames(url: string): string[] {
  const path = splitUrl(url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')).base;
  return [...new Set([...path.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => m[1]!))];
}

/** Keep one row per `:name` in the URL, preserving values the user already typed. */
export function syncPathVariables(url: string, current: KeyValue[] | undefined): KeyValue[] | undefined {
  const names = pathVariableNames(url);
  if (!names.length) return current?.length ? [] : current;
  return names.map((n) => current?.find((v) => v.key === n) ?? { key: n, value: '', enabled: true });
}

/** UI form (query in URL) → engine form (base URL + params). */
export function toEngineRequest(r: HttpRequestSpec): HttpRequestSpec {
  return { ...r, url: splitUrl(r.url).base, params: r.params };
}

/** Engine form → UI form (query shown in the URL bar). */
export function fromEngineRequest(r: HttpRequestSpec): HttpRequestSpec {
  const { base, query } = splitUrl(r.url);
  const params = [...(query ? parseQuery(query) : []), ...(r.params ?? [])];
  return { ...r, params, url: urlFromParams(base, params), pathVariables: syncPathVariables(base, r.pathVariables) };
}
