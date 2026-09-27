import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import type { AppSettings, Collection, Environment, McpServerConfig, ProviderConfig, Trace, Workspace } from '../model/types.js';
import { SCHEMA_VERSION, defaultSettings } from '../model/types.js';
import { ApsError } from '../errors.js';
import { shortId, slugify } from '../util/ids.js';
import { atomicWrite, readJson, writeJson } from './fsutil.js';
import { openMetaStore, type MetaStore } from './metastore.js';
import type { Baseline } from '../report/regression.js';

/* ------------------------------------------------------------------ migrations */

export interface Migration {
  from: string;
  to: string;
  description: string;
  migrate(ws: Record<string, unknown>, root: string): Record<string, unknown>;
}

/**
 * Ordered workspace-format migrations. Each step upgrades exactly one version; `migrateWorkspace`
 * chains them. Never silently break existing workspaces: unknown future versions are rejected.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: '0.9',
    to: '1.0',
    description: 'Pre-release format: `variables` was an object map; convert to a key/value list.',
    migrate(ws) {
      const vars = ws.variables;
      if (vars && !Array.isArray(vars) && typeof vars === 'object')
        ws.variables = Object.entries(vars as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value), enabled: true }));
      ws.schemaVersion = '1.0';
      return ws;
    },
  },
];

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function migrateWorkspace(ws: Record<string, unknown>, root = '', migrations = MIGRATIONS, target = SCHEMA_VERSION): { ws: Record<string, unknown>; applied: string[] } {
  let version = String(ws.schemaVersion ?? '0.9');
  const applied: string[] = [];
  if (cmpVersion(version, target) > 0)
    throw new ApsError('ConfigurationError', `Workspace format ${version} is newer than this version of Protolens supports (${target})`, {
      suggestions: ['Upgrade Protolens to open this workspace.'],
    });
  while (cmpVersion(version, target) < 0) {
    const m = migrations.find((x) => x.from === version);
    if (!m) throw new ApsError('ConfigurationError', `No migration path from workspace format ${version} to ${target}`);
    ws = m.migrate(ws, root);
    applied.push(`${m.from} → ${m.to}`);
    version = m.to;
  }
  return { ws, applied };
}

/* ------------------------------------------------------------------ workspace store */

export interface TestFileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: TestFileNode[];
}

/**
 * On-disk layout (spec §25):
 *   workspace.json  database.sqlite  collections/  environments/  tests/  datasets/
 *   traces/  payloads/  reports/  runs/  baselines/  providers.json  mcp-servers.json
 */
export class WorkspaceStore {
  readonly meta: MetaStore;
  private ws: Workspace;
  readonly migrationsApplied: string[] = [];

  private constructor(
    readonly root: string,
    ws: Workspace,
  ) {
    this.ws = ws;
    for (const d of ['collections', 'environments', 'tests', 'datasets', 'traces', 'payloads', 'reports', 'runs', 'baselines']) mkdirSync(join(root, d), { recursive: true });
    this.meta = openMetaStore(root);
  }

  static create(root: string, name: string): WorkspaceStore {
    if (existsSync(join(root, 'workspace.json'))) throw new ApsError('ConfigurationError', `A workspace already exists at ${root}`);
    mkdirSync(root, { recursive: true });
    const now = new Date().toISOString();
    const ws: Workspace = { schemaVersion: SCHEMA_VERSION, id: shortId('ws-'), name, variables: [], createdAt: now, updatedAt: now };
    writeJson(join(root, 'workspace.json'), ws);
    const store = new WorkspaceStore(root, ws);
    store.saveEnvironment({ id: 'development', name: 'Development', variables: [{ key: 'baseUrl', value: 'http://localhost:3000', enabled: true }] });
    return store;
  }

  static open(root: string): WorkspaceStore {
    const file = join(root, 'workspace.json');
    if (!existsSync(file)) throw new ApsError('ConfigurationError', `No workspace found at ${root}`, { suggestions: ['Create a workspace first, or pass the correct --workspace path.'] });
    const raw = readJson<Record<string, unknown>>(file);
    const original = structuredClone(raw);
    const { ws, applied } = migrateWorkspace(raw, root);
    if (applied.length) {
      // keep a backup of the pre-migration file
      atomicWrite(`${file}.bak-${original.schemaVersion ?? '0.9'}`, JSON.stringify(original, null, 2));
      writeJson(file, ws);
    }
    const store = new WorkspaceStore(root, ws as unknown as Workspace);
    store.migrationsApplied.push(...applied);
    return store;
  }

  get workspace(): Workspace {
    return this.ws;
  }

  get id(): string {
    return this.ws.id;
  }

