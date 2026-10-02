import { securityLint } from '../eval/security.js';
import { Redactor } from '../util/redact.js';
import type { WorkspaceStore } from './workspace.js';

/**
 * Secrets that would be published by committing the workspace (GIT-104): values typed in where a secret variable
 * belongs. Secret variables themselves are safe: their values live in the OS secret store, not in the files.
 * Used before a commit: `testpion git check`, the pre-commit hook (`testpion git hook install`), and the app.
 */
export interface SecretFinding {
  /** Workspace file the value is in. */
  file: string;
  /** Where in it, in words: "Payments ▸ Create invoice", "environment Staging, variable token". */
  where: string;
  message: string;
}

const hasVariable = (v: string) => /\{\{\s*[^{}]+\s*\}\}/.test(v);

export function findCommittableSecrets(store: WorkspaceStore): SecretFinding[] {
  const out: SecretFinding[] = [];
  const red = new Redactor();
  const sensitive = (key: string) => red.isSensitiveKey(key);
  // collections: the security lint's "typed in" findings (headers, auth, body fields)
  for (const c of store.listCollections()) {
    if ((c as { problem?: string }).problem) continue;
    for (const f of securityLint(c)) if (f.severity === 'high' && /typed in/.test(f.message)) out.push({ file: `collections/${c.id}.json`, where: f.where, message: f.message });
    for (const v of c.variables ?? []) if (sensitive(v.key) && v.value && !hasVariable(v.value) && !(v as { secret?: boolean }).secret) out.push({ file: `collections/${c.id}.json`, where: `collection ${c.name}, variable ${v.key}`, message: `The collection variable "${v.key}" holds a value typed in: move it to a secret environment variable` });
  }
  // environments and the workspace: a sensitive-looking variable with a plain value (not marked secret)
  for (const e of store.listEnvironments()) {
    for (const v of e.variables) if (sensitive(v.key) && v.value && !v.secret && !hasVariable(v.value)) out.push({ file: `environments/${e.id}.json`, where: `environment ${e.name}, variable ${v.key}`, message: `"${v.key}" holds a value in plain text: mark it secret (lock icon) so its value stays in the OS secret store` });
  }
  for (const v of store.workspace.variables ?? []) if (sensitive(v.key) && v.value && !(v as { secret?: boolean }).secret && !hasVariable(v.value)) out.push({ file: 'workspace.json', where: `workspace variable ${v.key}`, message: `"${v.key}" holds a value in plain text: mark it secret` });
  // MCP servers (headers, environment of a local command) and providers (API keys)
  for (const s of store.getMcpServers()) {
    const kv: Array<[string, string]> = 'env' in s && s.env ? Object.entries(s.env) : 'headers' in s && s.headers ? s.headers.map((h) => [h.key, h.value]) : [];
    for (const [k, v] of kv) if (sensitive(k) && v && !hasVariable(v)) out.push({ file: 'mcp-servers.json', where: `MCP server ${s.name}, ${k}`, message: `"${k}" holds a value typed in: use a {{secret variable}}` });
  }
  for (const p of store.getProviders()) if (p.apiKey && !hasVariable(p.apiKey)) out.push({ file: 'providers.json', where: `provider ${p.name}`, message: 'The API key is typed in: save it in Settings ▸ Providers (kept in the OS secret store)' });
  return out;
}
