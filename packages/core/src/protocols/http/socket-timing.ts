/**
 * DNS, TCP and TLS timing of the connection a request went over. Node publishes every new client socket on the
 * `net.client.socket` diagnostics channel (its lookup / connect / secureConnect events are timed here), and undici
 * publishes `undici:client:sendHeaders` with the socket each request is written to, which ties the two together.
 */
import { subscribe } from 'node:diagnostics_channel';

interface SocketTimes {
  created: number;
  lookup?: number;
  connect?: number;
  secure?: number;
}

/** What the request was sent over: when its headers were written and the socket's timings and peer. */
export interface SentOver {
  sentAt: number;
  times?: SocketTimes;
  remoteAddress?: string;
  remotePort?: number;
  tlsProtocol?: string;
  cipher?: string;
}

type Sock = {
  once(event: string, fn: () => void): void;
  remoteAddress?: string;
  remotePort?: number;
  getProtocol?: () => string | null;
  getCipher?: () => { name?: string } | undefined;
};

const times = new WeakMap<object, SocketTimes>();
subscribe('net.client.socket', (m) => {
  const socket = (m as { socket?: Sock }).socket;
  if (!socket) return;
  const t: SocketTimes = { created: performance.now() };
  times.set(socket, t);
  socket.once('lookup', () => (t.lookup = performance.now()));
  socket.once('connect', () => (t.connect = performance.now()));
  socket.once('secureConnect', () => (t.secure = performance.now()));
});

interface Waiter {
  origin: string;
  path: string;
  method: string;
  sent?: SentOver;
}
const waiters = new Set<Waiter>();
subscribe('undici:client:sendHeaders', (m) => {
  if (!waiters.size) return;
  const { request, socket } = m as { request?: { origin?: unknown; path?: string; method?: string }; socket?: Sock };
  if (!request || !socket) return;
  const origin = String(request.origin);
  for (const w of waiters) {
    if (w.sent || w.origin !== origin || w.path !== request.path || w.method !== request.method) continue;
    let tlsProtocol: string | undefined;
    let cipher: string | undefined;
    try {
      tlsProtocol = socket.getProtocol?.() ?? undefined;
      cipher = socket.getCipher?.()?.name;
    } catch {
      /* a plain socket, or already closed */
    }
    w.sent = { sentAt: performance.now(), times: times.get(socket), remoteAddress: socket.remoteAddress, remotePort: socket.remotePort, tlsProtocol, cipher };
    waiters.delete(w);
    return;
  }
});

/** Watch for the first time a request for this URL is written; read the result once the response has started. */
export function watchSend(url: URL, method: string): { result(): SentOver | undefined; stop(): void } {
  const w: Waiter = { origin: url.origin, path: url.pathname + url.search, method: method.toUpperCase() };
  // a request that failed before stop() leaves its waiter: drop the oldest ones past a bound
  if (waiters.size >= 200) waiters.delete(waiters.values().next().value!);
  waiters.add(w);
  return { result: () => w.sent, stop: () => waiters.delete(w) };
}
