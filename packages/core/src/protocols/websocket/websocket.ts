import { assertUrlAllowed } from '../../net/policy.js';
import { WebSocket as UndiciWebSocket } from 'undici';
import { ApsError } from '../../errors.js';
import { shortId } from '../../util/ids.js';
import type { KeyValue } from '../../model/types.js';
import type { CookieJar } from '../../cookies/cookie-jar.js';

export interface WsMessage {
  id: string;
  time: number;
  direction: 'sent' | 'received' | 'system';
  data: string;
  binary?: boolean;
  size: number;
}

/** Interactive WebSocket session with a bounded in-memory message log. */
export class WebSocketSession {
  private ws?: InstanceType<typeof UndiciWebSocket>;
  readonly id = shortId('ws-');
  private listeners: Array<(m: WsMessage) => void> = [];
  private statusListeners: Array<(s: string) => void> = [];
  status: 'connecting' | 'open' | 'closed' = 'closed';

  constructor(
    readonly url: string,
    /** `cookieJar`: cookies for the handshake URL (e.g. a login session) are sent, like with HTTP requests. */
    private opts: { protocols?: string[]; headers?: KeyValue[]; cookieJar?: CookieJar } = {},
  ) {}

  onMessage(l: (m: WsMessage) => void): () => void {
    this.listeners.push(l);
    return () => (this.listeners = this.listeners.filter((x) => x !== l));
  }

  onStatus(l: (s: string) => void): () => void {
    this.statusListeners.push(l);
    return () => (this.statusListeners = this.statusListeners.filter((x) => x !== l));
  }

  private emit(direction: WsMessage['direction'], data: string, binary = false, size = data.length) {
    const m: WsMessage = { id: shortId(), time: Date.now(), direction, data: data.length > 256 * 1024 ? data.slice(0, 256 * 1024) + '… [truncated]' : data, binary, size };
    for (const l of this.listeners) l(m);
  }

  private setStatus(s: WebSocketSession['status']) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  async connect(timeoutMs = 15_000): Promise<void> {
    // the handshake is an HTTP request: the network policy applies as for http:// and https://
    try {
      await assertUrlAllowed(this.url.replace(/^ws(s?):/i, 'http$1:'));
    } catch (e) {
      if (e instanceof ApsError) throw e;
      /* an invalid URL is reported below */
    }
    return this.open(timeoutMs);
  }

  private open(timeoutMs: number): Promise<void> {
    const headers: Record<string, string> = {};
    for (const h of this.opts.headers ?? []) if (h.enabled !== false && h.key) headers[h.key] = h.value;
    // the handshake is an HTTP request: ws:// and wss:// use the cookies of http:// and https://
    if (this.opts.cookieJar && !Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')) {
      try {
        const cookie = this.opts.cookieJar.headerFor(this.url.replace(/^ws(s?):/i, 'http$1:'));
        if (cookie) headers.Cookie = cookie;
      } catch {
        /* invalid URL: reported by the connection below */
      }
    }
    this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      let ws: InstanceType<typeof UndiciWebSocket>;
      try {
        ws = new UndiciWebSocket(this.url, { protocols: this.opts.protocols, headers } as never);
      } catch (e) {
        this.setStatus('closed');
        return reject(new ApsError('ConfigurationError', `Invalid WebSocket URL: ${(e as Error).message}`));
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        ws.close();
        reject(new ApsError('TimeoutError', `WebSocket connection timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        this.setStatus('open');
        this.emit('system', `Connected${ws.protocol ? ` (protocol ${ws.protocol})` : ''}`);
        resolve();
      });
      ws.addEventListener('message', (ev) => {
        const d = ev.data;
        if (typeof d === 'string') this.emit('received', d);
        else {
          const buf = Buffer.from(d as ArrayBuffer);
          this.emit('received', buf.toString('base64'), true, buf.length);
        }
      });
      ws.addEventListener('error', (ev) => {
        clearTimeout(timer);
        const msg = (ev as unknown as { error?: Error; message?: string }).error?.message ?? 'WebSocket error';
        this.emit('system', `Error: ${msg}`);
        if (this.status === 'connecting') reject(new ApsError('NetworkError', msg));
      });
      ws.addEventListener('close', (ev) => {
        clearTimeout(timer);
        this.emit('system', `Closed (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''})`);
        this.setStatus('closed');
      });
    });
  }

  send(data: string): void {
    if (!this.ws || this.status !== 'open') throw new ApsError('ProtocolError', 'WebSocket is not open');
    this.ws.send(data);
    this.emit('sent', data);
  }

  close(code = 1000, reason = ''): void {
    this.ws?.close(code, reason);
  }
}
