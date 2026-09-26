import { createHash, createHmac, randomUUID } from 'node:crypto';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-mjs-release-sync';

/**
 * User scripts run inside QuickJS compiled to WebAssembly — a separate JS engine with its
 * own heap. Scripts have no access to the filesystem, network, processes, Node APIs or the
 * host realm. Data is passed in and out as JSON only; the only host functions exposed are
 * pure crypto/uuid helpers. CPU time and memory are bounded.
 */

export interface ScriptInput {
  variables: Record<string, unknown>;
  request?: { method: string; url: string; headers: Array<{ key: string; value: string; enabled?: boolean }>; body?: string };
  response?: { status?: number; headers?: Array<[string, string]>; body?: string; time?: number };
  /** Arbitrary extra data exposed as `aps.data` (e.g. LLM output, MCP result). */
  data?: unknown;
}

export interface ScriptOutput {
  /** Variables set via `aps.variables.set` (written to the runtime scope). */
  vars: Record<string, unknown>;
  unset: string[];
  tests: Array<{ name: string; passed: boolean; message?: string }>;
  logs: string[];
  request?: ScriptInput['request'];
  error?: string;
  durationMs: number;
}

let modulePromise: Promise<QuickJSWASMModule> | undefined;
function getModule(): Promise<QuickJSWASMModule> {
  return (modulePromise ??= newQuickJSWASMModuleFromVariant(variant as never));
}

const PRELUDE = String.raw`
const __in = JSON.parse(__input_json);
const __out = { vars: {}, unset: [], tests: [], logs: [], request: __in.request || null, error: null };
const __vars = Object.assign({}, __in.variables || {});
const __fmt = (v) => { try { return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v); } catch (e) { return String(v); } };
function expect(actual) {
  const make = (neg) => {
    const a = (cond, msg) => { if (neg ? cond : !cond) throw new Error((neg ? 'expected not: ' : '') + msg); };
    return {
      toBe: (e) => a(actual === e, 'expected ' + __fmt(actual) + ' to be ' + __fmt(e)),
      toEqual: (e) => a(JSON.stringify(actual) === JSON.stringify(e), 'expected ' + __fmt(actual) + ' to equal ' + __fmt(e)),
      toContain: (e) => a(actual != null && actual.indexOf(e) >= 0, 'expected ' + __fmt(actual) + ' to contain ' + __fmt(e)),
      toMatch: (re) => a(new RegExp(re).test(String(actual)), 'expected ' + __fmt(actual) + ' to match ' + String(re)),
      toBeTruthy: () => a(!!actual, 'expected ' + __fmt(actual) + ' to be truthy'),
      toBeFalsy: () => a(!actual, 'expected ' + __fmt(actual) + ' to be falsy'),
      toBeDefined: () => a(actual !== undefined, 'expected value to be defined'),
      toBeGreaterThan: (n) => a(actual > n, 'expected ' + __fmt(actual) + ' > ' + n),
      toBeLessThan: (n) => a(actual < n, 'expected ' + __fmt(actual) + ' < ' + n),
      toHaveProperty: (k) => a(actual != null && Object(actual)[k] !== undefined, 'expected object to have property ' + k),
      toHaveLength: (n) => a(actual != null && actual.length === n, 'expected length ' + n + ', got ' + (actual && actual.length)),
    };
  };
  const r = make(false); r.not = make(true); return r;
}
const aps = {
  variables: {
    get: (k) => __vars[k],
    set: (k, v) => { __vars[k] = v; __out.vars[k] = v; },
    unset: (k) => { delete __vars[k]; __out.unset.push(k); },
    has: (k) => Object.prototype.hasOwnProperty.call(__vars, k),
    toObject: () => Object.assign({}, __vars),
  },
  request: __out.request,
  response: __in.response ? Object.assign({}, __in.response, {
    json() { return JSON.parse(this.body || 'null'); },
    text() { return this.body || ''; },
    header(name) { const h = (this.headers || []).find((x) => String(x[0]).toLowerCase() === String(name).toLowerCase()); return h ? h[1] : undefined; },
  }) : undefined,
  data: __in.data,
  test(name, fn) {
    try { fn(); __out.tests.push({ name: String(name), passed: true }); }
    catch (e) { __out.tests.push({ name: String(name), passed: false, message: String((e && e.message) || e) }); }
  },
  expect,
  uuid: () => __host_uuid(),
  crypto: {
    sha256: (s) => __host_hash('sha256', String(s)),
    md5: (s) => __host_hash('md5', String(s)),
    hmacSha256: (key, s) => __host_hmac('sha256', String(key), String(s)),
    base64: (s) => __host_b64(String(s)),
  },
};
aps.environment = aps.variables;
const pm = aps;
const console = {
  log: (...a) => __out.logs.push(a.map((x) => typeof x === 'string' ? x : __fmt(x)).join(' ')),
};
console.info = console.log; console.warn = console.log; console.error = console.log; console.debug = console.log;
`;

export async function runScript(code: string, input: ScriptInput, opts: { timeoutMs?: number; memoryMb?: number } = {}): Promise<ScriptOutput> {
  const t0 = performance.now();
  if (!code?.trim()) return { vars: {}, unset: [], tests: [], logs: [], request: input.request, durationMs: 0 };
  const mod = await getModule();
  const runtime = mod.newRuntime();
  runtime.setMemoryLimit((opts.memoryMb ?? 32) * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + (opts.timeoutMs ?? 2000)));
  const vm = runtime.newContext();
  try {
    const fn = (name: string, impl: (...args: string[]) => string) => {
      const h = vm.newFunction(name, (...args) => vm.newString(impl(...args.map((a) => String(vm.dump(a))))));
      vm.setProp(vm.global, name, h);
      h.dispose();
    };
    fn('__host_uuid', () => randomUUID());
    fn('__host_hash', (alg, s) => createHash(alg === 'md5' ? 'md5' : 'sha256').update(s ?? '').digest('hex'));
    fn('__host_hmac', (_alg, key, s) => createHmac('sha256', key ?? '').update(s ?? '').digest('hex'));
    fn('__host_b64', (s) => Buffer.from(s ?? '').toString('base64'));
    const inputHandle = vm.newString(JSON.stringify(input));
    vm.setProp(vm.global, '__input_json', inputHandle);
    inputHandle.dispose();

    const wrapped = `${PRELUDE}\ntry { (function(){\n${code}\n})(); } catch (e) { __out.error = String((e && e.stack) || e); }\nJSON.stringify(__out);`;
    const result = vm.evalCode(wrapped, 'user-script.js');
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      const msg = typeof err === 'object' && err ? `${(err as { name?: string }).name ?? 'Error'}: ${(err as { message?: string }).message ?? JSON.stringify(err)}` : String(err);
      return { vars: {}, unset: [], tests: [], logs: [], request: input.request, error: /interrupted/i.test(msg) ? `Script timed out after ${opts.timeoutMs ?? 2000} ms` : msg, durationMs: Math.round(performance.now() - t0) };
    }
    const json = vm.getString(result.value);
    result.value.dispose();
    const out = JSON.parse(json) as Omit<ScriptOutput, 'durationMs'> & { error: string | null };
    return { ...out, error: out.error ?? undefined, request: out.request ?? undefined, durationMs: Math.round(performance.now() - t0) };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
