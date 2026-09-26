import { createWriteStream, openAsBlob, readFileSync, mkdirSync, type WriteStream } from 'node:fs';
import { basename, join } from 'node:path';
import { Agent, ProxyAgent, fetch as undiciFetch, FormData as UndiciFormData, type Dispatcher } from 'undici';
import type { BodyConfig, HttpRequestSpec, HttpResponseData, KeyValue, TimelinePhase } from '../../model/types.js';
import { ApsError } from '../../errors.js';
import { applyAuth, type AuthContext } from './auth.js';
import type { Redactor } from '../../util/redact.js';
import { shortId } from '../../util/ids.js';

export const DEFAULT_MAX_PREVIEW = 2 * 1024 * 1024;

export interface HttpExecOptions extends AuthContext {
  signal?: AbortSignal;
  /** When set, the full response body is streamed to a file in this directory. */
  payloadDir?: string;
  maxPreviewBytes?: number;
  /** Receives decoded chunks while the body streams (SSE, chunked responses). */
  onChunk?: (chunk: string) => void;
  redactor?: Redactor;
  /** Skip body preview decoding entirely (load testing). */
  discardBody?: boolean;
}

export interface PreparedRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  bodyPreview?: string;
}

const dispatchers = new Map<string, Dispatcher>();

/** Reuse connection pools per TLS/proxy configuration. */
function dispatcherFor(spec: HttpRequestSpec): Dispatcher | undefined {
  const s = spec.settings ?? {};
  if (!s.insecure && !s.proxy && !s.clientCert) return defaultAgent();
  const key = JSON.stringify([s.insecure, s.proxy, s.clientCert]);
  let d = dispatchers.get(key);
  if (!d) {
    const connect: Record<string, unknown> = {};
    if (s.insecure) connect.rejectUnauthorized = false;
    if (s.clientCert) {
      connect.cert = readFileSync(s.clientCert.certPath);
      connect.key = readFileSync(s.clientCert.keyPath);
      if (s.clientCert.caPath) connect.ca = readFileSync(s.clientCert.caPath);
      if (s.clientCert.passphrase) connect.passphrase = s.clientCert.passphrase;
    }
    d = s.proxy ? new ProxyAgent({ uri: s.proxy, connect, requestTls: connect }) : new Agent({ connect });
    dispatchers.set(key, d);
  }
  return d;
}

let _default: Agent | undefined;
function defaultAgent(): Agent {
  return (_default ??= new Agent({ connections: 256, pipelining: 1, keepAliveTimeout: 10_000 }));
}

export function buildUrl(raw: string, params?: KeyValue[]): URL {
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new ApsError('ConfigurationError', `Invalid URL: ${raw}`, {
      suggestions: ['Check for unresolved {{variables}} in the URL.', 'Make sure the selected environment defines the base URL.'],
    });
  }
  for (const p of params ?? []) if (p.enabled !== false && p.key) url.searchParams.append(p.key, p.value);
  return url;
}

async function buildBody(body: BodyConfig | undefined, headers: Headers): Promise<{ body?: unknown; preview?: string }> {
  if (!body || body.type === 'none') return {};
  const setCT = (ct: string) => {
    if (!headers.has('content-type')) headers.set('content-type', ct);
  };
  switch (body.type) {
    case 'json':
      setCT('application/json');
      return { body: body.content, preview: body.content };
    case 'xml':
      setCT('application/xml');
      return { body: body.content, preview: body.content };
    case 'html':
      setCT('text/html');
      return { body: body.content, preview: body.content };
    case 'text':
      setCT('text/plain');
      return { body: body.content, preview: body.content };
    case 'form-urlencoded': {
      const f = new URLSearchParams();
      for (const kv of body.fields) if (kv.enabled !== false && kv.key) f.append(kv.key, kv.value);
      setCT('application/x-www-form-urlencoded');
      const s = f.toString();
      return { body: s, preview: s };
    }
    case 'multipart': {
      const fd = new UndiciFormData();
      const preview: string[] = [];
      for (const f of body.fields) {
        if (f.enabled === false || !f.key) continue;
        if (f.kind === 'file') {
          const blob = await openAsBlob(f.value, { type: f.contentType });
          fd.append(f.key, blob, basename(f.value));
          preview.push(`${f.key}=@${basename(f.value)} (${blob.size} bytes)`);
        } else {
          fd.append(f.key, f.value);
          preview.push(`${f.key}=${f.value}`);
        }
      }
      // content-type with boundary is set by fetch
      headers.delete('content-type');
      return { body: fd, preview: preview.join('\n') };
    }
    case 'binary': {
      const blob = await openAsBlob(body.filePath);
      setCT(body.contentType ?? 'application/octet-stream');
      return { body: blob, preview: `<binary ${basename(body.filePath)} ${blob.size} bytes>` };
    }
  }
}

