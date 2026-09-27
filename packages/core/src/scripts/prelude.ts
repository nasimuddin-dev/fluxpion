/**
 * JavaScript that runs inside the QuickJS sandbox before every user script. It implements the
 * scripting API: Postman-compatible `pm.*` (chai-style `pm.expect`, `pm.response.to.have.status`,
 * variable scopes, `pm.request`, `pm.info`, `postman.setNextRequest`, `CryptoJS`) plus the older
 * `aps.*` alias with jest-style `expect(x).toBe(y)`.
 *
 * Only JSON crosses the sandbox boundary: `__input_json` in, `JSON.stringify(__out)` out. The host
 * functions are pure helpers (hash, HMAC, base64, uuid).
 */
export const PRELUDE = String.raw`
const __in = JSON.parse(__input_json);
const __out = {
  vars: {}, unset: [], tests: [], logs: [], request: __in.request || null, error: null,
  scopeSets: { environment: {}, globals: {}, collectionVariables: {} },
  scopeUnsets: { environment: [], globals: [], collectionVariables: [] },
  nextRequest: undefined, jarOps: [],
};
const __fmt = (v) => { try { return v === undefined ? 'undefined' : JSON.stringify(v); } catch (e) { return String(v); } };
const __deepEq = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => __deepEq(a[k], b[k]));
};
const __typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : v instanceof RegExp ? 'regexp' : typeof v);

/* ---------------- variable scopes ---------------- */
// merged view: globals < collection < environment < data < local (runtime)
const __scopes = {
  globals: Object.assign({}, __in.globals || {}),
  collectionVariables: Object.assign({}, __in.collectionVariables || {}),
  environment: Object.assign({}, __in.environment || {}),
  iterationData: Object.assign({}, __in.iterationData || {}),
};
const __local = Object.assign({}, __in.variables || {});
function __resolve(key) {
  if (Object.prototype.hasOwnProperty.call(__local, key)) return __local[key];
  for (const s of ['iterationData', 'environment', 'collectionVariables', 'globals'])
    if (Object.prototype.hasOwnProperty.call(__scopes[s], key)) return __scopes[s][key];
  return undefined;
}
function __replaceIn(str) {
  return String(str).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => { const v = __resolve(k.trim()); return v === undefined ? m : typeof v === 'object' ? JSON.stringify(v) : String(v); });
}
function __scope(name) {
  const store = __scopes[name];
  return {
    get: (k) => store[k],
    set: (k, v) => { store[k] = v; __local[k] = v; __out.scopeSets[name][k] = v; },
    unset: (k) => { delete store[k]; delete __local[k]; __out.scopeUnsets[name].push(k); },
    has: (k) => Object.prototype.hasOwnProperty.call(store, k),
    clear: () => { for (const k of Object.keys(store)) { delete store[k]; __out.scopeUnsets[name].push(k); } },
    toObject: () => Object.assign({}, store),
    replaceIn: __replaceIn,
    name,
  };
}
const __variables = {
  get: (k) => __resolve(k),
  set: (k, v) => { __local[k] = v; __out.vars[k] = v; },
  unset: (k) => { delete __local[k]; __out.unset.push(k); },
  has: (k) => __resolve(k) !== undefined,
  toObject: () => Object.assign({}, __scopes.globals, __scopes.collectionVariables, __scopes.environment, __scopes.iterationData, __local),
  replaceIn: __replaceIn,
};

/* ---------------- chai-style assertions ---------------- */
function __chai(actual, state) {
  const st = Object.assign({ neg: false, deep: false, own: false }, state || {});
  const self = {};
  const assert = (cond, msg, negMsg) => {
    if (st.neg ? cond : !cond) throw new Error(st.neg ? (negMsg || 'expected not: ' + msg) : msg);
    return self;
  };
  const S = __fmt(actual);
  const chainWords = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also'];
  for (const w of chainWords) Object.defineProperty(self, w, { get: () => self });
  Object.defineProperty(self, 'not', { get: () => __chai(actual, Object.assign({}, st, { neg: !st.neg })) });
  Object.defineProperty(self, 'deep', { get: () => __chai(actual, Object.assign({}, st, { deep: true })) });
  Object.defineProperty(self, 'own', { get: () => __chai(actual, Object.assign({}, st, { own: true })) });
  const flag = (name, cond, msg) => Object.defineProperty(self, name, { get: () => assert(cond(), msg) });
  flag('true', () => actual === true, 'expected ' + S + ' to be true');
  flag('false', () => actual === false, 'expected ' + S + ' to be false');
  flag('null', () => actual === null, 'expected ' + S + ' to be null');
  flag('undefined', () => actual === undefined, 'expected ' + S + ' to be undefined');
  flag('NaN', () => Number.isNaN(actual), 'expected ' + S + ' to be NaN');
  flag('ok', () => !!actual, 'expected ' + S + ' to be truthy');
  flag('exist', () => actual !== null && actual !== undefined, 'expected value to exist');
  flag('empty', () => (typeof actual === 'string' || Array.isArray(actual) ? actual.length === 0 : actual && typeof actual === 'object' ? Object.keys(actual).length === 0 : false), 'expected ' + S + ' to be empty');
  const typeCheck = (t) => assert(__typeOf(actual) === String(t).toLowerCase(), 'expected ' + S + ' to be a ' + t);
  self.a = typeCheck; self.an = typeCheck;
  const eq = (v) => (st.deep ? assert(__deepEq(actual, v), 'expected ' + S + ' to deeply equal ' + __fmt(v)) : assert(actual === v, 'expected ' + S + ' to equal ' + __fmt(v)));
  self.equal = eq; self.equals = eq; self.eq = eq;
  self.eql = (v) => assert(__deepEq(actual, v), 'expected ' + S + ' to deeply equal ' + __fmt(v));
  self.above = self.gt = self.greaterThan = (n) => assert(actual > n, 'expected ' + S + ' to be above ' + n);
  self.below = self.lt = self.lessThan = (n) => assert(actual < n, 'expected ' + S + ' to be below ' + n);
  self.least = self.gte = (n) => assert(actual >= n, 'expected ' + S + ' to be at least ' + n);
  self.most = self.lte = (n) => assert(actual <= n, 'expected ' + S + ' to be at most ' + n);
  self.within = (a, b) => assert(actual >= a && actual <= b, 'expected ' + S + ' to be within ' + a + '..' + b);
  const inc = (v) => {
    let ok = false;
    if (typeof actual === 'string') ok = actual.indexOf(v) >= 0;
    else if (Array.isArray(actual)) ok = actual.some((x) => (st.deep || typeof v === 'object' ? __deepEq(x, v) : x === v));
    else if (actual && typeof actual === 'object' && v && typeof v === 'object') ok = Object.keys(v).every((k) => __deepEq(actual[k], v[k]));
    return assert(ok, 'expected ' + S + ' to include ' + __fmt(v));
  };
  self.include = inc; self.includes = inc; self.contain = inc; self.contains = inc;
  self.property = function (name, val) {
    const has = actual !== null && actual !== undefined && (st.own ? Object.prototype.hasOwnProperty.call(Object(actual), name) : name in Object(actual));
    if (arguments.length > 1) {
      assert(has && (st.deep ? __deepEq(actual[name], val) : actual[name] === val), 'expected ' + S + ' to have property ' + name + ' of ' + __fmt(val));
    } else assert(has, 'expected ' + S + ' to have property ' + __fmt(name));
    return st.neg ? self : __chai(actual[name]);
  };
  self.ownProperty = (name) => assert(actual !== null && actual !== undefined && Object.prototype.hasOwnProperty.call(Object(actual), name), 'expected ' + S + ' to have own property ' + name);
  /* chainable like chai: .lengthOf(3) or .lengthOf.at.least(1) / .above(n) / .within(a, b) */
  const lengthOf = () => {
    const len = actual !== null && actual !== undefined ? (actual instanceof Map || actual instanceof Set ? actual.size : actual.length) : undefined;
    const fn = (n) => assert(len === n, 'expected ' + S + ' to have length ' + n + ' but got ' + len);
    const sub = __chai(len, st);
    for (const k of ['above', 'gt', 'greaterThan', 'below', 'lt', 'lessThan', 'least', 'gte', 'most', 'lte', 'within', 'equal', 'eq']) fn[k] = sub[k];
    for (const w of ['at', 'be', 'is', 'of']) Object.defineProperty(fn, w, { get: () => fn });
    return fn;
  };
  Object.defineProperty(self, 'lengthOf', { get: lengthOf });
  Object.defineProperty(self, 'length', { get: lengthOf });
  self.match = (re) => assert(new RegExp(re).test(String(actual)), 'expected ' + S + ' to match ' + re);
  self.string = (s) => assert(String(actual).indexOf(s) >= 0, 'expected ' + S + ' to contain ' + __fmt(s));
  self.oneOf = (arr) => assert(arr.some((x) => __deepEq(x, actual)), 'expected ' + S + ' to be one of ' + __fmt(arr));
  self.keys = function () {
    const want = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
    return assert(actual && want.every((k) => Object.prototype.hasOwnProperty.call(actual, k)), 'expected ' + S + ' to have keys ' + __fmt(want));
  };
  self.members = (arr) => assert(Array.isArray(actual) && arr.every((m) => actual.some((x) => __deepEq(x, m))), 'expected ' + S + ' to have members ' + __fmt(arr));
  self.instanceOf = (C) => assert(actual instanceof C, 'expected instance');
  self.satisfy = (fn) => assert(!!fn(actual), 'expected ' + S + ' to satisfy the predicate');
  self.status = (code) => assert(actual && (actual.code === code || actual.status === code), 'expected status ' + code);
  /* jest-style aliases so expect(x).toBe(y) keeps working */
  self.toBe = (e) => assert(actual === e, 'expected ' + S + ' to be ' + __fmt(e));
  self.toEqual = (e) => assert(__deepEq(actual, e), 'expected ' + S + ' to equal ' + __fmt(e));
  self.toContain = (e) => inc(e);
  self.toMatch = (re) => self.match(re);
  self.toBeTruthy = () => assert(!!actual, 'expected ' + S + ' to be truthy');
  self.toBeFalsy = () => assert(!actual, 'expected ' + S + ' to be falsy');
  self.toBeDefined = () => assert(actual !== undefined, 'expected value to be defined');
  self.toBeUndefined = () => assert(actual === undefined, 'expected value to be undefined');
  self.toBeNull = () => assert(actual === null, 'expected ' + S + ' to be null');
  self.toBeGreaterThan = (n) => assert(actual > n, 'expected ' + S + ' > ' + n);
  self.toBeLessThan = (n) => assert(actual < n, 'expected ' + S + ' < ' + n);
  self.toHaveProperty = (k) => assert(actual != null && Object(actual)[k] !== undefined, 'expected object to have property ' + k);
  self.toHaveLength = (n) => assert(actual != null && actual.length === n, 'expected length ' + n + ', got ' + (actual && actual.length));
  return self;
}
const expect = (v) => __chai(v);

/* ---------------- request ---------------- */
function __headerList(list) {
  const arr = list;
  const find = (k) => arr.findIndex((h) => String(h.key).toLowerCase() === String(k).toLowerCase());
  return {
    get: (k) => { const i = find(k); return i >= 0 ? arr[i].value : undefined; },
    has: (k) => find(k) >= 0,
    add: (h) => { arr.push({ key: h.key, value: String(h.value) }); },
    push: (h) => { arr.push({ key: h.key, value: String(h.value) }); },
    upsert: (h) => { const i = find(h.key); if (i >= 0) arr[i].value = String(h.value); else arr.push({ key: h.key, value: String(h.value) }); },
    remove: (k) => { const i = find(k); if (i >= 0) arr.splice(i, 1); },
    each: (fn) => arr.forEach(fn),
    toObject: () => { const o = {}; arr.forEach((h) => { o[h.key] = h.value; }); return o; },
    all: () => arr.slice(),
    count: () => arr.length,
  };
}
let __request;
if (__out.request) {
  const r = __out.request;
  r.headers = r.headers || [];
  __request = {
    get method() { return r.method; },
    set method(m) { r.method = String(m).toUpperCase(); },
    url: { toString: () => r.url, update: (u) => { r.url = String(u); }, getHost: () => (/^[a-z]+:\/\/([^/:?#]+)/i.exec(r.url) || [])[1] },
    headers: __headerList(r.headers),
    addHeader: (h) => __headerList(r.headers).add(h),
    removeHeader: (k) => __headerList(r.headers).remove(k),
    get body() { return { raw: r.body, mode: 'raw', toString: () => r.body || '', update: (b) => { r.body = typeof b === 'string' ? b : JSON.stringify(b); } }; },
  };
}

/* ---------------- response ---------------- */
let __response;
if (__in.response) {
  const res = __in.response;
  const hdrs = (res.headers || []).map((h) => ({ key: h[0], value: h[1] }));
  const code = res.status;
  const reasons = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };
  const jsonBody = () => JSON.parse(res.body || 'null');
  const respAssert = (neg) => {
    const a = (cond, msg) => { if (neg ? cond : !cond) throw new Error((neg ? 'expected not: ' : '') + msg); return chain; };
    const chain = {};
    ['to', 'have', 'be', 'and', 'a', 'an'].forEach((w) => Object.defineProperty(chain, w, { get: () => chain }));
    Object.defineProperty(chain, 'not', { get: () => respAssert(!neg) });
    chain.status = (s) => (typeof s === 'number' ? a(code === s, 'expected response to have status code ' + s + ' but got ' + code) : a(String(reasons[code] || '').toLowerCase() === String(s).toLowerCase(), 'expected response to have status reason ' + s));
    chain.header = (k, v) => { const h = hdrs.find((x) => x.key.toLowerCase() === String(k).toLowerCase()); return v === undefined ? a(!!h, 'expected response to have header ' + k) : a(!!h && h.value === String(v), 'expected header ' + k + ' to be ' + v + ' but got ' + (h && h.value)); };
    chain.body = (b) => (b === undefined ? a(!!res.body, 'expected response to have a body') : a(typeof b === 'string' ? res.body === b : __deepEq(jsonBody(), b), 'expected response body to match'));
    chain.jsonBody = (path, val) => { let j; try { j = jsonBody(); } catch (e) { return a(false, 'expected response body to be JSON'); } if (path === undefined) return a(true, ''); const v = String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), j); return val === undefined ? a(v !== undefined, 'expected JSON body to have ' + path) : a(__deepEq(v, val), 'expected JSON body ' + path + ' to equal ' + __fmt(val)); };
    chain.jsonSchema = () => a(true, '');
    chain.responseTime = { below: (n) => a((res.time || 0) < n, 'expected response time below ' + n + 'ms') };
    const flag = (n, cond, msg) => Object.defineProperty(chain, n, { get: () => a(cond(), msg) });
    flag('ok', () => code === 200, 'expected response to be ok (200) but got ' + code);
    flag('success', () => code >= 200 && code < 300, 'expected a 2xx response but got ' + code);
    flag('info', () => code >= 100 && code < 200, 'expected a 1xx response');
    flag('redirection', () => code >= 300 && code < 400, 'expected a 3xx response');
    flag('error', () => code >= 400, 'expected an error response but got ' + code);
    flag('clientError', () => code >= 400 && code < 500, 'expected a 4xx response but got ' + code);
    flag('serverError', () => code >= 500, 'expected a 5xx response but got ' + code);
    flag('accepted', () => code === 202, 'expected 202');
    flag('badRequest', () => code === 400, 'expected 400');
    flag('unauthorized', () => code === 401, 'expected 401');
    flag('forbidden', () => code === 403, 'expected 403');
    flag('notFound', () => code === 404, 'expected 404');
    flag('rateLimited', () => code === 429, 'expected 429');
    flag('json', () => { try { jsonBody(); return true; } catch (e) { return false; } }, 'expected response body to be JSON');
    flag('withBody', () => !!res.body, 'expected response to have a body');
    return chain;
  };
  __response = {
    code, status: reasons[code] || '', responseTime: res.time, responseSize: (res.body || '').length,
    headers: __headerList(hdrs),
    json: jsonBody, text: () => res.body || '',
    body: res.body,
    header(name) { return this.headers.get(name); },
    cookies: { get: (n) => (__in.cookies || {})[n], has: (n) => Object.prototype.hasOwnProperty.call(__in.cookies || {}, n), toObject: () => Object.assign({}, __in.cookies || {}) },
    get to() { return respAssert(false).to; },
  };
}

/* ---------------- cookie jar ---------------- */
// pm.cookies.jar(): a copy of the workspace jar; changes are recorded in __out.jarOps and applied by the host.
// Postman's jar methods are callback based; the callback runs synchronously here and the value is also returned.
const __jar = (__in.jar || []).map((c) => Object.assign({}, c));
const __hostOf = (u) => { const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/:?#]+)/i.exec(String(u)); return m ? m[1].toLowerCase() : ''; };
const __jarMatch = (host, c) => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain));
const __cb = (cb, err, v) => { if (typeof cb === 'function') cb(err, v); return v; };
const __cookieView = (c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, secure: !!c.secure, httpOnly: !!c.httpOnly });
function __cookieJar() {
  return {
    get(url, name, cb) { const h = __hostOf(url); const c = __jar.find((x) => x.name === name && __jarMatch(h, x)); return __cb(cb, null, c ? c.value : undefined); },
    getAll(url, cb) { const h = __hostOf(url); return __cb(cb, null, __jar.filter((x) => __jarMatch(h, x)).map(__cookieView)); },
    set(url, name, value, cb) {
      if (name && typeof name === 'object') { cb = value; value = name.value; name = name.name; }
      if (typeof value === 'function') { cb = value; value = ''; }
      const h = __hostOf(url);
      const c = { name: String(name), value: String(value == null ? '' : value), domain: h, path: '/', hostOnly: true };
      const i = __jar.findIndex((x) => x.name === c.name && x.domain === h && x.path === '/');
      if (i >= 0) __jar[i] = c; else __jar.push(c);
      __out.jarOps.push({ op: 'set', url: String(url), name: c.name, value: c.value });
      return __cb(cb, null, __cookieView(c));
    },
    unset(url, name, cb) {
      const h = __hostOf(url);
      for (let i = __jar.length - 1; i >= 0; i--) if (__jar[i].name === name && __jar[i].domain === h) __jar.splice(i, 1);
      __out.jarOps.push({ op: 'unset', url: String(url), name: String(name) });
      return __cb(cb, null);
    },
    clear(url, cb) {
      const h = __hostOf(url);
      for (let i = __jar.length - 1; i >= 0; i--) if (__jar[i].domain === h) __jar.splice(i, 1);
      __out.jarOps.push({ op: 'clear', url: String(url) });
      return __cb(cb, null);
    },
  };
}

/* ---------------- pm.sendRequest ---------------- */
// The sandbox is synchronous, so requests are replayed: on the first pass a call is recorded in
// __out.pendingRequests and its callback does not run; the host sends it and runs the script again
// with the response in __in.sent, and this time the callback runs straight away with it.
// responses are keyed by request signature + occurrence, so calls added by callbacks don't shift them
const __sendSeen = {};
const __sent = __in.sent || [];
__out.pendingRequests = [];
function __normRequest(req) {
  if (typeof req === 'string') return { method: 'GET', url: req, headers: [], body: undefined };
  const r = req || {};
  const url = typeof r.url === 'string' ? r.url : r.url && (r.url.raw || String(r.url));
  const hs = r.header || r.headers || [];
  const headers = Array.isArray(hs) ? hs.map((h) => ({ key: String(h.key), value: String(h.value) })) : Object.keys(hs).map((k) => ({ key: k, value: String(hs[k]) }));
  let body;
  const b = r.body;
  if (typeof b === 'string') body = b;
  else if (b && b.mode === 'raw') body = b.raw;
  else if (b && b.mode === 'urlencoded') body = { urlencoded: (b.urlencoded || []).map((f) => ({ key: String(f.key), value: String(f.value) })) };
  else if (b && typeof b === 'object' && !b.mode) body = JSON.stringify(b);
  return { method: String(r.method || 'GET').toUpperCase(), url: String(url || ''), headers, body };
}
function __responseObject(res) {
  const hdrs = (res.headers || []).map((h) => ({ key: h[0], value: h[1] }));
  return {
    code: res.status, status: res.statusText || '', responseTime: res.time, responseSize: (res.body || '').length,
    headers: __headerList(hdrs),
    json: () => JSON.parse(res.body || 'null'), text: () => res.body || '',
    body: res.body,
  };
}
function __sendRequest(req, cb) {
  const n = __normRequest(req);
  const sig = n.method + ' ' + n.url + ' ' + JSON.stringify(n.headers) + ' ' + JSON.stringify(n.body === undefined ? null : n.body);
  __sendSeen[sig] = (__sendSeen[sig] || 0) + 1;
  const key = sig + '#' + __sendSeen[sig];
  const done = __sent.find((x) => x.key === key);
  if (done) {
    if (typeof cb === 'function') {
      if (done.error) cb(new Error(done.error), null);
      else cb(null, __responseObject(done.response));
    }
    return;
  }
  __out.pendingRequests.push({ key: key, request: n });
}

/* ---------------- libraries ---------------- */
const __word = (hex) => ({ __hex: hex, toString: (enc) => (enc && enc.__b64 ? __host_hex2b64(hex) : hex), sigBytes: hex.length / 2 });
const CryptoJS = {
  SHA256: (m) => __word(__host_hash('sha256', String(m))),
  SHA1: (m) => __word(__host_hash('sha1', String(m))),
  SHA512: (m) => __word(__host_hash('sha512', String(m))),
  MD5: (m) => __word(__host_hash('md5', String(m))),
  HmacSHA256: (m, k) => __word(__host_hmac('sha256', String(k), String(m))),
  HmacSHA1: (m, k) => __word(__host_hmac('sha1', String(k), String(m))),
  HmacSHA512: (m, k) => __word(__host_hmac('sha512', String(k), String(m))),
  enc: {
    Hex: { __hex: true, stringify: (w) => w.__hex, parse: (h) => __word(h) },
    Base64: { __b64: true, stringify: (w) => (w && w.__hex !== undefined ? __host_hex2b64(w.__hex) : __host_b64(String(w))), parse: (s) => __word(__host_b642hex(s)) },
    Utf8: { parse: (s) => String(s), stringify: (w) => (w && w.__hex !== undefined ? __host_hex2utf8(w.__hex) : String(w)) },
  },
};
const btoa = (s) => __host_b64(String(s));
const atob = (s) => __host_unb64(String(s));
const require = (name) => {
  if (name === 'crypto-js') return CryptoJS;
  if (name === 'uuid') return { v4: () => __host_uuid() };
  throw new Error('require("' + name + '") is not available in the sandbox (supported: crypto-js, uuid)');
};

/* ---------------- pm / aps ---------------- */
const pm = {
  test(name, fn) {
    try { fn(); __out.tests.push({ name: String(name), passed: true }); }
    catch (e) { __out.tests.push({ name: String(name), passed: false, message: String((e && e.message) || e) }); }
  },
  expect,
  variables: __variables,
  environment: __scope('environment'),
  globals: __scope('globals'),
  collectionVariables: __scope('collectionVariables'),
  iterationData: { get: (k) => __scopes.iterationData[k], has: (k) => Object.prototype.hasOwnProperty.call(__scopes.iterationData, k), toObject: () => Object.assign({}, __scopes.iterationData), toJSON: () => Object.assign({}, __scopes.iterationData) },
  request: __request,
  response: __response,
  info: Object.assign({ eventName: __in.response ? 'test' : 'prerequest', iteration: 0, iterationCount: 1, requestName: '', requestId: '' }, __in.info || {}),
  cookies: { get: (n) => (__in.cookies || {})[n], has: (n) => Object.prototype.hasOwnProperty.call(__in.cookies || {}, n), toObject: () => Object.assign({}, __in.cookies || {}), jar: __cookieJar },
  sendRequest: __sendRequest,
  execution: { setNextRequest: (n) => { __out.nextRequest = n === null ? null : String(n); }, skipRequest: () => { __out.skipRequest = true; } },
  uuid: () => __host_uuid(),
  crypto: {
    sha256: (s) => __host_hash('sha256', String(s)),
    md5: (s) => __host_hash('md5', String(s)),
    hmacSha256: (key, s) => __host_hmac('sha256', String(key), String(s)),
    base64: (s) => __host_b64(String(s)),
  },
  data: __in.data,
};
const postman = {
  setNextRequest: (n) => { __out.nextRequest = n === null ? null : String(n); },
  setEnvironmentVariable: (k, v) => pm.environment.set(k, v),
  getEnvironmentVariable: (k) => pm.environment.get(k),
  setGlobalVariable: (k, v) => pm.globals.set(k, v),
  getGlobalVariable: (k) => pm.globals.get(k),
};
const tests = {};
const aps = pm;
// legacy Postman sandbox globals (pre-pm API)
const responseCode = __in.response ? { code: __in.response.status, name: '', detail: '' } : undefined;
const responseBody = __in.response ? __in.response.body || '' : undefined;
const responseTime = __in.response ? __in.response.time : undefined;
const responseHeaders = __in.response ? Object.fromEntries((__in.response.headers || []).map((h) => [h[0], h[1]])) : undefined;
const environment = __scopes.environment;
const globals = __scopes.globals;
const data = __scopes.iterationData;
// legacy aps.response helpers
if (__response) { __response.header = (n) => __response.headers.get(n); }
const console = {
  log: (...a) => __out.logs.push(a.map((x) => (typeof x === 'string' ? x : __fmt(x))).join(' ')),
};
console.info = console.log; console.warn = console.log; console.error = console.log; console.debug = console.log;
`;

/** Appended after the user script: legacy `tests["name"] = bool` assertions from old Postman scripts. */
export const EPILOGUE = String.raw`
for (const k of Object.keys(tests)) __out.tests.push({ name: k, passed: !!tests[k], message: tests[k] ? undefined : 'tests["' + k + '"] was false' });
`;
