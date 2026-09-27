/**
 * Desktop backend: every capability of the UI is exposed as an RPC method here.
 * It runs in the Electron main process (via IPC) or, for browser-based development,
 * behind a local HTTP bridge. All protocol execution happens in @protolens/core — the same
 * engine the CLI uses — so the UI thread never performs network or test execution.
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join, dirname } from 'node:path';
import { stringify as toYaml } from 'yaml';
import {
  ApsError,
  ChainSecretStore,
  EncryptedFileSecretStore,
  EnvSecretStore,
  Logger,
  McpSession,
  MemorySecretStore,
  Redactor,
  Tracer,
  WebSocketSession,
  WorkspaceManager,
  WorkspaceSearch,
  WorkspaceStore,
  batcher,
  compareToBaseline,
  createBaseline,
  createEngineContext,
  defaultSettings,
  estimateCost,
  executeHttp,
  executeGraphQL,
  expandDataset,
  fileSink,
  importAny,
  inheritedAuthFor,
  introspect,
  loadSuite,
  loadTestsFromFile,
  normalizeError,
  readResultsFile,
  runChecks,
  runLoadTest,
  runScript,
  scriptScopes,
  applyScriptOutput,
  CurrentValues,
  CookieJarStore,
  responseCookies,
  exampleFromResponse,
  startMockServer,
  collectMockRoutes,
  collectionMarkdown,
  parseGeneratedRequest,
  generatedTestScript,
  exportPostmanCollection,
  exportPostmanEnvironment,
  type MockRoute,
  type MockServer,
  withRequestExamples,
  type SavedExample,
  applyCookieJarOps,
  type CookieInput,
  runTests,
  runCollection,
  collectionRequests,
  readDataset,
  secretKeys,
  shortId,
  streamTests,
  summarizeSchema,
  prepareHttpRequest,
  parseCurl,
  generateCode,
  CODE_LANGUAGES,
  type SnippetRequest,
  tryParseJson,
  validateSchema,
  writeReports,
  templateVariables,
  renderPrompt,
  isSuiteFile,
  checkTypes,
  DEFAULT_BASE_URLS,
  ENGINE_VERSION,
  type AppSettings,
  type CheckConfig,
  type CheckContext,
  type Collection,
  type CollectionNode,
  type Environment,
  type GraphQLRequestSpec,
  type HttpRequestSpec,
  type LoadTestConfig,
  type LogRecord,
  type McpServerConfig,
  type ProviderConfig,
  type ResponseFormat,
  type RunEvent,
  type RunOptions,
  type RunSummary,
  type DatasetRecord,
  type SecretCipher,
  type SecretStore,
  type TestCase,
  type TestResult,
  type WorkspaceBundle,
  type ModelRef,
} from '@protolens/core';

export interface BackendHost {
  appDir: string;
  cipher?: SecretCipher;
  emit(channel: string, payload: unknown): void;
  openExternal?(url: string): void | Promise<void>;
  saveDialog?(opts: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | undefined>;
  openDialog?(opts: { directory?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | undefined>;
  openPath?(path: string): void | Promise<unknown>;
}

type Handler = (params: any) => Promise<unknown> | unknown;

interface RunState {
  ctrl: AbortController;
  done: boolean;
}

const CONSOLE_MAX = 500;
const CONSOLE_BODY_CHARS = 16_000;

/** One line of the Postman-style console. Values are redacted before they are stored. */
export interface ConsoleEntry {
  id: string;
  time: string;
  source: 'request' | 'run';
  run?: string;
  name: string;
  method: string;
  url: string;
  status?: number | string;
  durationMs?: number;
  size?: number;
  request?: { headers: Array<[string, string]>; body?: string };
  response?: { headers: Array<[string, string]>; body?: string };
  logs: Array<{ phase: 'pre-request' | 'test'; message: string }>;
  error?: string;
  failedChecks?: number;
}

export class Backend {
  private host: BackendHost;
  private manager: WorkspaceManager;
  private settings: AppSettings;
  private store?: WorkspaceStore;
  private currentValues?: CurrentValues;
  private cookieStore?: CookieJarStore;
  private search?: WorkspaceSearch;
  private secrets: SecretStore;
  private logger: Logger;
  private logBuffer: LogRecord[] = [];
  /** Postman-style console: recent requests with their details and script output. */
  private consoleBuffer: ConsoleEntry[] = [];
  private controllers = new Map<string, AbortController>();
  private runs = new Map<string, RunState>();
  private mcpSessions = new Map<string, McpSession>();
  private wsSessions = new Map<string, WebSocketSession>();
  /** Running mock servers by collection id. */
  private mocks = new Map<string, MockServer>();
  readonly handlers: Record<string, Handler>;

  constructor(host: BackendHost) {
    this.host = host;
    this.manager = new WorkspaceManager(host.appDir);
    this.settings = this.manager.loadSettings();
    const stores: SecretStore[] = [];
    if (host.cipher) stores.push(new EncryptedFileSecretStore(join(host.appDir, 'secrets.json'), host.cipher));
    else stores.push(new MemorySecretStore());
    stores.push(new EnvSecretStore());
    this.secrets = new ChainSecretStore(stores);
    this.logger = new Logger(this.settings.logLevel, new Redactor(this.settings.redactFields));
    this.logger.addSink(fileSink(join(host.appDir, 'logs', 'app.log')));
    this.logger.addSink((rec) => {
      this.logBuffer.push(rec);
      if (this.logBuffer.length > 500) this.logBuffer.shift();
      this.host.emit('log', rec);
    });
    this.handlers = this.buildHandlers();
    if (this.manager.settingsProblem) this.logger.warn(`Settings were reset to defaults: ${this.manager.settingsProblem}`);
    this.bootstrapWorkspace();
  }

  /** Open the last workspace, or create a starter workspace on first launch. */
  private bootstrapWorkspace(): void {
    try {
      const last = this.settings.lastWorkspace && this.manager.resolve(this.settings.lastWorkspace);
      if (last) return this.openStore(last);
      const list = this.manager.list();
      if (list.length) return this.openStore(list[0]!.path);
      const s = this.manager.create('My Workspace');
      s.saveProviders([{ id: 'offline', name: 'Offline mock', kind: 'mock', baseUrl: DEFAULT_BASE_URLS.mock! }]);
      s.close();
      this.openStore(this.manager.resolve('My Workspace')!);
    } catch (e) {
      this.logger.error('Failed to open workspace', normalizeError(e));
    }
  }

  private openStore(path: string): void {
    this.store?.close();
    for (const s of this.mcpSessions.values()) void s.close();
    this.mcpSessions.clear();
    for (const m of this.mocks.values()) void m.close();
    this.mocks.clear();
    this.store = WorkspaceStore.open(path);
    this.currentValues = new CurrentValues(join(this.host.appDir, 'current-values', `${this.store.id}.json`), this.secrets, this.store.id);
    void this.cookieStore?.flush().catch(() => undefined);
    this.cookieStore = new CookieJarStore(this.secrets, this.store.id);
    this.search = new WorkspaceSearch(this.store);
    this.settings = this.manager.saveSettings({ ...this.settings, lastWorkspace: this.store.root });
    this.logger.info(`Opened workspace ${this.store.workspace.name}`, { migrations: this.store.migrationsApplied });
  }

  private jar() {
    if (!this.cookieStore) throw new ApsError('ConfigurationError', 'No workspace is open');
    return this.cookieStore.jar;
  }

  /** A running mock server follows its collection: new or edited examples are served straight away. */
  private refreshMock(collectionId: string): void {
    const m = this.mocks.get(collectionId);
    if (!m) return;
    try {
      m.update(this.ws.getCollection(collectionId));
    } catch {
      /* collection deleted: keep the last routes until the server is stopped */
    }
  }

  /** Status of a collection's mock server; when stopped, the routes it would serve. */
  private mockInfo(collectionId: string) {
    const m = this.mocks.get(collectionId);
    const view = (routes: MockRoute[]) => routes.map((r) => ({ method: r.method, path: r.path, status: r.example.status, example: r.example.name, request: r.requestName, requestId: r.requestId }));
    if (m) return { running: true, url: m.url, port: m.port, routes: view(m.routes) };
    let routes: MockRoute[] = [];
    try {
      routes = collectMockRoutes(this.ws.getCollection(collectionId));
    } catch {
      /* unknown collection */
    }
    return { running: false, routes: view(routes) };
  }

  private consoleEntry(e: ConsoleEntry): void {
    this.consoleBuffer.push(e);
    if (this.consoleBuffer.length > CONSOLE_MAX) this.consoleBuffer.splice(0, this.consoleBuffer.length - CONSOLE_MAX);
    this.host.emit('console', e);
  }