function parseSetCookie(h: string): { name: string; value: string; attributes: Record<string, string> } {
  const [pair, ...attrs] = h.split(';');
  const eq = (pair ?? '').indexOf('=');
  const attributes: Record<string, string> = {};
  for (const a of attrs) {
    const i = a.indexOf('=');
    const k = (i < 0 ? a : a.slice(0, i)).trim();
    if (k) attributes[k] = i < 0 ? 'true' : a.slice(i + 1).trim();
  }
  return { name: (pair ?? '').slice(0, eq).trim(), value: (pair ?? '').slice(eq + 1).trim(), attributes };
}

/**
 * Prepare a request without sending it (used for "code snippet"/preview and by the executor).
 * The spec must already have variables resolved.
 */
export async function prepareHttpRequest(spec: HttpRequestSpec, opts: HttpExecOptions = {}) {
  const url = buildUrl(spec.url, spec.params);
  const headers = new Headers();
  for (const h of spec.headers ?? []) if (h.enabled !== false && h.key) headers.append(h.key, h.value);
  const cookies = (spec.cookies ?? []).filter((c) => c.enabled !== false && c.key).map((c) => `${c.key}=${c.value}`);
  if (cookies.length) headers.set('cookie', [headers.get('cookie'), ...cookies].filter(Boolean).join('; '));
  if (!headers.has('user-agent')) headers.set('user-agent', 'AIProtocolStudio/0.1');
  if (!headers.has('accept')) headers.set('accept', '*/*');
  await applyAuth(spec.auth, headers, url, opts);
  const { body, preview } = await buildBody(spec.body, headers);
  const method = (spec.method || 'GET').toUpperCase();
  return { url, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body, bodyPreview: preview, method };
}

