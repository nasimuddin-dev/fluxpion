import type { Span, SpanKind, Trace } from '../model/types.js';
import { spanId as newSpanId, traceId as newTraceId } from '../util/ids.js';
import type { Redactor } from '../util/redact.js';

/** Max serialized size of a span's input/output kept in a trace (larger payloads are truncated). */
const MAX_IO_CHARS = 64 * 1024;

export type SpanListener = (span: Span, phase: 'start' | 'end') => void;

/**
 * Builds a normalised, OpenTelemetry-shaped trace for one execution.
 * All inputs/outputs are redacted and size-bounded when recorded.
 */
export class Tracer {
  readonly trace: Trace;
  private listeners: SpanListener[] = [];

  constructor(
    name: string,
    private redactor?: Redactor,
  ) {
    this.trace = { traceId: newTraceId(), name, startTime: Date.now(), status: 'unset', spans: [] };
  }

  get traceId(): string {
    return this.trace.traceId;
  }

  onSpan(l: SpanListener): () => void {
    this.listeners.push(l);
    return () => (this.listeners = this.listeners.filter((x) => x !== l));
  }

  start(name: string, kind: SpanKind, opts: { parent?: SpanHandle | string; attributes?: Record<string, unknown>; input?: unknown } = {}): SpanHandle {
    const parentId = typeof opts.parent === 'string' ? opts.parent : opts.parent?.span.spanId;
    const span: Span = {
      traceId: this.trace.traceId,
      spanId: newSpanId(),
      parentSpanId: parentId,
      name,
      kind,
      startTime: Date.now(),
      status: 'unset',
      attributes: this.clean(opts.attributes ?? {}) as Record<string, unknown>,
      input: opts.input === undefined ? undefined : this.clean(opts.input),
    };
    this.trace.spans.push(span);
    this.emit(span, 'start');
    return new SpanHandle(this, span);
  }

  /** Convenience: run `fn` inside a span, recording its output / error. */
  async span<T>(
    name: string,
    kind: SpanKind,
    fn: (s: SpanHandle) => Promise<T>,
    opts: { parent?: SpanHandle | string; attributes?: Record<string, unknown>; input?: unknown } = {},
  ): Promise<T> {
    const s = this.start(name, kind, opts);
    try {
      const out = await fn(s);
      if (!s.span.endTime) s.end({ status: s.span.status === 'error' ? 'error' : 'ok' });
      return out;
    } catch (err) {
      s.fail(err);
      throw err;
    }
  }

  finish(status?: 'ok' | 'error'): Trace {
    this.trace.endTime = Date.now();
    this.trace.status = status ?? (this.trace.spans.some((s) => s.status === 'error') ? 'error' : 'ok');
    return this.trace;
  }

  /** @internal */
  emit(span: Span, phase: 'start' | 'end'): void {
    for (const l of this.listeners) l(span, phase);
  }

  /** @internal Redact and bound the size of recorded data. */
  clean(v: unknown): unknown {
    const r = this.redactor ? this.redactor.redact(v) : v;
    if (typeof r === 'string') return r.length > MAX_IO_CHARS ? r.slice(0, MAX_IO_CHARS) + `… [truncated ${r.length - MAX_IO_CHARS} chars]` : r;
    try {
      const s = JSON.stringify(r);
      if (s && s.length > MAX_IO_CHARS) return { truncated: true, preview: s.slice(0, MAX_IO_CHARS), originalChars: s.length };
    } catch {
      return String(r);
    }
    return r;
  }
}

export class SpanHandle {
  constructor(
    private tracer: Tracer,
    readonly span: Span,
  ) {}

  get id(): string {
    return this.span.spanId;
  }

  set(key: string, value: unknown): this {
    this.span.attributes[key] = this.tracer.clean(value);
    return this;
  }

  setAttributes(attrs: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(attrs)) this.set(k, v);
    return this;
  }

  event(name: string, attributes?: Record<string, unknown>): this {
    (this.span.events ??= []).push({ time: Date.now(), name, attributes: attributes && (this.tracer.clean(attributes) as Record<string, unknown>) });
    return this;
  }

  output(v: unknown): this {
    this.span.output = this.tracer.clean(v);
    return this;
  }

  child(name: string, kind: SpanKind, opts: { attributes?: Record<string, unknown>; input?: unknown } = {}): SpanHandle {
    return this.tracer.start(name, kind, { ...opts, parent: this });
  }

  end(opts: { status?: 'ok' | 'error'; output?: unknown; error?: string } = {}): void {
    if (this.span.endTime) return;
    if (opts.output !== undefined) this.output(opts.output);
    if (opts.error) this.span.error = this.tracer.clean(opts.error) as string;
    this.span.status = opts.status ?? (opts.error ? 'error' : 'ok');
    this.span.endTime = Date.now();
    this.span.durationMs = this.span.endTime - this.span.startTime;
    this.tracer.emit(this.span, 'end');
  }

  fail(err: unknown): void {
    const msg = (err as Error)?.message ?? String(err);
    this.end({ status: 'error', error: msg });
  }

  /** A finished child span with known times (e.g. a phase measured elsewhere). */
  childAt(name: string, kind: SpanKind, startTime: number, durationMs: number, attributes?: Record<string, unknown>): SpanHandle {
    const c = this.tracer.start(name, kind, { parent: this, attributes });
    c.span.startTime = Math.round(startTime);
    c.span.status = 'ok';
    c.span.endTime = Math.round(startTime + durationMs);
    c.span.durationMs = Math.round(durationMs * 100) / 100;
    this.tracer.emit(c.span, 'end');
    return c;
  }
}

/** The phases of an HTTP response's timeline (DNS, TCP, TLS, waiting, download) as child spans of its request span. */
export function timingSpans(parent: SpanHandle, timeline: Array<{ name: string; startMs: number; durationMs: number }> | undefined, base = parent.span.startTime): void {
  for (const p of timeline ?? []) {
    if (p.name === 'total' || p.name === 'prepare') continue;
    parent.childAt(p.name, 'http', base + p.startMs, p.durationMs, { phase: p.name });
  }
}

/** Build a parent→children tree from a flat span list (for UI rendering). */
export function spanTree(trace: Trace): Array<{ span: Span; depth: number }> {
  const children = new Map<string | undefined, Span[]>();
  for (const s of trace.spans) {
    const k = s.parentSpanId && trace.spans.some((p) => p.spanId === s.parentSpanId) ? s.parentSpanId : undefined;
    (children.get(k) ?? children.set(k, []).get(k)!).push(s);
  }
  const out: Array<{ span: Span; depth: number }> = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const s of (children.get(parent) ?? []).sort((a, b) => a.startTime - b.startTime)) {
      out.push({ span: s, depth });
      walk(s.spanId, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}
