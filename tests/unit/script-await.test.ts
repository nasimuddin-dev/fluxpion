import { describe, expect, it } from 'vitest';
import { VariableScope, runScript } from '../../packages/core/src/index.js';

const input = (vars: Record<string, string> = {}) => ({ request: { method: 'GET', url: 'http://x', headers: [] }, vars, environment: vars }) as never;

describe('async scripts', () => {
  it('await pm.sendRequest(…) goes on with the response (replayed across passes)', async () => {
    const sent: string[] = [];
    const out = await runScript(
      `const a = await pm.sendRequest('http://api.test/token');
       const b = await pm.sendRequest({ url: 'http://api.test/me', header: { Authorization: 'Bearer ' + a.json().token } });
       pm.environment.set('who', b.json().name);
       pm.test('both responses', () => pm.expect(b.code).to.equal(200));`,
      input(),
      {
        sendRequest: async (r) => {
          sent.push(`${r.method} ${r.url}`);
          return { status: 200, headers: [], body: r.url.endsWith('/token') ? '{"token":"t1"}' : '{"name":"Ada"}', time: 1 } as never;
        },
      },
    );
    expect(out.error).toBeUndefined();
    expect(sent).toEqual(['GET http://api.test/token', 'GET http://api.test/me']);
    expect(out.scopeSets.environment).toEqual({ who: 'Ada' });
    expect(out.tests).toEqual([{ name: 'both responses', passed: true }]);
  });

  it('a failed request rejects the promise; errors after await keep their line', async () => {
    const out = await runScript("try { await pm.sendRequest('http://down.test'); } catch (e) { pm.test('rejected', () => pm.expect(e.message).to.include('refused')); }\nnull.x;", input(), {
      sendRequest: async () => {
        throw new Error('connection refused');
      },
    });
    expect(out.tests).toEqual([{ name: 'rejected', passed: true }]);
    expect(out.error).toMatch(/TypeError[\s\S]*line 2/);
  });

  it('pm.vault reads and writes (secret) variables; {{vault:key}} resolves them', async () => {
    const out = await runScript("const k = await pm.vault.get('apiKey'); await pm.vault.set('seen', k.length);", input({ apiKey: 'abc123' }));
    expect(out.error).toBeUndefined();
    expect(out.scopeSets.environment).toEqual({ seen: 6 });
    const vars = new VariableScope();
    vars.setScope('environment', { apiKey: 'abc123' });
    expect(vars.resolve('key={{vault:apiKey}}')).toBe('key=abc123');
  });

  it('plain synchronous scripts behave as before (timers after the script)', async () => {
    const out = await runScript("const order = []; setTimeout(() => { order.push('t'); pm.environment.set('order', order.join()); }, 5); order.push('s');", input());
    expect(out.scopeSets.environment).toEqual({ order: 's,t' });
  });
});
