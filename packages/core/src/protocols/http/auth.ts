import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AuthConfig } from '../../model/types.js';
import { ApsError } from '../../errors.js';
import type { Redactor } from '../../util/redact.js';

export interface AuthContext {
  redactor?: Redactor;
  signal?: AbortSignal;
  /** Opens a URL in the user's browser (desktop only) — required for authorization_code flows. */
  openExternal?: (url: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * Apply an (already variable-resolved) auth config to request headers/url.
 * Mutates and returns the given headers map and URL.
 */
export async function applyAuth(auth: AuthConfig | undefined, headers: Headers, url: URL, ctx: AuthContext = {}): Promise<void> {
  if (!auth || auth.type === 'none' || auth.type === 'inherit') return;
  const r = ctx.redactor;
  switch (auth.type) {
    case 'apiKey': {
      r?.addSecret(auth.value);
      if (auth.in === 'query') url.searchParams.set(auth.key, auth.value);
      else headers.set(auth.key, auth.value);
      return;
    }
    case 'basic': {
      r?.addSecret(auth.password);
      const enc = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      r?.addSecret(enc);
      headers.set('Authorization', `Basic ${enc}`);
      return;
    }
    case 'bearer': {
      r?.addSecret(auth.token);
      headers.set('Authorization', `${auth.prefix ?? 'Bearer'} ${auth.token}`);
      return;
    }
    case 'jwt': {
      r?.addSecret(auth.secret);
      const token = signJwt(auth.payload, auth.secret, auth.algorithm ?? 'HS256', auth.expiresInSec);
      r?.addSecret(token);
      headers.set('Authorization', `${auth.prefix ?? 'Bearer'} ${token}`);
      return;
    }
    case 'headers': {
      for (const h of auth.headers) if (h.enabled !== false && h.key) headers.set(h.key, h.value);
      return;
    }
    case 'oauth2': {
      const tok = await getOAuth2Token(auth, ctx);
      r?.addSecret(tok.accessToken);
      headers.set('Authorization', `${tok.tokenType || 'Bearer'} ${tok.accessToken}`);
      return;
    }
  }
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signJwt(payloadJson: string, secret: string, alg: 'HS256' | 'HS384' | 'HS512', expiresInSec?: number): string {
  let payload: Record<string, unknown>;
  try {
    payload = payloadJson.trim() ? JSON.parse(payloadJson) : {};
  } catch (e) {
    throw new ApsError('ConfigurationError', 'JWT payload is not valid JSON', { cause: e });
  }
  const now = Math.floor(Date.now() / 1000);
  if (expiresInSec) {
    payload.iat ??= now;
    payload.exp ??= now + expiresInSec;
  }
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const hash = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg];
  const sig = createHmac(hash, secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

async function getOAuth2Token(auth: Extract<AuthConfig, { type: 'oauth2' }>, ctx: AuthContext): Promise<CachedToken> {
  const key = [auth.grantType, auth.tokenUrl, auth.clientId, auth.scope ?? '', auth.username ?? '', auth.audience ?? ''].join('|');
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 10_000) return cached;
  ctx.redactor?.addSecret(auth.clientSecret);
  ctx.redactor?.addSecret(auth.password);

  const form = new URLSearchParams();
  form.set('grant_type', auth.grantType);
  form.set('client_id', auth.clientId);
  if (auth.clientSecret) form.set('client_secret', auth.clientSecret);
  if (auth.scope) form.set('scope', auth.scope);
  if (auth.audience) form.set('audience', auth.audience);

  if (auth.grantType === 'password') {
    form.set('username', auth.username ?? '');
    form.set('password', auth.password ?? '');
  } else if (auth.grantType === 'authorization_code') {
    const { code, verifier, redirectUri } = await authorizationCodeFlow(auth, ctx);
    form.set('code', code);
    form.set('redirect_uri', redirectUri);
    if (verifier) form.set('code_verifier', verifier);
  }

  const f = ctx.fetchImpl ?? fetch;
  const res = await f(auth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
    signal: ctx.signal,
  });
  const text = await res.text();
  if (!res.ok)
    throw new ApsError('AuthenticationError', `OAuth 2.0 token request failed with HTTP ${res.status}`, {
      details: { body: ctx.redactor?.redactString(text.slice(0, 2000)) ?? text.slice(0, 2000) },
      suggestions: ['Check client id/secret and token URL.', 'Check the requested scopes are allowed for this client.'],
    });
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  const accessToken = String(data.access_token ?? '');
  if (!accessToken) throw new ApsError('AuthenticationError', 'OAuth 2.0 token response did not contain access_token');
  const tok: CachedToken = {
    accessToken,
    tokenType: String(data.token_type ?? 'Bearer').replace(/^bearer$/i, 'Bearer'),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
  tokenCache.set(key, tok);
  return tok;
}

/** Authorization Code (+PKCE) flow using a loopback redirect listener. */
async function authorizationCodeFlow(
  auth: Extract<AuthConfig, { type: 'oauth2' }>,
  ctx: AuthContext,
): Promise<{ code: string; verifier?: string; redirectUri: string }> {
  if (!auth.authUrl) throw new ApsError('ConfigurationError', 'Authorization URL is required for the authorization_code grant');
  if (!ctx.openExternal)
    throw new ApsError('ConfigurationError', 'The authorization_code grant needs a browser and is only available in the desktop app', {
      suggestions: ['Use client_credentials in CI, or obtain a token in the desktop app and store it as a secret variable.'],
    });

  const verifier = auth.usePkce !== false ? b64url(randomBytes(32)) : undefined;
  const challenge = verifier ? b64url(createHash('sha256').update(verifier).digest()) : undefined;
  const state = b64url(randomBytes(16));

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif"><h3>${code ? 'Authorization complete' : 'Authorization failed'}</h3><p>You can close this window and return to Protolens.</p></body></html>`);
      clearTimeout(timer);
      server.close();
      if (err || !code) return reject(new ApsError('AuthenticationError', `Authorization failed: ${err ?? 'no code returned'}`));
      if (u.searchParams.get('state') !== state) return reject(new ApsError('AuthenticationError', 'OAuth state mismatch'));
      resolve({ code, verifier, redirectUri });
    });
    let redirectUri = '';
    const timer = setTimeout(() => {
      server.close();
      reject(new ApsError('TimeoutError', 'Timed out waiting for the OAuth redirect'));
    }, 5 * 60_000);
    server.listen(auth.redirectPort ?? 0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const u = new URL(auth.authUrl!);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', auth.clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      if (auth.scope) u.searchParams.set('scope', auth.scope);
      if (auth.audience) u.searchParams.set('audience', auth.audience);
      if (challenge) {
        u.searchParams.set('code_challenge', challenge);
        u.searchParams.set('code_challenge_method', 'S256');
      }
      Promise.resolve(ctx.openExternal!(u.toString())).catch(reject);
    });
  });
}
