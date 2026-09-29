import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { CookieJar, McpSession, WebSocketSession } from '../../packages/core/src/index.js';

describe('the workspace cookie jar on WebSocket and MCP HTTP connections', () => {
  it('sends matching cookies on the WebSocket handshake', async () => {
    let seen: string | undefined;
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', (_s, req) => (seen = req.headers.cookie));
    await new Promise((r) => wss.once('listening', r));
    const port = (wss.address() as AddressInfo).port;
    const jar = new CookieJar();
    jar.storeFromResponse(`http://127.0.0.1:${port}/login`, ['session=abc123; Path=/', 'other=x; Path=/admin']);
    const s = new WebSocketSession(`ws://127.0.0.1:${port}/socket`, { cookieJar: jar });
    try {
      await s.connect(5000);
      await new Promise((r) => setTimeout(r, 100));
      expect(seen).toBe('session=abc123');
    } finally {
      s.close();
      await new Promise((r) => wss.close(r));
    }
  });

  it('an explicit Cookie header wins over the jar', async () => {
    let seen: string | undefined;
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', (_s, req) => (seen = req.headers.cookie));
    await new Promise((r) => wss.once('listening', r));
    const port = (wss.address() as AddressInfo).port;
    const jar = new CookieJar();
    jar.storeFromResponse(`http://127.0.0.1:${port}/`, ['session=fromjar; Path=/']);
    const s = new WebSocketSession(`ws://127.0.0.1:${port}/`, { cookieJar: jar, headers: [{ key: 'Cookie', value: 'session=manual' }] });
    try {
      await s.connect(5000);
      await new Promise((r) => setTimeout(r, 100));
      expect(seen).toBe('session=manual');
    } finally {
      s.close();
      await new Promise((r) => wss.close(r));
    }
  });

  it('sends cookies to an HTTP MCP server and keeps the ones it sets', async () => {
    const seen: Array<string | undefined> = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.cookie);
      req.resume();
      // not a real MCP server: set a cookie and fail, which is enough to test the transport
      res.writeHead(500, { 'set-cookie': 'mcp_session=s1; Path=/', 'content-type': 'text/plain' });
      res.end('nope');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    const jar = new CookieJar();
    jar.storeFromResponse(`http://127.0.0.1:${port}/`, ['auth=tok; Path=/']);
    const s = new McpSession({ id: 'x', name: 'x', transport: 'streamable-http', url: `http://127.0.0.1:${port}/mcp` }, undefined, { cookieJar: jar });
    try {
      await expect(s.connect(5000)).rejects.toThrow();
      expect(seen[0]).toBe('auth=tok');
      expect(jar.headerFor(`http://127.0.0.1:${port}/`)).toContain('mcp_session=s1');
    } finally {
      await s.close().catch(() => undefined);
      await new Promise((r) => server.close(r));
    }
  });
});
