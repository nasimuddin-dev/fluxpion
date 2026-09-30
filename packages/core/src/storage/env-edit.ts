import type { Environment } from '../model/types.js';
import type { WorkspaceStore } from './workspace.js';
import { ApsError } from '../errors.js';
import { slugify } from '../util/ids.js';

/**
 * Set or remove plain (non-secret) variables of an environment from the CLI or an AI agent. Secret
 * variables are refused: their values live in the OS secret store and are set in the app (or passed to
 * the CLI as TESTPION_SECRET_* environment variables), never through here.
 */
export function findEnvironment(store: WorkspaceStore, ref: string): Environment | undefined {
  const envs = store.listEnvironments();
  return envs.find((e) => e.id === ref) ?? envs.find((e) => e.name.toLowerCase() === ref.toLowerCase());
}

export function setEnvironmentVariables(store: WorkspaceStore, ref: string, values: Record<string, string>, opts: { create?: boolean } = {}): Environment {
  let env = findEnvironment(store, ref);
  if (!env) {
    if (!opts.create) throw new ApsError('ValidationError', `No environment "${ref}". Available: ${store.listEnvironments().map((e) => e.name).join(', ') || 'none'}`, { suggestions: ['Pass --create (create: true) to make it.'] });
    env = { id: slugify(ref) || 'environment', name: ref, variables: [] } as Environment;
  }
  const variables = [...env.variables];
  for (const [key, value] of Object.entries(values)) {
    if (!/^[\w.-]+$/.test(key)) throw new ApsError('ValidationError', `"${key}" is not a valid variable name (letters, digits, _ . -)`);
    const i = variables.findIndex((v) => v.key === key);
    if (i >= 0 && (variables[i] as { secret?: boolean }).secret) throw new ApsError('ValidationError', `"${key}" is a secret variable: set its value in the app (or as TESTPION_SECRET_* in CI), not here`);
    if (i >= 0) variables[i] = { ...variables[i]!, value, enabled: true };
    else variables.push({ key, value, enabled: true });
  }
  return store.saveEnvironment({ ...env, variables });
}

export function unsetEnvironmentVariables(store: WorkspaceStore, ref: string, keys: string[]): Environment {
  const env = findEnvironment(store, ref);
  if (!env) throw new ApsError('ValidationError', `No environment "${ref}"`);
  const secret = env.variables.find((v) => keys.includes(v.key) && (v as { secret?: boolean }).secret);
  if (secret) throw new ApsError('ValidationError', `"${secret.key}" is a secret variable: remove it in the app, so its stored value is removed too`);
  return store.saveEnvironment({ ...env, variables: env.variables.filter((v) => !keys.includes(v.key)) });
}
