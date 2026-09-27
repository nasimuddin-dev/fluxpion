import { parse as parseYaml } from 'yaml';
import type { AuthConfig, BodyConfig, Collection, CollectionFolder, CollectionNode, Environment, KeyValue, SavedExample, SavedHttpRequest } from '../model/types.js';
import { SCHEMA_VERSION } from '../model/types.js';
import { ApsError } from '../errors.js';
import { shortId, slugify } from '../util/ids.js';

function newCollection(name: string, items: CollectionNode[], extra: Partial<Collection> = {}): Collection {
  return { schemaVersion: SCHEMA_VERSION, id: slugify(name) + '-' + shortId().slice(-4), name, version: 0, variables: [], items, updatedAt: new Date().toISOString(), ...extra };
}

export function detectFormat(text: string): 'openapi' | 'swagger' | 'postman' | 'postman-env' | 'har' | 'aps-collection' | 'aps-workspace' | 'graphql-sdl' | 'unknown' {
  const t = text.trim();
  if (/^(type|schema|interface|enum|input|scalar|union|directive|extend)\s/m.test(t) && !t.startsWith('{')) return 'graphql-sdl';
  let d: Record<string, any>;
  try {
    d = t.startsWith('{') || t.startsWith('[') ? JSON.parse(t) : parseYaml(t);
  } catch {
    return 'unknown';
  }
  if (!d || typeof d !== 'object') return 'unknown';
  if (d.openapi) return 'openapi';
  if (d.swagger) return 'swagger';
  if (d.info?._postman_id || String(d.info?.schema ?? '').includes('postman')) return 'postman';
  if (d._postman_variable_scope === 'environment' || (Array.isArray(d.values) && d.name)) return 'postman-env';
  if (d.log?.entries) return 'har';
  if (d.format === 'protolens-workspace') return 'aps-workspace';
  if (d.schemaVersion && Array.isArray(d.items)) return 'aps-collection';
  return 'unknown';
}

/* ------------------------------------------------------------------ OpenAPI */

function sampleFromSchema(schema: any, spec: any, depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.$ref) {
    const path = String(schema.$ref).replace(/^#\//, '').split('/');
    let cur = spec;
    for (const p of path) cur = cur?.[p.replace(/~1/g, '/').replace(/~0/g, '~')];
    return sampleFromSchema(cur, spec, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: unknown) => sampleFromSchema(s, spec, depth + 1)));
  if (schema.oneOf || schema.anyOf) return sampleFromSchema((schema.oneOf ?? schema.anyOf)[0], spec, depth + 1);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type ?? (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) o[k] = sampleFromSchema(v, spec, depth + 1);
      return o;
    }
    case 'array':
      return [sampleFromSchema(schema.items, spec, depth + 1)];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return schema.format === 'date-time' ? new Date(0).toISOString() : schema.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : schema.format === 'email' ? 'user@example.com' : 'string';
    default:
      return null;
  }
}

