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

  it('pm.test: async functions, done callbacks and pm.test.skip', async () => {
    const out = await runScript(
      `pm.test('async passes', async () => { const r = await pm.sendRequest('http://api.test/x'); pm.expect(r.code).to.equal(200); });
       pm.test('async fails', async () => { throw new Error('nope'); });
       pm.test('done later', function (done) { setTimeout(() => { pm.expect(1).to.equal(1); done(); }, 5); });
       pm.test('done with error', (done) => done(new Error('bad')));
       pm.test('done forgotten', function (done) {});
       pm.test.skip('not yet', () => { throw new Error('should not run'); });`,
      input(),
      { sendRequest: async () => ({ status: 200, headers: [], body: '{}', time: 1 }) as never },
    );
    expect(out.error).toBeUndefined();
    const by = Object.fromEntries(out.tests.map((t) => [t.name, t]));
    expect(by['async passes']!.passed).toBe(true);
    expect(by['async fails']).toMatchObject({ passed: false, message: 'nope' });
    expect(by['done later']!.passed).toBe(true);
    expect(by['done with error']).toMatchObject({ passed: false, message: 'bad' });
    expect(by['done forgotten']).toMatchObject({ passed: false, message: 'done() was not called' });
    expect(by['not yet']).toMatchObject({ passed: true, skipped: true });
  });

  it("more of Postman's modules: ajv, chai, xml2js, csv-parse, atob / btoa", async () => {
    const out = await runScript(
      `const Ajv = require('ajv');
       const validate = new Ajv({ allErrors: true }).compile({ type: 'object', required: ['id'], properties: { id: { type: 'number' } } });
       pm.test('ajv valid', () => pm.expect(validate({ id: 7 })).to.equal(true));
       pm.test('ajv invalid', () => { pm.expect(validate({ id: 'x' })).to.equal(false); pm.expect(validate.errors.length).to.be.above(0); });
       const { expect: e } = require('chai');
       pm.test('chai', () => e([1, 2]).to.have.lengthOf(2));
       require('xml2js').parseString('<a><b>1</b></a>', (err, res) => pm.test('xml2js', () => pm.expect(err).to.equal(null)));
       const parse = require('csv-parse/lib/sync');
       pm.test('csv', () => pm.expect(parse('id,name\\n1,"Rex, the dog"\\n2,Fido\\n', { columns: true, skip_empty_lines: true })).to.eql([{ id: '1', name: 'Rex, the dog' }, { id: '2', name: 'Fido' }]));
       pm.test('base64', () => pm.expect(require('atob')(require('btoa')('vet'))).to.equal('vet'));`,
      input(),
    );
    expect(out.error).toBeUndefined();
    expect(out.tests.filter((t) => !t.passed)).toEqual([]);
    expect(out.tests).toHaveLength(6);
  });

  it('plain synchronous scripts behave as before (timers after the script)', async () => {
    const out = await runScript("const order = []; setTimeout(() => { order.push('t'); pm.environment.set('order', order.join()); }, 5); order.push('s');", input());
    expect(out.scopeSets.environment).toEqual({ order: 's,t' });
  });
});