  /** Requests made by runs (test runner, Collection Runner) appear in the console too, without bodies. */
  private consoleFromResult(r: TestResult, runName: string, redactor: Redactor): void {
    if (r.type !== 'http' && r.type !== 'graphql') return;
    const m = (r.metadata ?? {}) as { url?: string; method?: string; size?: number; preRequestLogs?: string[]; scriptLogs?: string[] };
    const status = r.checks.find((c) => c.type === 'status')?.actual;
    this.consoleEntry({
      id: r.id,
      time: new Date().toISOString(),
      source: 'run',
      run: runName,
      name: r.name,
      method: m.method ?? (r.type === 'graphql' ? 'POST' : 'GET'),
      url: m.url ?? r.input ?? '',
      status: typeof status === 'number' ? status : r.error ? r.error.kind : r.status,
      durationMs: r.latencyMs,
      size: m.size,
      logs: [...(m.preRequestLogs ?? []).map((message) => ({ phase: 'pre-request' as const, message: redactor.redactString(message) })), ...(m.scriptLogs ?? []).map((message) => ({ phase: 'test' as const, message: redactor.redactString(message) }))],
      error: r.error?.message,
      failedChecks: r.checks.filter((c) => !c.passed).length,
    });
  }

  private get ws(): WorkspaceStore {
    if (!this.store) throw new ApsError('ConfigurationError', 'No workspace is open');
    return this.store;
  }

  async invoke(method: string, params: unknown): Promise<unknown> {
    const h = this.handlers[method];
    if (!h) throw new ApsError('ConfigurationError', `Unknown backend method ${method}`);
    const t0 = performance.now();
    try {
      const r = await h(params ?? {});
      this.logger.trace(`rpc ${method}`, { ms: Math.round(performance.now() - t0) });
      return r;
    } catch (e) {
      const err = normalizeError(e);
      if (err.kind !== 'CancelledError') this.logger.warn(`rpc ${method} failed: ${err.message}`);
      throw err;
    }
  }

  private context(opts: { environment?: string; collectionId?: string }) {
    const ctx = createEngineContext({
      store: this.ws,
      secrets: this.secrets,
      settings: this.settings,
      environment: opts.environment,
      collectionId: opts.collectionId,
      logger: this.logger,
      openExternal: this.host.openExternal?.bind(this.host),
      cookieJar: this.cookieStore?.jar,
    });
    // Postman-style current values: set by scripts, kept on this machine, override stored values
    const cv = this.currentValues;
    if (cv) {
      const envName = ctx.environment?.name;
      cv.apply(ctx.vars, { environment: envName, collectionId: opts.collectionId }, ctx.redactor);
      const secretEnvKeys = new Set(ctx.environment?.variables.filter((v) => v.secret).map((v) => v.key));
      ctx.services.persistVariable = (scope, key, value) => {
        const owner = scope === 'environment' ? envName : scope === 'collectionVariables' ? opts.collectionId : '';
        if (owner === undefined) return; // no environment / collection selected: keep it for this run only
        const sensitive = ctx.redactor.isSensitiveKey(key) || (scope === 'environment' && secretEnvKeys.has(key));
        void cv.set(scope, owner, key, value, sensitive).catch((e) => this.logger.warn(`Could not save current value ${key}: ${(e as Error).message}`));
      };
    }
    return ctx;
  }

  /** Emit high-frequency events in batches so the renderer is not flooded (spec §22). */
  private batched<T>(channel: string, intervalMs = 50) {
    return batcher<T>((items) => this.host.emit(channel, items), intervalMs);
  }

  private buildHandlers(): Record<string, Handler> {
    return {
      /* ---------------------------------------------------------------- app */
      'app.info': () => ({
        version: ENGINE_VERSION,
        platform: process.platform,
        appDir: this.host.appDir,
        secretBackend: this.secrets.kind,
        metaBackend: this.store?.meta.backend,
        checkTypes: checkTypes(),
        node: process.versions.node,
        electron: process.versions.electron,
      }),
      'settings.get': () => this.settings,
      'settings.save': (s: AppSettings) => {
        this.settings = this.manager.saveSettings({ ...defaultSettings(), ...s, telemetry: false });
        this.logger.setLevel(this.settings.logLevel);
        this.logger.redactor.setFields(this.settings.redactFields);
        return this.settings;
      },
      'logs.recent': () => this.logBuffer,
      'console.recent': () => this.consoleBuffer,
      'console.clear': () => {
        this.consoleBuffer = [];
      },
      'app.openExternal': ({ url }: { url: string }) => {
        if (!/^https?:\/\//.test(url)) throw new ApsError('ValidationError', 'Only http(s) URLs can be opened');
        return this.host.openExternal?.(url);
      },
      'app.openPath': ({ path }: { path: string }) => this.host.openPath?.(path),

      /* ---------------------------------------------------------------- workspaces */
      'ws.list': () => this.manager.list(),
      'ws.current': () =>
        this.store && {
          ...this.store.workspace,
          path: this.store.root,
          environments: this.store.listEnvironments(),
          migrations: this.store.migrationsApplied,
        },
      'ws.create': ({ name }: { name: string }) => {
        const s = this.manager.create(name);
        s.saveProviders([{ id: 'offline', name: 'Offline mock', kind: 'mock', baseUrl: DEFAULT_BASE_URLS.mock! }]);
        const root = s.root;
        s.close();
        this.openStore(root);
        return this.handlers['ws.current']!({});
      },
      'ws.open': async ({ ref }: { ref?: string }) => {
        let path = ref ? this.manager.resolve(ref) : undefined;
        if (!ref && this.host.openDialog) {
          const dir = await this.host.openDialog({ directory: true });
          if (!dir) return null;
          path = dir;
          const s = this.manager.loadSettings();
          if (!s.workspacePaths.includes(dir)) this.settings = this.manager.saveSettings({ ...s, workspacePaths: [...s.workspacePaths, dir] });
        }
        if (!path) throw new ApsError('ConfigurationError', `Workspace ${ref} not found`);
        this.openStore(path);
        return this.handlers['ws.current']!({});
      },
      'ws.update': ({ name, description, variables }: { name?: string; description?: string; variables?: Array<{ key: string; value: string; enabled?: boolean; secret?: boolean }> }) => {
        const ws = this.ws;
        let vars = variables;
        if (vars)
          vars = vars.map((v) => {
            if (v.secret && v.value) void this.secrets.set(secretKeys.workspaceVar(ws.id, v.key), v.value);
            return v.secret ? { ...v, value: '' } : v;
          });
        return ws.updateWorkspace({ ...(name ? { name } : {}), ...(description !== undefined ? { description } : {}), ...(vars ? { variables: vars } : {}) });
      },
      'ws.duplicate': ({ ref, name }: { ref: string; name: string }) => this.manager.duplicate(ref, name),
      'ws.delete': ({ ref }: { ref: string }) => {
        const p = this.manager.resolve(ref);
        if (p && this.store && p === this.store.root) throw new ApsError('ValidationError', 'Switch to another workspace before deleting this one');
        this.manager.delete(ref);
        return this.manager.list();
      },
      'ws.export': async () => {
        const bundle = this.ws.exportBundle();
        const dest = await this.host.saveDialog?.({ defaultPath: `${this.ws.workspace.name}.apsworkspace.json`, filters: [{ name: 'Workspace', extensions: ['json'] }] });
        if (dest) writeFileSync(dest, JSON.stringify(bundle, null, 2));
        return { path: dest, bundle: dest ? undefined : bundle };
      },
      'ws.import': ({ bundle, name }: { bundle: WorkspaceBundle; name?: string }) => {
        const s = this.manager.importBundle(bundle, name);
        const root = s.root;
        s.close();
        this.openStore(root);
        return this.handlers['ws.current']!({});
      },
      'ws.search': ({ query }: { query: string }) => this.search?.search(query, 60) ?? [],

      /* ---------------------------------------------------------------- environments & secrets */
      'env.list': () => this.ws.listEnvironments(),
      'env.save': async ({ env, secrets }: { env: Environment; secrets?: Record<string, string> }) => {
        for (const [k, v] of Object.entries(secrets ?? {})) if (v) await this.secrets.set(secretKeys.envVar(env.id, k), v);
        return this.ws.saveEnvironment(env);
      },
      'env.delete': ({ id }: { id: string }) => this.ws.deleteEnvironment(id),
      'currentValues.summary': () => this.currentValues?.summary(),
      'currentValues.get': ({ scope, owner }: { scope: 'environment' | 'globals' | 'collectionVariables'; owner?: string }) => {
        const values = this.currentValues?.get(scope, owner ?? '') ?? {};
        // never send secret values to the UI: mask sensitive keys
        return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, this.logger.redactor.isSensitiveKey(k) ? '••••••' : v]));
      },
      'currentValues.reset': ({ scope, owner }: { scope?: 'environment' | 'globals' | 'collectionVariables'; owner?: string }) => this.currentValues?.reset(scope, owner),
      /** Postman's environment "quick look": initial and current values of the active environment and globals, secrets masked. */
      'env.quickLook': ({ environment }: { environment?: string }) => {
        const mask = '••••••';
        const r = this.logger.redactor;
        const rows = (vars: Array<{ key: string; value: string; enabled?: boolean; secret?: boolean }>, current: Record<string, unknown>) => {
          const keys = [...new Set([...vars.map((v) => v.key), ...Object.keys(current)])].filter(Boolean);
          return keys.map((key) => {
            const v = vars.find((x) => x.key === key);
            const sensitive = !!v?.secret || r.isSensitiveKey(key);
            const show = (x: unknown) => (x === undefined ? undefined : sensitive ? mask : typeof x === 'string' ? x : JSON.stringify(x));
            return { key, initial: v ? (v.secret ? mask : show(v.value)) : undefined, current: show(current[key]), secret: sensitive, enabled: v?.enabled !== false };
          });
        };
        const env = environment ? this.ws.getEnvironment(environment) : undefined;
        return {
          environment: env ? { id: env.id, name: env.name, isProduction: !!env.isProduction, variables: rows(env.variables, this.currentValues?.get('environment', env.name) ?? {}) } : undefined,
          globals: rows(this.settings.globalVariables ?? [], this.currentValues?.get('globals', '') ?? {}),
        };
      },

