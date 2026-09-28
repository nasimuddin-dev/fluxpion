import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AppSettings, Collection, CollectionNode, HttpRequestSpec, TestResult } from '../model/types.js';
import type { RunEvent } from '../runner/runner.js';
import { ApsError, normalizeError } from '../errors.js';
import { Redactor } from '../util/redact.js';
import { shortId } from '../util/ids.js';
import type { WorkspaceStore } from '../storage/workspace.js';
import type { SecretStore } from '../storage/secrets.js';
import { createEngineContext, inheritedAuthFor } from '../engine.js';
import { executeHttp } from '../protocols/http/client.js';
import { runCollection } from '../runner/collection-run.js';
import { collectionMarkdown } from '../report/collection-docs.js';

/**
 * `fluxpion mcp-server`: the FluxPion engine as MCP tools, so AI agents (Claude, IDE assistants …)
 * can browse a workspace's collections, send requests and run collections. Output is redacted with the
 * workspace's redaction rules; secret values never leave the machine through this server.
 */
export interface FluxPionMcpOptions {
  store: WorkspaceStore;
  secrets: SecretStore;
  settings: AppSettings;
  /** Only the browsing tools (no requests are sent). */
  readOnly?: boolean;
  /** Allow sending to environments marked as production (off by default). */
  allowProduction?: boolean;
  version?: string;
}

const BODY_CHARS = 20_000;

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  write?: boolean;
  run(args: Record<string, unknown>): Promise<unknown> | unknown;
}

const str = (description: string) => ({ type: 'string', description });

