/** Script snippets (same set Postman offers), inserted into pre-request / test scripts. */
export interface Snippet {
  label: string;
  code: string;
  kind: 'test' | 'pre' | 'both';
}

export const SNIPPETS: Snippet[] = [
  { kind: 'test', label: 'Status code: Code is 200', code: `pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});` },
  { kind: 'test', label: 'Status code: Successful POST request', code: `pm.test("Successful POST request", function () {\n  pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]);\n});` },
  { kind: 'test', label: 'Response time is less than 200ms', code: `pm.test("Response time is less than 200ms", function () {\n  pm.expect(pm.response.responseTime).to.be.below(200);\n});` },
  { kind: 'test', label: 'Response body: JSON value check', code: `pm.test("Your test name", function () {\n  const jsonData = pm.response.json();\n  pm.expect(jsonData.value).to.eql(100);\n});` },
  { kind: 'test', label: 'Response body: Contains string', code: `pm.test("Body matches string", function () {\n  pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});` },
  { kind: 'test', label: 'Response body: Is equal to a string', code: `pm.test("Body is correct", function () {\n  pm.response.to.have.body("response_body_string");\n});` },
  { kind: 'test', label: 'Response headers: Content-Type header check', code: `pm.test("Content-Type is present", function () {\n  pm.response.to.have.header("Content-Type");\n});` },
  { kind: 'test', label: 'Response body: Array has items', code: `pm.test("Returns items", function () {\n  const data = pm.response.json();\n  pm.expect(data.items).to.be.an("array").that.is.not.empty;\n});` },
  { kind: 'test', label: 'Response body: Property types', code: `pm.test("Has the expected shape", function () {\n  const data = pm.response.json();\n  pm.expect(data).to.have.property("id");\n  pm.expect(data.id).to.be.a("string");\n});` },
  { kind: 'test', label: 'Save a value from the response', code: `const data = pm.response.json();\npm.environment.set("token", data.access_token);` },
  { kind: 'both', label: 'Set an environment variable', code: `pm.environment.set("variable_key", "variable_value");` },
  { kind: 'both', label: 'Get an environment variable', code: `pm.environment.get("variable_key");` },
  { kind: 'both', label: 'Set a collection variable', code: `pm.collectionVariables.set("variable_key", "variable_value");` },
  { kind: 'both', label: 'Set a global variable', code: `pm.globals.set("variable_key", "variable_value");` },
  { kind: 'both', label: 'Get a variable (any scope)', code: `pm.variables.get("variable_key");` },
  { kind: 'both', label: 'Clear an environment variable', code: `pm.environment.unset("variable_key");` },
  { kind: 'test', label: 'Cookies: Cookie is present', code: `pm.test("Session cookie is set", function () {\n  pm.expect(pm.cookies.has("session")).to.be.true;\n});` },
  { kind: 'both', label: 'Cookies: Read from the cookie jar', code: `const jar = pm.cookies.jar();\njar.get(pm.request.url.toString(), "session", (error, value) => {\n  pm.variables.set("session", value);\n});` },
  { kind: 'both', label: 'Cookies: Set a cookie in the jar', code: `pm.cookies.jar().set(pm.request.url.toString(), "cookie_name", "cookie_value");` },
  { kind: 'both', label: 'Cookies: Clear the jar for this domain', code: `pm.cookies.jar().clear(pm.request.url.toString());` },
  { kind: 'pre', label: 'Add a request header', code: `pm.request.headers.upsert({ key: "X-Request-Id", value: pm.uuid() });` },
  { kind: 'pre', label: 'Timestamp variable', code: `pm.variables.set("timestamp", new Date().toISOString());` },
  { kind: 'pre', label: 'HMAC signature header', code: `const body = pm.request.body.toString();\nconst signature = CryptoJS.HmacSHA256(body, pm.environment.get("secret")).toString(CryptoJS.enc.Base64);\npm.request.headers.upsert({ key: "X-Signature", value: signature });` },
  { kind: 'both', label: 'Log to the console', code: `console.log(pm.variables.toObject());` },
  { kind: 'test', label: 'Collection runner: go to a request next', code: `postman.setNextRequest("Request name");` },
];