      /* ---------------------------------------------------------------- cookies (kept on this machine, encrypted) */
      'cookies.list': () => ({ cookies: this.cookieStore?.jar.list() ?? [], persistent: this.cookieStore?.persistent ?? false }),
      'cookies.set': ({ cookie, replace }: { cookie: CookieInput; replace?: { name: string; domain: string; path?: string } }) => {
        const jar = this.jar();
        if (replace) jar.remove(replace.domain, replace.name, replace.path);
        return jar.set(cookie);
      },
      'cookies.delete': ({ domain, name, path }: { domain: string; name: string; path?: string }) => this.jar().remove(domain, name, path),
      'cookies.clear': ({ domain }: { domain?: string }) => this.jar().clear(domain),
      'env.secretStatus': ({ envId, keys }: { envId: string; keys: string[] }) => Object.fromEntries(keys.map((k) => [k, !!this.secrets.get(secretKeys.envVar(envId, k))])),
      'vars.inspect': ({ environment, collectionId, template }: { environment?: string; collectionId?: string; template?: string }) => {
        const ctx = this.context({ environment, collectionId });
        const names = template ? templateVariables(template) : Object.keys(ctx.vars.toObject());
        return names.map((n) => {
          const d = ctx.vars.describe(n);
          return { name: n, scope: d?.scope, value: d ? (d.secret ? '••••••' : String(typeof d.value === 'object' ? JSON.stringify(d.value) : d.value)) : undefined, secret: d?.secret };
        });
      },

      /* ---------------------------------------------------------------- collections */
      'col.list': () => this.ws.listCollections(),
      'col.save': (c: Collection) => {
        const r = this.ws.saveCollection(c);
        this.refreshMock(c.id);
        return r;
      },

