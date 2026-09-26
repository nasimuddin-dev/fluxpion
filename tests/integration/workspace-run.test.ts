import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

  it('CLI: `protolens run` exits 0 and writes all report formats', async () => {
    const cli = resolve('packages/cli/bin/protolens.js');
    const out = join(dir, 'cli-out');
    const r = await run([cli, 'run', '-w', ws.root, '--suite', 'smoke', '-o', out, '-q'], { ...process.env, PROTOLENS_HOME: join(dir, 'home') });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(readFileSync(join(out, 'junit.xml'), 'utf8')).toContain('tests="4"');
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).summary.passed).toBe(4);
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('Smoke');
    expect(readFileSync(join(out, 'report.html'), 'utf8')).toContain('PASSED');
    const bad = await run([cli, 'test', join(dir, 'does-not-exist')], { ...process.env, PROTOLENS_HOME: join(dir, 'home') });
    expect(bad.status).toBe(2);
  });
});
