import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { APP_CLAUDE_ID, APP_CLAUDE_SECRET, MemorySecretStore, WorkspaceStore, checkAnthropicKey, createEngineContext, defaultSettings } from '../../packages/core/src/index.js';

let server: Server;
let base: string;
beforeAll(async () => {
  // a stand-in for api.anthropic.com/v1/models: only "sk-ant-good" is accepted
  server = createServer((req, res) => {
    const ok = req.headers['x-api-key'] === 'sk-ant-good' && req.headers['anthropic-version'] && req.url?.startsWith('/v1/models');
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end(ok ? '{"data":[]}' : '{"error":{"type":"authentication_error"}}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe("Claude with the user's API key", () => {
  it('checks the key with Anthropic before it is saved', async () => {
    await expect(checkAnthropicKey('sk-ant-good', { baseUrl: base })).resolves.toBeUndefined();
    await expect(checkAnthropicKey('sk-ant-bad', { baseUrl: base })).rejects.toThrow(/rejected this API key/);
    await expect(checkAnthropicKey('  ', { baseUrl: base })).rejects.toThrow(/Paste an Anthropic API key/);
    await expect(checkAnthropicKey('sk-ant-good', { baseUrl: 'http://127.0.0.1:1' })).rejects.toThrow(/Couldn't reach the Anthropic API/);
  });

  it('is a provider in every workspace once a key is in the secret store, with the chosen model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-claude-'));
    const store = WorkspaceStore.create(join(dir, 'ws'), 'W');
    try {
      const secrets = new MemorySecretStore();
      const without = createEngineContext({ store, secrets });
      expect(without.services.providers.list().map((p) => p.id)).not.toContain(APP_CLAUDE_ID);
      void secrets.set(APP_CLAUDE_SECRET, 'sk-ant-good');
      const settings = { ...defaultSettings(), assistantProvider: APP_CLAUDE_ID, assistantModel: 'claude-sonnet-5-5' };
      const withKey = createEngineContext({ store, secrets, settings });
      const p = withKey.services.providers.list().find((x) => x.id === APP_CLAUDE_ID)!;
      expect(p).toMatchObject({ kind: 'anthropic', defaultModel: 'claude-sonnet-5-5', apiKey: `{{$secret.${APP_CLAUDE_SECRET}}}` });
      // the key itself never lands in workspace files
      const file = store.path('providers.json');
      expect(existsSync(file) ? readFileSync(file, 'utf8') : '').not.toContain('sk-ant-good');
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
