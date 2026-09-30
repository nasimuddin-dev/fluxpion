import { parse as parseYaml } from 'yaml';
import type { AuthConfig, BodyConfig, CheckConfig, Collection, CollectionFolder, CollectionNode, Environment, KeyValue, SavedGraphQLRequest, SavedHttpRequest } from '../model/types.js';
import { SCHEMA_VERSION } from '../model/types.js';
import { shortId, slugify } from '../util/ids.js';

/**
 * Importers for other API clients' exports: Insomnia (v4 JSON export, v5 YAML), Bruno (collection
 * export JSON) and Hoppscotch (collection JSON). Requests, folders, bodies, auth, headers, parameters,
 * variables and environments come over; each tool's own script API does not (scripts are kept as
 * comments so nothing is lost).
 */

type Any = Record<string, any>;

const collectionOf = (name: string, items: CollectionNode[], extra: Partial<Collection> = {}): Collection => ({
  schemaVersion: SCHEMA_VERSION,
  id: `${slugify(name) || 'import'}-${shortId().slice(-4)}`,
  name,
  version: 0,
  variables: [],
  items,
  updatedAt: new Date().toISOString(),
  ...extra,
});

/** `{{ _.baseUrl }}`, `{{ baseUrl }}` (Insomnia) and `<<baseUrl>>` (Hoppscotch) → `{{baseUrl}}`. */
export function normalizeTemplate(s: unknown): string {
  return String(s ?? '')
    .replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, '{{$1}}')
    .replace(/\{\{\s+([\w.$-]+)\s*\}\}|\{\{([\w.$-]+)\s+\}\}/g, (_, a, b) => `{{${a ?? b}}}`)
    .replace(/<<([\w.-]+)>>/g, '{{$1}}');
}

/** Nested variable objects become dotted keys: `{ api: { url } }` → `api.url`. */
function flattenVars(data: unknown, prefix = ''): KeyValue[] {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data as Any).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flattenVars(v, `${prefix}${k}.`) : [{ key: `${prefix}${k}`, value: typeof v === 'string' ? normalizeTemplate(v) : JSON.stringify(v), enabled: true }],
  );
}

const kv = (list: unknown, name = 'name', enabled = (x: Any) => !x.disabled): KeyValue[] =>
  (Array.isArray(list) ? list : []).filter((x: Any) => x && x[name]).map((x: Any) => ({ key: normalizeTemplate(x[name]), value: normalizeTemplate(x.value ?? ''), enabled: enabled(x) }));

/** Another tool's script, kept as comments (its API is not TestPion's `pm.*` / `tp.*`). */
function commented(tool: string, script: unknown): string | undefined {
  const s = String(script ?? '').trim();
  if (!s) return undefined;
  return [`// ${tool} script (not converted: it uses ${tool}'s own script API). Rewrite it with pm.* / tp.* to run it.`, ...s.split('\n').map((l) => `// ${l}`)].join('\n');
}

function bodyFromMime(mime: string, text: string | undefined, params: Any[] | undefined): BodyConfig | undefined {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('x-www-form-urlencoded')) return { type: 'form-urlencoded', fields: kv(params) };
  if (m.includes('multipart/form-data'))
    return { type: 'multipart', fields: (params ?? []).filter((p) => p.name).map((p) => ({ key: p.name, value: p.type === 'file' ? p.fileName ?? '' : normalizeTemplate(p.value ?? ''), kind: p.type === 'file' ? 'file' : 'text', enabled: !p.disabled })) };
  if (text === undefined || text === '') return undefined;
  const content = normalizeTemplate(text);
  return { type: m.includes('json') ? 'json' : m.includes('xml') ? 'xml' : m.includes('html') ? 'html' : 'text', content };
}

/* ------------------------------------------------------------------ Insomnia */