      /* ---------------------------------------------------------------- mock servers (saved examples on localhost) */
      'mock.start': async ({ collectionId, port, delayMs }: { collectionId: string; port?: number; delayMs?: number }) => {
        await this.mocks.get(collectionId)?.close();
        this.mocks.delete(collectionId);
        const c = this.ws.getCollection(collectionId);
        const m = await startMockServer(c, { port: port ?? 0, delayMs, onRequest: (e) => this.host.emit('mock.request', { collectionId, ...e, time: new Date().toISOString() }) });
        this.mocks.set(collectionId, m);
        this.logger.info(`Mock server for ${c.name} listening on ${m.url}`, { routes: m.routes.length });
        return this.mockInfo(collectionId);
      },
      'mock.stop': async ({ collectionId }: { collectionId: string }) => {
        await this.mocks.get(collectionId)?.close();
        this.mocks.delete(collectionId);
      },
      'mock.status': ({ collectionId }: { collectionId: string }) => this.mockInfo(collectionId),
      'col.delete': ({ id }: { id: string }) => {
        void this.mocks.get(id)?.close();
        this.mocks.delete(id);
        return this.ws.deleteCollection(id);
      },
      /** Save a response as an example of a saved request (sensitive headers and values are masked). */
      'col.addExample': (p: { collectionId: string; requestId: string; name: string; environment?: string; response: Parameters<typeof exampleFromResponse>[0]; request?: SavedExample['request'] }) => {
        const ctx = this.context({ environment: p.environment, collectionId: p.collectionId });
        const example = exampleFromResponse(p.response, { name: p.name, redactor: ctx.redactor, request: p.request });
        const c = withRequestExamples(this.ws.getCollection(p.collectionId), p.requestId, (list) => [...list, example]);
        this.ws.saveCollection(c);
        this.refreshMock(p.collectionId);
        return example;
      },
      /** Markdown documentation of a collection (the given draft, or the saved one), with secrets masked. */
      'col.docs': ({ id, collection, environment }: { id?: string; collection?: Collection; environment?: string }) => {
        const c = collection ?? this.ws.getCollection(id!);
        const ctx = this.context({ environment, collectionId: collection ? undefined : c.id });
        return collectionMarkdown(c, { redactor: ctx.redactor });
      },
      /** Replace a saved request's examples (rename, edit, delete). */
      'col.setExamples': (p: { collectionId: string; requestId: string; examples: SavedExample[] }) => {
        this.ws.saveCollection(withRequestExamples(this.ws.getCollection(p.collectionId), p.requestId, () => p.examples));
        this.refreshMock(p.collectionId);
        return p.examples;
      },
      'col.import': ({ text }: { text: string }) => {
        const r = importAny(text);
        if (r.collection) this.ws.saveCollection(r.collection);
        if (r.environment) this.ws.saveEnvironment(r.environment);
        return { format: r.format, collection: r.collection?.name, environment: r.environment?.name };
      },
      'col.importFile': async () => {
        const f = await this.host.openDialog?.({ filters: [{ name: 'API definitions', extensions: ['json', 'yaml', 'yml', 'har'] }] });
        if (!f) return null;
        return this.handlers['col.import']!({ text: readFileSync(f, 'utf8') });
      },
      'col.run': (p: CollectionRunParams) => this.startCollectionRun(p),
      /** Pick a CSV/JSON data file for a collection run; returns a preview of its rows. */
      'col.pickDataFile': async () => {
        const f = await this.host.openDialog?.({ filters: [{ name: 'Data files', extensions: ['csv', 'json', 'jsonl'] }] });
        return f ? this.handlers['col.previewDataFile']!({ path: f }) : null;
      },
      'col.previewDataFile': async ({ path }: { path: string }) => {
        const rows = await this.readRunData(path);
        const columns = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))];
        return { path, name: basename(path), count: rows.length, columns, preview: rows.slice(0, 20) };
      },
      /** Export a collection as Protolens JSON or a Postman v2.1 collection (`notes` lists what Postman can't hold). */
      'col.export': async ({ id, format = 'protolens' }: { id: string; format?: 'protolens' | 'postman' }) => {
        const c = this.ws.getCollection(id);
        const { collection, notes } = format === 'postman' ? exportPostmanCollection(c) : { collection: c as unknown as Record<string, unknown>, notes: [] as string[] };
        const name = format === 'postman' ? `${c.name}.postman_collection.json` : `${c.name}.collection.json`;
        const dest = await this.host.saveDialog?.({ defaultPath: name, filters: [{ name: 'Collection', extensions: ['json'] }] });
        if (dest) writeFileSync(dest, JSON.stringify(collection, null, 2));
        return { path: dest, collection: dest ? undefined : collection, name, notes };
      },
      /** Export an environment in Postman's format (secret values are never included). */
      'env.export': async ({ id }: { id: string }) => {
        const env = this.ws.getEnvironment(id);
        if (!env) throw new ApsError('ConfigurationError', `Environment "${id}" not found`);
        const out = exportPostmanEnvironment(env);
        const name = `${env.name}.postman_environment.json`;
        const dest = await this.host.saveDialog?.({ defaultPath: name, filters: [{ name: 'Environment', extensions: ['json'] }] });
        if (dest) writeFileSync(dest, JSON.stringify(out, null, 2));
        return { path: dest, environment: dest ? undefined : out, name };
      },

      /* ---------------------------------------------------------------- HTTP */
      'http.send': (p: HttpSendParams) => this.httpSend(p),
      'http.cancel': ({ id }: { id: string }) => this.controllers.get(id)?.abort(),
      'http.curl': async (p: { request: HttpRequestSpec; environment?: string; collectionId?: string; requestId?: string }) => this.codeSnippet({ ...p, language: 'curl', revealSecrets: true }),
      'http.code': (p: { request: HttpRequestSpec; environment?: string; collectionId?: string; requestId?: string; language: string; revealSecrets?: boolean }) => this.codeSnippet(p),
      'http.codeLanguages': () => CODE_LANGUAGES,
      'http.parseCurl': ({ text }: { text: string }) => parseCurl(text),
      'http.saveBody': async ({ payloadPath, name }: { payloadPath: string; name?: string }) => {
        if (!payloadPath || !payloadPath.startsWith(this.ws.path('payloads'))) throw new ApsError('ValidationError', 'Unknown payload');
        const dest = await this.host.saveDialog?.({ defaultPath: name ?? 'response.bin' });
        if (dest) copyFileSync(payloadPath, dest);
        return dest;
      },
      'history.list': (q: { query?: string; kind?: string; limit?: number; offset?: number }) => this.ws.meta.listHistory(q),
      'history.get': ({ id }: { id: string }) => this.ws.meta.getHistory(id),
      'history.delete': ({ id }: { id: string }) => this.ws.meta.deleteHistory(id),
      'history.clear': () => this.ws.meta.clearHistory(),

      /* ---------------------------------------------------------------- GraphQL */
      'gql.introspect': async ({ request, environment }: { request: Omit<GraphQLRequestSpec, 'query'>; environment?: string }) => {
        const ctx = this.context({ environment });
        const { sdl, schema } = await introspect(ctx.vars.resolveDeep(request), { redactor: ctx.redactor });
        return { sdl, summary: summarizeSchema(schema) };
      },
      'gql.send': (p: GqlSendParams) => this.gqlSend(p),

      /* ---------------------------------------------------------------- MCP */
      'mcp.servers': () => this.ws.getMcpServers().map((s) => ({ ...s, connected: !!this.mcpSessions.get(s.id)?.connected })),
      'mcp.saveServers': ({ servers }: { servers: McpServerConfig[] }) => {
        this.ws.saveMcpServers(servers);
        return servers;
      },
      'mcp.connect': async ({ serverId, environment }: { serverId: string; environment?: string }) => {
        await this.mcpSessions.get(serverId)?.close();
        const cfg = this.ws.getMcpServers().find((s) => s.id === serverId);
        if (!cfg) throw new ApsError('ConfigurationError', `Unknown MCP server ${serverId}`);
        const ctx = this.context({ environment });
        const session = new McpSession(ctx.vars.resolveDeep(cfg), ctx.redactor);
        const b = this.batched<unknown>('mcp.events');
        session.onEvent((e) => b.push({ serverId, event: e }));
        this.mcpSessions.set(serverId, session);
        try {
          await session.connect();
        } finally {
          b.flush();
        }
        return { discovery: await session.discover(), events: session.events };
      },
      'mcp.disconnect': async ({ serverId }: { serverId: string }) => {
        await this.mcpSessions.get(serverId)?.close();
        this.mcpSessions.delete(serverId);
      },
      'mcp.events': ({ serverId }: { serverId: string }) => this.mcpSessions.get(serverId)?.events ?? [],
      'mcp.call': async ({ serverId, tool, args, assertions }: { serverId: string; tool: string; args: Record<string, unknown>; assertions?: CheckConfig[] }) => {
        const s = this.session(serverId);
        const tracer = new Tracer(`tools/call ${tool}`, this.logger.redactor);
        const span = tracer.start(`tools/call ${tool}`, 'mcp', { attributes: { server: s.config.name, tool }, input: args });
        try {
          const r = await s.callTool(tool, args);
          span.end({ status: r.isError ? 'error' : 'ok', output: r.raw });
          const { mcpResultBody } = await import('@protolens/core');
          const { body, text } = mcpResultBody(r);
          const checks = await runChecks(assertions, { testType: 'mcp', body, text, isError: r.isError, latencyMs: r.durationMs });
          const trace = tracer.finish();
          this.ws.saveTrace(trace, 'mcp');
          this.ws.meta.addHistory({ id: shortId('h-'), timestamp: new Date().toISOString(), kind: 'mcp', name: `${s.config.name} · ${tool}`, status: r.isError ? 'error' : 'ok', durationMs: r.durationMs, request: { serverId, tool, args }, traceId: trace.traceId });
          return { ...r, body, checks, traceId: trace.traceId };
        } catch (e) {
          span.fail(e);
          this.ws.saveTrace(tracer.finish('error'), 'mcp');
          throw e;
        }
      },
      'mcp.read': async ({ serverId, uri }: { serverId: string; uri: string }) => this.session(serverId).readResource(uri),
      'mcp.prompt': async ({ serverId, name, args }: { serverId: string; name: string; args: Record<string, string> }) => this.session(serverId).getPrompt(name, args),
      'mcp.ping': async ({ serverId }: { serverId: string }) => this.session(serverId).ping(),
      'mcp.saveTest': ({ serverId, tool, args, assertions, name }: { serverId: string; tool: string; args: Record<string, unknown>; assertions: CheckConfig[]; name: string }) => {
        const cfg = this.ws.getMcpServers().find((s) => s.id === serverId);
        const rel = `mcp/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.yaml`;
        this.ws.writeTestFile(rel, toYaml({ name, type: 'mcp', server: cfg?.name ?? serverId, tool, arguments: args, assertions: assertions.length ? assertions : [{ type: 'status', expected: 'success' }] }));
        return rel;
      },

      /* ---------------------------------------------------------------- AI */
      'ai.providers': () => this.ws.getProviders().map((p) => ({ ...p, hasKey: !!this.secrets.get(secretKeys.provider(p.id)) || !!(p.apiKey && !p.apiKey.includes('$secret')) })),
      'ai.saveProviders': async ({ providers, keys }: { providers: ProviderConfig[]; keys?: Record<string, string> }) => {
        for (const [id, key] of Object.entries(keys ?? {})) if (key) await this.secrets.set(secretKeys.provider(id), key);
        const clean = providers.map((p) => ({ ...p, apiKey: p.apiKey && /\{\{/.test(p.apiKey) ? p.apiKey : keys?.[p.id] || this.secrets.get(secretKeys.provider(p.id)) ? `{{$secret.${secretKeys.provider(p.id)}}}` : undefined }));
        this.ws.saveProviders(clean);
        return clean;
      },
      'ai.models': async ({ providerId, environment }: { providerId: string; environment?: string }) => {
        const ctx = this.context({ environment });
        const p = ctx.services.providers.get(providerId);
        return (await p.listModels?.()) ?? [];
      },
      'ai.chat': (p: AiChatParams) => this.aiChat(p),
      'ai.cancel': ({ id }: { id: string }) => this.controllers.get(id)?.abort(),
      'ai.compare': async (p: AiChatParams & { models: ModelRef[] }) => {
        const results = await Promise.all(
          p.models.map(async (m, i) => {
            try {
              return await this.aiChat({ ...p, provider: m.provider, model: m.name ?? '', requestId: `${p.requestId}-${i}`, stream: false });
            } catch (e) {
              return { error: normalizeError(e), provider: m.provider, model: m.name };
            }
          }),
        );
        return results;
      },

      /* ---------------------------------------------------------------- tests & runs */
      'tests.tree': () => this.ws.testTree(),
      'tests.read': ({ path }: { path: string }) => this.ws.readTestFile(path),
      'tests.write': ({ path, content }: { path: string; content: string }) => this.ws.writeTestFile(path, content),
      'tests.delete': ({ path }: { path: string }) => this.ws.deleteTestFile(path),
      'tests.preview': async ({ path }: { path: string }) => {
        const out: Array<{ id?: string; name: string; type: string; tags?: string[] }> = [];
        const abs = join(this.ws.path('tests'), path);
        if (isSuiteFile(abs)) return { suite: await loadSuite(abs), tests: [] };
        for await (const t of loadTestsFromFile(abs)) {
          out.push({ id: t.id, name: t.name, type: t.type, tags: t.tags });
          if (out.length >= 500) break;
        }
        return { tests: out };
      },
      'tests.run': (p: { paths: string[]; environment?: string; concurrency?: number; retries?: number; name?: string; grep?: string; tags?: string[] }) => this.startTestRun(p),
      'eval.run': (p: EvalRunParams) => this.startEvalRun(p),
      'runs.cancel': ({ runId }: { runId: string }) => this.runs.get(runId)?.ctrl.abort(),
      'runs.list': (q: { query?: string; limit?: number; offset?: number }) => this.ws.meta.listRuns(q),
      'runs.summary': ({ runId }: { runId: string }) => {
        const f = join(this.ws.runDir(runId), 'summary.json');
        return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
      },
      'runs.results': (q: { runId: string; offset?: number; limit?: number; status?: string; query?: string }) => this.pageResults(q),
      'runs.openReport': ({ runId, format }: { runId: string; format: 'html' | 'markdown' | 'junit' | 'json' }) => {
        const file = { html: 'report.html', markdown: 'report.md', junit: 'junit.xml', json: 'report.json' }[format];
        const p = join(this.ws.runDir(runId), file);
        if (!existsSync(p)) throw new ApsError('ConfigurationError', 'Report not found');
        void this.host.openPath?.(p);
        return p;
      },
      'runs.exportReport': async ({ runId, format }: { runId: string; format: 'html' | 'markdown' | 'junit' | 'json' }) => {
        const file = { html: 'report.html', markdown: 'report.md', junit: 'junit.xml', json: 'report.json' }[format];
        const src = join(this.ws.runDir(runId), file);
        const dest = await this.host.saveDialog?.({ defaultPath: file });
        if (dest) copyFileSync(src, dest);
        return dest;
      },
      'baselines.list': () => this.ws.listBaselines(),
      'baselines.save': async ({ runId, name }: { runId: string; name: string }) => {
        const summary = await this.handlers['runs.summary']!({ runId });
        const b = await createBaseline(name, summary as never, this.results(runId));
        this.ws.saveBaseline(b);
        return { name, tests: Object.keys(b.tests).length };
      },
      'baselines.compare': async ({ runId, name, thresholds }: { runId: string; name: string; thresholds?: { latencyPct: number; tokensPct: number; scoreDrop: number } }) => {
        const summary = await this.handlers['runs.summary']!({ runId });
        return compareToBaseline(this.ws.getBaseline(name), summary as never, this.results(runId), thresholds);
      },

      /* ---------------------------------------------------------------- traces */
      'traces.list': (q: { query?: string; kind?: string; limit?: number; offset?: number }) => this.ws.meta.listTraces(q),
      'traces.get': ({ id }: { id: string }) => this.ws.loadTrace(id),

      /* ---------------------------------------------------------------- load testing */
      'load.start': (p: { config: LoadTestConfig; environment?: string }) => this.startLoad(p),
      'load.stop': ({ id }: { id: string }) => this.controllers.get(id)?.abort(),

      /* ---------------------------------------------------------------- WebSocket */
      'wsock.connect': async ({ url, protocols, headers, environment }: { url: string; protocols?: string[]; headers?: Array<{ key: string; value: string }>; environment?: string }) => {
        const ctx = this.context({ environment });
        const s = new WebSocketSession(ctx.vars.resolve(url), { protocols, headers: ctx.vars.resolveDeep(headers) });
        const b = this.batched<unknown>('wsock.messages');
        s.onMessage((m) => b.push({ id: s.id, message: m }));
        s.onStatus((st) => this.host.emit('wsock.status', { id: s.id, status: st }));
        this.wsSessions.set(s.id, s);
        await s.connect();
        return { id: s.id };
      },
      'wsock.send': ({ id, data }: { id: string; data: string }) => this.wsSessions.get(id)?.send(data),
      'wsock.close': ({ id }: { id: string }) => {
        this.wsSessions.get(id)?.close();
        this.wsSessions.delete(id);
      },

      /* ---------------------------------------------------------------- AI assistant */
      'assistant.ask': (p: { task: string; context: unknown; question?: string; environment?: string }) => this.assistant(p),
      /** Natural language → an HTTP request (shown to the user before anything is sent). */
      'ai.generateRequest': async ({ description, environment }: { description: string; environment?: string }) => {
        const r = await this.assistant({ task: 'generate-request', context: {}, question: description, environment });
        return { ...parseGeneratedRequest(r.text), model: `${r.provider}/${r.model}` };
      },
      /** pm tests for a response, labelled as AI-generated. */
      'ai.generateTests': async ({ request, response, environment }: { request: unknown; response: unknown; environment?: string }) => {
        const r = await this.assistant({ task: 'generate-pm-tests', context: { request, response }, environment });
        return { script: generatedTestScript(r.text, `${r.provider}/${r.model}`), model: `${r.provider}/${r.model}` };
      },

      /* ---------------------------------------------------------------- misc */
      'schema.validate': ({ schema, data }: { schema: unknown; data: unknown }) => validateSchema(schema, data),
      'prompt.variables': ({ template }: { template: string }) => templateVariables(template),
    };
  }

  private session(serverId: string): McpSession {
    const s = this.mcpSessions.get(serverId);
    if (!s?.connected) throw new ApsError('ConfigurationError', 'MCP server is not connected', { suggestions: ['Click Connect first.'] });
    return s;
  }

  /* ------------------------------------------------------------------ HTTP */

  private async httpSend(p: HttpSendParams) {
    const id = p.id ?? shortId('req-');
    const ctrl = new AbortController();
    this.controllers.set(id, ctrl);
    const ctx = this.context({ environment: p.environment, collectionId: p.collectionId });
    const tracer = new Tracer(p.name ?? `${p.request.method} ${p.request.url}`, ctx.redactor);
    const root = tracer.start(p.name ?? 'request', 'http');
    const chunks = this.batched<unknown>('http.chunks', 80);
    let scriptLogs: string[] = [];
    let preLogCount: number | undefined;
    const logsOf = () => scriptLogs.map((message, i) => ({ phase: i < (preLogCount ?? scriptLogs.length) ? ('pre-request' as const) : ('test' as const), message: ctx.redactor.redactString(message) }));
    try {
      let request = p.request;
      if ((!request.auth || request.auth.type === 'inherit') && ctx.collection)
        request = { ...request, auth: p.requestId ? inheritedAuthFor(ctx.collection, p.requestId) : ctx.collection.auth };
      // collection-level then request-level pre-request scripts
      for (const script of [ctx.collection?.preRequestScript, p.preRequestScript]) {
        if (!script?.trim()) continue;
        const bodyText = request.body && 'content' in request.body ? request.body.content : undefined;
        const out = await runScript(script, {
          ...scriptScopes(ctx.vars),
          request: { method: request.method, url: request.url, headers: request.headers ?? [], body: bodyText },
          jar: ctx.services.cookieJar?.list(),
          info: { requestName: p.name, requestId: p.requestId },
        });
        scriptLogs.push(...out.logs);
        applyScriptOutput(out, [ctx.vars], { redactor: ctx.redactor, persist: ctx.services.persistVariable });
        if (ctx.services.cookieJar) applyCookieJarOps(ctx.services.cookieJar, out.jarOps);
        if (out.error) throw new ApsError('ScriptError', `Pre-request script failed: ${out.error}`);
        if (out.request) {
          request = { ...request, method: out.request.method, url: out.request.url, headers: out.request.headers };
          if (out.request.body !== undefined && request.body && 'content' in request.body) request = { ...request, body: { ...request.body, content: out.request.body } };
        }
      }
      preLogCount = scriptLogs.length;
      const spec = ctx.vars.resolveDeep(request);
      spec.settings = { timeoutMs: this.settings.defaultTimeoutMs, ...spec.settings };
      const timeout = setTimeout(() => ctrl.abort(new ApsError('TimeoutError', `Request timed out after ${spec.settings!.timeoutMs} ms`)), spec.settings.timeoutMs);
      let result;
      try {
        result = await executeHttp(spec, {
          signal: ctrl.signal,
          payloadDir: this.ws.path('payloads'),
          maxPreviewBytes: this.settings.maxPreviewBytes,
          redactor: ctx.redactor,
          openExternal: this.host.openExternal?.bind(this.host),
          cookieJar: ctx.services.cookieJar,
          onChunk: /event-stream|stream/i.test(JSON.stringify(spec.headers ?? '')) || p.stream ? (c) => chunks.push({ id, chunk: c }) : undefined,
        });
      } finally {
        clearTimeout(timeout);
        chunks.flush();
      }
      const { response, prepared } = result;
      root.setAttributes({ status: response.status, url: prepared.url, size: response.size });
      root.span.input = { method: prepared.method, headers: prepared.headers, body: prepared.bodyPreview };
      root.end({ status: response.status >= 400 ? 'error' : 'ok', output: { status: response.status, headers: response.headers } });

      const cctx: CheckContext = { testType: 'http', status: response.status, headers: response.headers, body: response.json ?? response.bodyPreview, text: response.bodyPreview, latencyMs: response.durationMs };
      const checks = await runChecks(ctx.vars.resolveDeep(p.assertions ?? []), cctx);
      for (const script of [ctx.collection?.testScript, p.testScript]) {
        if (!script?.trim()) continue;
        const out = await runScript(script, {
          ...scriptScopes(ctx.vars),
          request: { method: spec.method, url: spec.url, headers: spec.headers ?? [] },
          response: { status: response.status, headers: response.headers, body: response.bodyPreview, time: response.durationMs },
          cookies: responseCookies(response.cookies, ctx.services.cookieJar, response.url),
          jar: ctx.services.cookieJar?.list(),
          info: { requestName: p.name, requestId: p.requestId },
        });
        scriptLogs.push(...out.logs);
        applyScriptOutput(out, [ctx.vars], { redactor: ctx.redactor, persist: ctx.services.persistVariable });
        if (ctx.services.cookieJar) applyCookieJarOps(ctx.services.cookieJar, out.jarOps);
        for (const t of out.tests) checks.push({ type: 'script', name: t.name, passed: t.passed, source: 'deterministic', message: t.message ?? (t.passed ? 'passed' : 'failed') });
        if (out.error) checks.push({ type: 'script', name: 'test script', passed: false, source: 'deterministic', message: out.error });
      }
      const trace = tracer.finish();
      this.ws.saveTrace(trace, 'http');
      const historyId = shortId('h-');
      this.ws.meta.addHistory({
        id: historyId,
        timestamp: new Date().toISOString(),
        kind: 'http',
        name: p.name ?? `${prepared.method} ${prepared.url}`,
        method: prepared.method,
        url: prepared.url,
        status: response.status,
        durationMs: response.durationMs,
        size: response.size,
        request: ctx.redactor.redact(p.request),
        payloadPath: response.payloadPath,
        traceId: trace.traceId,
      });
      const clip = (t: string | undefined) => (t && t.length > CONSOLE_BODY_CHARS ? t.slice(0, CONSOLE_BODY_CHARS) + `… [${t.length - CONSOLE_BODY_CHARS} more characters]` : t);
      // values typed into sensitive headers are secrets too (e.g. echoed back in a response body)
      for (const h of spec.headers ?? [])
        if (h.enabled !== false && ctx.redactor.isSensitiveKey(h.key) && h.value.length >= 6) {
          ctx.redactor.addSecret(h.value);
          const token = h.value.replace(/^\w+\s+/, '');
          if (token !== h.value && token.length >= 6) ctx.redactor.addSecret(token);
        }
      // so are sensitive fields of the request body (servers often echo them back)
      const collect = (v: unknown, key = '', depth = 0): void => {
        if (depth > 20 || v == null) return;
        if (typeof v === 'string') {
          if (key && ctx.redactor.isSensitiveKey(key) && v.length >= 4) ctx.redactor.addSecret(v);
        } else if (Array.isArray(v)) v.forEach((x) => collect(x, key, depth + 1));
        else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) collect(x, k, depth + 1);
      };
      if (spec.body && 'content' in spec.body)
        try {
          collect(JSON.parse(spec.body.content));
        } catch {
          /* not JSON */
        }
      else if (spec.body && 'fields' in spec.body) for (const f of spec.body.fields) collect(f.value, f.key);
      const safeBody = (t: string | undefined) => {
        if (!t) return t;
        try {
          return JSON.stringify(ctx.redactor.redact(JSON.parse(t)), null, 2);
        } catch {
          return ctx.redactor.redactString(t);
        }
      };
      this.consoleEntry({
        id,
        time: new Date().toISOString(),
        source: 'request',
        name: p.name ?? `${prepared.method} ${prepared.url}`,
        method: prepared.method,
        url: prepared.url,
        status: response.status,
        durationMs: response.durationMs,
        size: response.size,
        request: { headers: prepared.headers, body: clip(safeBody(prepared.bodyPreview)) },
        response: { headers: ctx.redactor.redact(response.headers), body: clip(safeBody(response.bodyPreview)) },
        logs: logsOf(),
        failedChecks: checks.filter((c) => !c.passed).length,
      });
      return { id, response, prepared, checks, scriptLogs, unresolved: [...ctx.vars.unresolved], traceId: trace.traceId, historyId };
    } catch (e) {
      const err = normalizeError(ctrl.signal.reason instanceof ApsError ? ctrl.signal.reason : e);
      root.fail(e);
      const trace = tracer.finish('error');
      this.ws.saveTrace(trace, 'http');
      this.ws.meta.addHistory({ id: shortId('h-'), timestamp: new Date().toISOString(), kind: 'http', name: p.name ?? `${p.request.method} ${p.request.url}`, method: p.request.method, url: ctx.redactor.redactUrl(ctx.vars.resolve(p.request.url)), status: err.kind, request: ctx.redactor.redact(p.request), traceId: trace.traceId });
      this.consoleEntry({
        id,
        time: new Date().toISOString(),
        source: 'request',
        name: p.name ?? `${p.request.method} ${p.request.url}`,
        method: p.request.method,
        url: ctx.redactor.redactUrl(ctx.vars.resolve(p.request.url)),
        status: err.kind,
        logs: logsOf(),
        error: err.message,
      });
      return { id, error: err, scriptLogs, unresolved: [...ctx.vars.unresolved], traceId: trace.traceId };
    } finally {
      this.controllers.delete(id);
    }
  }

  /** Code snippet for a request, with variables and auth resolved. Secrets are masked unless revealSecrets. */
  private async codeSnippet(p: { request: HttpRequestSpec; environment?: string; collectionId?: string; requestId?: string; language: string; revealSecrets?: boolean }) {
    const ctx = this.context({ environment: p.environment, collectionId: p.collectionId });
    let request = p.request;
    if ((!request.auth || request.auth.type === 'inherit') && ctx.collection)
      request = { ...request, auth: p.requestId ? inheritedAuthFor(ctx.collection, p.requestId) : ctx.collection.auth };
    const spec = ctx.vars.resolveDeep(request);
    // OAuth would trigger a token request just to show code; show a placeholder header instead
    const auth = spec.auth?.type === 'oauth2' ? undefined : spec.auth;
    const prepared = await prepareHttpRequest({ ...spec, auth }, { redactor: ctx.redactor });
    const headers = [...prepared.headers.entries()].filter(([k]) => k !== 'user-agent') as Array<[string, string]>;
    if (spec.auth?.type === 'oauth2') headers.push(['Authorization', 'Bearer <access token from OAuth 2.0>']);
    const body = spec.body;
    const snippet: SnippetRequest = {
      method: prepared.method,
      url: prepared.url.toString(),
      headers,
      body: body && body.type !== 'multipart' && body.type !== 'binary' && body.type !== 'none' ? prepared.bodyPreview : body?.type === 'binary' ? `@${body.filePath}` : undefined,
      form: body?.type === 'multipart' ? body.fields.filter((f) => f.enabled !== false && f.key).map((f) => ({ key: f.key, value: f.value, file: f.kind === 'file' })) : undefined,
    };
    const code = generateCode(snippet, p.language);
    if (p.revealSecrets) return code;
    // mask secret values and sensitive headers
    let masked = ctx.redactor.redactString(code);
    for (const [k, v] of headers) if (ctx.redactor.isSensitiveKey(k) && v.length >= 4) masked = masked.split(v).join('<secret>');
    return masked.split('[REDACTED]').join('<secret>');
  }

  private async gqlSend(p: GqlSendParams) {
    const id = p.id ?? shortId('gql-');
    const ctrl = new AbortController();
    this.controllers.set(id, ctrl);
    const ctx = this.context({ environment: p.environment, collectionId: p.collectionId });
    const tracer = new Tracer(p.operationName ?? 'GraphQL', ctx.redactor);
    const span = tracer.start('graphql', 'graphql', { input: { query: p.request.query, variables: p.request.variables } });
    try {
      const spec = ctx.vars.resolveDeep(p.request);
      const r = await executeGraphQL(spec, { signal: ctrl.signal, redactor: ctx.redactor, maxPreviewBytes: this.settings.maxPreviewBytes, payloadDir: this.ws.path('payloads'), cookieJar: ctx.services.cookieJar });
      span.end({ status: r.errors?.length ? 'error' : 'ok', output: r.response.json });
      const checks = await runChecks(ctx.vars.resolveDeep(p.assertions ?? []), {
        testType: 'graphql',
        status: r.response.status,
        headers: r.response.headers,
        body: r.response.json ?? r.response.bodyPreview,
        text: r.response.bodyPreview,
        latencyMs: r.response.durationMs,
        graphqlErrors: r.errors,
      });
      const trace = tracer.finish();
      this.ws.saveTrace(trace, 'graphql');
      this.ws.meta.addHistory({ id: shortId('h-'), timestamp: new Date().toISOString(), kind: 'graphql', name: p.operationName ?? 'GraphQL query', method: 'POST', url: r.prepared.url, status: r.response.status, durationMs: r.response.durationMs, size: r.response.size, request: ctx.redactor.redact(p.request), traceId: trace.traceId });
      return { id, ...r, checks, traceId: trace.traceId };
    } catch (e) {
      span.fail(e);
      this.ws.saveTrace(tracer.finish('error'), 'graphql');
      return { id, error: normalizeError(e) };
    } finally {
      this.controllers.delete(id);
    }
  }

  /* ------------------------------------------------------------------ AI */

  private async aiChat(p: AiChatParams) {
    const id = p.requestId ?? shortId('ai-');
    const ctrl = new AbortController();
    this.controllers.set(id, ctrl);
    const ctx = this.context({ environment: p.environment });
    const tracer = new Tracer(`AI ${p.model}`, ctx.redactor);
    const deltas = this.batched<unknown>('ai.deltas', 40);
    try {
      const { provider, model } = ctx.services.providers.resolveModel({ provider: p.provider, name: p.model || undefined });
      const input = p.input ?? {};
      const prompt = renderPrompt(p.prompt, ctx.vars, input);
      const system = p.system ? renderPrompt(p.system, ctx.vars, input) : undefined;
      const messages = [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user' as const, content: prompt }];
      const span = tracer.start(`llm ${model}`, 'llm', { attributes: { provider: provider.config.name, model, temperature: p.temperature, topP: p.topP, maxTokens: p.maxTokens }, input: messages });
      const r = await provider.chat({
        model,
        messages,
        temperature: p.temperature,
        topP: p.topP,
        maxTokens: p.maxTokens,
        seed: p.seed,
        responseFormat: p.responseFormat,
        stream: p.stream !== false,
        signal: ctrl.signal,
        onDelta: (d) => deltas.push({ id, delta: d }),
      });
      deltas.flush();
      const cost = estimateCost(this.settings.pricing, provider.config, r.model || model, r.usage);
      span.setAttributes({ inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, ttftMs: r.timing.firstTokenMs, costUsd: cost.cost });
      span.end({ output: r.text });
      const parsed = tryParseJson(r.text);
      const schemaCheck = p.responseFormat?.schema ? validateSchema(p.responseFormat.schema, parsed.ok ? parsed.value : undefined) : undefined;
      const checks = p.evaluators?.length
        ? await runChecks(ctx.vars.resolveDeep(p.evaluators), {
            testType: 'llm',
            body: parsed.ok ? parsed.value : r.text,
            text: r.text,
            latencyMs: r.timing.totalMs,
            tokens: r.usage,
            costUsd: cost.cost,
            input,
            expected: p.expected,
            services: { providers: ctx.services.providers },
          })
        : [];
      const trace = tracer.finish();
      this.ws.saveTrace(trace, 'llm');
      this.ws.meta.addHistory({ id: shortId('h-'), timestamp: new Date().toISOString(), kind: 'llm', name: `${provider.config.name} · ${r.model || model}`, status: 'ok', durationMs: r.timing.totalMs, request: { provider: p.provider, model, prompt: p.prompt, system: p.system, input }, traceId: trace.traceId });
      return {
        id,
        provider: provider.config.name,
        model: r.model || model,
        text: r.text,
        json: parsed.ok ? parsed.value : undefined,
        isJson: parsed.ok,
        schemaValid: schemaCheck?.valid,
        schemaErrors: schemaCheck?.errors,
        toolCalls: r.toolCalls,
        usage: r.usage,
        usageEstimated: r.usageEstimated,
        costUsd: cost.cost,
        priceVersion: cost.priceVersion,
        timing: r.timing,
        finishReason: r.finishReason,
        checks,
        renderedPrompt: prompt,
        traceId: trace.traceId,
      };
    } finally {
      this.controllers.delete(id);
    }
  }

  private async assistant(p: { task: string; context: unknown; question?: string; environment?: string }) {
    const providerRef = this.settings.assistantProvider;
    if (!providerRef)
      throw new ApsError('ConfigurationError', 'No AI assistant model configured', { suggestions: ['Choose an assistant provider and model in Settings → AI Assistant (a local model works offline).'] });
    const ctx = this.context({ environment: p.environment });
    const { provider, model } = ctx.services.providers.resolveModel({ provider: providerRef, name: this.settings.assistantModel });
    const instructions: Record<string, string> = {
      'explain-error':
        'Explain what went wrong in plain language, the most likely cause, and concrete troubleshooting steps. Be concise. Use short headings: What happened, Why, How to fix.',
      'generate-assertions':
        'Propose assertions for this response as a YAML list using the Protolens check types (status, exists, equals, contains, regex, json-schema, type, length, latency, header). Output only YAML.',
      'generate-test': 'Write an Protolens YAML test for the described scenario. Output only YAML.',
      'generate-query': 'Write a GraphQL operation for the request using the given schema. Output only the GraphQL document.',
      'generate-args': 'Produce example JSON arguments that satisfy this JSON Schema. Output only JSON.',
      'generate-mock-data': 'Generate realistic mock data matching the description or schema. Output only JSON.',
      analyze: 'Analyse the results: identify patterns, regressions, bottlenecks and likely causes. Be specific and concise.',
      'explain-response':
        'Explain this HTTP response for the request: what the status and body mean, the most likely cause if it is an error, and how to fix the request. Be concise. Use short headings: What happened, Why, How to fix.',
      'generate-request':
        'Turn the description into one HTTP request. Output only a JSON object: {"name": short name, "method": HTTP method, "url": full URL, "headers": [{"key": ..., "value": ...}], "body": JSON value or string or null}. Use {{variable}} references for values available in context.variables (for example {{baseUrl}} for the host when the description does not name one). Never invent secrets: use {{variables}} for tokens and keys.',
      'generate-pm-tests':
        'Write a Postman test script for this response using pm.test and pm.expect (chai style, e.g. pm.response.to.have.status(200), pm.expect(json.id).to.be.a("number")). Check the status, important fields and their types, and response time. Output only JavaScript, no explanations.',
      free: 'Answer the developer question about their API/protocol/AI testing work.',
    };
    // request generation may use the names (never the values) of the variables in scope
    const extra = p.task === 'generate-request' ? { variables: Object.keys(ctx.vars.toObject()).filter((k) => !k.startsWith('$')).slice(0, 200) } : {};
    const context = JSON.stringify(ctx.redactor.redact({ ...(p.context as object), ...extra }), null, 2).slice(0, 24_000);
    const r = await provider.chat({
      model,
      temperature: 0.2,
      maxTokens: 1200,
      messages: [
        { role: 'system', content: `You are the AI assistant inside Protolens, a developer tool for testing REST, GraphQL, MCP and LLM systems. ${instructions[p.task] ?? instructions.free}` },
        { role: 'user', content: `${p.question ? `Question: ${p.question}\n\n` : ''}Context:\n${context}` },
      ],
    });
    return { text: r.text, provider: provider.config.name, model: r.model || model, aiGenerated: true, usage: r.usage };
  }

  /* ------------------------------------------------------------------ runs */

  private results(runId: string): AsyncGenerator<TestResult> {
    const file = join(this.ws.runDir(runId), 'results.jsonl');
    return (async function* () {
      for await (const r of await readResultsFile(file)) yield r;
    })();
  }

  private async pageResults(q: { runId: string; offset?: number; limit?: number; status?: string; query?: string }) {
    const file = join(this.ws.runDir(q.runId), 'results.jsonl');
    const items: TestResult[] = [];
    let total = 0;
    if (!existsSync(file)) return { items, total };
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 100;
    const needle = q.query?.toLowerCase();
    const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let r: TestResult;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (q.status && q.status !== 'all' && (q.status === 'failed' ? r.status !== 'failed' && r.status !== 'error' : r.status !== q.status)) continue;
      if (needle && !r.name.toLowerCase().includes(needle)) continue;
      if (total >= offset && items.length < limit) items.push(r);
      total++;
    }
    return { items, total };
  }

  private startRun(
    name: string,
    tests: AsyncIterable<TestCase>,
    opts: { environment?: string; collectionId?: string; concurrency?: number; retries?: number; bail?: boolean; keepVariableValues?: boolean; traceMode?: 'all' | 'failures' | 'none' },
    exec: (o: RunOptions) => Promise<RunSummary> = runTests,
  ) {
    const runId = shortId('run-');
    const ctrl = new AbortController();
    this.runs.set(runId, { ctrl, done: false });
    const dir = this.ws.runDir(runId);
    mkdirSync(dir, { recursive: true });
    const store = this.ws;
    const ctx = this.context({ environment: opts.environment, collectionId: opts.collectionId });
    if (opts.keepVariableValues === false) ctx.services.persistVariable = undefined;
    const events = this.batched<RunEvent>('run.events', 100);
    const started = Date.now();
    void (async () => {
      try {
        const summary = await exec({
          name,
          runId,
          tests,
          bail: opts.bail,
          concurrency: opts.concurrency ?? 4,
          retries: opts.retries ?? 0,
          services: ctx.services,
          signal: ctrl.signal,
          resultsFile: join(dir, 'results.jsonl'),
          traceMode: opts.traceMode ?? 'all',
          onTrace: (t) => void store.saveTrace(t, 'test', runId),
          environment: opts.environment,
          // test-end events carry results; forward only compact info — the UI pages full results from disk
          onEvent: (e) => {
            if (e.type === 'test-end') this.consoleFromResult(e.result, name, ctx.redactor);
            if (e.type === 'test-end') events.push({ ...e, result: { ...e.result, output: e.result.output?.slice(0, 500), input: e.result.input?.slice(0, 300), metadata: undefined } });
            else if (e.type !== 'test-start') events.push(e);
          },
        });
        writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
        await writeReports(dir, summary, () => this.results(runId));
        store.meta.addRun(summary, dir);
        this.logger.info(`Run ${name} finished`, { runId, total: summary.total, passed: summary.passed, ms: Date.now() - started });
      } catch (e) {
        const err = normalizeError(e);
        this.logger.error(`Run ${name} failed: ${err.message}`);
        this.host.emit('run.error', { runId, error: err });
      } finally {
        events.flush();
        this.runs.get(runId)!.done = true;
        await ctx.dispose();
        this.host.emit('run.finished', { runId });
      }
    })();
    return { runId };
  }

  private startTestRun(p: { paths: string[]; environment?: string; concurrency?: number; retries?: number; name?: string; grep?: string; tags?: string[] }) {
    const base = this.ws.path('tests');
    const suitePath = p.paths.length === 1 && isSuiteFile(p.paths[0]!) ? join(base, p.paths[0]!) : undefined;
    const store = this.ws;
    const tests = (async function* () {
      if (suitePath) {
        const suite = await loadSuite(suitePath);
        yield* streamTests(suite.tests, dirname(suitePath), { grep: p.grep, tags: p.tags });
      } else yield* streamTests(p.paths.length ? p.paths : ['.'], store.path('tests'), { grep: p.grep, tags: p.tags });
    })();
    return this.startRun(p.name ?? (p.paths.join(', ') || 'All tests'), tests, p);
  }

  private async readRunData(path: string): Promise<DatasetRecord[]> {
    const rows: DatasetRecord[] = [];
    for await (const r of readDataset({ path, limit: 100_000 })) rows.push(r);
    return rows;
  }

  private startCollectionRun(p: CollectionRunParams) {
    const collection = this.ws.getCollection(p.collectionId);
    const count = collectionRequests(collection, p.selection).length;
    if (!count) throw new ApsError('ValidationError', 'Nothing to run: the selection has no requests');
    const folder = p.selection?.length === 1 ? findNodeName(collection.items, p.selection[0]!) : undefined;
    const name = p.name ?? (folder ? `${collection.name} / ${folder}` : collection.name);
    return this.startRun(name, (async function* () {})(), { ...p, concurrency: 1, retries: 0 }, async (o) =>
      runCollection({
        ...o,
        collection,
        selection: p.selection,
        iterations: p.iterations,
        data: p.dataPath ? await this.readRunData(p.dataPath) : undefined,
        delayMs: p.delayMs,
      }),
    );
  }

  private startEvalRun(p: EvalRunParams) {
    const base = this.ws.path('datasets');
    mkdirSync(base, { recursive: true });
    let dataset: Record<string, unknown>;
    if (p.datasetText !== undefined) {
      const f = join(base, `inline-${shortId()}.${p.datasetFormat ?? 'jsonl'}`);
      writeFileSync(f, p.datasetText);
      dataset = { path: f, format: p.datasetFormat === 'md' ? 'markdown' : p.datasetFormat, limit: p.limit };
    } else dataset = { path: p.datasetPath, limit: p.limit };
    const template = { ...p.template, dataset: { ...dataset, expectedField: p.expectedField ?? 'expected' } };
    const tests = expandDataset(template, join(base, 'x'));
    return this.startRun(p.name ?? String(p.template.name ?? 'Evaluation'), tests, { environment: p.environment, concurrency: p.concurrency, retries: p.retries, traceMode: 'all' });
  }

  private async startLoad(p: { config: LoadTestConfig; environment?: string }) {
    const id = shortId('load-');
    const ctrl = new AbortController();
    this.controllers.set(id, ctrl);
    const ctx = this.context({ environment: p.environment });
    const cfg: LoadTestConfig = {
      ...p.config,
      target: ctx.vars.resolveDeep(p.config.target),
      environmentIsProduction: ctx.environment?.isProduction,
      allowRemoteHosts: p.config.allowRemoteHosts || this.settings.loadTesting.allowRemoteHosts,
      maxVirtualUsers: this.settings.loadTesting.maxVirtualUsers,
    };
    // validate safeguards synchronously so the UI gets an immediate error
    const { checkLoadSafeguards, buildUrl } = await import('@protolens/core');
    checkLoadSafeguards(cfg, cfg.target.kind === 'http' ? buildUrl(cfg.target.request.url, cfg.target.request.params).toString() : undefined);
    void runLoadTest(cfg, { providers: ctx.services.providers, pricing: this.settings.pricing, redactor: ctx.redactor, signal: ctrl.signal, onSnapshot: (s) => this.host.emit('load.snapshot', { id, snapshot: s }) })
      .catch((e) => this.host.emit('load.error', { id, error: normalizeError(e) }))
      .finally(() => {
        this.controllers.delete(id);
        void ctx.dispose();
      });
    this.logger.info('Load test started', { id, vus: cfg.virtualUsers, duration: cfg.durationSec });
    return { id };
  }

  async dispose(): Promise<void> {
    for (const c of this.controllers.values()) c.abort();
    for (const r of this.runs.values()) r.ctrl.abort();
    for (const s of this.mcpSessions.values()) await s.close();
    for (const s of this.wsSessions.values()) s.close();
    for (const m of this.mocks.values()) await m.close();
    await this.cookieStore?.flush().catch(() => undefined);
    this.store?.close();
  }
}