  updateWorkspace(patch: Partial<Omit<Workspace, 'schemaVersion' | 'id' | 'createdAt'>>): Workspace {
    this.ws = { ...this.ws, ...patch, updatedAt: new Date().toISOString() };
    writeJson(join(this.root, 'workspace.json'), this.ws);
    return this.ws;
  }

  path(...p: string[]): string {
    return join(this.root, ...p);
  }

  /** Guard against path traversal for user-supplied relative paths. */
  safePath(rel: string, base = this.root): string {
    const p = resolve(base, rel);
    if (p !== base && !p.startsWith(base + sep)) throw new ApsError('ValidationError', `Path escapes the workspace: ${rel}`);
    return p;
  }

  /* collections */
  listCollections(): Array<Collection & { problem?: string }> {
    const dir = this.path('collections');
    const out: Array<Collection & { problem?: string }> = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        out.push(readJson<Collection>(join(dir, f)));
      } catch (e) {
        out.push({ schemaVersion: SCHEMA_VERSION, id: f.replace(/\.json$/, ''), name: `${f} (corrupted)`, version: 0, variables: [], items: [], updatedAt: '', problem: (e as Error).message });
      }
    }
    return out;
  }

  getCollection(id: string): Collection {
    return readJson<Collection>(this.path('collections', `${slugify(id)}.json`));
  }

  saveCollection(c: Collection): Collection {
    const next: Collection = { ...c, schemaVersion: SCHEMA_VERSION, version: (c.version ?? 0) + 1, updatedAt: new Date().toISOString() };
    writeJson(this.path('collections', `${slugify(c.id)}.json`), next);
    return next;
  }

  deleteCollection(id: string): void {
    rmSync(this.path('collections', `${slugify(id)}.json`), { force: true });
  }

  /* environments */
  listEnvironments(): Environment[] {
    const dir = this.path('environments');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .flatMap((f) => {
        try {
          return [readJson<Environment>(join(dir, f))];
        } catch {
          return [];
        }
      });
  }

  getEnvironment(idOrName: string): Environment | undefined {
    return this.listEnvironments().find((e) => e.id === idOrName || e.name.toLowerCase() === idOrName.toLowerCase());
  }

  /** Secret variable values must already have been moved to the secret store — they are stripped here. */
  saveEnvironment(env: Environment): Environment {
    const clean: Environment = { ...env, variables: env.variables.map((v) => (v.secret ? { ...v, value: '' } : v)) };
    writeJson(this.path('environments', `${slugify(env.id)}.json`), clean);
    return clean;
  }

  deleteEnvironment(id: string): void {
    rmSync(this.path('environments', `${slugify(id)}.json`), { force: true });
  }

  /* providers & MCP servers */
  getProviders(): ProviderConfig[] {
    return readJson<{ providers: ProviderConfig[] }>(this.path('providers.json'), { providers: [] }).providers;
  }

  saveProviders(providers: ProviderConfig[]): void {
    for (const p of providers)
      if (p.apiKey && !/\{\{.+\}\}/.test(p.apiKey))
        throw new ApsError('ValidationError', `Provider "${p.name}" has a literal API key; store it as a secret instead`, {
          suggestions: ['Use {{$secret.provider.<id>.apiKey}} or {{$env.NAME}}.'],
        });
    writeJson(this.path('providers.json'), { schemaVersion: SCHEMA_VERSION, providers });
  }

  getMcpServers(): McpServerConfig[] {
    return readJson<{ servers: McpServerConfig[] }>(this.path('mcp-servers.json'), { servers: [] }).servers;
  }

  saveMcpServers(servers: McpServerConfig[]): void {
    writeJson(this.path('mcp-servers.json'), { schemaVersion: SCHEMA_VERSION, servers });
  }

  /* tests */
  testTree(dir = this.path('tests')): TestFileNode[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((e) => {
        const p = join(dir, e.name);
        const rel = relative(this.path('tests'), p).split(sep).join('/');
        return e.isDirectory() ? { name: e.name, path: rel, kind: 'dir' as const, children: this.testTree(p) } : { name: e.name, path: rel, kind: 'file' as const };
      })
      .filter((n) => n.kind === 'dir' || /\.(ya?ml|json|jsonl|csv|md)$/i.test(n.name));
  }

  readTestFile(rel: string): string {
    return readFileSync(this.safePath(rel, this.path('tests')), 'utf8');
  }

  writeTestFile(rel: string, content: string): void {
    atomicWrite(this.safePath(rel, this.path('tests')), content);
  }

  deleteTestFile(rel: string): void {
    rmSync(this.safePath(rel, this.path('tests')), { force: true, recursive: true });
  }

  /* traces */
  saveTrace(trace: Trace, kind: string, runId?: string): string {
    const day = new Date(trace.startTime).toISOString().slice(0, 10);
    const rel = join('traces', day, `${trace.traceId}.json`);
    atomicWrite(this.path(rel), JSON.stringify(trace));
    this.meta.addTrace({
      id: trace.traceId,
      name: trace.name,
      kind,
      status: trace.status,
      startTime: trace.startTime,
      durationMs: (trace.endTime ?? trace.startTime) - trace.startTime,
      spanCount: trace.spans.length,
      runId,
      path: rel,
    });
    return rel;
  }

  loadTrace(id: string): Trace | undefined {
    const m = this.meta.getTrace(id);
    if (!m) return undefined;
    return readJson<Trace>(this.path(m.path));
  }

  /* baselines */
  listBaselines(): Array<{ name: string; createdAt: string; runId: string; tests: number }> {
    const dir = this.path('baselines');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => {
        try {
          const b = readJson<Baseline>(join(dir, f));
          return [{ name: b.name, createdAt: b.createdAt, runId: b.runId, tests: Object.keys(b.tests).length }];
        } catch {
          return [];
        }
      });
  }

  getBaseline(name: string): Baseline {
    return readJson<Baseline>(this.path('baselines', `${slugify(name)}.json`));
  }

  saveBaseline(b: Baseline): void {
    writeJson(this.path('baselines', `${slugify(b.name)}.json`), b);
  }

  runDir(runId: string): string {
    return this.path('runs', runId);
  }

  /** Portable export bundle. Secret values are never included. */
  exportBundle(): WorkspaceBundle {
    const tests: Record<string, string> = {};
    const walk = (nodes: TestFileNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'dir') walk(n.children ?? []);
        else {
          const p = this.path('tests', n.path);
          if (statSync(p).size < 5 * 1024 * 1024) tests[n.path] = readFileSync(p, 'utf8');
        }
      }
    };
    walk(this.testTree());
    return {
      format: 'protolens-workspace',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: { ...this.ws, variables: this.ws.variables.map((v) => ((v as { secret?: boolean }).secret ? { ...v, value: '' } : v)) },
      collections: this.listCollections().filter((c) => !c.problem),
      environments: this.listEnvironments().map((e) => ({ ...e, variables: e.variables.map((v) => (v.secret ? { ...v, value: '' } : v)) })),
      providers: this.getProviders(),
      mcpServers: this.getMcpServers(),
      tests,
    };
  }

  close(): void {
    this.meta.close();
  }
}

