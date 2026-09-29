import { ENGINE_VERSION } from '../version.js';
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
import { createEngineContext } from '../engine.js';
import { executeHttp } from '../protocols/http/client.js';
import { describeRoot, executeGrpc, grpcRoot, parseGrpcTarget } from '../protocols/grpc/grpc.js';
import { reflectServer } from '../protocols/grpc/reflection.js';
import { readFileSync } from 'node:fs';
import { runCollection } from '../runner/collection-run.js';
import { collectionMarkdown } from '../report/collection-docs.js';
import { detectRequestSnippet, parseRequestSnippet } from '../import/snippet.js';
import { addRequestToCollection, externalizeSecrets } from '../import/save-request.js';
import { compareHistory } from '../storage/history-compare.js';
import { redactDiff } from '../report/response-diff.js';

/**
 * `testpion mcp-server`: the TestPion engine as MCP tools, so AI agents (Claude, IDE assistants …)
 * can browse a workspace's collections, send requests and run collections. Output is redacted with the
 * workspace's redaction rules; secret values never leave the machine through this server.
 */
export interface TestPionMcpOptions {
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

export function createTestPionMcpServer(opts: TestPionMcpOptions): Server {
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
    // console.log output of the scripts and the pm.visualizer rendering, when there is one
    scriptLogs: (r.metadata as { scriptLogs?: string[] } | undefined)?.scriptLogs?.map((l) => redactor.redactString(l)),
    visualization: (r.metadata as { visualizer?: { html?: string; error?: string } } | undefined)?.visualizer,
  });
  /** A request from `snippet` (cURL / fetch / PowerShell) or from method + url + headers + body. */
  const requestFrom = (a: Record<string, unknown>): { request: HttpRequestSpec; format?: string } => {
    if (typeof a.snippet === 'string' && a.snippet.trim()) {
      const format = detectRequestSnippet(a.snippet);
      if (!format) throw new ApsError('ValidationError', 'snippet is not a cURL, fetch or PowerShell (Invoke-WebRequest / Invoke-RestMethod) command');
      return { request: parseRequestSnippet(a.snippet), format };
    }
    if (!a.url) throw new ApsError('ValidationError', 'Give snippet, or url (+ method, headers, body)');
    const body = typeof a.body === 'string' && a.body ? { type: /^\s*[{[]/.test(a.body) ? ('json' as const) : ('text' as const), content: a.body } : undefined;
    return {
      request: {
        method: String(a.method ?? 'GET').toUpperCase(),
        url: String(a.url),
        headers: Object.entries((a.headers as Record<string, string>) ?? {}).map(([key, value]) => ({ key, value: String(value) })),
        body,
      },
    };
  };

  const all: Tool[] = [
    {
      name: 'list_collections',
      description: 'List the collections of the TestPion workspace with their request counts.',
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
        'Send an HTTP request and return status, headers, body and timing. Either name a saved request (collection + request: its scripts and assertions run too) or give method + url (+ headers, body) for an ad-hoc request. {{variables}} resolve from the environment. Server-Sent Events responses (text/event-stream) also return their parsed events.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: str('Collection of a saved request (name or id)'),
          request: str('Saved request name or id'),
          method: str('HTTP method for an ad-hoc request (default GET)'),
          url: str('URL for an ad-hoc request; may use {{variables}}'),
          headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Headers for an ad-hoc request' },
          body: str('Raw body for an ad-hoc request (JSON is detected)'),
          snippet: str('Or: a cURL / fetch / PowerShell command to send as an ad-hoc request'),
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
        if (!a.url && !a.snippet) throw new ApsError('ValidationError', 'Give collection + request for a saved request, or url (or snippet) for an ad-hoc one');
        const ctx = createEngineContext({ store, secrets, settings, environment });
        try {
          const spec: HttpRequestSpec = ctx.vars.resolveDeep(requestFrom(a).request);
          const { response } = await executeHttp({ ...spec, settings: { timeoutMs: settings.defaultTimeoutMs } }, { redactor: ctx.redactor, maxPreviewBytes: 1024 * 1024, cookieJar: ctx.services.cookieJar });
          return {
            status: response.status,
            statusText: response.statusText,
            durationMs: response.durationMs,
            size: response.size,
            url: response.url,
            headers: Object.fromEntries(ctx.redactor.redact(response.headers)),
            body: clip(ctx.redactor.redactString(response.bodyPreview)),
            // Server-Sent Events, parsed (an endless stream stops at the timeout and keeps what arrived)
            ...(response.events
              ? {
                  eventCount: response.events.length + (response.eventsDropped ?? 0),
                  events: response.events.slice(0, 100).map((e) => ({ event: e.event, ...(e.id !== undefined ? { id: e.id } : {}), data: clip(ctx.redactor.redactString(e.data)), atMs: e.atMs })),
                  ...(response.streamStopped ? { streamStopped: true } : {}),
                }
              : {}),
            unresolvedVariables: ctx.vars.unresolved.size ? [...ctx.vars.unresolved] : undefined,
          };
        } finally {
          await ctx.dispose();
        }
      },
    },
    {
      name: 'grpc_call',
      write: true,
      description:
        'Call a gRPC method described by .proto files in the workspace (or, without protos, by the server itself through server reflection), or list the methods (with example requests) when no method is given. Returns the gRPC status, the response message (or the streamed messages), metadata and trailers. {{variables}} resolve from the environment.',
      inputSchema: {
        type: 'object',
        properties: {
          target: str('Server address: host:port, or grpcs://host:port for TLS'),
          protos: { type: 'array', items: { type: 'string' }, description: '.proto files in the workspace (and the files they import), e.g. ["protos/vet/v1/pets.proto"]' },
          method: str('package.Service/Method; omit to list the methods'),
          message: { description: 'Request message as a JSON object (a list of messages for client-streaming methods)' },
          metadata: { type: 'object', additionalProperties: { type: 'string' }, description: 'Metadata (headers)' },
          environment: str('Environment name'),
        },
      },
      run: async (a) => {
        const protoFiles = ((a.protos as string[]) ?? []).map((name) => ({ name, text: readFileSync(store.safePath(String(name)), 'utf8') }));
        const environment = checkEnvironment(a.environment);
        const ctx = createEngineContext({ store, secrets, settings, environment });
        try {
          const r = ctx.vars.resolveDeep({ target: String(a.target ?? ''), message: a.message ?? {}, metadata: Object.entries((a.metadata as Record<string, string>) ?? {}).map(([key, value]) => ({ key, value })) });
          if (!protoFiles.length && !r.target) throw new ApsError('ValidationError', 'Give the server address (target), and protos unless the server offers reflection');
          // no proto files: the server describes itself (server reflection)
          const descriptorSet = protoFiles.length ? undefined : (await reflectServer(parseGrpcTarget(r.target), { metadata: r.metadata })).descriptorSet;
          if (!a.method) return describeRoot(grpcRoot({ protoFiles, descriptorSet })).map((m) => ({ method: m.name, clientStreaming: m.clientStreaming, serverStreaming: m.serverStreaming, example: m.example }));
          if (!r.target) throw new ApsError('ValidationError', 'Give the server address (target)');
          const out = await executeGrpc({ target: r.target, method: String(a.method), message: JSON.stringify(r.message), metadata: r.metadata, protoFiles, descriptorSet, timeoutMs: settings.defaultTimeoutMs }, { redactor: ctx.redactor });
          const body = (v: unknown) => clip(ctx.redactor.redactString(JSON.stringify(v)));
          return {
            code: out.code,
            status: out.codeName,
            details: out.details || undefined,
            durationMs: out.durationMs,
            ...(out.response !== undefined ? { response: body(out.response) } : {}),
            ...(out.messages ? { messageCount: out.messages.length, messages: out.messages.slice(0, 100).map((m) => body(m.data)) } : {}),
            metadata: Object.fromEntries(out.metadata),
            trailers: Object.fromEntries(out.trailers),
            unresolvedVariables: ctx.vars.unresolved.size ? [...ctx.vars.unresolved] : undefined,
          };
        } finally {
          await ctx.dispose();
        }
      },
    },
    {
      name: 'request_history',
      description:
        'Earlier responses of a saved request, newest first (from requests sent in the TestPion app): id, time, status, duration and size. Use the ids with compare_responses to see what changed between two runs.',
      inputSchema: { type: 'object', properties: { collection: str('Collection name or id'), request: str('Request name or id'), limit: { type: 'number', description: 'How many (default 20, max 100)' } }, required: ['collection', 'request'] },
      run: (a) => {
        const { node } = findRequest(findCollection(a.collection), a.request);
        const limit = Math.min(Math.max(Number(a.limit) || 20, 1), 100);
        return store.meta
          .listHistory({ requestId: node.id, kind: 'http', limit })
          .items.map((h) => ({ id: h.id, timestamp: h.timestamp, status: h.status, durationMs: h.durationMs, size: h.size, url: h.url && redactor.redactUrl(h.url) }));
      },
    },
    {
      name: 'compare_responses',
      description:
        'Compare two responses from the history (ids from request_history): status, timing, header changes (volatile ones like date are flagged) and a field-by-field JSON body diff ($.path added / removed / changed), or a line diff for text. Sensitive values are masked.',
      inputSchema: { type: 'object', properties: { before: str('History id of the older response'), after: str('History id of the newer response') }, required: ['before', 'after'] },
      run: (a) => redactDiff(redactor.redact(compareHistory(store, String(a.before), String(a.after))), redactor),
    },
    {
      name: 'parse_request_snippet',
      description:
        'Turn a request copied from browser devtools or docs (cURL for bash or cmd, fetch, fetch (Node.js), or PowerShell Invoke-WebRequest / Invoke-RestMethod) into a structured TestPion request: method, URL, params, headers, cookies, body and auth. Nothing is sent or saved. Secret values (tokens, keys, cookies, passwords) are replaced by {{variables}} listed in `placeholders`.',
      inputSchema: { type: 'object', properties: { snippet: str('The copied command or code') }, required: ['snippet'] },
      run: (a) => {
        const { request, format } = requestFrom({ snippet: a.snippet });
        // same rewrite as save_request: cookies, tokens and keys become {{variables}}, never values
        const { request: safe, placeholders } = externalizeSecrets(request, redactor);
        return { format, request: redactor.redact(safe), placeholders };
      },
    },
    {
      name: 'save_request',
      write: true,
      description:
        'Save a request into a collection (and folder path such as "Auth / Tokens"). Give a snippet (cURL / fetch / PowerShell) or method + url (+ headers, body). Secret values (Authorization and other sensitive headers, auth credentials, cookies, sensitive query or body fields) are NOT written to the workspace: they are replaced by {{variables}}, listed in `placeholders`, and should be set as secret environment variables by the user.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: str('Collection name or id'),
          create: { type: 'boolean', description: 'Create the collection when it does not exist (default false)' },
          folder: str('Folder path inside the collection, e.g. "Auth / Tokens" (created as needed)'),
          name: str('Request name (default: method and URL)'),
          description: str('Markdown documentation for the request'),
          snippet: str('cURL / fetch / PowerShell command to import'),
          method: str('HTTP method (when no snippet)'),
          url: str('URL, may use {{variables}} (when no snippet)'),
          headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Headers (when no snippet)' },
          body: str('Raw body (when no snippet; JSON is detected)'),
        },
        required: ['collection'],
      },
      run: (a) => {
        const { request, format } = requestFrom(a);
        const { request: safe, placeholders } = externalizeSecrets(request, redactor);
        const { collection, node, created } = addRequestToCollection(collections(), {
          collection: String(a.collection),
          create: a.create === true,
          folder: typeof a.folder === 'string' ? a.folder : undefined,
          name: typeof a.name === 'string' ? a.name : '',
          description: typeof a.description === 'string' ? a.description : undefined,
          request: safe,
        });
        const saved = store.saveCollection(collection);
        return {
          saved: { collection: saved.name, collectionId: saved.id, createdCollection: created, request: node.name, requestId: node.id, method: safe.method, url: safe.url },
          format,
          placeholders,
          next: placeholders.length
            ? `Ask the user to add ${placeholders.map((p) => p.variable).join(', ')} as secret variables of an environment (Environments view, or they stay unresolved).`
            : undefined,
        };
      },
    },
    {
      name: 'reorder_environments',
      write: true,
      description: 'Set the display order of environments (the order of the environment picker). Environments not listed keep their order after the listed ones.',
      inputSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' }, description: 'Environment names or ids, first to last' } }, required: ['order'] },
      run: (a) => {
        const refs = Array.isArray(a.order) ? a.order.map((x) => String(x)) : [];
        const envs = store.listEnvironments();
        const ids = refs.map((r) => {
          const e = envs.find((x) => x.id === r) ?? envs.find((x) => x.name.toLowerCase() === r.toLowerCase());
          if (!e) throw new ApsError('ConfigurationError', `No environment "${r}". Available: ${envs.map((x) => x.name).join(', ') || 'none'}`);
          return e.id;
        });
        return store.reorderEnvironments(ids).map((e) => e.name);
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
    { name: 'testpion', version: opts.version ?? ENGINE_VERSION },
    {
      capabilities: { tools: {} },
      instructions: `TestPion workspace "${store.workspace.name}". Use list_collections and list_requests to find requests, get_request or collection_docs to understand them${opts.readOnly ? '' : ', send_request to call one and run_collection to run tests'}. parse_request_snippet reads a cURL / fetch / PowerShell command${opts.readOnly ? '' : ' and save_request stores it in a collection (secrets become {{variables}})'}. Values of secrets are never returned.`,
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
export async function serveTestPionMcp(opts: TestPionMcpOptions): Promise<void> {
  const server = createTestPionMcpServer(opts);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => (server.onclose = () => resolve()));
  await server.connect(transport);
  await closed;
}
