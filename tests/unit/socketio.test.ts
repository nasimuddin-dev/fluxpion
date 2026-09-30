import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { SocketIoSession, type SocketIoMessage } from '../../packages/core/src/index.js';

let io: Server;
let base = '';

beforeAll(async () => {
  const http = createServer();
  io = new Server(http);
  io.of('/chat').use((socket, next) => (socket.handshake.auth?.token === 'secret' ? next() : next(Object.assign(new Error('not authorized'), { data: { code: 401 } }))));
  io.of('/chat').on('connection', (socket) => {
    socket.emit('welcome', { user: socket.handshake.headers['x-user'] ?? 'anon' });
    socket.on('say', (msg: unknown, ack?: (r: unknown) => void) => {
      socket.emit('said', msg);
      ack?.({ ok: true, echo: msg });
    });
    socket.on('silent', () => undefined);
  });
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => io.close());

describe('Socket.IO', () => {
  it('connects to a namespace with auth and headers, receives events, emits with and without acknowledgement', async () => {
    const s = new SocketIoSession(`${base}/chat`, { auth: { token: 'secret' }, headers: [{ key: 'X-User', value: 'ada' }] });
    const msgs: SocketIoMessage[] = [];
    s.onMessage((m) => msgs.push(m));
    await s.connect();
    expect(s.status).toBe('open');
    await new Promise((r) => setTimeout(r, 150));
    expect(msgs.find((m) => m.event === 'welcome')?.data).toBe('{"user":"ada"}');
    const ack = await s.emit('say', [{ text: 'hi' }], true);
    expect(ack).toEqual([{ ok: true, echo: { text: 'hi' } }]);
    await s.emit('say', ['plain']);
    await new Promise((r) => setTimeout(r, 150));
    expect(msgs.filter((m) => m.event === 'said').map((m) => m.data)).toEqual(['{"text":"hi"}', '"plain"']);
    expect(msgs.some((m) => m.ack && m.event === 'say')).toBe(true);
    await expect(s.emit('silent', [], true, 300)).rejects.toThrow(/No acknowledgement/);
    s.close();
    expect(s.status).toBe('closed');
  });

  it('reports refused connections and unreachable servers clearly', async () => {
    await expect(new SocketIoSession(`${base}/chat`, { auth: { token: 'wrong' } }).connect()).rejects.toThrow(/not authorized.*401/);
    await expect(new SocketIoSession('http://127.0.0.1:1', { timeoutMs: 3000 }).connect()).rejects.toThrow(/Socket.IO connection failed/);
  });
});