export interface WorkspaceBundle {
  format: 'protolens-workspace';
  schemaVersion: string;
  exportedAt: string;
  workspace: Workspace;
  collections: Collection[];
  environments: Environment[];
  providers: ProviderConfig[];
  mcpServers: McpServerConfig[];
  tests: Record<string, string>;
}

/* ------------------------------------------------------------------ app-level manager */

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
}

export function defaultAppDir(): string {
  const explicit = process.env.PROTOLENS_HOME || process.env.APS_HOME; // APS_HOME: name before the Protolens rename
  if (explicit) return explicit;
  const dir = join(homedir(), '.protolens');
  // one-time move of the data folder used by 0.1.x (named "AI Protocol Studio" then)
  const legacy = join(homedir(), '.aipstudio');
  if (!existsSync(dir) && existsSync(legacy)) {
    try {
      renameSync(legacy, dir);
    } catch {
      return legacy; // in use or not permitted: keep using it rather than losing data
    }
  }
  return dir;
}

/** Manages the list of workspaces and global settings under the app directory. */
export class WorkspaceManager {
  constructor(readonly appDir = defaultAppDir()) {
    mkdirSync(join(appDir, 'workspaces'), { recursive: true });
  }

  get settingsPath(): string {
    return join(this.appDir, 'settings.json');
  }

  /** Problem found while loading settings (e.g. a corrupted file that was backed up and reset). */
  settingsProblem?: string;

  loadSettings(): AppSettings {
    let s: Partial<AppSettings> = {};
    try {
      s = readJson<Partial<AppSettings>>(this.settingsPath, {});
    } catch (e) {
      // readJson preserved the corrupted file as settings.json.corrupt-<ts>; start from defaults
      this.settingsProblem = (e as Error).message;
    }
    // revision 2 (redesigned UI): the default font size went from 13 to 14px — move people still on the old default
    if ((s.settingsRevision ?? 1) < 2 && s.fontSize === 13) s.fontSize = 14;
    return { ...defaultSettings(), ...s, settingsRevision: 2 };
  }

