import { DEFAULT_REDACT_FIELDS } from '../model/types.js';

export const REDACTED = '[REDACTED]';

/**
 * Redacts secrets from arbitrary data before it is logged, traced, reported or exported.
 *
 * Two mechanisms are combined:
 *  1. Field names (case-insensitive) configured by the user, e.g. `password`, `authorization`.
 *  2. Known secret *values* registered at resolution time — any occurrence inside any string is masked,
 *     which catches secrets embedded in URLs, bodies or error messages.
 */
export class Redactor {
  private fields: Set<string>;
  private normFields: Set<string>;
  private values = new Set<string>();
  private valueRegex?: RegExp;

  constructor(fields: string[] = DEFAULT_REDACT_FIELDS) {
    this.fields = new Set(fields.map((f) => f.toLowerCase()));
    this.normFields = new Set(fields.map(norm));
  }

  setFields(fields: string[]): void {
    this.fields = new Set(fields.map((f) => f.toLowerCase()));
    this.normFields = new Set(fields.map(norm));
  }

  /** Register a secret value; values shorter than 4 characters are ignored to avoid over-masking. */
  addSecret(value: string | undefined | null): void {
    if (!value || typeof value !== 'string' || value.length < 4 || this.values.has(value)) return;
    this.values.add(value);
    const sorted = [...this.values].sort((a, b) => b.length - a.length).map(escapeRegex);
    this.valueRegex = new RegExp(sorted.join('|'), 'g');
  }

  /**
   * Exact match (case/separator-insensitive), or the key *ends with* a configured field:
   * `accessToken`, `x-api-key`, `client_secret` match; `totalTokens`, `maxTokens` do not.
   */
  isSensitiveKey(key: string): boolean {
    return this.matchKey(key) !== 'none';
  }

  private matchKey(key: string): 'exact' | 'suffix' | 'none' {
    const k = norm(key);
    if (this.fields.has(key.toLowerCase()) || this.normFields.has(k)) return 'exact';
    for (const f of this.normFields) if (f.length >= 5 && k.endsWith(f)) return 'suffix';
    return 'none';
  }

  redactString(s: string): string {
    if (!this.valueRegex || !s) return s;
    return s.replace(this.valueRegex, REDACTED);
  }

  /** Deep-copy `data`, masking sensitive keys and known secret values. */
  redact<T>(data: T, depth = 0): T {
    if (data == null || depth > 64) return data;
    if (typeof data === 'string') return this.redactString(data) as T;
    if (typeof data !== 'object') return data;
    if (Array.isArray(data)) {
      // [key, value] header tuples
      if (data.length === 2 && typeof data[0] === 'string' && typeof data[1] === 'string' && this.isSensitiveKey(data[0]))
        return [data[0], REDACTED] as T;
      return data.map((v) => this.redact(v, depth + 1)) as T;
    }
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data;
    const out: Record<string, unknown> = {};
    const obj = data as Record<string, unknown>;
    // { key, value } pairs (headers, params, variables)
    const kv = typeof obj.key === 'string' && 'value' in obj;
    for (const [k, v] of Object.entries(obj)) {
      if (kv && k === 'value' && (this.isSensitiveKey(obj.key as string) || obj.secret === true)) out[k] = v ? REDACTED : v;
      else if (typeof v === 'string' && this.isSensitiveKey(k)) out[k] = REDACTED;
      // numbers are only masked on exact field matches (e.g. `ssn`), never on suffix matches like `totalTokens`
      else if (typeof v === 'number' && this.matchKey(k) === 'exact') out[k] = REDACTED;
      else out[k] = this.redact(v, depth + 1);
    }
    return out as T;
  }

  /** Redact query-string values of sensitive parameters in a URL. */
  redactUrl(url: string): string {
    try {
      const u = new URL(url);
      let changed = false;
      for (const k of [...u.searchParams.keys()]) {
        if (this.isSensitiveKey(k)) {
          u.searchParams.set(k, 'REDACTED');
          changed = true;
        }
      }
      if (u.password) {
        u.password = 'REDACTED';
        changed = true;
      }
      return this.redactString(changed ? u.toString() : url);
    } catch {
      return this.redactString(url);
    }
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[-_\s.]/g, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
