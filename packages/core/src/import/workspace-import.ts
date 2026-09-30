import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Collection, CollectionNode, Environment } from '../model/types.js';
import type { WorkspaceStore } from '../storage/workspace.js';
import { shortId, slugify } from '../util/ids.js';
import { secretKeys, type SecretStore } from '../storage/secrets.js';
import { importAny } from './importers.js';
import { scriptCompatibility, type ScriptWarning } from '../scripts/compat.js';

export interface WorkspaceImportResult {
  format: string;
  collection?: Collection;
  environment?: Environment;
  /** Every environment the file had (Insomnia and Bruno exports can hold several). */
  environments?: Environment[];
  /** Secret variables whose values could not be stored (no secret store): set them in the app or as TESTPION_SECRET_* variables. */
  secretsToSet?: string[];
  /** OpenAPI / Swagger imports: where the document was kept (relative to the workspace). */
  specPath?: string;
  /** Requests that got an `openapi` contract check. */
  contractChecks?: number;
  /** Script APIs the sandbox doesn't provide (cheerio, pm.vault …): these requests need a change to run. */
  scriptWarnings?: ScriptWarning[];
}

/**
 * Import an API definition, collection, environment or HAR file into a workspace (the app's Import,
 * `testpion import`). An OpenAPI / Swagger document is also kept in `specs/`, and every request made
 * from it gets an `openapi` check, so the new collection tests its own contract.
 */
export function importIntoWorkspace(store: WorkspaceStore, text: string, opts: { contractChecks?: boolean; name?: string; secrets?: SecretStore } = {}): WorkspaceImportResult {
  const r = importAny(text, { name: opts.name });
  const out: WorkspaceImportResult = { format: r.format };
  let collection = r.collection;
  if (collection && (r.format === 'openapi' || r.format === 'swagger')) {
    const ext = text.trimStart().startsWith('{') ? 'json' : 'yaml';
    const rel = `specs/${slugify(collection.name) || 'api'}.${r.format}.${ext}`;
    const file = store.safePath(rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    out.specPath = rel;
    if (opts.contractChecks !== false) {
      let added = 0;
      const withCheck = (nodes: CollectionNode[]): CollectionNode[] =>
        nodes.map((n) => {
          if (n.kind === 'folder') return { ...n, items: withCheck(n.items) };
          if (n.kind !== 'http' || n.assertions?.some((a) => a.type === 'openapi')) return n;
          added++;
          return { ...n, assertions: [...(n.assertions ?? []), { type: 'openapi', spec: rel }] };
        });
      collection = { ...collection, items: withCheck(collection.items) };
      out.contractChecks = added;
    }
  }
  if (collection) {
    out.collection = store.saveCollection(collection);
    const warnings = scriptCompatibility(collection, (name) => store.readScriptPackage(name) !== undefined);
    if (warnings.length) out.scriptWarnings = warnings;
  }
  // an import never replaces an environment the workspace already has: a clash gets a new id and name
  const envs = (r.environments ?? (r.environment ? [r.environment] : [])).map((e) => {
    const taken = store.listEnvironments();
    const clash = taken.some((x) => x.id === e.id || x.name.toLowerCase() === e.name.toLowerCase());
    if (!clash) return e;
    let name = `${e.name} (imported)`;
    for (let i = 2; taken.some((x) => x.name.toLowerCase() === name.toLowerCase()); i++) name = `${e.name} (imported ${i})`;
    return { ...e, id: `${slugify(name)}-${shortId().slice(-4)}`, name, originalId: e.id };
  });
  for (const raw of envs) {
    const { originalId, ...e } = raw as Environment & { originalId?: string };
    store.saveEnvironment(e);
    // secret values (from a .env file) go to the secret store; without one they are reported, never written
    const values = r.secretValues?.[originalId ?? e.id] ?? {};
    for (const [k, v] of Object.entries(values)) {
      if (opts.secrets) void opts.secrets.set(secretKeys.envVar(e.id, k), v);
      else (out.secretsToSet ??= []).push(`${e.name} › ${k}`);
    }
  }
  if (envs.length) {
    out.environment = envs[0];
    out.environments = envs;
  }
  return out;
}
