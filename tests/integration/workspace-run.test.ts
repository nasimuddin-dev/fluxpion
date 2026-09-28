import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

/** Async spawn — the demo servers live in this process, so a blocking spawnSync would deadlock. */
function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
import {
  WorkspaceStore,
  MemorySecretStore,
  createEngineContext,
  runTests,
  streamTests,
  loadSuite,
  McpSession,
  mcpResultBody,
  type RunEvent,
  type TestResult,
} from '../../packages/core/src/index.js';
// @ts-expect-error - plain JS example module
import { startAll } from '../../examples/servers/demo-servers.mjs';

/**
 * End-to-end: run the example workspace's regression suite through the same engine the desktop
 * app and CLI use. The demo servers bind the fixed ports referenced by the example environment.
 */
let servers: { close(): Promise<void> } | undefined;
let dir: string;
let ws: WorkspaceStore;

beforeAll(async () => {
  try {
    servers = await startAll(4010);
  } catch {
    servers = undefined; // ports already in use — assume the demo servers are already running
  }
  dir = mkdtempSync(join(tmpdir(), 'aps-ws-'));
  cpSync(resolve('examples/veterinary-workspace'), join(dir, 'veterinary-workspace'), { recursive: true, filter: (s) => !/runs|traces|database\.sqlite/.test(s) });
  ws = WorkspaceStore.open(join(dir, 'veterinary-workspace'));
  // the copy lives outside the repo, so point the stdio MCP server at the repo's script (and its node_modules)
  ws.saveMcpServers([{ id: 'customer-mcp', name: 'customer-mcp', transport: 'stdio', command: process.execPath, args: [resolve('examples/servers/mcp-server.mjs')] }]);
});

