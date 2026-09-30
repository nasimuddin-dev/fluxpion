import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { McpSession } from '../../packages/core/src/index.js';

const s = new McpSession({ id: 'cp', name: 'completions', transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/mcp-completions-server.mjs')] });
beforeAll(() => s.connect(20_000));
afterAll(() => s.close());

describe('MCP completions and resource subscriptions', () => {
  it('suggests prompt arguments and resource template parameters', async () => {
    expect((await s.complete({ type: 'ref/prompt', name: 'triage' }, { name: 'species', value: 'ca' })).values).toEqual(['cat', 'cattle']);
    expect((await s.complete({ type: 'ref/resource', uri: 'patient://{id}' }, { name: 'id', value: '7' })).values).toEqual(['7', '70']);
    // an argument without completions
    expect((await s.complete({ type: 'ref/prompt', name: 'triage' }, { name: 'symptom', value: 'x' })).values).toEqual([]);
  });

  it('tells when a subscribed resource changes', async () => {
    const updated: string[] = [];
    s.onResourceUpdated((uri) => updated.push(uri));
    await s.callTool('add_visit', {});
    expect(updated).toEqual([]);
    await s.subscribeResource('clinic://visits');
    await s.callTool('add_visit', {});
    await new Promise((r) => setTimeout(r, 100));
    expect(updated).toEqual(['clinic://visits']);
    await s.unsubscribeResource('clinic://visits');
    await s.callTool('add_visit', {});
    await new Promise((r) => setTimeout(r, 100));
    expect(updated).toHaveLength(1);
  });

  it('says when a server has no subscriptions or completions', async () => {
    const plain = new McpSession({ id: 'cf', name: 'cf', transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/mcp-client-features-server.mjs')] });
    await plain.connect(20_000);
    try {
      await expect(plain.subscribeResource('x://y')).rejects.toThrow(/does not support resource subscriptions/);
      expect(await plain.complete({ type: 'ref/prompt', name: 'p' }, { name: 'a', value: '' })).toEqual({ values: [] });
    } finally {
      await plain.close();
    }
  });
});
