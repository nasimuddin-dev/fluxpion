import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ApsError } from '../errors.js';
import type { McpDiscovery } from '../protocols/mcp/client.js';

/**
 * MCP mock server: a fake MCP server from a definition (tools with canned responses, resources and
 * prompts), to test AI agents and MCP clients without the real server or its side effects.
 * Definitions are YAML/JSON files (`*.mcp-mock.yaml`), written by hand or recorded from a real
 * server with `mockFromDiscovery`.
 */
export interface McpMockResponse {
  /** Use this response when the call's arguments contain these values (deep equal); omit for the default. */
  when?: Record<string, unknown>;
  /** Text content; `{{args.name}}` is replaced by the call's argument. */
  text?: string;
  /** JSON content (sent as text JSON and as structuredContent). */
  json?: unknown;
  /** Raw MCP content items, if you need images or several parts. */
  content?: unknown[];
  isError?: boolean;
}

export interface McpMockDefinition {
  schemaVersion?: string;
  name: string;
  version?: string;
  instructions?: string;
  tools?: Array<{ name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: Record<string, unknown>; responses?: McpMockResponse[] }>;
  resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string; text?: string }>;
  prompts?: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }>; messages?: Array<{ role: 'user' | 'assistant'; text: string }> }>;
}

/** Parse a mock definition (YAML or JSON) and check its shape. */
export function loadMcpMock(text: string): McpMockDefinition {
  const d = parseYaml(text) as McpMockDefinition;
  if (!d || typeof d !== 'object' || !d.name) throw new ApsError('ValidationError', 'An MCP mock needs at least a "name" (and usually "tools")');
  for (const t of d.tools ?? []) if (!t.name) throw new ApsError('ValidationError', 'Every tool in the MCP mock needs a "name"');
  return d;
}

export function dumpMcpMock(d: McpMockDefinition): string {
  return stringifyYaml({ schemaVersion: '1.0', ...d }, { lineWidth: 120 });
}

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const subset = (args: Record<string, unknown>, when: Record<string, unknown>) => Object.entries(when).every(([k, v]) => deepEqual(args[k], v));
const fill = (s: string, vars: Record<string, unknown>) =>
  s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path: string) => {
    const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), vars);
    return v === undefined ? m : typeof v === 'string' ? v : JSON.stringify(v);
  });

/** The MCP result for a tool call against the mock. */
export function mockToolResult(d: McpMockDefinition, name: string, args: Record<string, unknown> = {}): { content: unknown[]; isError?: boolean; structuredContent?: unknown } {
  const tool = d.tools?.find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool "${name}" (mock)` }], isError: true };
  const rs = tool.responses ?? [];
  const r = rs.find((x) => x.when && subset(args, x.when)) ?? rs.find((x) => !x.when);
  if (!r) return { content: [{ type: 'text', text: `Mock response for ${name}: ${JSON.stringify(args)}` }] };
  if (r.content) return { content: r.content, ...(r.isError ? { isError: true } : {}) };
  if (r.json !== undefined) return { content: [{ type: 'text', text: JSON.stringify(r.json) }], structuredContent: r.json, ...(r.isError ? { isError: true } : {}) };
  return { content: [{ type: 'text', text: fill(r.text ?? '', { args }) }], ...(r.isError ? { isError: true } : {}) };
}

/** An MCP server (not yet connected) that answers from the definition. */
export function createMcpMockServer(d: McpMockDefinition): Server {
  const caps: Record<string, object> = { tools: {} };
  if (d.resources?.length) caps.resources = {};
  if (d.prompts?.length) caps.prompts = {};
  const server = new Server({ name: d.name, version: d.version ?? '1.0.0-mock' }, { capabilities: caps, instructions: d.instructions });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (d.tools ?? []).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: { type: 'object', properties: {}, ...(t.inputSchema ?? {}) }, annotations: t.annotations })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => mockToolResult(d, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>) as never);
  if (d.resources?.length) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: d.resources!.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })) }));
    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const r = d.resources!.find((x) => x.uri === req.params.uri);
      if (!r) throw new McpError(ErrorCode.InvalidParams, `Unknown resource ${req.params.uri}`);
      return { contents: [{ uri: r.uri, mimeType: r.mimeType ?? 'text/plain', text: r.text ?? '' }] };
    });
  }
  if (d.prompts?.length) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: d.prompts!.map(({ name, description, arguments: a }) => ({ name, description, arguments: a })) }));
    server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      const p = d.prompts!.find((x) => x.name === req.params.name);
      if (!p) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt ${req.params.name}`);
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      return { description: p.description, messages: (p.messages ?? []).map((m) => ({ role: m.role, content: { type: 'text', text: fill(m.text, args) } })) };
    });
  }
  return server;
}

/** Serve the mock over stdio (for AI agents that start MCP servers as commands). */
export async function serveMcpMockStdio(d: McpMockDefinition): Promise<void> {
  await createMcpMockServer(d).connect(new StdioServerTransport());
}

export interface McpMockHttpServer {
  url: string;
  close(): Promise<void>;
}

/** Serve the mock over Streamable HTTP on localhost (stateless: every request gets a fresh server). */
export async function startMcpMockHttp(d: McpMockDefinition, opts: { port?: number } = {}): Promise<McpMockHttpServer> {
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    const server = createMcpMockServer(d);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
  const http = createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: (e as Error).message }, id: null }));
    });
  });
  await new Promise<void>((ok, fail) => {
    http.once('error', fail);
    http.listen(opts.port ?? 0, '127.0.0.1', () => ok());
  });
  return { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, close: () => new Promise((ok) => http.close(() => ok())) };
}

/**
 * A mock definition recorded from a real server: its tools, resources and prompts, plus the results
 * of calls made so far (each becomes a response matched on its arguments).
 */
export function mockFromDiscovery(
  name: string,
  discovery: McpDiscovery,
  calls: Array<{ tool: string; args: Record<string, unknown>; result: { content?: unknown[]; isError?: boolean } }> = [],
  resourceTexts: Record<string, string> = {},
): McpMockDefinition {
  return {
    name,
    version: discovery.serverInfo?.version,
    instructions: discovery.instructions,
    tools: discovery.tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      responses: calls.filter((c) => c.tool === t.name).map((c) => ({ when: Object.keys(c.args).length ? c.args : undefined, content: c.result.content ?? [], ...(c.result.isError ? { isError: true } : {}) })),
    })),
    resources: discovery.resources.map((r) => ({ ...r, text: resourceTexts[r.uri] })),
    prompts: discovery.prompts.map((p) => ({ ...p, messages: [] })),
  };
}