function insomniaAuth(a: Any | undefined): AuthConfig | undefined {
  if (!a || !a.type || a.disabled) return a?.disabled ? { type: 'none' } : undefined;
  const t = (x: unknown) => normalizeTemplate(x ?? '');
  switch (a.type) {
    case 'bearer':
      return { type: 'bearer', token: t(a.token), ...(a.prefix && a.prefix !== 'Bearer' ? { prefix: a.prefix } : {}) };
    case 'basic':
      return { type: 'basic', username: t(a.username), password: t(a.password) };
    case 'digest':
      return { type: 'digest', username: t(a.username), password: t(a.password) };
    case 'apikey':
      return { type: 'apiKey', key: t(a.key), value: t(a.value), in: a.addTo === 'queryParams' ? 'query' : 'header' };
    case 'oauth1':
      return { type: 'oauth1', consumerKey: t(a.consumerKey), consumerSecret: t(a.consumerSecret), token: t(a.tokenKey), tokenSecret: t(a.tokenSecret), signatureMethod: a.signatureMethod === 'HMAC-SHA256' ? 'HMAC-SHA256' : a.signatureMethod === 'PLAINTEXT' ? 'PLAINTEXT' : 'HMAC-SHA1' };
    case 'oauth2':
      return {
        type: 'oauth2',
        grantType: a.grantType === 'password' ? 'password' : a.grantType === 'authorization_code' ? 'authorization_code' : 'client_credentials',
        tokenUrl: t(a.accessTokenUrl),
        authUrl: a.authorizationUrl ? t(a.authorizationUrl) : undefined,
        clientId: t(a.clientId),
        clientSecret: t(a.clientSecret),
        scope: a.scope ? t(a.scope) : undefined,
        username: a.username ? t(a.username) : undefined,
        password: a.password ? t(a.password) : undefined,
        usePkce: !!a.usePkce,
      };
    case 'iam':
      return { type: 'awsv4', accessKey: t(a.accessKeyId), secretKey: t(a.secretAccessKey), sessionToken: a.sessionToken ? t(a.sessionToken) : undefined, region: t(a.region), service: t(a.service) };
    case 'none':
      return { type: 'none' };
    default:
      return undefined;
  }
}

function insomniaRequest(r: Any): SavedHttpRequest | SavedGraphQLRequest {
  const url = normalizeTemplate(r.url);
  const headers = kv(r.headers);
  const auth = insomniaAuth(r.authentication) ?? { type: 'inherit' as const };
  const mime = r.body?.mimeType ?? '';
  if (mime === 'application/graphql') {
    let g: Any = {};
    try {
      g = JSON.parse(r.body?.text ?? '{}');
    } catch {
      /* not JSON */
    }
    return { kind: 'graphql', id: shortId('gql-'), name: r.name || url, request: { endpoint: url, query: normalizeTemplate(g.query ?? ''), variables: g.variables && Object.keys(g.variables).length ? g.variables : undefined, operationName: g.operationName || undefined, headers, auth } };
  }
  const pathParams = kv(r.pathParameters);
  const testScript = commented('Insomnia', r.afterResponseScript);
  const preRequestScript = commented('Insomnia', r.preRequestScript);
  return {
    kind: 'http',
    id: shortId('req-'),
    name: r.name || url,
    ...(r.description ? { description: String(r.description) } : {}),
    request: {
      method: String(r.method ?? 'GET').toUpperCase(),
      url,
      params: kv(r.parameters),
      ...(pathParams.length ? { pathVariables: pathParams } : {}),
      headers,
      body: bodyFromMime(mime, r.body?.text, r.body?.params),
      auth,
      ...(r.settingFollowRedirects === 'off' ? { settings: { followRedirects: false } } : {}),
    },
    ...(preRequestScript ? { preRequestScript } : {}),
    ...(testScript ? { testScript } : {}),
  };
}

function insomniaEnvironments(name: string, base: Any | undefined, subs: Any[]): Environment[] {
  const baseVars = flattenVars(base?.data ?? {});
  const merge = (extra: KeyValue[]) => {
    const keys = new Set(extra.map((v) => v.key));
    return [...baseVars.filter((v) => !keys.has(v.key)), ...extra];
  };
  if (!subs.length) return baseVars.length ? [{ id: slugify(name) || 'imported', name, variables: baseVars }] : [];
  return subs.map((s) => ({ id: slugify(s.name ?? 'env') || 'env', name: s.name ?? 'Environment', variables: merge(flattenVars(s.data ?? {})), ...(s.color ? { color: s.color } : {}) }));
}

