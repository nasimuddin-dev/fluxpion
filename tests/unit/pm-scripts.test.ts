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

  it('validates JSON schemas for real (pm.response, pm.expect, tv4)', async () => {
    const good = { type: 'object', required: ['items', 'total'], properties: { total: { type: 'integer' }, items: { type: 'array', items: { required: ['id', 'name'] } } } };
    const bad = { type: 'object', required: ['missing'], properties: { total: { type: 'string' } } };
    const out = await runScript(
      `const good = ${JSON.stringify(good)}, bad = ${JSON.stringify(bad)};
       pm.test("response matches", () => pm.response.to.have.jsonSchema(good));
       pm.test("response mismatch", () => pm.response.to.have.jsonSchema(bad));
       pm.test("expect matches", () => pm.expect(pm.response.json().items[0]).to.have.jsonSchema({ type: "object", properties: { id: { type: "number" } } }));
       pm.test("expect mismatch", () => pm.expect({ id: "x" }).to.have.jsonSchema({ properties: { id: { type: "number" } } }));
       const tv4 = require("tv4");
       pm.test("tv4", () => { pm.expect(tv4.validate(pm.response.json(), good)).to.be.true; pm.expect(tv4.validate({}, bad)).to.be.false; pm.expect(tv4.error.message).to.include("missing"); });`,
      { variables: {}, response },
    );
    expect(out.error).toBeUndefined();
    expect(out.tests.map((t) => [t.name, t.passed])).toEqual([
      ['response matches', true],
      ['response mismatch', false],
      ['expect matches', true],
      ['expect mismatch', false],
      ['tv4', true],
    ]);
    expect(out.tests[1]!.message).toMatch(/must have required property 'missing'/);
  });

  it('has lodash like Postman (_ and require("lodash")), loaded only when used', async () => {
    const out = await runScript(
      `const lodash = require("lodash");
       const items = pm.response.json().items;
       pm.test("lodash", () => {
         pm.expect(_.get(pm.response.json(), "items[0].tags[0]")).to.equal("dog");
         pm.expect(lodash.map(items, "name")).to.eql(["Rex"]);
         pm.expect(_.sortBy([3, 1, 2])).to.eql([1, 2, 3]);
         pm.expect(_.isEqual({ a: [1] }, { a: [1] })).to.be.true;
       });`,
      { variables: {}, response },
    );
    expect(out.error).toBeUndefined();
    expect(out.tests).toEqual([expect.objectContaining({ name: 'lodash', passed: true })]);
    const plain = await runScript(`pm.test("no lodash", () => pm.expect(typeof _).to.equal("undefined"));`, { variables: {}, response });
    expect(plain.tests[0]!.passed).toBe(true);
    expect(out.durationMs).toBeLessThan(1500);
  });

  it('has moment like Postman (UTC)', async () => {
    const out = await runScript(
      `const m = require("moment");
       const t = moment("2024-01-31T10:05:09.007Z");
       const r = {
         fmt: t.format("YYYY-MM-DD HH:mm:ss.SSS"),
         long: t.format("dddd, MMMM Do YYYY, h:mm a [Q]Q"),
         iso: t.clone().add(1, "month").toISOString(),
         leap: moment("2024-02-29").add(1, "y").format("YYYY-MM-DD"),
         sub: t.clone().subtract({ days: 1, hours: 2 }).format(),
         start: t.clone().startOf("month").toISOString(),
         end: t.clone().endOf("day").toISOString(),
         diffDays: moment("2024-03-01").diff(moment("2024-02-01"), "days"),
         diffMonths: moment("2024-03-15").diff("2024-01-15", "months"),
         parsed: moment("31/12/2023 23:59", "DD/MM/YYYY HH:mm").toISOString(),
         unix: moment.unix(1700000000).format("YYYY-MM-DD"),
         before: t.isBefore("2025-01-01") && t.isSame("2024-01-31T23:00:00Z", "day"),
         same: m === moment,
         now: Math.abs(moment().valueOf() - Date.now()) < 5000,
       };
       pm.environment.set("r", JSON.stringify(r));`,
      { variables: {} },
    );
    expect(out.error).toBeUndefined();
    expect(JSON.parse(String(out.scopeSets.environment.r))).toEqual({
      fmt: '2024-01-31 10:05:09.007',
      long: 'Wednesday, January 31st 2024, 10:05 am Q1',
      iso: '2024-02-29T10:05:09.007Z',
      leap: '2025-02-28',
      sub: '2024-01-30T08:05:09Z',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-01-31T23:59:59.999Z',
      diffDays: 29,
      diffMonths: 2,
      parsed: '2023-12-31T23:59:00.000Z',
      unix: '2023-11-14',
      before: true,
      same: true,
      now: true,
    });
  });
});