export function createFluxPionMcpServer(opts: FluxPionMcpOptions): Server {
  const { store, secrets, settings } = opts;
  const redactor = new Redactor(settings.redactFields);
  const collections = () => store.listCollections().filter((c) => !c.problem);
  const findCollection = (ref: unknown): Collection => {
    const r = String(ref ?? '').toLowerCase();
    const c = collections().find((x) => x.id.toLowerCase() === r) ?? collections().find((x) => x.name.toLowerCase() === r);
    if (!c) throw new ApsError('ConfigurationError', `No collection "${String(ref)}". Available: ${collections().map((x) => x.name).join(', ') || 'none'}`);
    return c;
  };
  type Flat = { node: Exclude<CollectionNode, { kind: 'folder' }>; folder: string };
  const flatten = (nodes: CollectionNode[], path: string[] = []): Flat[] => nodes.flatMap((n) => (n.kind === 'folder' ? flatten(n.items, [...path, n.name]) : [{ node: n, folder: path.join(' / ') }]));
  const findRequest = (c: Collection, ref: unknown): Flat => {
    const all = flatten(c.items);
    const r = String(ref ?? '').toLowerCase();
    const f = all.find((x) => x.node.id.toLowerCase() === r) ?? all.find((x) => x.node.name.toLowerCase() === r);
    if (!f) throw new ApsError('ConfigurationError', `No request "${String(ref)}" in "${c.name}"`);
    return f;
  };
  const checkEnvironment = (name: unknown): string | undefined => {
    if (name === undefined || name === null || name === '') return undefined;
    const env = store.getEnvironment(String(name));
    if (!env) throw new ApsError('ConfigurationError', `No environment "${String(name)}". Available: ${store.listEnvironments().map((e) => e.name).join(', ') || 'none'}`);
    if (env.isProduction && !opts.allowProduction) throw new ApsError('ConfigurationError', `"${env.name}" is a production environment; the MCP server does not send to production unless started with --allow-production`);
    return env.name;
  };
  const clip = (t: string) => (t.length > BODY_CHARS ? `${t.slice(0, BODY_CHARS)}… [${t.length - BODY_CHARS} more characters]` : t);
  const summarizeResult = (r: TestResult) => ({
    name: r.name,
    status: r.status,
    latencyMs: r.latencyMs,
    url: (r.metadata as { url?: string } | undefined)?.url,
    error: r.error?.message,
    failedChecks: r.checks.filter((c) => !c.passed).map((c) => `${c.name ?? c.type}: ${c.message ?? 'failed'}`),
    passedChecks: r.checks.filter((c) => c.passed).length,
  });

  const all: Tool[] = [
    {
      name: 'list_collections',
      description: 'List the collections of the FluxPion workspace with their request counts.',
      inputSchema: { type: 'object', properties: {} },
      run: () =>
        collections().map((c) => ({ id: c.id, name: c.name, description: c.description?.slice(0, 300), requests: flatten(c.items).length, examples: flatten(c.items).reduce((a, f) => a + (f.node.kind === 'http' ? f.node.examples?.length ?? 0 : 0), 0) })),
    },
    {
      name: 'list_requests',
      description: 'List the requests of a collection: id, name, method, URL (with {{variables}}) and folder.',
      inputSchema: { type: 'object', properties: { collection: str('Collection name or id') }, required: ['collection'] },
      run: (a) =>
        flatten(findCollection(a.collection).items).map(({ node, folder }) => ({
          id: node.id,
          name: node.name,
          kind: node.kind,
          method: node.kind === 'http' ? node.request.method : 'POST',
          url: node.kind === 'http' ? redactor.redactString(node.request.url) : node.request.endpoint,
          folder: folder || undefined,
        })),
    },
    {
      name: 'get_request',
      description: 'Show one saved request (headers, body, auth type, scripts, documentation and saved example names). Sensitive values are masked.',
      inputSchema: { type: 'object', properties: { collection: str('Collection name or id'), request: str('Request name or id') }, required: ['collection', 'request'] },
      run: (a) => {
        const { node, folder } = findRequest(findCollection(a.collection), a.request);
        const base = { id: node.id, name: node.name, folder: folder || undefined, request: redactor.redact(node.request) };
        return node.kind === 'http'
          ? { ...base, description: node.description, preRequestScript: node.preRequestScript, testScript: node.testScript, assertions: node.assertions, examples: node.examples?.map((e) => ({ name: e.name, status: e.status })) }
          : base;
      },
    },
    {
      name: 'list_environments',
      description: 'List environments and their variable names (values are not returned).',
      inputSchema: { type: 'object', properties: {} },
      run: () => store.listEnvironments().map((e) => ({ name: e.name, production: !!e.isProduction, variables: e.variables.filter((v) => v.enabled !== false).map((v) => (v.secret ? `${v.key} (secret)` : v.key)) })),
    },
    {
      name: 'collection_docs',
      description: 'Markdown documentation of a collection: description, every request with parameters, headers, body and saved examples.',
      inputSchema: { type: 'object', properties: { collection: str('Collection name or id') }, required: ['collection'] },
      run: (a) => collectionMarkdown(findCollection(a.collection), { redactor }),
    },
    {
      name: 'send_request',
      write: true,
      description:
        'Send an HTTP request and return status, headers, body and timing. Either name a saved request (collection + request: its scripts and assertions run too) or give method + url (+ headers, body) for an ad-hoc request. {{variables}} resolve from the environment.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: str('Collection of a saved request (name or id)'),
          request: str('Saved request name or id'),
          method: str('HTTP method for an ad-hoc request (default GET)'),
          url: str('URL for an ad-hoc request; may use {{variables}}'),
          headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Headers for an ad-hoc request' },
          body: str('Raw body for an ad-hoc request (JSON is detected)'),
          environment: str('Environment name'),
        },
      },
      run: async (a) => {
        const environment = checkEnvironment(a.environment);
        if (a.collection && a.request) {
          const c = findCollection(a.collection);
          const { node } = findRequest(c, a.request);
          const ctx = createEngineContext({ store, secrets, settings, environment, collectionId: c.id });
          let result: TestResult | undefined;
          try {
            await runCollection({ name: `mcp ${node.name}`, runId: shortId('mcp-'), collection: c, selection: [node.id], services: ctx.services, traceMode: 'none', onEvent: (e: RunEvent) => e.type === 'test-end' && (result = e.result) });
          } finally {
            await ctx.dispose();
          }
          if (!result) throw new ApsError('ProtocolError', 'The request did not run');
          return { ...summarizeResult(result), output: result.output && clip(result.output) };
        }
        if (!a.url) throw new ApsError('ValidationError', 'Give collection + request for a saved request, or url for an ad-hoc one');
        const ctx = createEngineContext({ store, secrets, settings, environment });
        try {
          const body = typeof a.body === 'string' && a.body ? { type: /^\s*[{[]/.test(a.body) ? ('json' as const) : ('text' as const), content: a.body } : undefined;
          const spec: HttpRequestSpec = ctx.vars.resolveDeep({
            method: String(a.method ?? 'GET').toUpperCase(),
            url: String(a.url),
            headers: Object.entries((a.headers as Record<string, string>) ?? {}).map(([key, value]) => ({ key, value: String(value) })),
            body,
          });
          const { response } = await executeHttp({ ...spec, settings: { timeoutMs: settings.defaultTimeoutMs } }, { redactor: ctx.redactor, maxPreviewBytes: 1024 * 1024, cookieJar: ctx.services.cookieJar });
          return {
            status: response.status,
            statusText: response.statusText,
            durationMs: response.durationMs,
            size: response.size,
            url: response.url,
            headers: Object.fromEntries(ctx.redactor.redact(response.headers)),
            body: clip(ctx.redactor.redactString(response.bodyPreview)),
            unresolvedVariables: ctx.vars.unresolved.size ? [...ctx.vars.unresolved] : undefined,
          };
        } finally {
          await ctx.dispose();
        }
      },
    },
    {
      name: 'run_collection',
      write: true,
      description: 'Run a collection (or one folder) like the Collection Runner: requests in order with their scripts and assertions. Returns totals and per-request results.',
      inputSchema: { type: 'object', properties: { collection: str('Collection name or id'), folder: str('Only run this folder or request (name or id)'), environment: str('Environment name') }, required: ['collection'] },
      run: async (a) => {
        const environment = checkEnvironment(a.environment);
        const c = findCollection(a.collection);
        let selection: string[] | undefined;
        if (a.folder) {
          const r = String(a.folder).toLowerCase();
          const all: CollectionNode[] = [];
          const walk = (nodes: CollectionNode[]) => nodes.forEach((n) => (all.push(n), n.kind === 'folder' && walk(n.items)));
          walk(c.items);
          const n = all.find((x) => x.id.toLowerCase() === r) ?? all.find((x) => x.name.toLowerCase() === r);
          if (!n) throw new ApsError('ConfigurationError', `No folder or request "${String(a.folder)}" in "${c.name}"`);
          selection = [n.id];
        }
        const ctx = createEngineContext({ store, secrets, settings, environment, collectionId: c.id });
        const results: TestResult[] = [];
        try {
          const summary = await runCollection({ name: c.name, runId: shortId('mcp-'), collection: c, selection, services: ctx.services, traceMode: 'none', environment, onEvent: (e: RunEvent) => e.type === 'test-end' && results.push(e.result) });
          return { total: summary.total, passed: summary.passed, failed: summary.failed, errors: summary.errors, skipped: summary.skipped, durationMs: summary.durationMs, results: results.slice(0, 200).map(summarizeResult) };
        } finally {
          await ctx.dispose();
        }
      },
    },
  ];
  const tools = all.filter((t) => !(opts.readOnly && t.write));

  const server = new Server(
    { name: 'fluxpion', version: opts.version ?? '0.5.0' },
    {
      capabilities: { tools: {} },
      instructions: `FluxPion workspace "${store.workspace.name}". Use list_collections and list_requests to find requests, get_request or collection_docs to understand them${opts.readOnly ? '' : ', send_request to call one and run_collection to run tests'}. Values of secrets are never returned.`,
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${req.params.name}` }] };
    try {
      const out = await tool.run((req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
    } catch (e) {
      const err = normalizeError(e);
      return { isError: true, content: [{ type: 'text', text: `${err.kind}: ${err.message}${err.suggestions.length ? `\n${err.suggestions.join('\n')}` : ''}` }] };
    }
  });
  return server;
}

/** Serve the workspace over stdio until the client disconnects. */
export async function serveFluxPionMcp(opts: FluxPionMcpOptions): Promise<void> {
  const server = createFluxPionMcpServer(opts);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => (server.onclose = () => resolve()));
  await server.connect(transport);
  await closed;
}
