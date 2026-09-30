import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect as netConnect, type AddressInfo } from 'node:net';
import { bypassed, executeHttp, proxyFor, setProxySettings } from '../../packages/core/src/index.js';

describe('proxy rules', () => {
  afterAll(() => setProxySettings({ mode: 'env' }));

  it('NO_PROXY matching: *, hosts with subdomains, .suffix, host:port, IPs', () => {
    const u = (s: string) => new URL(s);
    expect(bypassed(u('http://localhost:3000/'), 'localhost')).toBe(true);
    expect(bypassed(u('https://api.internal.example.com/'), '.example.com')).toBe(true);
    expect(bypassed(u('https://example.com/'), '.example.com')).toBe(true);
    expect(bypassed(u('https://api.example.com/'), 'example.com')).toBe(true);
    expect(bypassed(u('https://notexample.com/'), 'example.com')).toBe(false);
    expect(bypassed(u('http://10.0.0.5:8080/'), '10.0.0.5:8080')).toBe(true);
    expect(bypassed(u('http://10.0.0.5:9090/'), '10.0.0.5:8080')).toBe(false);
    expect(bypassed(u('https://anything.test/'), '*')).toBe(true);
    expect(bypassed(u('https://a.test/'), '')).toBe(false);
  });

  it('chooses the proxy per mode: environment variables, custom with bypass, off', () => {
    const env = { HTTPS_PROXY: 'http://corp:3128', NO_PROXY: 'localhost,.corp.local' };
    setProxySettings({ mode: 'env' });
    expect(proxyFor('https://api.github.com/', env)).toBe('http://corp:3128');
    expect(proxyFor('https://git.corp.local/', env)).toBeUndefined();
    expect(proxyFor('http://plain.example/', env)).toBeUndefined(); // no HTTP_PROXY
    setProxySettings({ mode: 'custom', url: 'http://mine:8080', bypass: 'localhost' });
    expect(proxyFor('https://api.github.com/', env)).toBe('http://mine:8080');
    expect(proxyFor('https://git.corp.local/', env)).toBe('http://mine:8080'); // the environment's NO_PROXY does not apply
    expect(proxyFor('http://localhost:1/', env)).toBeUndefined();
    setProxySettings({ mode: 'off' });
    expect(proxyFor('https://api.github.com/', env)).toBeUndefined();
    expect(() => setProxySettings({ mode: 'custom', url: 'not a url' })).toThrow();
  });
});

describe('requests through a proxy', () => {
  let target: Server;
  let proxy: Server;
  let targetUrl: string;
  let proxyUrl: string;
  const seen: Array<{ host: string; auth?: string }> = [];
  beforeAll(async () => {
    target = createServer((req, res) => res.end(`hello from ${req.url}`));
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    // a minimal forward proxy: absolute-URI requests (http targets) and CONNECT tunnels (https targets)
    proxy = createServer((req, res) => {
      const u = new URL(req.url!);
      seen.push({ host: u.host, auth: req.headers['proxy-authorization'] });
      const { 'proxy-authorization': _auth, ...headers } = req.headers;
      const up = httpRequest({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => res.writeHead(502).end());
      req.pipe(up);
    });
    proxy.on('connect', (req, client, head) => {
      seen.push({ host: req.url!, auth: req.headers['proxy-authorization'] });
      const [host, port] = req.url!.split(':');
      const up = netConnect(Number(port), host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.write(head);
        up.pipe(client).pipe(up);
      });
      up.on('error', () => client.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    setProxySettings({ mode: 'env' });
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => target.close(r));
  });

  it('sends through the custom proxy with credentials, and bypasses listed hosts', async () => {
    setProxySettings({ mode: 'custom', url: proxyUrl, username: 'ada', password: 'p@ss:word' });
    const r = await executeHttp({ method: 'GET', url: `${targetUrl}/via-proxy` });
    expect(r.response.status).toBe(200);
    expect(seen.at(-1)).toEqual({ host: new URL(targetUrl).host, auth: `Basic ${Buffer.from('ada:p@ss:word').toString('base64')}` });

    const before = seen.length;
    setProxySettings({ mode: 'custom', url: proxyUrl, bypass: '127.0.0.1' });
    const direct = await executeHttp({ method: 'GET', url: `${targetUrl}/direct` });
    expect(direct.response.status).toBe(200);
    expect(seen.length).toBe(before);

    // global fetch (AI providers, MCP over HTTP) follows the same settings
    setProxySettings({ mode: 'custom', url: proxyUrl });
    expect(await (await fetch(`${targetUrl}/fetch`)).text()).toBe('hello from /fetch');
    expect(seen.length).toBe(before + 1);

    setProxySettings({ mode: 'off' });
    await executeHttp({ method: 'GET', url: `${targetUrl}/off` });
    expect(seen.length).toBe(before + 1);
  });

  it("a request's own proxy wins", async () => {
    setProxySettings({ mode: 'off' });
    const before = seen.length;
    const r = await executeHttp({ method: 'GET', url: `${targetUrl}/own`, settings: { proxy: proxyUrl } });
    expect(r.response.status).toBe(200);
    expect(seen.length).toBe(before + 1);
  });
});
