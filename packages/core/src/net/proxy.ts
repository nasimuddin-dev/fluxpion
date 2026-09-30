import { Agent, EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher, type Dispatcher } from 'undici';
import { Agent as HttpAgent, request as httpRequest, type AgentOptions, type IncomingMessage } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';
import type { Duplex } from 'node:stream';
import { policyLookup } from './policy.js';

/**
 * Outbound proxy for everything the engine sends over HTTP (requests, pm.sendRequest, OAuth token
 * calls, AI providers, MCP over HTTP, remote datasets, WebSocket and Socket.IO handshakes):
 * - `env` (default): the standard HTTP_PROXY / HTTPS_PROXY / NO_PROXY variables, as curl and most CLIs do;
 * - `custom`: one proxy URL (optionally with a user name and password) and a bypass list;
 * - `off`: connect directly, even when the variables are set.
 * A request's own proxy setting wins over this. gRPC is not covered (grpc-js reads the same
 * environment variables itself).
 */
export interface ProxySettings {
  mode: 'env' | 'custom' | 'off';
  /** custom: http://host:port (https:// proxies work too). */
  url?: string;
  /** custom: hosts that go direct, comma separated, like NO_PROXY: `localhost, .internal.example, 10.0.0.1`. */
  bypass?: string;
  /** custom: proxy user name; the password is passed separately (it lives in the secret store). */
  username?: string;
  password?: string;
}

let settings: ProxySettings = { mode: 'env' };
let generation = 0;
let base: Dispatcher | undefined;
let wsBase: Dispatcher | undefined;

const withAuth = (url: string, username?: string, password?: string) => {
  if (!username) return url;
  const u = new URL(url);
  u.username = encodeURIComponent(username);
  u.password = encodeURIComponent(password ?? '');
  return u.toString();
};

/** Proxy options for undici's EnvHttpProxyAgent (undefined keys fall back to the environment). */
function proxyOptions(): { httpProxy?: string; httpsProxy?: string; noProxy?: string } {
  if (settings.mode !== 'custom' || !settings.url?.trim()) return {};
  const uri = withAuth(settings.url.trim(), settings.username, settings.password);
  // with a custom proxy, NO_PROXY from the environment must not apply: the bypass list replaces it
  return { httpProxy: uri, httpsProxy: uri, noProxy: settings.bypass?.trim() || '' };
}

/**
 * A dispatcher for these TLS / connect options that honours the proxy settings (a per-request proxy
 * overrides them). The SSRF guard (`policyLookup`) always applies to direct connections.
 */
export function makeDispatcher(connect: Record<string, unknown> = {}, requestProxy?: string, pool: Record<string, unknown> = {}): Dispatcher {
  const c = { lookup: policyLookup, ...connect };
  if (requestProxy) return new ProxyAgent({ uri: requestProxy, connect: c, requestTls: c as never, ...pool });
  if (settings.mode === 'off') return new Agent({ connect: c as never, ...pool });
  return new EnvHttpProxyAgent({ ...proxyOptions(), connect: c as never, requestTls: c as never, ...pool } as never);
}

/** The shared dispatcher for requests with default TLS settings (also used by global `fetch`). */
export function baseDispatcher(): Dispatcher {
  return (base ??= makeDispatcher({}, undefined, { connections: 256, pipelining: 1, keepAliveTimeout: 10_000 }));
}

/** For WebSocket handshakes: always a CONNECT tunnel through the proxy (proxies can't forward a ws:// upgrade otherwise). */
export function websocketDispatcher(): Dispatcher {
  return (wsBase ??= makeDispatcher({}, undefined, { proxyTunnel: true }));
}

/** Changes whenever the proxy settings change, so callers can drop cached dispatchers. */
export function proxyGeneration(): number {
  return generation;
}

export function getProxySettings(): ProxySettings {
  return { ...settings, password: settings.password ? '••••' : undefined };
}

/** Apply new proxy settings (the app's Settings, or the CLI's defaults). Global `fetch` follows them too. */
export function setProxySettings(p: ProxySettings): void {
  if (p.mode === 'custom' && p.url) new URL(p.url); // throws on a malformed URL before anything changes
  settings = { ...p };
  generation++;
  const old = [base, wsBase];
  base = wsBase = undefined;
  setGlobalDispatcher(baseDispatcher());
  for (const d of old) void d?.close().catch(() => undefined);
}

/** Which proxy a URL would use under the current settings (for the UI, `testpion` diagnostics and tests). */
export function proxyFor(url: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (settings.mode === 'off') return undefined;
  const u = new URL(url);
  const custom = settings.mode === 'custom' && settings.url?.trim();
  const proxy = custom ? settings.url!.trim() : u.protocol === 'https:' ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy : env.HTTP_PROXY ?? env.http_proxy;
  if (!proxy) return undefined;
  const noProxy = (custom ? settings.bypass : env.NO_PROXY ?? env.no_proxy) ?? '';
  return bypassed(u, noProxy) ? undefined : proxy;
}

/** NO_PROXY rules: `*`, host names (also matching subdomains), `.suffix`, host:port, IP addresses. */
export function bypassed(u: URL, noProxy: string): boolean {
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return noProxy
    .split(/[,\s]+/)
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule === '*') return true;
      const [h, p] = rule.startsWith('[') ? [rule.slice(1, rule.indexOf(']')), rule.split(']:')[1]] : rule.split(':');
      if (p && p !== port) return false;
      const name = h!.replace(/^\*?\./, '');
      return host === name || host.endsWith(`.${name}`);
    });
}

/** The proxy URL for a target, with the custom proxy's credentials (for clients that aren't undici). */
function proxyUriFor(url: string): string | undefined {
  const proxy = proxyFor(url);
  if (!proxy) return undefined;
  return settings.mode === 'custom' ? withAuth(proxy, settings.username, settings.password) : proxy;
}

/**
 * A Node `http.Agent` that tunnels through the proxy with CONNECT, for clients built on Node's http
 * module (Socket.IO's engine.io); undefined when the target goes direct. ws:// and http:// targets get
 * a plain tunnel, wss:// and https:// a TLS connection inside it.
 */
export function proxyAgentFor(url: string): HttpAgent | undefined {
  const target = new URL(url.replace(/^ws(s?):/i, 'http$1:'));
  const uri = proxyUriFor(target.toString());
  if (!uri) return undefined;
  const p = new URL(uri);
  const auth = p.username ? `Basic ${Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64')}` : undefined;
  const secure = target.protocol === 'https:';
  const createConnection = (opts: ConnectionOptions & { host?: string; port?: number | string }, cb: (err: Error | null, socket?: Duplex) => void) => {
    const hostPort = `${opts.host}:${opts.port}`;
    const req = (p.protocol === 'https:' ? httpsRequest : httpRequest)({
      host: p.hostname,
      port: p.port || (p.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: hostPort,
      headers: { host: hostPort, ...(auth ? { 'proxy-authorization': auth } : {}) },
    });
    req.once('connect', (res: IncomingMessage, socket: Duplex) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return cb(new Error(`The proxy refused the connection to ${hostPort} (HTTP ${res.statusCode})`));
      }
      cb(null, secure ? tlsConnect({ ...opts, socket: socket as never, servername: opts.servername ?? opts.host }) : socket);
    });
    req.once('error', (e) => cb(e));
    req.end();
    return undefined;
  };
  const Base = secure ? HttpsAgent : HttpAgent;
  const agent = new Base({ keepAlive: false } as AgentOptions);
  (agent as unknown as { createConnection: typeof createConnection }).createConnection = createConnection;
  return agent;
}

