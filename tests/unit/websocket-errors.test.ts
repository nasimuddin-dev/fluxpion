import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketSession } from '../../packages/core/src/index.js';

// A failed WebSocket handshake used to surface as an empty error: each cause now has its own message.
const fail = async (url: string) => {
  const s = new WebSocketSession(url);
  try {
    await s.connect(8000);
    s.close();
    return undefined;
  } catch (e) {
    return e as Error & { kind: string; suggestions: string[] };
  }
};

describe('WebSocket connection errors', () => {
  it('explains unknown hosts, closed ports, HTTP answers and TLS mismatches', async () => {
    const http = createServer((req, res) => res.writeHead(req.url === '/private' ? 401 : 200).end('hello'));
    await new Promise<void>((ok) => http.listen(0, '127.0.0.1', () => ok()));
    const port = (http.address() as AddressInfo).port;
    try {
      expect((await fail('wss://no-such-host.invalid/socket'))!.message).toBe('Can\'t find the server "no-such-host.invalid" (its name doesn\'t resolve)');
      expect((await fail('ws://127.0.0.1:1'))!.message).toBe('Nothing is listening on 127.0.0.1:1 (connection refused)');
      expect((await fail(`ws://127.0.0.1:${port}/`))!.message).toBe('The server answered HTTP 200 OK instead of opening a WebSocket');
      const auth = (await fail(`ws://127.0.0.1:${port}/private`))!;
      expect(auth.message).toMatch(/HTTP 401/);
      expect(auth.suggestions[0]).toMatch(/Handshake headers/);
      expect((await fail(`wss://127.0.0.1:${port}/`))!.message).toBe(`127.0.0.1:${port} doesn't use TLS on this port, but the URL starts with wss://`);
    } finally {
      http.close();
    }
  });
});
