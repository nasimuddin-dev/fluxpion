import { ApsError } from '../errors.js';
import type { KeyValue } from '../model/types.js';
import type { CookieJar } from '../cookies/cookie-jar.js';
import type { Redactor } from '../util/redact.js';
import { SocketIoSession } from './socketio/socketio.js';
import { WebSocketSession } from './websocket/websocket.js';

/**
 * One scripted exchange with a real-time server, for the CLI and AI agents: connect (WebSocket or
 * Socket.IO), send messages / emit events in order, collect everything received for a while, close.
 */
export interface RealtimeExchange {
  url: string;
  mode?: 'websocket' | 'socketio';
  /** WebSocket: text frames. Socket.IO: `{ event, args?, ack? }`. */
  send?: Array<string | { event: string; args?: unknown[]; ack?: boolean }>;
  /** How long to keep listening after the last message was sent (ms, default 1500, max 60000). */
  waitMs?: number;
  headers?: KeyValue[];
  protocols?: string[];
  /** Socket.IO handshake auth payload, and path. */
  auth?: Record<string, unknown>;
  path?: string;
}

export interface RealtimeResult {
  mode: 'websocket' | 'socketio';
  connected: boolean;
  messages: Array<{ atMs: number; direction: 'sent' | 'received' | 'system'; event?: string; ack?: boolean; data: string }>;
  durationMs: number;
}

export async function runRealtimeExchange(x: RealtimeExchange, opts: { redactor?: Redactor; cookieJar?: CookieJar; signal?: AbortSignal } = {}): Promise<RealtimeResult> {
  const t0 = Date.now();
  const mode = x.mode ?? (/^https?:/i.test(x.url) ? 'socketio' : 'websocket');
  const wait = Math.min(Math.max(x.waitMs ?? 1500, 0), 60_000);
  const messages: RealtimeResult['messages'] = [];
  const redact = (s: string) => opts.redactor?.redactString(s) ?? s;
  const record = (m: { direction: 'sent' | 'received' | 'system'; data: string; event?: string; ack?: boolean }) =>
    messages.length < 1000 && messages.push({ atMs: Date.now() - t0, direction: m.direction, ...(m.event ? { event: m.event } : {}), ...(m.ack ? { ack: true } : {}), data: redact(m.data).slice(0, 20_000) });

  if (mode === 'socketio') {
    const s = new SocketIoSession(x.url, { headers: x.headers, auth: x.auth, path: x.path });
    s.onMessage(record);
    try {
      await s.connect();
      for (const item of x.send ?? []) {
        if (opts.signal?.aborted) break;
        const e = typeof item === 'string' ? { event: item, args: [] } : item;
        await s.emit(e.event, e.args ?? [], e.ack).catch(() => undefined); // a missing ack is recorded as a message
      }
      await sleep(wait, opts.signal);
      return { mode, connected: true, messages, durationMs: Date.now() - t0 };
    } catch (e) {
      if (s.status === 'closed' && !messages.some((m) => m.direction === 'received')) {
        if (!messages.some((m) => m.data.includes((e as Error).message))) record({ direction: 'system', data: (e as Error).message });
        return { mode, connected: false, messages, durationMs: Date.now() - t0 };
      }
      throw e;
    } finally {
      s.close();
    }
  }

  const s = new WebSocketSession(x.url, { protocols: x.protocols, headers: x.headers, cookieJar: opts.cookieJar });
  s.onMessage((m) => record({ direction: m.direction, data: m.data }));
  try {
    await s.connect();
  } catch (e) {
    // the session already logged the reason as a system message
    const msg = (e as Error).message;
    if (!messages.some((m) => m.data.includes(msg))) record({ direction: 'system', data: msg });
    return { mode, connected: false, messages, durationMs: Date.now() - t0 };
  }
  try {
    for (const item of x.send ?? []) {
      if (opts.signal?.aborted) break;
      if (typeof item !== 'string') throw new ApsError('ValidationError', 'WebSocket messages are text: give strings (JSON as text)');
      s.send(item);
      await sleep(20);
    }
    await sleep(wait, opts.signal);
    return { mode, connected: true, messages, durationMs: Date.now() - t0 };
  } finally {
    s.close();
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), ok()), { once: true });
  });
