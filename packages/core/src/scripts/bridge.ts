import type { VariableScope, ScopeName } from '../vars/variables.js';
import type { Redactor } from '../util/redact.js';
import type { ScriptInput, ScriptOutput, ScriptScope } from './sandbox.js';

/** Where `pm.environment` / `pm.globals` / `pm.collectionVariables` map to in the engine's scopes. */
const SCOPE_MAP: Record<ScriptScope, ScopeName> = { environment: 'environment', globals: 'global', collectionVariables: 'collection' };

/** Called when a script sets or unsets a scoped variable (the desktop app keeps these as local "current values"). */
export type PersistVariable = (scope: ScriptScope, key: string, value: unknown | undefined) => void;

/** Scope data a script sees. */
export function scriptScopes(vars: VariableScope, iterationData?: Record<string, unknown>): Pick<ScriptInput, 'variables' | 'environment' | 'globals' | 'collectionVariables' | 'iterationData'> {
  return {
    variables: vars.toObject(),
    environment: vars.scopeValues('environment'),
    globals: vars.scopeValues('global'),
    collectionVariables: vars.scopeValues('collection'),
    iterationData: iterationData ?? {},
  };
}

/**
 * Apply what a script changed: `pm.variables.set` → runtime scope; `pm.environment.set` etc. → that
 * scope (in every given VariableScope, e.g. the test's own and the run's shared one), plus persistence.
 */
export function applyScriptOutput(out: Pick<ScriptOutput, 'vars' | 'unset' | 'scopeSets' | 'scopeUnsets'>, targets: VariableScope[], opts: { redactor?: Redactor; persist?: PersistVariable } = {}): void {
  for (const [k, v] of Object.entries(out.vars)) for (const t of targets) t.set(k, v, 'runtime');
  for (const k of out.unset) for (const t of targets) t.unset(k, 'runtime');
  for (const scope of Object.keys(SCOPE_MAP) as ScriptScope[]) {
    for (const [k, v] of Object.entries(out.scopeSets?.[scope] ?? {})) {
      for (const t of targets) t.set(k, v, SCOPE_MAP[scope]);
      if (typeof v === 'string' && opts.redactor?.isSensitiveKey(k)) opts.redactor.addSecret(v);
      opts.persist?.(scope, k, v);
    }
    for (const k of out.scopeUnsets?.[scope] ?? []) {
      for (const t of targets) t.unset(k, SCOPE_MAP[scope]);
      opts.persist?.(scope, k, undefined);
    }
  }
}
