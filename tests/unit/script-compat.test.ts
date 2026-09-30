import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, importIntoWorkspace } from '../../packages/core/src/index.js';

const collection = {
  info: { name: 'Legacy', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  event: [{ listen: 'prerequest', script: { exec: ["const token = await pm.vault.get('token');"] } }],
  item: [
    {
      name: 'Pages',
      item: [
        {
          name: 'Home',
          request: { method: 'GET', url: 'https://example.test/' },
          event: [{ listen: 'test', script: { exec: ["const $ = cheerio.load(pm.response.text());", "const f = require('node-fetch');", "const _ = require('lodash');", "const m = require('moment');"] } }],
        },
      ],
    },
    { name: 'Fine', request: { method: 'GET', url: 'https://example.test/ok' }, event: [{ listen: 'test', script: { exec: ["pm.test('ok', () => pm.response.to.have.status(200));", "const j = xml2Json(pm.response.text());"] } }] },
  ],
};

describe('script compatibility on import', () => {
  it('lists script APIs the sandbox does not have, per request', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-compat-'));
    const store = WorkspaceStore.create(join(dir, 'ws'), 'W');
    try {
      const r = importIntoWorkspace(store, JSON.stringify(collection));
      // pm.vault and cheerio work, so only the unknown module is listed
      expect(r.scriptWarnings?.map((w) => [w.where, w.script, w.api])).toEqual([['Pages / Home', 'test', "require('node-fetch')"]]);
      expect(r.scriptWarnings![0]!.hint).toContain('lodash');
      // a collection without problems has no warnings
      const clean = importIntoWorkspace(store, JSON.stringify({ ...collection, event: [], item: [collection.item[1]] }));
      expect(clean.scriptWarnings).toBeUndefined();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