export function importOpenApi(text: string): { collection: Collection; environment?: Environment } {
  let spec: any;
  try {
    spec = text.trim().startsWith('{') ? JSON.parse(text) : parseYaml(text);
  } catch (e) {
    throw new ApsError('ValidationError', `Invalid OpenAPI document: ${(e as Error).message}`);
  }
  const isV2 = !!spec.swagger;
  const name = spec.info?.title ?? 'Imported API';
  let baseUrl = 'http://localhost';
  if (isV2) baseUrl = `${(spec.schemes ?? ['https'])[0]}://${spec.host ?? 'localhost'}${spec.basePath ?? ''}`;
  else if (spec.servers?.[0]?.url) {
    baseUrl = String(spec.servers[0].url);
    for (const [k, v] of Object.entries<any>(spec.servers[0].variables ?? {})) baseUrl = baseUrl.replace(`{${k}}`, v.default ?? '');
  }
  const folders = new Map<string, CollectionFolder>();
  const root: CollectionNode[] = [];
  const securitySchemes = isV2 ? spec.securityDefinitions ?? {} : spec.components?.securitySchemes ?? {};

  const authFor = (security: any[] | undefined): AuthConfig | undefined => {
    const first = security?.[0] ? Object.keys(security[0])[0] : undefined;
    const s = first ? securitySchemes[first] : undefined;
    if (!s) return undefined;
    if ((s.type === 'http' && s.scheme === 'bearer') || s.type === 'oauth2' || s.type === 'openIdConnect') return { type: 'bearer', token: '{{accessToken}}' };
    if (s.type === 'http' && s.scheme === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' };
    if (s.type === 'apiKey') return { type: 'apiKey', key: s.name, value: '{{apiKey}}', in: s.in === 'query' ? 'query' : 'header' };
    return undefined;
  };

  for (const [path, ops] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = ops?.[method];
      if (!op) continue;
      const params = [...(ops.parameters ?? []), ...(op.parameters ?? [])].map((p: any) => (p.$ref ? sampleRef(p.$ref, spec) : p));
      const query: KeyValue[] = params.filter((p: any) => p.in === 'query').map((p: any) => ({ key: p.name, value: String(p.example ?? p.schema?.example ?? ''), enabled: !!p.required, description: p.description }));
      const headers: KeyValue[] = params.filter((p: any) => p.in === 'header').map((p: any) => ({ key: p.name, value: String(p.example ?? ''), enabled: !!p.required }));
      const url = '{{baseUrl}}' + path.replace(/\{([^}]+)\}/g, '{{$1}}');
      let body: BodyConfig | undefined;
      if (isV2) {
        const bp = params.find((p: any) => p.in === 'body');
        if (bp) body = { type: 'json', content: JSON.stringify(sampleFromSchema(bp.schema, spec), null, 2) };
      } else if (op.requestBody) {
        const rb = op.requestBody.$ref ? sampleRef(op.requestBody.$ref, spec) : op.requestBody;
        const content = rb?.content ?? {};
        const ct = Object.keys(content)[0];
        if (ct && /json/.test(ct)) body = { type: 'json', content: JSON.stringify(content[ct].example ?? sampleFromSchema(content[ct].schema, spec), null, 2) };
        else if (ct === 'application/x-www-form-urlencoded')
          body = { type: 'form-urlencoded', fields: Object.keys(content[ct].schema?.properties ?? {}).map((k) => ({ key: k, value: '' })) };
        else if (ct === 'multipart/form-data') body = { type: 'multipart', fields: Object.keys(content[ct].schema?.properties ?? {}).map((k) => ({ key: k, value: '' })) };
        else if (ct) body = { type: 'text', content: '' };
      }
      const req: SavedHttpRequest = {
        kind: 'http',
        id: shortId('req-'),
        name: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
        request: { method: method.toUpperCase(), url, params: query, headers, body, auth: authFor(op.security ?? spec.security) ?? { type: 'inherit' } },
        assertions: [{ type: 'status', expected: Number(Object.keys(op.responses ?? {}).find((c) => /^2/.test(c)) ?? 200) }],
      };
      const tag = op.tags?.[0];
      if (tag) {
        let f = folders.get(tag);
        if (!f) {
          f = { kind: 'folder', id: shortId('fld-'), name: tag, items: [] };
          folders.set(tag, f);
          root.push(f);
        }
        f.items.push(req);
      } else root.push(req);
    }
  }
  const collection = newCollection(name, root, { description: spec.info?.description, variables: [{ key: 'baseUrl', value: baseUrl, enabled: true }] });
  return { collection };
}