export function importInsomnia(text: string): { collection: Collection; environments: Environment[] } {
  const t = text.trim();
  const d: Any = t.startsWith('{') ? JSON.parse(t) : parseYaml(t);
  if (String(d.type ?? '').startsWith('collection.insomnia.rest/5')) {
    // Insomnia 5 YAML: a tree under `collection`, environments with sub-environments
    const convert = (items: Any[]): CollectionNode[] =>
      (items ?? []).map((it: Any): CollectionNode =>
        Array.isArray(it.children)
          ? ({ kind: 'folder', id: shortId('fld-'), name: it.name ?? 'Folder', items: convert(it.children), auth: insomniaAuth(it.authentication), ...(flattenVars(it.environment).length ? { variables: flattenVars(it.environment) } : {}) } as CollectionFolder)
          : insomniaRequest(it),
      );
    const name = d.name ?? 'Insomnia import';
    const env = d.environments ?? {};
    return { collection: collectionOf(name, convert(d.collection ?? []), { description: d.meta?.description }), environments: insomniaEnvironments(name, env, env.subEnvironments ?? []) };
  }
  // Insomnia 4 export: flat resources linked by parentId
  const res: Any[] = d.resources ?? [];
  const children = new Map<string, Any[]>();
  for (const r of res) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r]);
  const order = (list: Any[]) => [...list].sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0));
  const build = (parentId: string): CollectionNode[] =>
    order(children.get(parentId) ?? []).flatMap((r): CollectionNode[] => {
      if (r._type === 'request_group') {
        const variables = flattenVars(r.environment);
        return [{ kind: 'folder', id: shortId('fld-'), name: r.name ?? 'Folder', items: build(r._id), ...(insomniaAuth(r.authentication) ? { auth: insomniaAuth(r.authentication) } : {}), ...(variables.length ? { variables } : {}) } as CollectionFolder];
      }
      if (r._type === 'request') return [insomniaRequest(r)];
      return [];
    });
  const workspaces = res.filter((r) => r._type === 'workspace');
  const name = workspaces.length === 1 ? workspaces[0].name : workspaces.length ? 'Insomnia import' : 'Insomnia import';
  const items = workspaces.length === 1 ? build(workspaces[0]._id) : workspaces.length ? workspaces.map((w) => ({ kind: 'folder', id: shortId('fld-'), name: w.name, items: build(w._id) }) as CollectionFolder) : build(res.find((r) => r._type === 'request' || r._type === 'request_group')?.parentId);
  const base = res.find((r) => r._type === 'environment' && workspaces.some((w) => w._id === r.parentId)) ?? res.find((r) => r._type === 'environment' && !res.some((p) => p._id === r.parentId && p._type === 'environment'));
  const subs = base ? res.filter((r) => r._type === 'environment' && r.parentId === base._id) : [];
  return { collection: collectionOf(name, items, { description: workspaces[0]?.description || undefined }), environments: insomniaEnvironments(name, base, subs) };
}

/* ------------------------------------------------------------------ Bruno */

function brunoAuth(a: Any | undefined): AuthConfig | undefined {
  if (!a?.mode) return undefined;
  const t = (x: unknown) => normalizeTemplate(x ?? '');
  switch (a.mode) {
    case 'none':
      return { type: 'none' };
    case 'inherit':
      return { type: 'inherit' };
    case 'bearer':
      return { type: 'bearer', token: t(a.bearer?.token) };
    case 'basic':
      return { type: 'basic', username: t(a.basic?.username), password: t(a.basic?.password) };
    case 'digest':
      return { type: 'digest', username: t(a.digest?.username), password: t(a.digest?.password) };
    case 'apikey':
      return { type: 'apiKey', key: t(a.apikey?.key), value: t(a.apikey?.value), in: a.apikey?.placement === 'queryparams' ? 'query' : 'header' };
    case 'awsv4':
      return { type: 'awsv4', accessKey: t(a.awsv4?.accessKeyId), secretKey: t(a.awsv4?.secretAccessKey), sessionToken: a.awsv4?.sessionToken ? t(a.awsv4.sessionToken) : undefined, region: t(a.awsv4?.region), service: t(a.awsv4?.service) };
    case 'oauth2':
      return { type: 'oauth2', grantType: a.oauth2?.grantType === 'password' ? 'password' : a.oauth2?.grantType === 'authorization_code' ? 'authorization_code' : 'client_credentials', tokenUrl: t(a.oauth2?.accessTokenUrl), clientId: t(a.oauth2?.clientId), clientSecret: t(a.oauth2?.clientSecret), scope: a.oauth2?.scope ? t(a.oauth2.scope) : undefined };
    default:
      return undefined;
  }
}

