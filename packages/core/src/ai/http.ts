import { ApsError, errorKindForStatus } from '../errors.js';
import type { Redactor } from '../util/redact.js';

/** POST JSON and return parsed JSON, mapping HTTP failures to normalised errors. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: { signal?: AbortSignal; redactor?: Redactor; provider: string },
): Promise<unknown> {
  const res = await doFetch(url, body, headers, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApsError('ProtocolError', `${opts.provider} returned a non-JSON response`, { details: { body: text.slice(0, 1000) } });
  }
}

export async function doFetch(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: { signal?: AbortSignal; redactor?: Redactor; provider: string; method?: string },
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    if (err.name === 'AbortError') throw new ApsError('CancelledError', 'Request cancelled');
    throw new ApsError('NetworkError', `Could not reach ${opts.provider} at ${opts.redactor?.redactUrl(url) ?? url}: ${err.cause?.code ?? err.message}`, {
      suggestions: ['Check the provider base URL.', 'For local models (Ollama), make sure the server is running.', 'This feature needs network access.'],
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const kind = errorKindForStatus(res.status) ?? 'ServerError';
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message ?? j?.message ?? j?.error ?? text;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch {
      /* keep text */
    }
    const err = new ApsError(kind, `${opts.provider} returned HTTP ${res.status}: ${(opts.redactor?.redactString(msg) ?? msg).slice(0, 500)}`, {
      details: { status: res.status },
    });
    const ra = res.headers.get('retry-after');
    if (ra) (err as ApsError & { retryAfterMs?: number }).retryAfterMs = Number.isFinite(Number(ra)) ? Number(ra) * 1000 : undefined;
    throw err;
  }
  return res;
}

/** Iterate Server-Sent Events from a fetch Response. Yields `{ event, data }`. */
export async function* sseEvents(res: Response): AsyncGenerator<{ event?: string; data: string }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | undefined;
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = undefined;
          data = [];
        } else if (line.startsWith(':')) continue;
        else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.releaseLock();
  }
}

/** Tracks streaming timing: time-to-first-token and mean inter-token gap. */
export class StreamTimer {
  readonly start = performance.now();
  private first?: number;
  private last?: number;
  private gaps = 0;
  private gapSum = 0;

  tick(): void {
    const now = performance.now();
    if (this.first === undefined) this.first = now;
    else if (this.last !== undefined) {
      this.gapSum += now - this.last;
      this.gaps++;
    }
    this.last = now;
  }

  result(startedAt: number) {
    const end = performance.now();
    return {
      startedAt,
      firstTokenMs: this.first !== undefined ? Math.round(this.first - this.start) : undefined,
      totalMs: Math.round(end - this.start),
      interTokenMsAvg: this.gaps ? Math.round((this.gapSum / this.gaps) * 100) / 100 : undefined,
    };
  }
}