/** Type declarations for Monaco so the script editor autocompletes the pm API. */
export const PM_TYPES = `
interface PmExpect {
  to: PmExpect; be: PmExpect; been: PmExpect; is: PmExpect; that: PmExpect; which: PmExpect; and: PmExpect; has: PmExpect; have: PmExpect; with: PmExpect; not: PmExpect; deep: PmExpect;
  equal(v: any): PmExpect; eql(v: any): PmExpect; a(type: string): PmExpect; an(type: string): PmExpect;
  include(v: any): PmExpect; contain(v: any): PmExpect; property(name: string, value?: any): PmExpect; lengthOf(n: number): PmExpect;
  above(n: number): PmExpect; below(n: number): PmExpect; least(n: number): PmExpect; most(n: number): PmExpect; within(a: number, b: number): PmExpect;
  match(re: RegExp | string): PmExpect; oneOf(values: any[]): PmExpect; keys(...keys: string[]): PmExpect; members(values: any[]): PmExpect;
  readonly true: PmExpect; readonly false: PmExpect; readonly null: PmExpect; readonly undefined: PmExpect; readonly ok: PmExpect; readonly empty: PmExpect; readonly exist: PmExpect;
}
interface PmVariableScope { get(key: string): any; set(key: string, value: any): void; unset(key: string): void; has(key: string): boolean; clear(): void; toObject(): Record<string, any>; replaceIn(template: string): string; }
interface PmHeaderList { get(key: string): string | undefined; has(key: string): boolean; add(h: { key: string; value: string }): void; upsert(h: { key: string; value: string }): void; remove(key: string): void; toObject(): Record<string, string>; }
interface PmResponseAssert {
  to: PmResponseAssert; have: PmResponseAssert; be: PmResponseAssert; not: PmResponseAssert;
  status(codeOrReason: number | string): PmResponseAssert; header(name: string, value?: string): PmResponseAssert; body(expected?: string | object): PmResponseAssert; jsonBody(path?: string, value?: any): PmResponseAssert;
  readonly ok: PmResponseAssert; readonly success: PmResponseAssert; readonly error: PmResponseAssert; readonly clientError: PmResponseAssert; readonly serverError: PmResponseAssert; readonly json: PmResponseAssert;
  readonly notFound: PmResponseAssert; readonly unauthorized: PmResponseAssert; readonly forbidden: PmResponseAssert; readonly badRequest: PmResponseAssert;
}
/** Workspace cookie jar. Callbacks run immediately; the value is also returned. */
interface PmCookieJar {
  get(url: string, name: string, cb?: (err: null, value: string | undefined) => void): string | undefined;
  getAll(url: string, cb?: (err: null, cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: string; secure: boolean; httpOnly: boolean }>) => void): Array<{ name: string; value: string; domain: string; path: string }>;
  set(url: string, name: string, value: string, cb?: (err: null, cookie: object) => void): object;
  unset(url: string, name: string, cb?: (err: null) => void): void;
  clear(url: string, cb?: (err: null) => void): void;
}
declare const pm: {
  /** Define a named test; it passes unless the function throws. */
  test(name: string, fn: () => void): void;
  /** Chai-style assertion: pm.expect(value).to.equal(expected) */
  expect(value: any): PmExpect;
  variables: PmVariableScope; environment: PmVariableScope; globals: PmVariableScope; collectionVariables: PmVariableScope;
  iterationData: { get(key: string): any; has(key: string): boolean; toObject(): Record<string, any> };
  request: { method: string; url: { toString(): string; update(url: string): void }; headers: PmHeaderList; body: { toString(): string; update(body: string | object): void } };
  response: { code: number; status: string; responseTime: number; responseSize: number; headers: PmHeaderList; json(): any; text(): string; to: PmResponseAssert };
  info: { requestName: string; requestId: string; iteration: number; iterationCount: number; eventName: 'prerequest' | 'test' };
  cookies: { get(name: string): string | undefined; has(name: string): boolean; toObject(): Record<string, string>; jar(): PmCookieJar };
  execution: { setNextRequest(name: string | null): void; skipRequest(): void };
  uuid(): string;
};
declare const postman: { setNextRequest(name: string | null): void; setEnvironmentVariable(k: string, v: any): void; getEnvironmentVariable(k: string): any; setGlobalVariable(k: string, v: any): void; getGlobalVariable(k: string): any };
declare const CryptoJS: any;
declare const tests: Record<string, boolean>;
declare function btoa(s: string): string;
declare function atob(s: string): string;
`;
