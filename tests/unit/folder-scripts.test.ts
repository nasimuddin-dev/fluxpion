import { describe, expect, it } from 'vitest';
import {
  collectionRequests,
  collectionRequestToTest,
  folderChain,
  folderVariables,
  McpManager,
  MemorySecretStore,
  ProviderRegistry,
  Redactor,
  runCollection,
  VariableScope,
  type Collection,
  type ExecServices,
  type RunEvent,
} from '../../packages/core/src/index.js';

const collection: Collection = {
  schemaVersion: '1.0',
  id: 'c',
  name: 'C',
  version: 1,
  variables: [{ key: 'who', value: 'collection' }],
  preRequestScript: "pm.variables.set('order', 'collection');",
  testScript: "pm.test('collection test', () => {});",
  updatedAt: '',
  items: [
    {
      kind: 'folder',
      id: 'outer',
      name: 'Outer',
      variables: [
        { key: 'who', value: 'outer' },
        { key: 'depth', value: '1' },
      ],
      preRequestScript: "pm.variables.set('order', pm.variables.get('order') + ' > outer');",
      items: [
        {
          kind: 'folder',
          id: 'inner',
          name: 'Inner',
          variables: [
            { key: 'depth', value: '2' },
            { key: 'off', value: 'x', enabled: false },
          ],
          preRequestScript: "pm.variables.set('order', pm.variables.get('order') + ' > inner');",
          testScript: "pm.test('inner folder test', () => pm.expect(pm.variables.get('depth')).to.equal('2'));",
          items: [
            {
              kind: 'http',
              id: 'r',
              name: 'R',
              // unreachable host: the request fails fast, the scripts still run
              request: { method: 'GET', url: 'http://127.0.0.1:9/{{who}}/{{depth}}' },
              preRequestScript: "pm.variables.set('order', pm.variables.get('order') + ' > request'); pm.environment.set('seen', pm.variables.get('order'));",
              testScript: "pm.test('request test', () => {});",
            },
          ],
        },
      ],
    },
  ],
};

describe('folder-level scripts and variables', () => {
  it('finds the folder chain and merges variables (inner wins, disabled skipped)', () => {
    expect(folderChain(collection, 'r').map((f) => f.name)).toEqual(['Outer', 'Inner']);
    expect(folderChain(collection, 'nope')).toEqual([]);
    expect(folderVariables(folderChain(collection, 'r'))).toEqual({ who: 'outer', depth: '2' });
  });

  it('joins scripts collection → outer → inner → request, and data rows override folder variables', () => {
    const [ref] = collectionRequests(collection);
    const t = collectionRequestToTest(collection, ref!, { data: { depth: 'from-data' } });
    expect(t.variables).toEqual({ who: 'outer', depth: 'from-data' });
    if (t.type !== 'http') throw new Error('expected http');
    const pre = t.preRequestScript!;
    expect(pre.indexOf("'collection'")).toBeLessThan(pre.indexOf("' > outer'"));
    expect(pre.indexOf("' > outer'")).toBeLessThan(pre.indexOf("' > inner'"));
    expect(pre.indexOf("' > inner'")).toBeLessThan(pre.indexOf("' > request'"));
    expect(t.testScript).toContain('inner folder test');
  });

  it('runs them in that order in the Collection Runner', async () => {
    const vars = new VariableScope(new MemorySecretStore(), new Redactor());
    vars.setScope('collection', collection.variables);
    const redactor = new Redactor();
    const svc: ExecServices = { vars, providers: new ProviderRegistry([], vars, redactor), mcp: new McpManager(() => undefined, redactor), mcpServers: [], redactor, pricing: [], defaultTimeoutMs: 3000 };
    const results: Array<{ checks: Array<{ name?: string; passed: boolean }> }> = [];
    await runCollection({ name: 'folders', collection, services: svc, onEvent: (e: RunEvent) => e.type === 'test-end' && results.push(e.result) });
    expect(vars.scopeValues('environment')).toMatchObject({ seen: 'collection > outer > inner > request' });
    const names = results[0]!.checks.filter((c) => c.passed).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['collection test', 'inner folder test', 'request test']));
  });
});