afterAll(async () => {
  ws?.close();
  await servers?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('example workspace (end-to-end)', () => {
  it('passes the full regression suite across REST, GraphQL, MCP, LLM, RAG, agent and safety tests', async () => {
    const suite = await loadSuite(ws.path('tests', 'regression.suite.yaml'));
    const ctx = createEngineContext({ store: ws, secrets: new MemorySecretStore(), environment: suite.environment });
    const results: TestResult[] = [];
    const traces: string[] = [];
    try {
      const summary = await runTests({
        name: suite.name,
        tests: streamTests(suite.tests, ws.path('tests')),
        concurrency: suite.concurrency,
        services: ctx.services,
        resultsFile: join(dir, 'results.jsonl'),
        traceMode: 'all',
        onTrace: (t) => void traces.push(ws.saveTrace(t, 'test')),
        onEvent: (e: RunEvent) => e.type === 'test-end' && results.push(e.result),
      });
      const failures = results.filter((r) => r.status !== 'passed').map((r) => `${r.name}: ${r.error?.message ?? r.checks.filter((c) => !c.passed).map((c) => c.message).join('; ')}`);
      expect(failures).toEqual([]);
      expect(summary.total).toBe(22);
      const types = new Set(results.map((r) => r.type));
      expect([...types].sort()).toEqual(['agent', 'graphql', 'http', 'llm', 'mcp', 'rag']);
      // AI-judge / heuristic results are labelled distinctly from deterministic ones
      const rag = results.find((r) => r.type === 'rag')!;
      expect(rag.checks.find((c) => c.type === 'groundedness')!.source).toBe('heuristic');
      expect(rag.metadata?.rag).toMatchObject({ documentIds: ['doc-1', 'doc-2'] });
      // traces were persisted and indexed
      expect(ws.meta.listTraces().total).toBe(22);
      const agent = results.find((r) => r.type === 'agent')!;
      const trace = ws.loadTrace(agent.traceId!)!;
      expect(trace.spans.map((s) => s.kind)).toEqual(expect.arrayContaining(['test', 'llm', 'mcp', 'evaluation']));
      // secrets/tokens obtained at runtime never reach persisted results
      expect(readFileSync(join(dir, 'results.jsonl'), 'utf8')).not.toContain('demo-token-3f9a1c');
    } finally {
      await ctx.dispose();
    }
  });

  it('CLI: `protopion run` exits 0 and writes all report formats', async () => {
    const cli = resolve('packages/cli/bin/protopion.js');
    const out = join(dir, 'cli-out');
    const r = await run([cli, 'run', '-w', ws.root, '--suite', 'smoke', '-o', out, '-q'], { ...process.env, PROTOPION_HOME: join(dir, 'home') });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(readFileSync(join(out, 'junit.xml'), 'utf8')).toContain('tests="4"');
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).summary.passed).toBe(4);
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('Smoke');
    expect(readFileSync(join(out, 'report.html'), 'utf8')).toContain('PASSED');
    const bad = await run([cli, 'test', join(dir, 'does-not-exist')], { ...process.env, PROTOPION_HOME: join(dir, 'home') });
    expect(bad.status).toBe(2);
  });

  it('CLI: `protopion run-collection` runs workspace collections and Postman files (Newman-style)', async () => {
    const cli = resolve('packages/cli/bin/protopion.js');
    const env = { ...process.env, PROTOPION_HOME: join(dir, 'home') };

    // workspace collection, one folder, two iterations: the token script feeds the next requests
    const out = join(dir, 'col-out');
    const r = await run([cli, 'run-collection', 'Veterinary API', '-w', ws.root, '-e', 'Development', '--folder', 'Authentication', 'Patients', '-n', '2', '-o', out, '-q'], env);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))).toMatchObject({ total: 8, passed: 8 });

    // without the token request the patients endpoints refuse: exit 1, and no crash on exit
    const failing = await run([cli, 'run-collection', 'Veterinary API', '-w', ws.root, '-e', 'Development', '--folder', 'Patients', '-o', join(dir, 'col-fail'), '-q'], env);
    expect(failing.stderr).toBe('');
    expect(failing.status).toBe(1);

    // a Postman collection + environment + CSV data outside any workspace
    writeFileSync(
      join(dir, 'smoke.postman_collection.json'),
      JSON.stringify({
        info: { name: 'Smoke', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Health',
            request: { method: 'GET', url: '{{baseUrl}}/health' },
            event: [{ listen: 'test', script: { exec: ["pm.test('ok', () => pm.response.to.have.status(200));", "pm.environment.set('seen', pm.iterationData.get('n'));"] } }],
          },
          {
            name: 'Again',
            request: { method: 'GET', url: '{{baseUrl}}/health?n={{n}}' },
            event: [{ listen: 'test', script: { exec: ["pm.test('carries', () => pm.expect(String(pm.environment.get('seen'))).to.equal(String(pm.iterationData.get('n'))));"] } }],
          },
        ],
      }),
    );
    writeFileSync(join(dir, 'local.postman_environment.json'), JSON.stringify({ name: 'Local', values: [{ key: 'baseUrl', value: 'http://localhost:4010', enabled: true }] }));
    writeFileSync(join(dir, 'rows.csv'), 'n\n1\n2\n3\n');
    const pm = await run([cli, 'run-collection', join(dir, 'smoke.postman_collection.json'), '-e', join(dir, 'local.postman_environment.json'), '-d', join(dir, 'rows.csv'), '-o', join(dir, 'pm-out'), '-r', 'junit', '-q'], env);
    expect(pm.stderr).toBe('');
    expect(pm.status).toBe(0);
    expect(readFileSync(join(dir, 'pm-out', 'junit.xml'), 'utf8')).toContain('tests="6"');

    const missing = await run([cli, 'run-collection', join(dir, 'smoke.postman_collection.json'), '--folder', 'Nope'], env);
    expect(missing.status).toBe(2);
  });

  it('CLI: run-collection keeps cookies across requests and exports / imports the cookie jar', async () => {
    const cli = resolve('packages/cli/bin/protopion.js');
    const env = { ...process.env, PROTOPION_HOME: join(dir, 'home') };
    const collection = (items: unknown[]) => JSON.stringify({ info: { name: 'Cookies', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: items });
    const me = {
      name: 'Me',
      request: { method: 'GET', url: 'http://localhost:4010/session/me' },
      event: [{ listen: 'test', script: { exec: ["pm.test('logged in', () => pm.response.to.have.status(200));"] } }],
    };
    writeFileSync(
      join(dir, 'login.postman_collection.json'),
      collection([
        { name: 'Login', request: { method: 'POST', url: 'http://localhost:4010/session/login', header: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', raw: '{"username":"vet","password":"paws"}' } } },
        me,
      ]),
    );
    writeFileSync(join(dir, 'me.postman_collection.json'), collection([me]));
    const jar = join(dir, 'jar.json');
    const login = await run([cli, 'run-collection', join(dir, 'login.postman_collection.json'), '--export-cookie-jar', jar, '-o', join(dir, 'ck1'), '-r', 'json', '-q'], env);
    expect(login.stderr).toBe('');
    expect(login.status).toBe(0);
    expect(JSON.parse(readFileSync(jar, 'utf8')).cookies.map((c: { name: string }) => c.name).sort()).toEqual(['clinic', 'vet_session']);

    // a fresh run has no session; with the exported jar it does
    expect((await run([cli, 'run-collection', join(dir, 'me.postman_collection.json'), '-o', join(dir, 'ck2'), '-r', 'json', '-q'], env)).status).toBe(1);
    const reuse = await run([cli, 'run-collection', join(dir, 'me.postman_collection.json'), '--cookie-jar', jar, '-o', join(dir, 'ck3'), '-r', 'json', '-q'], env);
    expect(reuse.stderr).toBe('');
    expect(reuse.status).toBe(0);

    // the example workspace's "Cookie session" folder: login → me (pm.cookies, pm.cookies.jar()) → logout
    const example = await run([cli, 'run-collection', 'Veterinary API', '-w', ws.root, '-e', 'Development', '--folder', 'Cookie session', '-o', join(dir, 'ck4'), '-r', 'json', '-q'], env);
    expect(example.stderr).toBe('');
    expect(example.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'ck4', 'summary.json'), 'utf8'))).toMatchObject({ total: 3, passed: 3 });
  });

  it('CLI: `protopion export` / `export-environment` write Postman files that run-collection runs', async () => {
    const cli = resolve('packages/cli/bin/protopion.js');
    const env = { ...process.env, PROTOPION_HOME: join(dir, 'home') };
    const col = join(dir, 'vet.postman_collection.json');
    const envFile = join(dir, 'dev.postman_environment.json');
    const a = await run([cli, 'export', 'Veterinary API', '-w', ws.root, '-o', col], env);
    expect(a.status).toBe(0);
    expect(JSON.parse(readFileSync(col, 'utf8')).info.schema).toContain('v2.1.0');
    const b = await run([cli, 'export-environment', 'Development', '-w', ws.root, '-o', envFile], env);
    expect(b.status).toBe(0);
    const r = await run([cli, 'run-collection', col, '-e', envFile, '--folder', 'Authentication', 'Patients', 'Cookie session', '-o', join(dir, 'pm-rt'), '-r', 'json', '-q'], env);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'pm-rt', 'summary.json'), 'utf8'))).toMatchObject({ total: 7, passed: 7 });
  });

  it('CLI: `protopion mcp-server` gives AI agents the workspace as MCP tools', async () => {
    const env = { PROTOPION_HOME: join(dir, 'home') } as Record<string, string>;
    const cli = resolve('packages/cli/bin/protopion.js');
    const s = new McpSession({ id: 'pl', name: 'protopion', transport: 'stdio', command: process.execPath, args: [cli, 'mcp-server', '-w', ws.root], env });
    await s.connect(20_000);
    try {
      const names = (await s.listTools()).map((t) => t.name).sort();
      expect(names).toEqual(['collection_docs', 'get_request', 'list_collections', 'list_environments', 'list_requests', 'run_collection', 'send_request']);
      const text = async (tool: string, args: Record<string, unknown> = {}) => {
        const r = await s.callTool(tool, args);
        return { isError: r.isError, text: mcpResultBody(r).text };
      };
      expect((await text('list_collections')).text).toContain('Veterinary API');
      expect((await text('list_requests', { collection: 'Veterinary API' })).text).toContain('Get patient');
      const envs = await text('list_environments');
      expect(envs.text).toContain('clientSecret');
      expect(envs.text).not.toContain('demo-secret');
      const token = await text('get_request', { collection: 'Veterinary API', request: 'Get access token' });
      expect(token.text).not.toContain('demo-secret');
      // a saved request runs with its scripts; an ad-hoc one resolves {{variables}}
      const saved = JSON.parse((await text('send_request', { collection: 'Veterinary API', request: 'Health', environment: 'Development' })).text);
      expect(saved.status).toBe('passed');
      const adhoc = JSON.parse((await text('send_request', { method: 'GET', url: '{{baseUrl}}/health', environment: 'Development' })).text);
      expect(adhoc.status).toBe(200);
      const run = JSON.parse((await text('run_collection', { collection: 'Veterinary API', folder: 'Authentication', environment: 'Development' })).text);
      expect(run).toMatchObject({ total: 1, passed: 1 });
      // production environments are refused unless the server allows them
      const prod = await text('send_request', { method: 'GET', url: '{{baseUrl}}/health', environment: 'Production' });
      expect(prod.isError).toBe(true);
      expect(prod.text).toMatch(/production/);
      expect((await text('collection_docs', { collection: 'Veterinary API' })).text).toContain('# Veterinary API');
    } finally {
      await s.close();
    }
    // --read-only hides the tools that send requests
    const ro = new McpSession({ id: 'ro', name: 'protopion-ro', transport: 'stdio', command: process.execPath, args: [cli, 'mcp-server', '-w', ws.root, '--read-only'], env });
    await ro.connect(20_000);
    try {
      expect((await ro.listTools()).map((t) => t.name)).not.toContain('send_request');
    } finally {
      await ro.close();
    }
  });

  it('CLI: `protopion docs` writes Markdown documentation with examples and no secrets', async () => {
    const cli = resolve('packages/cli/bin/protopion.js');
    const r = await run([cli, 'docs', 'Veterinary API', '-w', ws.root], { ...process.env, PROTOPION_HOME: join(dir, 'home') });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Veterinary API');
    expect(r.stdout).toContain('### Get patient');
    expect(r.stdout).toContain('**Example: Patient not found** · `404 Not Found`');
    expect(r.stdout).not.toContain('demo-secret');
  });

  it('CLI: `protopion mock` serves the saved examples of a collection', async () => {
    const cli = resolve('packages/cli/bin/protopion.js');
    const p = spawn(process.execPath, [cli, 'mock', 'Veterinary API', '-w', ws.root, '-q'], { env: { ...process.env, PROTOPION_HOME: join(dir, 'home') } });
    try {
      const url = await new Promise<string>((ok, fail) => {
        let out = '';
        const t = setTimeout(() => fail(new Error(`mock server did not start: ${out}`)), 15_000);
        p.stdout.on('data', (d) => {
          out += d;
          const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out);
          if (m) {
            clearTimeout(t);
            ok(m[1]!);
          }
        });
      });
      const found = await fetch(`${url}/patients/42`);
      expect(found.status).toBe(200);
      expect(await found.json()).toMatchObject({ name: 'Rex' });
      expect((await fetch(`${url}/patients/999`)).status).toBe(404);
      expect((await fetch(`${url}/patients/1`, { headers: { 'x-mock-response-name': 'Patient not found' } })).status).toBe(404);
    } finally {
      p.kill();
    }
  });
});
