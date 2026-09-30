import { afterAll, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpManager, McpSession, ProviderRegistry, Redactor, VariableScope, normalizeTest, runTests, type ExecServices, type McpServerConfig, type TestResult } from '../../packages/core/src/index.js';

const server: McpServerConfig = { id: 'cf', name: 'client-features', transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/mcp-client-features-server.mjs')] };
const sessions: McpSession[] = [];
afterAll(async () => {
  for (const s of sessions) await s.close();
});

describe('MCP client features (roots, sampling, elicitation)', () => {
  it('answers elicitation, sampling and roots with the given handlers', async () => {
    const asked: string[] = [];
    const s = new McpSession(server, undefined, {
      handlers: {
        roots: () => [{ uri: 'file:///clinic', name: 'clinic' }],
        elicitation: async (p) => (asked.push(p.message), { action: 'accept', content: { date: '2026-10-01', urgent: true } }),
        sampling: async (p) => (asked.push(String(p.systemPrompt)), { role: 'assistant', content: { type: 'text', text: 'Rex is limping.' }, model: 'test-model', stopReason: 'endTurn' }),
      },
    });
    sessions.push(s);
    await s.connect(20_000);
    expect((await s.callTool('book_visit', {})).structuredContent).toEqual({ booked: true, date: '2026-10-01', urgent: true });
    expect((await s.callTool('summarize_notes', {})).content).toEqual([{ type: 'text', text: 'summary (test-model): Rex is limping.' }]);
    expect((await s.callTool('list_roots', {})).content).toEqual([{ type: 'text', text: 'file:///clinic' }]);
    expect(asked).toEqual(['When should Rex come in?', 'You are a vet assistant.']);
    // answers can change while connected
    s.setHandlers({ elicitation: async () => ({ action: 'decline' }) });
    expect((await s.callTool('book_visit', {})).content).toEqual([{ type: 'text', text: 'booking declined' }]);
  });

  it('without the capability, the server cannot ask', async () => {
    const s = new McpSession(server);
    sessions.push(s);
    await s.connect(20_000);
    const r = await s.callTool('book_visit', {});
    expect(r.isError).toBe(true);
  });

  it('type: mcp tests answer with fixed replies and record what the server asked', async () => {
    const redactor = new Redactor();
    const vars = new VariableScope();
    vars.setScope('environment', { visitDate: '2026-12-24' });
    const mcp = new McpManager((ref) => (typeof ref === 'string' ? (ref === server.name ? server : undefined) : ref));
    const services = { vars, providers: new ProviderRegistry([], vars, redactor), mcp, mcpServers: [server], redactor, pricing: [], defaultTimeoutMs: 20_000 } as ExecServices;
    const tests = [
      normalizeTest({ name: 'book', type: 'mcp', server: 'client-features', tool: 'book_visit', elicitation: { content: { date: '{{visitDate}}' } }, assertions: [{ type: 'equals', path: '$.date', expected: '2026-12-24' }] }, 'a.yaml'),
      normalizeTest({ name: 'declined', type: 'mcp', server: 'client-features', tool: 'book_visit', elicitation: { action: 'decline' }, assertions: [{ type: 'contains', expected: 'declined' }] }, 'b.yaml'),
      normalizeTest({ name: 'summary', type: 'mcp', server: 'client-features', tool: 'summarize_notes', sampling: 'Rex has a sprain.', assertions: [{ type: 'contains', expected: 'Rex has a sprain.' }] }, 'c.yaml'),
      normalizeTest({ name: 'roots', type: 'mcp', server: 'client-features', tool: 'list_roots', roots: [join('C:', 'clinic')], assertions: [{ type: 'contains', expected: pathToFileURL(join('C:', 'clinic')).href }] }, 'd.yaml'),
    ];
    const results: TestResult[] = [];
    try {
      await runTests({ name: 't', runId: 'r', tests, services, concurrency: 1, onEvent: (e) => e.type === 'test-end' && results.push(e.result) });
    } finally {
      await mcp.close();
    }
    expect(results.map((r) => [r.name, r.status, r.checks.filter((c) => !c.passed).map((c) => c.message).join('; ')])).toEqual([
      ['book', 'passed', ''],
      ['declined', 'passed', ''],
      ['summary', 'passed', ''],
      ['roots', 'passed', ''],
    ]);
    expect((results[0]!.metadata as { serverRequests?: Array<{ kind: string; params: { message: string } }> }).serverRequests?.[0]).toMatchObject({ kind: 'elicitation', params: { message: 'When should Rex come in?' } });
  }, 60_000);
});
