import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  MemorySecretStore,
  WorkspaceManager,
  WorkspaceStore,
  createEngineContext,
  listMonitors,
  loadSuite,
  loadTestsFromFile,
  runTests,
  streamTests,
  validateMonitor,
  type TestCase,
} from '../../packages/core/src/index.js';
import { Backend } from '../../apps/desktop/backend/backend.js';

// The examples workspace ships with the app and opens on first launch (examples/public-workspace).
// Its public-API tests need the internet, so CI checks that every file loads and runs the Offline suite
// (offline demo model + mock MCP server) end to end.
const template = resolve('examples/public-workspace');
const dir = mkdtempSync(join(tmpdir(), 'tp-examples-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

describe('examples workspace (public APIs)', () => {
  const root = join(dir, 'ws');
  cpSync(template, root, { recursive: true });
  const store = WorkspaceStore.open(root);
  afterAll(() => store.close());

  it('has valid collections, environment, providers, MCP servers, saved items and monitors', () => {
    const cols = store.listCollections();
    expect(cols.filter((c) => c.problem)).toEqual([]);
    expect(cols.map((c) => c.id).sort()).toEqual(['graphql-public', 'httpbin', 'jsonplaceholder', 'live-streams', 'petstore']);
    expect(store.getEnvironment('Public APIs')?.variables.some((v) => v.key === 'petstoreMcp')).toBe(true);
    expect(store.getProviders().map((p) => p.id)).toContain('demo');
    expect(store.getMcpServers().map((s) => s.name)).toEqual(['Petstore MCP', 'DeepWiki', 'Weather (offline mock)']);
    expect(store.libraryKinds().sort()).toEqual(['ai-prompts', 'grpc', 'monitors', 'websocket']);
    for (const m of listMonitors(store)) {
      expect(m.enabled).toBe(false); // never hit public APIs on a schedule unless the user turns it on
      validateMonitor(store, m);
    }
  });

  it('every test file and suite loads', async () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
    walk(store.path('tests'));
    let tests = 0;
    for (const f of files) {
      if (f.endsWith('.suite.yaml')) {
        const suite = await loadSuite(f);
        for (const p of suite.tests as string[]) expect(existsSync(join(store.path('tests'), p))).toBe(true);
      } else for await (const _ of loadTestsFromFile(f)) tests++;
    }
    expect(tests).toBeGreaterThan(10);
  });

  it('the Offline suite passes without network', async () => {
    const suite = await loadSuite(store.path('tests', 'offline.suite.yaml'));
    const ctx = createEngineContext({ store, secrets: new MemorySecretStore(), environment: 'Public APIs' });
    try {
      const all: TestCase[] = [];
      for await (const t of streamTests(suite.tests as string[], store.path('tests'))) all.push(t);
      const summary = await runTests({ name: 'offline', runId: 'run-offline', tests: all, services: ctx.services, concurrency: 4, resultsFile: join(dir, 'results.jsonl') });
      expect(summary).toMatchObject({ failed: 0, errors: 0 });
      expect(summary.total).toBeGreaterThanOrEqual(11);
    } finally {
      await ctx.dispose();
    }
  });
});

describe('first launch', () => {
  it('installs the examples workspace, opens it, and never overwrites it later', async () => {
    const home = join(dir, 'home');
    const be = new Backend({ appDir: home, emit: () => undefined, examplesDir: template, noMonitors: true });
    try {
      const cur = (await be.handlers['ws.current']!({})) as { id: string; name: string };
      expect(cur).toMatchObject({ id: 'ws-testpion-examples', name: 'TestPion Examples' });
      expect(new WorkspaceManager(home).list().map((w) => w.name)).toEqual(['My Workspace', 'TestPion Examples']);
      // the copy is the user's: run artefacts from the repo are not copied, and a second install keeps it
      const path = new WorkspaceManager(home).resolve('TestPion Examples')!;
      expect(existsSync(join(path, 'runs', 'monitors'))).toBe(false);
      await be.handlers['ws.openExamples']!({});
      expect(new WorkspaceManager(home).list()).toHaveLength(2);
    } finally {
      await be.dispose();
    }
  });
});
