import { createHash, createHmac, randomUUID } from 'node:crypto';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-mjs-release-sync';
import { EPILOGUE, PRELUDE } from './prelude.js';

/**
 * User scripts run inside QuickJS compiled to WebAssembly — a separate JS engine with its
 * own heap. Scripts have no access to the filesystem, network, processes, Node APIs or the
 * host realm. Data is passed in and out as JSON only; the only host functions exposed are
 * pure crypto/encoding/uuid helpers. CPU time and memory are bounded.
 *
 * The API is Postman-compatible (`pm.*`, `postman.*`, `tests[...]`, CryptoJS); `aps` is an alias.
 */

export type ScriptScope = 'environment' | 'globals' | 'collectionVariables';

export interface ScriptInput {
  /** Merged variables (all scopes) — `pm.variables`. */
  variables: Record<string, unknown>;
  environment?: Record<string, unknown>;
  globals?: Record<string, unknown>;
  collectionVariables?: Record<string, unknown>;
  iterationData?: Record<string, unknown>;
  request?: { method: string; url: string; headers: Array<{ key: string; value: string; enabled?: boolean }>; body?: string };
  response?: { status?: number; headers?: Array<[string, string]>; body?: string; time?: number };
  cookies?: Record<string, string>;
  info?: { requestName?: string; requestId?: string; iteration?: number; iterationCount?: number };
  /** Arbitrary extra data exposed as `pm.data` (e.g. LLM output, MCP result). */
  data?: unknown;
}

export interface ScriptOutput {
  /** Local variables set via `pm.variables.set` (runtime scope). */
  vars: Record<string, unknown>;
  unset: string[];
  /** Values set via pm.environment / pm.globals / pm.collectionVariables. */
  scopeSets: Record<ScriptScope, Record<string, unknown>>;
  scopeUnsets: Record<ScriptScope, string[]>;
  tests: Array<{ name: string; passed: boolean; message?: string }>;
  logs: string[];
  request?: ScriptInput['request'];
  /** `postman.setNextRequest(name)`: undefined = not called, null = stop the run. */
  nextRequest?: string | null;
  skipRequest?: boolean;
  error?: string;
  durationMs: number;
}

const emptyScopes = () => ({
  scopeSets: { environment: {}, globals: {}, collectionVariables: {} } as ScriptOutput['scopeSets'],
  scopeUnsets: { environment: [], globals: [], collectionVariables: [] } as ScriptOutput['scopeUnsets'],
});

let modulePromise: Promise<QuickJSWASMModule> | undefined;
function getModule(): Promise<QuickJSWASMModule> {
  return (modulePromise ??= newQuickJSWASMModuleFromVariant(variant as never));
}

const HASHES = new Set(['md5', 'sha1', 'sha256', 'sha512']);

export async function runScript(code: string, input: ScriptInput, opts: { timeoutMs?: number; memoryMb?: number } = {}): Promise<ScriptOutput> {
  const t0 = performance.now();
  if (!code?.trim()) return { vars: {}, unset: [], ...emptyScopes(), tests: [], logs: [], request: input.request, durationMs: 0 };
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
    const alg = (a: string) => (HASHES.has(a) ? a : 'sha256');
    fn('__host_uuid', () => randomUUID());
    fn('__host_hash', (a, s) => createHash(alg(a)).update(s ?? '').digest('hex'));
    fn('__host_hmac', (a, key, s) => createHmac(alg(a), key ?? '').update(s ?? '').digest('hex'));
    fn('__host_b64', (s) => Buffer.from(s ?? '', 'utf8').toString('base64'));
    fn('__host_unb64', (s) => Buffer.from(s ?? '', 'base64').toString('utf8'));
    fn('__host_hex2b64', (h) => Buffer.from(h ?? '', 'hex').toString('base64'));
    fn('__host_b642hex', (s) => Buffer.from(s ?? '', 'base64').toString('hex'));
    fn('__host_hex2utf8', (h) => Buffer.from(h ?? '', 'hex').toString('utf8'));
    const inputHandle = vm.newString(JSON.stringify(input));
    vm.setProp(vm.global, '__input_json', inputHandle);
    inputHandle.dispose();

    const wrapped = `${PRELUDE}\ntry { (function(){\n${code}\n})(); } catch (e) { __out.error = String((e && e.stack) || e); }\n${EPILOGUE}\nJSON.stringify(__out);`;
    const result = vm.evalCode(wrapped, 'user-script.js');
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      const msg = typeof err === 'object' && err ? `${(err as { name?: string }).name ?? 'Error'}: ${(err as { message?: string }).message ?? JSON.stringify(err)}` : String(err);
      return {
        vars: {},
        unset: [],
        ...emptyScopes(),
        tests: [],
        logs: [],
        request: input.request,
        error: /interrupted/i.test(msg) ? `Script timed out after ${opts.timeoutMs ?? 2000} ms` : msg,
        durationMs: Math.round(performance.now() - t0),
      };
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