/** Bruno assertions like `res.status: eq 200` become status checks; others stay in the comments. */
function brunoAssertions(list: Any[] | undefined): CheckConfig[] | undefined {
  const out: CheckConfig[] = [];
  for (const a of list ?? []) {
    if (a.enabled === false) continue;
    const m = /^eq\s+(\d{3})$/.exec(String(a.value ?? '').trim());
    if (a.name === 'res.status' && m) out.push({ type: 'status', expected: Number(m[1]) });
  }
  return out.length ? out : undefined;
}

export function importBruno(text: string): { collection: Collection; environments: Environment[] } {
  const d: Any = JSON.parse(text);
  const convert = (items: Any[]): CollectionNode[] =>
    [...(items ?? [])]
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .flatMap((it: Any): CollectionNode[] => {
        if (it.type === 'folder') return [{ kind: 'folder', id: shortId('fld-'), name: it.name ?? 'Folder', items: convert(it.items), ...(brunoAuth(it.root?.request?.auth) ? { auth: brunoAuth(it.root.request.auth) } : {}) } as CollectionFolder];
        const r = it.request ?? {};
        const headers = kv(r.headers, 'name', (x) => x.enabled !== false);
        const auth = brunoAuth(r.auth) ?? { type: 'inherit' as const };
        const url = normalizeTemplate(r.url);
        if (it.type === 'graphql-request') {
          let variables: Any | undefined;
          try {
            variables = r.body?.graphql?.variables ? JSON.parse(r.body.graphql.variables) : undefined;
          } catch {
            variables = undefined;
          }
          return [{ kind: 'graphql', id: shortId('gql-'), name: it.name || url, request: { endpoint: url, query: normalizeTemplate(r.body?.graphql?.query ?? ''), variables, headers, auth } }];
        }
        if (it.type !== 'http-request') return [];
        const b = r.body ?? {};
        const body: BodyConfig | undefined =
          b.mode === 'json' ? { type: 'json', content: normalizeTemplate(b.json ?? '') }
          : b.mode === 'xml' ? { type: 'xml', content: normalizeTemplate(b.xml ?? '') }
          : b.mode === 'text' ? { type: 'text', content: normalizeTemplate(b.text ?? '') }
          : b.mode === 'formUrlEncoded' ? { type: 'form-urlencoded', fields: kv(b.formUrlEncoded, 'name', (x) => x.enabled !== false) }
          : b.mode === 'multipartForm' ? { type: 'multipart', fields: (b.multipartForm ?? []).filter((f: Any) => f.name).map((f: Any) => ({ key: f.name, value: f.type === 'file' ? [].concat(f.value ?? []).join(',') : normalizeTemplate(f.value ?? ''), kind: f.type === 'file' ? 'file' : 'text', enabled: f.enabled !== false })) }
          : undefined;
        const params = (r.params ?? []) as Any[];
        const pre = commented('Bruno', r.script?.req);
        const post = [commented('Bruno', r.script?.res), commented('Bruno', r.tests)].filter(Boolean).join('\n');
        const pathVariables = kv(params.filter((p) => p.type === 'path'), 'name', (x) => x.enabled !== false);
        return [
          {
            kind: 'http',
            id: shortId('req-'),
            name: it.name || url,
            ...(r.docs ? { description: String(r.docs) } : {}),
            request: {
              method: String(r.method ?? 'GET').toUpperCase(),
              // query parameters are listed separately, so the URL keeps only its path
              url: params.some((p) => p.type !== 'path') ? url.split('?')[0]! : url,
              params: kv(params.filter((p) => p.type !== 'path'), 'name', (x) => x.enabled !== false),
              ...(pathVariables.length ? { pathVariables } : {}),
              headers,
              body,
              auth,
            },
            ...(pre ? { preRequestScript: pre } : {}),
            ...(post ? { testScript: post } : {}),
            ...(brunoAssertions(r.assertions) ? { assertions: brunoAssertions(r.assertions) } : {}),
          },
        ];
      });
  const environments: Environment[] = (d.environments ?? []).map((e: Any) => ({
    id: slugify(e.name ?? 'env') || 'env',
    name: e.name ?? 'Environment',
    // secret values stay out of workspace files: they become empty secret variables
    variables: (e.variables ?? []).filter((v: Any) => v.name).map((v: Any) => ({ key: v.name, value: v.secret ? '' : normalizeTemplate(v.value ?? ''), enabled: v.enabled !== false, ...(v.secret ? { secret: true } : {}) })),
  }));
  const collectionVars = kv(d.root?.request?.vars?.req, 'name', (x) => x.enabled !== false);
  return { collection: collectionOf(d.name ?? 'Bruno import', convert(d.items), { variables: collectionVars, ...(brunoAuth(d.root?.request?.auth) ? { auth: brunoAuth(d.root.request.auth) } : {}), ...(d.root?.docs ? { description: String(d.root.docs) } : {}) }), environments };
}

