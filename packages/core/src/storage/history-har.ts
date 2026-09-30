import type { HistoryEntry, HttpRequestSpec, GraphQLRequestSpec } from '../model/types.js';
import type { WorkspaceStore } from './workspace.js';
import type { Redactor } from '../util/redact.js';
import { historyResponse } from './history-compare.js';
import { ENGINE_VERSION } from '../version.js';

/**
 * Request history as a HAR 1.2 file (browser devtools, Charles, Fiddler, other API tools can open it).
 * HTTP and GraphQL entries only. The URL is the one that was sent; request headers and bodies are as
 * saved in history (`{{variables}}` as written, secrets already replaced); response bodies come from the
 * saved payloads and everything goes through the redactor once more.
 */
export function historyToHar(store: WorkspaceStore, entries: HistoryEntry[], redactor: Redactor): Record<string, unknown> {
  const har = entries
    .filter((h) => (h.kind === 'http' || h.kind === 'graphql') && h.url)
    .map((h) => {
      const url = redactor.redactUrl(h.url!);
      let headers: Array<{ name: string; value: string }> = [];
      let body: { mimeType: string; text: string } | undefined;
      if (h.kind === 'graphql') {
        const g = (h.request ?? {}) as Partial<GraphQLRequestSpec>;
        headers = (g.headers ?? []).filter((x) => x.key && x.enabled !== false).map((x) => ({ name: x.key, value: x.value }));
        const variables = typeof g.variables === 'string' ? safeJson(g.variables) : g.variables;
        body = { mimeType: 'application/json', text: JSON.stringify({ query: g.query, variables, operationName: g.operationName }) };
      } else {
        const r = (h.request ?? {}) as Partial<HttpRequestSpec>;
        headers = (r.headers ?? []).filter((x) => x.key && x.enabled !== false).map((x) => ({ name: x.key, value: x.value }));
        const b = r.body;
        if (b && 'content' in b) body = { mimeType: b.type === 'json' ? 'application/json' : b.type === 'xml' ? 'application/xml' : b.type === 'html' ? 'text/html' : 'text/plain', text: b.content };
        else if (b && b.type === 'form-urlencoded') body = { mimeType: 'application/x-www-form-urlencoded', text: new URLSearchParams(b.fields.filter((f) => f.enabled !== false).map((f): [string, string] => [f.key, f.value])).toString() };
      }
      const res = historyResponse(store, h);
      const contentType = res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
      const status = typeof h.status === 'number' ? h.status : 0;
      let query: Array<{ name: string; value: string }> = [];
      try {
        query = [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
      } catch {
        /* not a full URL */
      }
      return {
        startedDateTime: h.timestamp,
        time: h.durationMs ?? 0,
        comment: h.name,
        request: {
          method: h.method ?? (h.kind === 'graphql' ? 'POST' : 'GET'),
          url,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: headers.map((x) => pair(redactor, x.name, x.value)),
          queryString: query,
          ...(body ? { postData: { mimeType: body.mimeType, text: redactor.redactString(body.text) } } : {}),
          headersSize: -1,
          bodySize: body ? Buffer.byteLength(body.text) : 0,
        },
        response: {
          status,
          statusText: typeof h.status === 'string' ? h.status : '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: res.headers.map(([name, value]) => pair(redactor, name, value)),
          content: {
            size: h.size ?? (res.body ? Buffer.byteLength(res.body) : 0),
            mimeType: contentType,
            ...(res.body !== undefined ? { text: redactor.redactString(res.body) } : {}),
            ...(res.bodyTruncated ? { comment: 'Body truncated' } : res.bodyMissing ? { comment: 'Body not kept in history' } : {}),
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: h.size ?? -1,
        },
        cache: {},
        timings: { send: 0, wait: h.durationMs ?? 0, receive: 0 },
      };
    });
  return { log: { version: '1.2', creator: { name: 'TestPion', version: ENGINE_VERSION }, entries: har } };
}

/** A HAR name/value pair, masked when the name is sensitive (Authorization, Cookie, X-Api-Key …). */
function pair(redactor: Redactor, name: string, value: string): { name: string; value: string } {
  const [n, v] = redactor.redact([name, value]);
  return { name: n!, value: v! };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
