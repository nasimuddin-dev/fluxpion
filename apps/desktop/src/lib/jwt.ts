/** Decode JWTs in the browser (no verification: no keys), as core's util/jwt.ts does on the engine side. */

export interface DecodedJwt {
  token: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  expiresInSec?: number;
}

const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

function part(s: string): Record<string, unknown> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const v = JSON.parse(json) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
  return v as Record<string, unknown>;
}

export function decodeJwt(token: string): DecodedJwt | undefined {
  const [h, p] = token.split('.');
  if (!h || !p) return undefined;
  try {
    const payload = part(p);
    return { token, header: part(h), payload, expiresInSec: typeof payload.exp === 'number' ? Math.round(payload.exp - Date.now() / 1000) : undefined };
  } catch {
    return undefined;
  }
}

/** The JWTs in a response: its body and header values, each once (at most 10). */
export function findJwts(texts: string[]): DecodedJwt[] {
  const out: DecodedJwt[] = [];
  for (const t of texts)
    for (const m of t.matchAll(JWT_RE)) {
      if (out.some((d) => d.token === m[0])) continue;
      const d = decodeJwt(m[0]);
      if (d) out.push(d);
      if (out.length >= 10) return out;
    }
  return out;
}

export function describeExpiry(sec: number): string {
  const a = Math.abs(sec);
  const v = a < 120 ? `${a} s` : a < 7200 ? `${Math.round(a / 60)} min` : a < 172800 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} days`;
  return sec > 0 ? `expires in ${v}` : `expired ${v} ago`;
}
