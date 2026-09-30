import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySecretStore, WorkspaceStore, renameVariable, secretKeys, variableUsages, type Collection, type SavedHttpRequest } from '../../packages/core/src/index.js';

const collection: Collection = {
  schemaVersion: '1.0',
  id: 'shop',
  name: 'Shop',
  version: 1,
  variables: [{ key: 'apiVersion', value: 'v1', enabled: true }],
  updatedAt: new Date(0).toISOString(),
  auth: { type: 'bearer', token: '{{token}}' },
  preRequestScript: "if (!pm.environment.get('token')) console.log('no token');",
  items: [
    {
      kind: 'folder',
      id: 'f',
      name: 'Orders',
      items: [
        {
          kind: 'http',
          id: 'r1',
          name: 'List',
          request: { method: 'GET', url: '{{baseUrl}}/{{apiVersion}}/orders?t={{ token }}', headers: [{ key: 'X-Token', value: '{{token}}', enabled: true }] },
          testScript: "pm.environment.set(\"token\", pm.response.json().next);\npm.environment.set('tokenish', 1);",
        },
        { kind: 'http', id: 'r2', name: 'Other', request: { method: 'GET', url: '{{baseUrl}}/other', body: { type: 'json', content: '{"t":"{{tokenLike}}"}' } } },
      ],
    },
  ],
};

describe('variable usages and rename', () => {
  it('finds every use and renames it everywhere, moving secret values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-rename-'));
    const store = WorkspaceStore.create(join(dir, 'ws'), 'W');
    try {
      store.saveCollection(collection);
      const env = store.saveEnvironment({ id: 'staging', name: 'Staging', variables: [{ key: 'token', value: '', enabled: true, secret: true } as never, { key: 'baseUrl', value: 'https://s.test', enabled: true }] } as never);
      const secrets = new MemorySecretStore();
      await secrets.set(secretKeys.envVar(env.id, 'token'), 'sk-live-1');
      store.writeTestFile('smoke.yaml', 'name: smoke\ntype: http\nrequest:\n  url: "{{baseUrl}}/x"\n  headers:\n    Authorization: "Bearer {{token}}"\n');

      const uses = variableUsages(store, 'token').map((u) => `${u.kind} | ${u.where} | ${u.field}`);
      expect(uses).toEqual(
        expect.arrayContaining([
          'definition | Environment Staging | variable',
          'script | Shop | pre-request script',
          'request | Shop | collection auth',
          'request | Shop › Orders › List | URL',
          'request | Shop › Orders › List | header X-Token',
          'script | Shop › Orders › List | test script',
          'test-file | tests/smoke.yaml | file',
        ]),
      );
      // similar names are not matches
      expect(uses.join('\n')).not.toContain('Other');

      // renaming onto an existing name is refused
      await expect(renameVariable(store, 'token', 'baseUrl', { secrets })).rejects.toThrow(/already defined/);

      const r = await renameVariable(store, 'token', 'accessToken', { secrets });
      expect(r.files).toBe(3);
      expect(variableUsages(store, 'token')).toEqual([]);
      const c = store.listCollections().find((x) => x.id === 'shop')!;
      const list = (c.items[0] as { items: SavedHttpRequest[] }).items[0]!;
      expect(list.request.url).toBe('{{baseUrl}}/{{apiVersion}}/orders?t={{accessToken}}');
      expect(list.request.headers![0]!.value).toBe('{{accessToken}}');
      expect(list.testScript).toBe("pm.environment.set(\"accessToken\", pm.response.json().next);\npm.environment.set('tokenish', 1);");
      expect(c.preRequestScript).toContain("pm.environment.get('accessToken')");
      expect(c.auth).toEqual({ type: 'bearer', token: '{{accessToken}}' });
      expect(store.getEnvironment('Staging')!.variables.map((v) => v.key)).toEqual(['accessToken', 'baseUrl']);
      expect(store.readTestFile('smoke.yaml')).toContain('Bearer {{accessToken}}');
      // the secret moved with it
      expect(secrets.get(secretKeys.envVar(env.id, 'accessToken'))).toBe('sk-live-1');
      expect(secrets.get(secretKeys.envVar(env.id, 'token'))).toBeUndefined();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