function sampleRef(ref: string, spec: any): any {
  let cur = spec;
  for (const p of ref.replace(/^#\//, '').split('/')) cur = cur?.[p];
  return cur;
}

/* ------------------------------------------------------------------ Postman */

function pmAuth(a: any): AuthConfig | undefined {
  if (!a) return undefined;
  const get = (arr: any[] | undefined, k: string) => String(arr?.find((x: any) => x.key === k)?.value ?? '');
  switch (a.type) {
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: get(a.bearer, 'token') };
    case 'basic':
      return { type: 'basic', username: get(a.basic, 'username'), password: get(a.basic, 'password') };
    case 'apikey':
      return { type: 'apiKey', key: get(a.apikey, 'key'), value: get(a.apikey, 'value'), in: get(a.apikey, 'in') === 'query' ? 'query' : 'header' };
    case 'oauth2': {
      const g = get(a.oauth2, 'grant_type');
      const opt = (k: string) => get(a.oauth2, k) || undefined;
      return {
        type: 'oauth2',
        grantType: g === 'client_credentials' ? 'client_credentials' : g === 'password_credentials' ? 'password' : 'authorization_code',
        tokenUrl: get(a.oauth2, 'accessTokenUrl'),
        authUrl: opt('authUrl'),
        clientId: get(a.oauth2, 'clientId'),
        clientSecret: opt('clientSecret'),
        scope: opt('scope'),
        username: opt('username'),
        password: opt('password'),
        usePkce: g === 'authorization_code_with_pkce' || undefined,
      };
    }
    default:
      return undefined;
  }
}

type PmEvent = { listen: string; script?: { exec?: string[] | string } };
/** Script of a Postman `event` list (`prerequest` or `test`). */
function pmScript(events: PmEvent[] | undefined, listen: string): string | undefined {
  const e = (events ?? []).find((x) => x.listen === listen)?.script?.exec;
  const s = Array.isArray(e) ? e.join('\n') : e;
  return s?.trim() ? s : undefined;
}

/** Postman descriptions are a string or `{ content, type }`. */
function pmDescription(d: any): string | undefined {
  const s = typeof d === 'string' ? d : typeof d?.content === 'string' ? d.content : undefined;
  return s?.trim() ? s : undefined;
}

/** Postman saved responses (`item.response[]`) → examples. */
function pmExamples(responses: any, parent?: { method?: string; url?: string }): SavedExample[] | undefined {
  if (!Array.isArray(responses) || !responses.length) return undefined;
  return responses.map((r: any) => {
    const url0 = typeof r.originalRequest?.url === 'string' ? r.originalRequest.url : r.originalRequest?.url?.raw;
    // an original request identical to the saved request adds nothing
    const same = parent && url0 === parent.url && (r.originalRequest?.method ?? 'GET') === (parent.method ?? 'GET') && !r.originalRequest?.body;
    const o = same ? undefined : r.originalRequest;
    const url = typeof o?.url === 'string' ? o.url : o?.url?.raw;
    return {
      id: shortId('ex-'),
      name: String(r.name || `${r.code ?? ''} ${r.status ?? ''}`.trim() || 'Example'),
      status: Number(r.code) || 200,
      statusText: r.status || undefined,
      headers: (Array.isArray(r.header) ? r.header : []).map((h: any) => ({ key: String(h.key), value: String(h.value ?? '') })),
      body: typeof r.body === 'string' ? r.body : '',
      request: o && url ? { method: o.method ?? 'GET', url, headers: (o.header ?? []).map((h: any) => ({ key: h.key, value: h.value ?? '' })), body: o.body?.mode === 'raw' ? o.body.raw : undefined } : undefined,
    };
  });
}

export function importPostman(text: string): { collection: Collection } {
  const d = JSON.parse(text);
  const convert = (items: any[]): CollectionNode[] =>
    (items ?? []).map((it: any): CollectionNode => {
      if (Array.isArray(it.item)) return { kind: 'folder', id: shortId('fld-'), name: it.name, items: convert(it.item), auth: pmAuth(it.auth) };
      const r = typeof it.request === 'string' ? { url: it.request } : it.request ?? {};
      const url = typeof r.url === 'string' ? r.url : r.url?.raw ?? '';
      const [base, qs] = url.split('?');
      const params: KeyValue[] = (r.url?.query ?? []).map((q: any) => ({ key: q.key, value: q.value ?? '', enabled: !q.disabled, ...(q.description ? { description: pmDescription(q.description) } : {}) }));
      const pathVariables: KeyValue[] = (r.url?.variable ?? []).filter((v: any) => v.key).map((v: any) => ({ key: v.key, value: String(v.value ?? ''), ...(v.description ? { description: pmDescription(v.description) } : {}) }));
      const headers: KeyValue[] = (r.header ?? []).map((h: any) => ({ key: h.key, value: h.value ?? '', enabled: !h.disabled, ...(h.description ? { description: pmDescription(h.description) } : {}) }));
      const auth = pmAuth(r.auth) ?? { type: 'inherit' as const };
      if (r.body?.mode === 'graphql') {
        const g = r.body.graphql ?? {};
        return {
          kind: 'graphql',
          id: shortId('gql-'),
          name: it.name ?? url,
          request: { endpoint: url, query: g.query ?? '', variables: typeof g.variables === 'string' && g.variables.trim() ? g.variables : undefined, headers, auth },
        };
      }
      let body: BodyConfig | undefined;
      if (r.body?.mode === 'raw') {
        const lang = r.body.options?.raw?.language;
        body = { type: lang === 'json' || (!lang && /^\s*[{[]/.test(r.body.raw ?? '')) ? 'json' : lang === 'xml' ? 'xml' : lang === 'html' ? 'html' : 'text', content: r.body.raw ?? '' };
      } else if (r.body?.mode === 'urlencoded') body = { type: 'form-urlencoded', fields: r.body.urlencoded.map((f: any) => ({ key: f.key, value: f.value ?? '', enabled: !f.disabled })) };
      else if (r.body?.mode === 'formdata')
        body = { type: 'multipart', fields: r.body.formdata.map((f: any) => ({ key: f.key, value: f.type === 'file' ? f.src ?? '' : f.value ?? '', kind: f.type === 'file' ? 'file' : 'text', enabled: !f.disabled })) };
      else if (r.body?.mode === 'file' && r.body.file?.src) body = { type: 'binary', filePath: r.body.file.src };
      const behavior = it.protocolProfileBehavior ?? {};
      const settings = { ...(behavior.followRedirects === false ? { followRedirects: false } : {}), ...(behavior.strictSSL === false ? { insecure: true } : {}) };
      return {
        kind: 'http',
        id: shortId('req-'),
        name: it.name ?? url,
        request: {
          method: r.method ?? 'GET',
          url: params.length ? base! : qs ? url : base!,
          params,
          ...(pathVariables.length ? { pathVariables } : {}),
          headers,
          body,
          auth,
          ...(Object.keys(settings).length ? { settings } : {}),
        },
        description: pmDescription(r.description ?? it.description),
        preRequestScript: pmScript(it.event, 'prerequest'),
        testScript: pmScript(it.event, 'test'),
        examples: pmExamples(it.response, { method: r.method, url }),
      };
    });
  const collection = newCollection(d.info?.name ?? 'Postman import', convert(d.item), {
    description: pmDescription(d.info?.description),
    variables: (d.variable ?? []).map((v: any) => ({ key: v.key, value: String(v.value ?? ''), enabled: !v.disabled })),
    auth: pmAuth(d.auth),
    preRequestScript: pmScript(d.event, 'prerequest'),
    testScript: pmScript(d.event, 'test'),
  });
  return { collection };
}

export function importPostmanEnvironment(text: string): Environment {
  const d = JSON.parse(text);
  return {
    id: slugify(d.name ?? 'imported'),
    name: d.name ?? 'Imported',
    variables: (d.values ?? []).map((v: any) => ({ key: v.key, value: v.type === 'secret' ? '' : String(v.value ?? ''), secret: v.type === 'secret', enabled: v.enabled !== false })),
  };
}

/* ------------------------------------------------------------------ HAR */

export function importHar(text: string): { collection: Collection } {
  const d = JSON.parse(text);
  const items: CollectionNode[] = (d.log?.entries ?? []).map((e: any): SavedHttpRequest => {
    const r = e.request;
    const u = new URL(r.url);
    const mime = r.postData?.mimeType ?? '';
    let body: BodyConfig | undefined;
    if (r.postData?.params?.length && /urlencoded/.test(mime)) body = { type: 'form-urlencoded', fields: r.postData.params.map((p: any) => ({ key: p.name, value: p.value ?? '' })) };
    else if (r.postData?.text !== undefined) body = { type: /json/.test(mime) ? 'json' : /xml/.test(mime) ? 'xml' : 'text', content: r.postData.text };
    return {
      kind: 'http',
      id: shortId('req-'),
      name: `${r.method} ${u.pathname}`,
      request: {
        method: r.method,
        url: `${u.origin}${u.pathname}`,
        params: [...u.searchParams].map(([key, value]) => ({ key, value })),
        headers: (r.headers ?? []).filter((h: any) => !/^(:|content-length|host|connection|accept-encoding|cookie)/i.test(h.name)).map((h: any) => ({ key: h.name, value: h.value })),
        cookies: (r.cookies ?? []).map((c: any) => ({ key: c.name, value: c.value })),
        body,
      },
      assertions: e.response?.status ? [{ type: 'status', expected: e.response.status }] : undefined,
    };
  });
  return { collection: newCollection(`HAR import ${new Date().toISOString().slice(0, 10)}`, items) };
}

/** Import any supported document into a collection (and optionally an environment). */
export function importAny(text: string): { format: string; collection?: Collection; environment?: Environment } {
  const format = detectFormat(text);
  switch (format) {
    case 'openapi':
    case 'swagger':
      return { format, ...importOpenApi(text) };
    case 'postman':
      return { format, ...importPostman(text) };
    case 'postman-env':
      return { format, environment: importPostmanEnvironment(text) };
    case 'har':
      return { format, ...importHar(text) };
    case 'aps-collection': {
      const c = JSON.parse(text) as Collection;
      return { format, collection: { ...c, id: c.id || shortId('col-') } };
    }
    default:
      throw new ApsError('ValidationError', `Unrecognised import format (${format})`, {
        suggestions: ['Supported: OpenAPI 3 / Swagger 2 (JSON or YAML), Postman v2.1 collections & environments, HAR, Protolens collections and workspace exports.'],
      });
  }
}
