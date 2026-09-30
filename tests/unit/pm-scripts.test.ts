import { describe, expect, it } from 'vitest';
import { runScript } from '../../packages/core/src/index.js';

const response = {
  status: 200,
  headers: [
    ['Content-Type', 'application/json; charset=utf-8'],
    ['X-Request-Id', 'abc'],
  ] as Array<[string, string]>,
  body: JSON.stringify({ items: [{ id: 1, name: 'Rex', tags: ['dog'] }], total: 1, token: 'tok-1' }),
  time: 42,
};

describe('Postman-compatible scripts (pm.*)', () => {
  it('runs Postman "snippets" test scripts', async () => {
    const out = await runScript(
      `pm.test("Status code is 200", function () { pm.response.to.have.status(200); });
       pm.test("Status reason OK", () => pm.response.to.have.status("OK"));
       pm.test("Response time is less than 200ms", function () { pm.expect(pm.response.responseTime).to.be.below(200); });
       pm.test("Content-Type is present", function () { pm.response.to.have.header("Content-Type"); });
       pm.test("Body matches string", function () { pm.expect(pm.response.text()).to.include("Rex"); });
       pm.test("Your test name", function () {
         var jsonData = pm.response.json();
         pm.expect(jsonData.total).to.eql(1);
         pm.expect(jsonData.items).to.be.an('array').that.has.lengthOf(1);
         pm.expect(jsonData.items).to.have.lengthOf.at.least(1);
         pm.expect(jsonData.items).to.have.length.below(5);
         pm.expect(jsonData.items).to.not.have.lengthOf(3);
         pm.expect(jsonData.items[0]).to.have.property('name', 'Rex');
         pm.expect(jsonData.items[0].tags).to.include('dog');
         pm.expect(jsonData).to.have.keys('items', 'total', 'token');
         pm.expect(jsonData.items[0].name).to.be.oneOf(['Rex', 'Max']);
         pm.expect(jsonData.missing).to.be.undefined;
         pm.expect(jsonData.items[0]).to.deep.include({ id: 1 });
         pm.expect(jsonData.total).to.not.equal(2);
       });
       pm.test("Successful POST request", function () { pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]); });
       pm.test("is json + success", () => { pm.response.to.be.json; pm.response.to.be.success; pm.response.to.not.be.error; });
       pm.test("fails", () => pm.expect(1).to.equal(2));
       tests["legacy passes"] = responseCode.code === 200 && JSON.parse(responseBody).total === 1;`,
      { variables: {}, response },
    );
    expect(out.error).toBeUndefined();
    const failed = out.tests.filter((t) => !t.passed);
    expect(failed.map((t) => t.name)).toEqual(['fails']);
    expect(failed[0]!.message).toBe('expected 1 to equal 2');
    expect(out.tests).toHaveLength(10);
  });

  it('reads and writes variable scopes', async () => {
    const out = await runScript(
      `const token = pm.response.json().token;
       pm.environment.set("accessToken", token);
       pm.collectionVariables.set("page", 2);
       pm.globals.unset("old");
       pm.variables.set("local", "x");
       postman.setEnvironmentVariable("legacy", "y");
       pm.test("scopes", () => {
         pm.expect(pm.environment.get("baseUrl")).to.equal("http://env");
         pm.expect(pm.variables.get("baseUrl")).to.equal("http://env");      // environment beats globals
         pm.expect(pm.globals.get("baseUrl")).to.equal("http://global");
         pm.expect(pm.iterationData.get("row")).to.equal(3);
         pm.expect(pm.variables.replaceIn("{{baseUrl}}/p?x={{row}}")).to.equal("http://env/p?x=3");
         pm.expect(pm.info.requestName).to.equal("Get pets");
       });
       postman.setNextRequest("Create pet");`,
      {
        variables: {},
        environment: { baseUrl: 'http://env' },
        globals: { baseUrl: 'http://global', old: 1 },
        iterationData: { row: 3 },
        info: { requestName: 'Get pets' },
        response,
      },
    );
    expect(out.tests).toEqual([{ name: 'scopes', passed: true }]);
    expect(out.scopeSets.environment).toEqual({ accessToken: 'tok-1', legacy: 'y' });
    expect(out.scopeSets.collectionVariables).toEqual({ page: 2 });
    expect(out.scopeUnsets.globals).toEqual(['old']);
    expect(out.vars).toEqual({ local: 'x' });
    expect(out.nextRequest).toBe('Create pet');
  });

  it('modifies the request and computes signatures with CryptoJS', async () => {
    const out = await runScript(
      `const ts = "1700000000";
       const sig = CryptoJS.HmacSHA256(pm.request.body.toString() + ts, "secret").toString(CryptoJS.enc.Base64);
       pm.request.headers.add({ key: "X-Timestamp", value: ts });
       pm.request.headers.upsert({ key: "X-Signature", value: sig });
       pm.request.headers.remove("X-Remove");
       pm.request.url.update(pm.request.url.toString() + "?signed=1");
       pm.environment.set("sha", CryptoJS.SHA256("abc").toString());
       pm.environment.set("b64", btoa("hi") + ":" + atob("aGk="));`,
      { variables: {}, request: { method: 'POST', url: 'https://a.test/x', headers: [{ key: 'X-Remove', value: '1' }], body: '{"a":1}' } },
    );
    expect(out.error).toBeUndefined();
    expect(out.request!.headers.map((h) => h.key)).toEqual(['X-Timestamp', 'X-Signature']);
    expect(out.request!.headers[1]!.value).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(out.request!.url).toBe('https://a.test/x?signed=1');
    expect(out.scopeSets.environment.sha).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(out.scopeSets.environment.b64).toBe('aGk=:hi');
  });

  it('keeps the legacy aps / jest-style API working', async () => {
    const out = await runScript(`aps.test('ok', () => aps.expect(aps.response.json().total).toBe(1)); aps.variables.set('a', 1);`, { variables: {}, response });
    expect(out.tests).toEqual([{ name: 'ok', passed: true }]);
    expect(out.vars).toEqual({ a: 1 });
  });

  it('says when pm.sendRequest has no network access', async () => {
    const out = await runScript(`pm.sendRequest('https://x', () => pm.environment.set('ran', true));`, { variables: {} });
    expect(out.scopeSets.environment).toEqual({});
    expect(out.logs.join(' ')).toMatch(/not available/);
  });

  it('pm.sendRequest: callbacks get real responses, chained calls work, only the last pass counts', async () => {
    const calls: string[] = [];
    const sendRequest = async (req: { method: string; url: string; headers: Array<{ key: string; value: string }>; body?: unknown }) => {
      calls.push(`${req.method} ${req.url} ${JSON.stringify(req.headers)} ${JSON.stringify(req.body ?? null)}`);
      if (req.url.endsWith('/token')) return { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']] as Array<[string, string]>, body: '{"access_token":"t-1"}', time: 5 };
      if (req.url.endsWith('/down')) throw new Error('connect ECONNREFUSED');
      return { status: 201, headers: [] as Array<[string, string]>, body: JSON.stringify({ auth: req.headers.find((h) => h.key === 'Authorization')?.value }), time: 3 };
    };
    const code = `
      console.log('start');
      pm.sendRequest({ url: 'https://api.test/token', method: 'POST', header: { 'Content-Type': 'application/json' }, body: { mode: 'raw', raw: '{"u":"a"}' } }, (err, res) => {
        pm.environment.set('token', res.json().access_token);
        pm.test('token status', () => pm.expect(res.code).to.equal(200));
        pm.sendRequest({ url: 'https://api.test/me', header: [{ key: 'Authorization', value: 'Bearer ' + res.json().access_token }] }, (err2, me) => {
          pm.test('chained', () => pm.expect(me.json().auth).to.equal('Bearer t-1'));
        });
      });
      pm.sendRequest('https://api.test/down', (err, res) => pm.test('network error', () => { pm.expect(err.message).to.include('ECONNREFUSED'); pm.expect(res).to.equal(null); }));
    `;
    const out = await runScript(code, { variables: {} }, { sendRequest });
    expect(out.error).toBeUndefined();
    // callbacks run synchronously, so a chained request's callback runs inside its parent's
    expect(out.tests).toEqual([
      { name: 'token status', passed: true },
      { name: 'chained', passed: true },
      { name: 'network error', passed: true },
    ]);
    expect(out.scopeSets.environment).toEqual({ token: 't-1' });
    expect(out.logs).toEqual(['start']);
    expect(calls).toEqual([
      'POST https://api.test/token [{"key":"Content-Type","value":"application/json"}] "{\\"u\\":\\"a\\"}"',
      'GET https://api.test/down [] null',
      'GET https://api.test/me [{"key":"Authorization","value":"Bearer t-1"}] null',
    ]);
    expect(out.sentRequests?.map((r) => r.status ?? r.error)).toEqual([200, 'connect ECONNREFUSED', 201]);
  });

  it('pm.sendRequest: stops runaway scripts', async () => {
    const sendRequest = async () => ({ status: 200, headers: [] as Array<[string, string]>, body: '{}' });
    const out = await runScript(`function go(n) { pm.sendRequest('https://x.test/' + n, () => go(n + 1)); } go(0);`, { variables: {} }, { sendRequest, maxRequests: 5 });
    expect(out.error).toMatch(/more than 5 requests/);
  });

  it('pm.variables.replaceIn fills dynamic variables ($randomFirstName, $guid …)', async () => {
    const out = await runScript(
      `const s = pm.variables.replaceIn("{{$randomFirstName}}|{{$guid}}|{{$randomInt(3,3)}}|{{$nope}}|{{name}}");
       pm.environment.set("s", s);`,
      { variables: { name: 'Rex' } },
    );
    expect(out.error).toBeUndefined();
    const [first, guid, n, nope, name] = String(out.scopeSets.environment.s).split('|');
    expect(first).toMatch(/^[A-Z]/);
    expect(guid).toMatch(/^[0-9a-f-]{36}$/);
    expect([n, nope, name]).toEqual(['3', '{{$nope}}', 'Rex']);
  });
});