  saveSettings(s: AppSettings): AppSettings {
    writeJson(this.settingsPath, s);
    return s;
  }

  list(): WorkspaceInfo[] {
    const dirs = readdirSync(join(this.appDir, 'workspaces'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(this.appDir, 'workspaces', d.name));
    const extra = this.loadSettings().workspacePaths ?? [];
    const out: WorkspaceInfo[] = [];
    for (const p of [...dirs, ...extra]) {
      try {
        const w = readJson<Workspace>(join(p, 'workspace.json'));
        out.push({ id: w.id, name: w.name, path: p, updatedAt: w.updatedAt });
      } catch {
        /* skip invalid */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Resolve a workspace by id, name, slug or filesystem path. */
  resolve(ref: string): string | undefined {
    if (existsSync(join(ref, 'workspace.json'))) return resolve(ref);
    const r = ref.toLowerCase();
    return this.list().find((w) => w.id === ref || w.name.toLowerCase() === r || basename(w.path) === slugify(ref))?.path;
  }

  create(name: string, path?: string): WorkspaceStore {
    let root = path ?? join(this.appDir, 'workspaces', slugify(name));
    if (!path) {
      let i = 2;
      while (existsSync(root)) root = join(this.appDir, 'workspaces', `${slugify(name)}-${i++}`);
    }
    const s = WorkspaceStore.create(root, name);
    if (path) {
      const settings = this.loadSettings();
      if (!settings.workspacePaths.includes(root)) this.saveSettings({ ...settings, workspacePaths: [...settings.workspacePaths, root] });
    }
    return s;
  }

  open(ref: string): WorkspaceStore {
    const p = this.resolve(ref);
    if (!p) throw new ApsError('ConfigurationError', `Workspace "${ref}" not found`, { suggestions: [`Known workspaces: ${this.list().map((w) => w.name).join(', ') || 'none'}`] });
    return WorkspaceStore.open(p);
  }

  duplicate(ref: string, newName: string): WorkspaceInfo {
    const src = this.resolve(ref);
    if (!src) throw new ApsError('ConfigurationError', `Workspace "${ref}" not found`);
    let dest = join(this.appDir, 'workspaces', slugify(newName));
    let i = 2;
    while (existsSync(dest)) dest = join(this.appDir, 'workspaces', `${slugify(newName)}-${i++}`);
    cpSync(src, dest, {
      recursive: true,
      // copy definitions, not execution artefacts
      filter: (s) => {
        const top = relative(src, s).split(/[\\/]/)[0] ?? '';
        return !['runs', 'traces', 'payloads', 'reports'].includes(top) && !/^(database\.sqlite.*|metadata\.jsonl)$/.test(basename(s));
      },
    });
    const w = readJson<Workspace>(join(dest, 'workspace.json'));
    const next = { ...w, id: shortId('ws-'), name: newName, updatedAt: new Date().toISOString() };
    writeJson(join(dest, 'workspace.json'), next);
    return { id: next.id, name: newName, path: dest, updatedAt: next.updatedAt };
  }

  delete(ref: string): void {
    const p = this.resolve(ref);
    if (!p) return;
    const managed = resolve(p).startsWith(resolve(this.appDir, 'workspaces'));
    const settings = this.loadSettings();
    this.saveSettings({ ...settings, workspacePaths: settings.workspacePaths.filter((x) => resolve(x) !== resolve(p)) });
    // only delete files for workspaces the app created; external folders are just unregistered
    if (managed) rmSync(p, { recursive: true, force: true });
  }

  importBundle(bundle: WorkspaceBundle, name?: string): WorkspaceStore {
    if (bundle?.format !== 'protolens-workspace') throw new ApsError('ValidationError', 'Not an Protolens workspace export');
    const { ws } = migrateWorkspace({ ...(bundle.workspace as unknown as Record<string, unknown>), schemaVersion: bundle.schemaVersion });
    const store = this.create(name ?? `${(ws as unknown as Workspace).name} (imported)`);
    store.updateWorkspace({ variables: (ws as unknown as Workspace).variables, description: (ws as unknown as Workspace).description });
    for (const c of bundle.collections ?? []) store.saveCollection(c);
    for (const e of bundle.environments ?? []) store.saveEnvironment(e);
    store.saveProviders(bundle.providers ?? []);
    store.saveMcpServers(bundle.mcpServers ?? []);
    for (const [rel, content] of Object.entries(bundle.tests ?? {})) {
      const p = store.safePath(rel, store.path('tests'));
      mkdirSync(dirname(p), { recursive: true });
      atomicWrite(p, content);
    }
    return store;
  }
}
