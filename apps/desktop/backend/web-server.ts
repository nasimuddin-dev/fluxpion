/**
 * Development bridge: serves the backend over HTTP (POST /rpc, GET /events as SSE) so the UI can be
 * developed and tested in a regular browser. Binds to 127.0.0.1 only and requires a per-process token.
 * Secrets use an in-memory store in this mode (nothing is written to disk in plain text).
 */
import { createServer, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Backend } from './backend.js';

const port = Number(process.env.APS_BRIDGE_PORT ?? 5174);
const token = process.env.APS_BRIDGE_TOKEN ?? randomBytes(16).toString('hex');
const clients = new Set<ServerResponse>();

const backend = new Backend({
  appDir: process.env.APS_HOME || join(homedir(), '.aipstudio-dev'),
  emit: (channel, payload) => {
    const data = `data: ${JSON.stringify({ channel, payload })}\n\n`;
    for (const c of clients) c.write(data);
  },
  openExternal: (url) => console.log(`[bridge] open ${url}`),
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.searchParams.get('token') !== token && req.headers['x-aps-token'] !== token) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/rpc' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    const { method, params } = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    try {
      res.end(JSON.stringify({ ok: true, data: (await backend.invoke(method, params)) ?? null }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e }));
    }
    return;
  }
  res.writeHead(404).end();
}).listen(port, '127.0.0.1', () => {
  console.log(`[bridge] backend listening on http://127.0.0.1:${port} (token ${token})`);
});