/* ------------------------------------------------------------------ Hoppscotch */

function hoppAuth(a: Any | undefined): AuthConfig | undefined {
  if (!a?.authType) return undefined;
  if (a.authActive === false || a.authType === 'none') return { type: 'none' };
  const t = (x: unknown) => normalizeTemplate(x ?? '');
  switch (a.authType) {
    case 'inherit':
      return { type: 'inherit' };
    case 'bearer':
      return { type: 'bearer', token: t(a.token) };
    case 'basic':
      return { type: 'basic', username: t(a.username), password: t(a.password) };
    case 'digest':
      return { type: 'digest', username: t(a.username), password: t(a.password) };
    case 'api-key':
      return { type: 'apiKey', key: t(a.key), value: t(a.value), in: a.addTo === 'QUERY_PARAMS' ? 'query' : 'header' };
    case 'oauth-2':
      return { type: 'oauth2', grantType: 'client_credentials', tokenUrl: t(a.grantTypeInfo?.authEndpoint ?? a.accessTokenURL), clientId: t(a.grantTypeInfo?.clientID ?? a.clientID), clientSecret: t(a.grantTypeInfo?.clientSecret), scope: a.grantTypeInfo?.scopes ?? a.scope };
    default:
      return undefined;
  }
}

export function importHoppscotch(text: string): { collection: Collection } {
  const d: Any = JSON.parse(text);
  const roots: Any[] = Array.isArray(d) ? d : [d];
  const request = (r: Any): SavedHttpRequest => {
    const ct = r.body?.contentType ?? '';
    const body = typeof r.body?.body === 'string' ? bodyFromMime(ct, r.body.body, undefined) : Array.isArray(r.body?.body) ? bodyFromMime(ct, undefined, r.body.body.map((f: Any) => ({ name: f.key, value: f.value, disabled: f.active === false, type: f.isFile ? 'file' : 'text' }))) : undefined;
    const pre = commented('Hoppscotch', r.preRequestScript);
    const post = commented('Hoppscotch', r.testScript);
    return {
      kind: 'http',
      id: shortId('req-'),
      name: r.name || r.endpoint,
      request: {
        method: String(r.method ?? 'GET').toUpperCase(),
        url: normalizeTemplate(r.endpoint),
        params: kv(r.params, 'key', (x) => x.active !== false),
        headers: kv(r.headers, 'key', (x) => x.active !== false),
        body,
        auth: hoppAuth(r.auth) ?? { type: 'inherit' },
      },
      ...(pre ? { preRequestScript: pre } : {}),
      ...(post ? { testScript: post } : {}),
    };
  };
  const folder = (c: Any): CollectionFolder => ({ kind: 'folder', id: shortId('fld-'), name: c.name ?? 'Folder', items: [...(c.folders ?? []).map(folder), ...(c.requests ?? []).map(request)], ...(hoppAuth(c.auth) ? { auth: hoppAuth(c.auth) } : {}) });
  if (roots.length === 1) {
    const c = roots[0]!;
    return { collection: collectionOf(c.name ?? 'Hoppscotch import', [...(c.folders ?? []).map(folder), ...(c.requests ?? []).map(request)], { ...(hoppAuth(c.auth) ? { auth: hoppAuth(c.auth) } : {}) }) };
  }
  return { collection: collectionOf('Hoppscotch import', roots.map(folder)) };
}

/* ------------------------------------------------------------------ detection */

export function detectOtherTool(d: unknown): 'insomnia' | 'bruno' | 'hoppscotch' | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const o = d as Any;
  if (o._type === 'export' && Array.isArray(o.resources)) return 'insomnia';
  if (String(o.type ?? '').startsWith('collection.insomnia.rest/')) return 'insomnia';
  if (Array.isArray(o.items) && (o.brunoConfig || o.items.some((i: Any) => /^(http|graphql)-request$|^folder$/.test(i?.type ?? '')))) return 'bruno';
  const hopp = (c: Any) => c && typeof c === 'object' && Array.isArray(c.folders) && Array.isArray(c.requests);
  if (hopp(o) || (Array.isArray(o) && o.length > 0 && o.every(hopp))) return 'hoppscotch';
  return undefined;
}