export interface CollectionRunParams {
  collectionId: string;
  /** Folder and/or request ids; empty runs the whole collection. */
  selection?: string[];
  environment?: string;
  iterations?: number;
  /** CSV / JSON file with one row per iteration. */
  dataPath?: string;
  delayMs?: number;
  bail?: boolean;
  /** Save variables set by scripts as current values (Postman's "Keep variable values"). Default true. */
  keepVariableValues?: boolean;
  name?: string;
}

function findNodeName(nodes: CollectionNode[], id: string): string | undefined {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    if (n.kind === 'folder') {
      const r = findNodeName(n.items, id);
      if (r) return r;
    }
  }
  return undefined;
}

export interface HttpSendParams {
  id?: string;
  name?: string;
  request: HttpRequestSpec;
  environment?: string;
  collectionId?: string;
  requestId?: string;
  preRequestScript?: string;
  testScript?: string;
  assertions?: CheckConfig[];
  stream?: boolean;
}

export interface GqlSendParams {
  id?: string;
  request: GraphQLRequestSpec;
  environment?: string;
  collectionId?: string;
  operationName?: string;
  assertions?: CheckConfig[];
}

export interface AiChatParams {
  requestId?: string;
  provider: string;
  model: string;
  system?: string;
  prompt: string;
  input?: Record<string, unknown>;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
  responseFormat?: ResponseFormat;
  stream?: boolean;
  environment?: string;
  evaluators?: CheckConfig[];
  expected?: unknown;
}

export interface EvalRunParams {
  name?: string;
  template: Record<string, unknown>;
  datasetText?: string;
  datasetFormat?: 'jsonl' | 'json' | 'csv' | 'md';
  datasetPath?: string;
  expectedField?: string;
  limit?: number;
  concurrency?: number;
  retries?: number;
  environment?: string;
}