/** Execute an HTTP request, streaming the response with bounded memory. */
export async function executeHttp(spec: HttpRequestSpec, opts: HttpExecOptions = {}): Promise<{ response: HttpResponseData; prepared: PreparedRequest }> {
  const t0 = performance.now();
  const timeline: TimelinePhase[] = [];
  const mark = (name: string, start: number) => timeline.push({ name, startMs: round(start - t0), durationMs: round(performance.now() - start) });

  const { url, headers, body, bodyPreview, method } = await prepareHttpRequest(spec, opts);
  mark('prepare', t0);
  const redact = (s: string) => opts.redactor?.redactUrl(s) ?? s;
  const prepared: PreparedRequest = {
    method,
    url: redact(url.toString()),
    headers: [...headers.entries()].map(([k, v]) => [k, v] as [string, string]),
    bodyPreview: bodyPreview && bodyPreview.length > 64 * 1024 ? bodyPreview.slice(0, 64 * 1024) + '…' : bodyPreview,
  };
  if (opts.redactor) prepared.headers = opts.redactor.redact(prepared.headers);

  const s = spec.settings ?? {};
  const tSend = performance.now();
  const res = await undiciFetch(url, {
    method,
    headers: headers as unknown as Record<string, string>,
    body: body as never,
    redirect: s.followRedirects === false ? 'manual' : 'follow',
    signal: opts.signal,
    dispatcher: dispatcherFor(spec),
    // duplex is required by undici for streamed (Blob/FormData) bodies
    ...({ duplex: 'half' } as object),
  });
  mark('waiting (TTFB)', tSend);

  const tDown = performance.now();
  const maxPreview = opts.maxPreviewBytes ?? s.maxPreviewBytes ?? DEFAULT_MAX_PREVIEW;
  const chunks: Buffer[] = [];
  let kept = 0;
  let size = 0;
  let file: WriteStream | undefined;
  let payloadPath: string | undefined;
  const decoder = opts.onChunk ? new TextDecoder() : undefined;

  if (res.body && method !== 'HEAD') {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (opts.discardBody) continue;
        if (kept < maxPreview) {
          const take = Math.min(value.byteLength, maxPreview - kept);
          chunks.push(Buffer.from(value.buffer, value.byteOffset, take));
          kept += take;
        }
        if (opts.payloadDir) {
          if (!file) {
            mkdirSync(opts.payloadDir, { recursive: true });
            payloadPath = join(opts.payloadDir, `${shortId('resp-')}.bin`);
            file = createWriteStream(payloadPath);
          }
          if (!file.write(value)) await new Promise<void>((r) => file!.once('drain', () => r()));
        }
        if (decoder) opts.onChunk!(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
      if (file) await new Promise<void>((r) => file!.end(r));
    }
  }
  mark('download', tDown);
  const durationMs = round(performance.now() - t0);
  timeline.push({ name: 'total', startMs: 0, durationMs });

  const truncated = size > kept;
  const bodyBuf = Buffer.concat(chunks);
  const contentType = res.headers.get('content-type') ?? '';
  let bodyPreviewText = opts.discardBody ? '' : decodeBody(bodyBuf, contentType);
  if (truncated) bodyPreviewText = trimToCharBoundary(bodyPreviewText);
  let json: unknown;
  if (!truncated && bodyPreviewText && /json|\+json/i.test(contentType)) {
    try {
      json = JSON.parse(bodyPreviewText);
    } catch {
      /* not json */
    }
  } else if (!truncated && bodyPreviewText && /^\s*[[{]/.test(bodyPreviewText)) {
    try {
      json = JSON.parse(bodyPreviewText);
    } catch {
      /* not json */
    }
  }

  const response: HttpResponseData = {
    status: res.status,
    statusText: res.statusText,
    headers: [...res.headers.entries()].map(([k, v]) => [k, v] as [string, string]),
    cookies: res.headers.getSetCookie().map(parseSetCookie),
    bodyPreview: bodyPreviewText,
    truncated,
    size,
    contentType,
    payloadPath,
    durationMs,
    timeline,
    url: redact(res.url || url.toString()),
    redirected: res.redirected,
    json,
  };
  return { response, prepared };
}

function decodeBody(buf: Buffer, contentType: string): string {
  if (!buf.length) return '';
  if (/image\/|audio\/|video\/|octet-stream|application\/(zip|pdf|gzip)/i.test(contentType) || looksBinary(buf))
    return `<binary data ${buf.length} bytes — use "Save response" to download>`;
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  try {
    return new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 512);
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i]!;
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return ctrl / n > 0.1;
}

function trimToCharBoundary(s: string): string {
  return s.endsWith('�') ? s.slice(0, -1) : s;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Generate a cURL command for a prepared request (secrets already redacted). */
export function toCurl(p: PreparedRequest): string {
  const parts = [`curl -X ${p.method} '${p.url.replace(/'/g, "'\\''")}'`];
  for (const [k, v] of p.headers) parts.push(`  -H '${k}: ${v.replace(/'/g, "'\\''")}'`);
  if (p.bodyPreview) parts.push(`  --data-raw '${p.bodyPreview.replace(/'/g, "'\\''")}'`);
  return parts.join(' \\\n');
}
