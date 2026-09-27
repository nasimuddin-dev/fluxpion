import { randomInt, randomUUID } from 'node:crypto';
import type { Redactor } from '../util/redact.js';

/**
 * Variable scopes in increasing precedence (later scopes override earlier ones):
 * Global → Workspace → Environment → Collection → Request → Runtime.
 */
export const SCOPE_ORDER = ['global', 'workspace', 'environment', 'collection', 'request', 'runtime'] as const;
export type ScopeName = (typeof SCOPE_ORDER)[number];

export interface SecretReader {
  /** Synchronous read so template resolution stays synchronous. */
  get(name: string): string | undefined;
}

export interface ResolveOptions {
  /** Allow `{{$env.NAME}}` lookups (enabled for CLI/CI; desktop enables it too). */
  allowEnv?: boolean;
}

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export class VariableScope {
  private scopes = new Map<ScopeName, Map<string, unknown>>();
  private secretKeys = new Set<string>();
  readonly unresolved = new Set<string>();

  constructor(
    private secrets?: SecretReader,
    private redactor?: Redactor,
    private opts: ResolveOptions = { allowEnv: true },
  ) {
    for (const s of SCOPE_ORDER) this.scopes.set(s, new Map());
  }

  /** Create a child that shares nothing but a copy of current values (runtime writes stay local). */
  clone(): VariableScope {
    const c = new VariableScope(this.secrets, this.redactor, this.opts);
    for (const [name, m] of this.scopes) c.scopes.set(name, new Map(m));
    for (const k of this.secretKeys) c.secretKeys.add(k);
    return c;
  }

  setScope(scope: ScopeName, values: Record<string, unknown> | Array<{ key: string; value: unknown; enabled?: boolean; secret?: boolean }>): void {
    const m = new Map<string, unknown>();
    if (Array.isArray(values)) {
      for (const v of values) {
        if (v.enabled === false || !v.key) continue;
        m.set(v.key, v.value);
        if (v.secret) this.markSecret(v.key, v.value);
      }
    } else {
      for (const [k, v] of Object.entries(values)) m.set(k, v);
    }
    this.scopes.set(scope, m);
  }

  markSecret(key: string, value: unknown): void {
    this.secretKeys.add(key);
    if (typeof value === 'string') this.redactor?.addSecret(value);
  }

  isSecret(key: string): boolean {
    return this.secretKeys.has(key);
  }

  set(key: string, value: unknown, scope: ScopeName = 'runtime'): void {
    this.scopes.get(scope)!.set(key, value);
  }

  unset(key: string, scope: ScopeName = 'runtime'): void {
    this.scopes.get(scope)!.delete(key);
  }

  has(key: string): boolean {
    return this.lookup(key) !== undefined;
  }

  get(key: string): unknown {
    return this.lookup(key);
  }

  /** Merged view of all scopes (for display / scripts). Secret values are included — callers must redact. */
  /** Values defined in one scope only (e.g. the environment), for Postman-style pm.environment access. */
  scopeValues(scope: ScopeName): Record<string, unknown> {
    return Object.fromEntries(this.scopes.get(scope)!);
  }

  toObject(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const s of SCOPE_ORDER) for (const [k, v] of this.scopes.get(s)!) out[k] = v;
    return out;
  }

  /** Where does a key resolve from? Useful for the UI "variable inspector". */
  describe(key: string): { scope: ScopeName; value: unknown; secret: boolean } | undefined {
    for (let i = SCOPE_ORDER.length - 1; i >= 0; i--) {
      const s = SCOPE_ORDER[i]!;
      const m = this.scopes.get(s)!;
      if (m.has(key)) return { scope: s, value: m.get(key), secret: this.secretKeys.has(key) };
    }
    return undefined;
  }

  private lookup(expr: string): unknown {
    const name = expr.trim();
    if (name.startsWith('$')) return this.dynamic(name);
    for (let i = SCOPE_ORDER.length - 1; i >= 0; i--) {
      const m = this.scopes.get(SCOPE_ORDER[i]!)!;
      if (m.has(name)) return m.get(name);
    }
    // dotted access into object values: {{user.name}}, {{args.customer_id}}
    const dot = name.indexOf('.');
    if (dot > 0) {
      let cur = this.lookup(name.slice(0, dot));
      for (const part of name.slice(dot + 1).split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
      }
      return cur;
    }
    return undefined;
  }

  private dynamic(name: string): unknown {
    if (name === '$uuid' || name === '$guid') return randomUUID();
    if (name === '$timestamp') return Math.floor(Date.now() / 1000);
    if (name === '$timestampMs') return Date.now();
    if (name === '$isoTimestamp') return new Date().toISOString();
    if (name === '$randomInt') return randomInt(0, 1001);
    const ri = /^\$randomInt\((\d+)\s*,\s*(\d+)\)$/.exec(name);
    if (ri) return randomInt(Number(ri[1]), Number(ri[2]) + 1);
    if (name === '$randomEmail') return `user${randomInt(0, 1e6)}@example.test`;
    if (name.startsWith('$env.')) {
      if (!this.opts.allowEnv) return undefined;
      const v = process.env[name.slice(5)];
      if (v && /key|token|secret|password/i.test(name)) this.redactor?.addSecret(v);
      return v;
    }
    if (name.startsWith('$secret.')) {
      const v = this.secrets?.get(name.slice(8));
      if (v) this.redactor?.addSecret(v);
      return v;
    }
    return undefined;
  }

  /** Replace `{{var}}` placeholders in a string. Unknown placeholders are left intact and recorded. */
  resolve(input: string): string {
    if (!input || input.indexOf('{{') < 0) return input;
    return input.replace(TEMPLATE, (whole, expr: string) => {
      const v = this.lookup(expr);
      if (v === undefined) {
        this.unresolved.add(expr.trim());
        return whole;
      }
      if (this.secretKeys.has(expr.trim()) && typeof v === 'string') this.redactor?.addSecret(v);
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }

  /**
   * Deeply resolve templates in any JSON-like value. A string that is exactly one placeholder
   * (e.g. `"{{count}}"`) resolves to the raw typed value, so numbers/objects survive.
   */
  resolveDeep<T>(value: T): T {
    if (typeof value === 'string') {
      const m = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value);
      if (m) {
        const v = this.lookup(m[1]!);
        if (v !== undefined) {
          if (this.secretKeys.has(m[1]!.trim()) && typeof v === 'string') this.redactor?.addSecret(v);
          return v as T;
        }
      }
      return this.resolve(value) as T;
    }
    if (Array.isArray(value)) return value.map((v) => this.resolveDeep(v)) as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.resolveDeep(v);
      return out as T;
    }
    return value;
  }
}

/** Extract `{{name}}` references from a template (for "missing variable" warnings and prompt variable forms). */
export function templateVariables(input: string): string[] {
  const out = new Set<string>();
  for (const m of input.matchAll(TEMPLATE)) {
    const name = m[1]!.trim();
    if (!name.startsWith('$')) out.add(name.split('.')[0]!);
  }
  return [...out];
}
