import { describe, it, expect, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { Server } from 'socket.io';
import { runRealtimeExchange } from '../../packages/core/src/index.js';

const closers: Array<() => void> = [];
afterAll(() => closers.forEach((c) => c()));

describe('realtime exchange (CLI `testpion ws`, MCP realtime_exchange)', () => {
  it('WebSocket: sends messages in order and collects the replies', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss.once('listening', r));
    wss.on('connection', (ws) => ws.on('message', (d) => ws.send(`echo:${d}`)));
    closers.push(() => wss.close());
    const r = await runRealtimeExchange({ url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, send: ['a', 'b'], waitMs: 300 });
    expect(r).toMatchObject({ mode: 'websocket', connected: true });
    expect(r.messages.filter((m) => m.direction === 'received').map((m) => m.data)).toEqual(['echo:a', 'echo:b']);
  });

  it('Socket.IO: emits events with acknowledgements (mode from the http URL)', async () => {
    const http = createServer();
    const io = new Server(http);
    io.on('connection', (s) => s.on('add', (a: number, b: number, ack: (n: number) => void) => ack(a + b)));
    await new Promise<void>((ok) => http.listen(0, '127.0.0.1', () => ok()));
    closers.push(() => io.close());
    const r = await runRealtimeExchange({ url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, send: [{ event: 'add', args: [2, 3], ack: true }], waitMs: 100 });
    expect(r.mode).toBe('socketio');
    expect(r.messages.find((m) => m.ack)?.data).toBe('5');
  });

  it('reports a failed connection once, without throwing', async () => {
    const r = await runRealtimeExchange({ url: 'ws://127.0.0.1:1', waitMs: 0 });
    expect(r.connected).toBe(false);
    expect(r.messages.filter((m) => /connection refused/.test(m.data))).toHaveLength(1);
  });
});
