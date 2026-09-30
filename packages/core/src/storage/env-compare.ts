import type { Environment } from '../model/types.js';
import type { SecretStore } from './secrets.js';
import { secretKeys } from './secrets.js';
import { Redactor } from '../util/redact.js';

/**
 * Compare two environments variable by variable, to catch configuration drift ("works on Staging,
 * broken on Production"): a key missing on one side, a different value, a disabled variable, a secret
 * that is set on one side only. Secret values are never read into the result, only whether they are set.
 */
export type EnvDiffStatus = 'same' | 'different' | 'only-left' | 'only-right';

export interface EnvDiffRow {
  key: string;
  status: EnvDiffStatus;
  /** Values, when requested and not sensitive (secrets and sensitive-looking keys are masked). */
  left?: string;
  right?: string;
  secret?: boolean;
  /** Which side stores it as a secret (a key can be a secret in one environment and plain in the other). */
  secretLeft?: boolean;
  secretRight?: boolean;
  /** Disabled on a side (a disabled variable is not used). */
  disabledLeft?: boolean;
  disabledRight?: boolean;
  /** For secrets: whether a value is stored on each side. */
  secretSetLeft?: boolean;
  secretSetRight?: boolean;
}

export interface EnvDiff {
  left: string;
  right: string;
  rows: EnvDiffRow[];
  summary: { same: number; different: number; onlyLeft: number; onlyRight: number };
}

export interface EnvDiffOptions {
  /** Include values (masked when secret or sensitive). Default false: statuses only (for agents). */
  values?: boolean;
  /** To tell whether secret variables have a value stored. */
  secrets?: SecretStore;
  redactor?: Redactor;
}

const MASK = '••••••';

export function compareEnvironments(left: Environment, right: Environment, opts: EnvDiffOptions = {}): EnvDiff {
  const redactor = opts.redactor ?? new Redactor();
  const index = (e: Environment) => new Map(e.variables.filter((v) => v.key).map((v) => [v.key, v]));
  const l = index(left);
  const r = index(right);
  const secretSet = (env: Environment, key: string) => {
    if (!opts.secrets) return undefined;
    const v = opts.secrets.get(secretKeys.envVar(env.id, key));
    return v !== undefined && v !== '';
  };
  const secretValue = (env: Environment, key: string) => opts.secrets?.get(secretKeys.envVar(env.id, key)) ?? '';
  const keys = [...new Set([...l.keys(), ...r.keys()])].sort((a, b) => a.localeCompare(b));
  const rows: EnvDiffRow[] = keys.map((key) => {
    const a = l.get(key);
    const b = r.get(key);
    const secret = !!(a?.secret || b?.secret);
    const sensitiveKey = redactor.isSensitiveKey(key);
    let status: EnvDiffStatus;
    if (!b) status = 'only-left';
    else if (!a) status = 'only-right';
    else {
      // secrets compare by their stored values when the store is available (the values are not returned)
      const va = a.secret ? secretValue(left, key) : a.value;
      const vb = b.secret ? secretValue(right, key) : b.value;
      status = va === vb && !!a.secret === !!b.secret && (a.enabled !== false) === (b.enabled !== false) ? 'same' : 'different';
    }
    const row: EnvDiffRow = { key, status };
    if (secret) row.secret = true;
    if (a?.secret) row.secretLeft = true;
    if (b?.secret) row.secretRight = true;
    if (a && a.enabled === false) row.disabledLeft = true;
    if (b && b.enabled === false) row.disabledRight = true;
    if (opts.secrets) {
      if (a?.secret) row.secretSetLeft = !!secretSet(left, key);
      if (b?.secret) row.secretSetRight = !!secretSet(right, key);
    }
    if (opts.values) {
      if (a) row.left = a.secret || sensitiveKey ? MASK : a.value;
      if (b) row.right = b.secret || sensitiveKey ? MASK : b.value;
    }
    return row;
  });
  const count = (s: EnvDiffStatus) => rows.filter((x) => x.status === s).length;
  return { left: left.name, right: right.name, rows, summary: { same: count('same'), different: count('different'), onlyLeft: count('only-left'), onlyRight: count('only-right') } };
}
