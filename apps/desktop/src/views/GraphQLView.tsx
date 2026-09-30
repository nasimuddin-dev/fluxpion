import { BookOpen, ChevronLeft, FlaskConical, Play, Radio, RefreshCw, Save, Sparkles, Square, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parse, print } from 'graphql';
import { asError, call, on, type NormalizedError } from '../api';
import { confirmAction, persisted, promptText, useApp } from '../store';
import { useIntent, useSendShortcut } from '../hooks';
import { setGraphQLSchema } from '../monaco';
import type { AuthConfig, CheckConfig, CheckResult, Collection, HttpResponseData, KeyValue, SavedGraphQLRequest } from '../types';
import { formatMs, uid } from '../lib/format';
import { AssertionEditor } from '../components/AssertionEditor';
import { AuthEditor } from '../components/AuthEditor';
import { CodeEditor } from '../components/CodeEditor';
import { addToFolder, findNode, mapNodes } from '../components/CollectionTree';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { ScriptsPanel } from '../components/ScriptsPanel';
import { saveResponseVariable } from '../lib/save-variable';
import { JsonTree, RawView } from '../components/JsonView';
import { CheckList, ErrorPanel } from '../components/Results';
import { VarInput } from '../components/VarInput';
import { Badge, Button, cx, Empty, Input, Select, Split, statusTone, Tabs, Tooltip } from '../components/ui';

interface SchemaType {
  name: string;
  kind: string;
  description?: string;
  fields?: Array<{ name: string; type: string; description?: string; deprecated?: string; args?: Array<{ name: string; type: string; description?: string }> }>;
  enumValues?: Array<{ name: string; description?: string }>;
  possibleTypes?: string[];
  interfaces?: string[];
}
interface SchemaSummary {
  queryType?: string;
  mutationType?: string;
  subscriptionType?: string;
  types: SchemaType[];
  directives: Array<{ name: string; description?: string; locations: string[] }>;
}

interface Draft {
  endpoint: string;
  query: string;
  variables: string;
  headers: KeyValue[];
  auth?: AuthConfig;
  assertions: CheckConfig[];
  operationName?: string;
  collectionId?: string;
  requestId?: string;
  name: string;
  preRequestScript?: string;
  testScript?: string;
  /** Subscriptions: the connection_init payload (JSON), e.g. { "authorization": "Bearer {{token}}" }. */
  connectionParams?: string;
}

interface SubEvent {
  type: 'status' | 'next' | 'error' | 'complete';
  time: number;
  data?: unknown;
  message?: string;
}

const DEFAULT_QUERY = `# Write your query. Ctrl+Space for schema-aware suggestions, Ctrl+Enter to run.
query GetPatient($id: ID!) {
  patient(id: $id) {
    id
    name
  }
}
`;
const store = persisted<Draft>('graphql', { endpoint: '{{graphqlEndpoint}}', query: DEFAULT_QUERY, variables: '{\n  "id": "123"\n}', headers: [], auth: { type: 'inherit' }, assertions: [{ type: 'graphql-no-errors' }], name: 'GraphQL query' });

export function GraphQLView() {
  const [d, setD] = useState<Draft>(store.load);
  const [schema, setSchema] = useState<SchemaSummary>();
  const [sdl, setSdl] = useState<string>();
  const [introspecting, setIntrospecting] = useState(false);
  const [schemaError, setSchemaError] = useState<NormalizedError>();
  const [mockUrl, setMockUrl] = useState<string>();
  useEffect(() => void call<{ url: string } | null>('gql.mock.status').then((r) => setMockUrl(r?.url)), []);
  /** Serve fake data for the introspected schema on localhost, so a front end can work without the real API. */
  const toggleMock = async () => {
    try {
      if (mockUrl) {
        await call('gql.mock.stop');
        setMockUrl(undefined);
        useApp.getState().toast('GraphQL mock stopped', 'success');
        return;
      }
      if (!sdl) return useApp.getState().toast('Introspect the schema first, then mock it', 'error');
      const r = await call<{ url: string }>('gql.mock.start', { sdl });
      setMockUrl(r.url);
      await navigator.clipboard.writeText(r.url).catch(() => undefined);
      useApp.getState().toast(`GraphQL mock running at ${r.url} (copied). Every valid query gets fake, correctly typed data.`, 'success');
    } catch (e) {
      useApp.getState().toast(`Couldn't start the mock: ${asError(e).message}`, 'error');
    }
  };
  const [running, setRunning] = useState<string>();
  const [result, setResult] = useState<{ response?: HttpResponseData; errors?: unknown[]; checks?: CheckResult[]; error?: NormalizedError; operationType?: string; scriptLogs?: Array<{ phase: string; message: string }> }>();
  const [sub, setSub] = useState<'variables' | 'headers' | 'auth' | 'scripts' | 'tests' | 'connection'>('variables');
  // a running subscription and its events
  const [subscription, setSubscription] = useState<{ id: string; protocol: string }>();
  const [events, setEvents] = useState<SubEvent[]>();
  const [eventSel, setEventSel] = useState<number>();
  const [resTab, setResTab] = useState<'response' | 'raw' | 'tests'>('response');
  const env = useApp((s) => s.environment);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  useEffect(() => store.save(d), [d]);

  const operations = useMemo(() => {
    try {
      return parse(d.query).definitions.flatMap((x) => (x.kind === 'OperationDefinition' ? [{ name: x.name?.value, type: x.operation }] : []));
    } catch {
      return [];
    }
  }, [d.query]);

  const introspectNow = async () => {
    setIntrospecting(true);
    setSchemaError(undefined);
    try {
      const r = await call<{ sdl: string; summary: SchemaSummary }>('gql.introspect', { request: { endpoint: d.endpoint, headers: d.headers, auth: d.auth?.type === 'inherit' ? undefined : d.auth }, environment: env });
      setSchema(r.summary);
      setSdl(r.sdl);
      setGraphQLSchema(r.sdl);
      useApp.getState().toast(`Schema loaded: ${r.summary.types.length} types`, 'success');
    } catch (e) {
      setSchemaError(asError(e));
    } finally {
      setIntrospecting(false);
    }
  };

  // schema explorer ▸ Build: a whole operation for a root field (variables with placeholder values)
  const buildOperation = async (field: string) => {
    if (!sdl) return;
    try {
      const op = await call<{ operationName: string; query: string; variables: Record<string, unknown> }>('gql.buildOperation', { sdl, field });
      const current = d.query.trim();
      if (current && current !== op.query.trim() && !(await confirmAction({ title: `Replace the query with ${op.operationName}?`, message: 'The editor has a query already. The built operation and its variables replace it.', confirmLabel: 'Replace' }))) return;
      set({ query: op.query, variables: JSON.stringify(op.variables, null, 2), operationName: op.operationName });
      setSub('variables');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };

  const selectedOp = operations.find((o) => o.name === d.operationName) ?? operations[0];
  const isSubscription = selectedOp?.type === 'subscription';
  useEffect(
    () =>
      on<{ id: string; event: SubEvent }>('gql.subscription', (p) => {
        if (p.id !== subscriptionRef.current) return;
        setEvents((xs) => [...(xs ?? []), p.event].slice(-2000));
        if (p.event.type === 'complete' || (p.event.type === 'status' && p.event.message === 'Connection closed')) setSubscription(undefined);
      }),
    [],
  );
  const subscriptionRef = useRef<string | undefined>(undefined);
  subscriptionRef.current = subscription?.id;
  const subscribe = async () => {
    setEvents([]);
    setEventSel(undefined);
    setResult(undefined);
    try {
      const r = await call<{ id: string; protocol: string }>('gql.subscribe', {
        request: { endpoint: d.endpoint, query: d.query, variables: d.variables, headers: d.headers, auth: d.auth },
        environment: env,
        collectionId: d.collectionId,
        operationName: d.operationName && operations.some((o) => o.name === d.operationName) ? d.operationName : undefined,
        connectionParams: d.connectionParams,
      });
      setSubscription(r);
    } catch (e) {
      setEvents(undefined);
      setResult({ error: asError(e) });
    }
  };
  const unsubscribe = () => subscription && void call('gql.unsubscribe', { id: subscription.id }).then(() => setSubscription(undefined));

  const run = async () => {
    if (isSubscription) return subscribe();
    setEvents(undefined);
    const id = uid('gql-');
    setRunning(id);
    useApp.getState().setActivity(id, 'Running GraphQL operation');
    try {
      const opName = d.operationName && operations.some((o) => o.name === d.operationName) ? d.operationName : operations.length > 1 ? operations[0]?.name : undefined;
      const r = await call('gql.send', {
        id,
        request: { endpoint: d.endpoint, query: d.query, variables: d.variables, operationName: opName, headers: d.headers, auth: d.auth?.type === 'inherit' ? undefined : d.auth },
        environment: env,
        collectionId: d.collectionId,
        requestId: d.requestId,
        name: d.name,
        operationName: opName,
        assertions: d.assertions,
        preRequestScript: d.preRequestScript,
        testScript: d.testScript,
      });
      setResult(r);
      if (r.checks?.some((c: CheckResult) => !c.passed)) setResTab('tests');
    } catch (e) {
      setResult({ error: asError(e) });
    } finally {
      setRunning(undefined);
      useApp.getState().setActivity(id);
    }
  };
  useSendShortcut('graphql', () => !running && void run());

  useIntent('graphql', async (p) => {
    if (p?.reset) setD({ ...store.load(), query: DEFAULT_QUERY, collectionId: undefined, requestId: undefined, name: 'GraphQL query' });
    if (p?.collectionId) {
      const cols = await call<Collection[]>('col.list');
      const c = cols.find((x) => x.id === p.collectionId);
      const n = c && (findNode(c.items, p.requestId) as SavedGraphQLRequest | undefined);
      if (n?.kind === 'graphql')
        setD({ endpoint: n.request.endpoint, query: n.request.query, variables: n.request.variables ?? '', headers: n.request.headers ?? [], auth: n.request.auth, assertions: n.assertions ?? [], collectionId: c!.id, requestId: n.id, name: n.name, operationName: n.request.operationName, preRequestScript: n.preRequestScript, testScript: n.testScript });
    }
  });

  const save = async () => {
    const cols = await call<Collection[]>('col.list');
    let c = cols.find((x) => x.id === d.collectionId);
    if (!c) {
      const pick = await promptText('Save to collection', {
        message: 'Collection name (an existing one, or a new name to create it)',
        detail: cols.length ? `Existing: ${cols.map((x) => x.name).join(', ')}` : undefined,
        value: cols[0]?.name ?? 'GraphQL',
        okLabel: 'Next',
      });
      if (!pick) return;
      c = cols.find((x) => x.name === pick) ?? { schemaVersion: '1.0', id: uid('col-'), name: pick, version: 0, variables: [], items: [], updatedAt: '' };
    }
    const name = d.requestId ? d.name : ((await promptText('Save operation', { message: 'Request name', value: d.operationName ?? operations[0]?.name ?? d.name, okLabel: 'Save' })) ?? d.name);
    // keep what this view doesn't edit (favorite …) when updating a saved request
    const before = d.requestId ? (findNode(c.items, d.requestId) as SavedGraphQLRequest | undefined) : undefined;
    const node: SavedGraphQLRequest = {
      ...(before?.kind === 'graphql' ? before : {}),
      kind: 'graphql',
      id: d.requestId ?? uid('gql-'),
      name,
      request: { endpoint: d.endpoint, query: d.query, variables: d.variables, headers: d.headers, auth: d.auth, operationName: d.operationName },
      assertions: d.assertions,
      preRequestScript: d.preRequestScript || undefined,
      testScript: d.testScript || undefined,
    };
    const items = d.requestId && findNode(c.items, d.requestId) ? mapNodes(c.items, (n) => (n.id === node.id ? node : n)) : addToFolder(c.items, undefined, node);
    await call('col.save', { ...c, items });
    set({ collectionId: c.id, requestId: node.id, name });
    useApp.getState().toast('Saved to collection', 'success');
  };

  const prettify = () => {
    try {
      set({ query: print(parse(d.query)) });
    } catch (e) {
      useApp.getState().toast(`Cannot format: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-line shrink-0">
        <Badge tone="accent">{isSubscription ? 'WS' : 'POST'}</Badge>
        <VarInput ariaLabel="GraphQL endpoint" className="flex-1 h-8" value={d.endpoint} onChange={(endpoint) => set({ endpoint })} placeholder="https://api.example.com/graphql" />
        <Button icon={<RefreshCw size={13} className={introspecting ? 'spin' : ''} />} onClick={introspectNow} disabled={introspecting}>
          Introspect
        </Button>
        <Tooltip content={mockUrl ? `Mock running at ${mockUrl}: click to stop` : sdl ? 'Serve fake data for this schema on localhost' : 'Introspect a schema first'}>
          <Button variant={mockUrl ? 'soft' : 'default'} icon={<FlaskConical size={13} />} onClick={() => void toggleMock()} disabled={!mockUrl && !sdl}>
            {mockUrl ? 'Mock on' : 'Mock'}
          </Button>
        </Tooltip>
        {operations.length > 1 && (
          <Select aria-label="Operation" value={d.operationName ?? operations[0]?.name ?? ''} onChange={(e) => set({ operationName: e.target.value })}>
            {operations.map((o) => (
              <option key={o.name ?? 'anon'} value={o.name}>
                {o.type} {o.name ?? '(anonymous)'}
              </option>
            ))}
          </Select>
        )}
        {subscription ? (
          <Button variant="danger" icon={<Square size={12} />} onClick={unsubscribe}>
            Stop
          </Button>
        ) : running ? (
          <Button variant="danger" icon={<Square size={12} />} onClick={() => call('http.cancel', { id: running })}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" icon={isSubscription ? <Radio size={13} /> : <Play size={13} />} onClick={run} title={isSubscription ? 'Subscribe over WebSocket (Ctrl+Enter)' : 'Run (Ctrl+Enter)'}>
            {isSubscription ? 'Subscribe' : 'Run'}
          </Button>
        )}
        <Button icon={<Save size={13} />} onClick={save}>
          Save
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <Split id="gql-explorer" sidebar initial={22} min={12}>
          <SchemaExplorer schema={schema} error={schemaError} sdl={sdl} onInsert={(f) => set({ query: d.query.replace(/\}\s*$/, `  ${f}\n}\n`) })} onBuild={(f) => void buildOperation(f)} onIntrospect={introspectNow} loading={introspecting} />
          <Split id="gql-main" initial={50}>
            <div className="h-full flex flex-col">
              <div className="flex items-center h-8 px-2 border-b border-line gap-1 text-xs text-muted shrink-0">
                <span className="font-medium text-fg">{d.name}</span>
                {operations[0] && <Badge>{operations[0].type}</Badge>}
                <Button size="sm" variant="ghost" className="ml-auto" icon={<Wand2 size={12} />} onClick={prettify}>
                  Prettify
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Sparkles size={12} />}
                  onClick={() => useApp.getState().set({ assistant: { task: 'generate-query', title: 'Generate GraphQL query', context: { schemaSdl: sdl?.slice(0, 20000) ?? 'unknown — introspect first', currentQuery: d.query }, question: '' } })}
                >
                  Generate
                </Button>
              </div>
              <div className="flex-1 min-h-0">
                <Split id="gql-editor-vars" direction="vertical" initial={65}>
                  <CodeEditor language="graphql" path="query.graphql" value={d.query} onChange={(query) => set({ query })} />
                  <div className="h-full flex flex-col">
                    <Tabs
                      value={sub}
                      onChange={setSub}
                      tabs={[
                        { id: 'variables', label: 'Variables' },
                        { id: 'headers', label: 'Headers', badge: d.headers.length },
                        { id: 'auth', label: 'Auth' },
                        { id: 'scripts', label: 'Scripts', badge: (d.preRequestScript?.trim() ? 1 : 0) + (d.testScript?.trim() ? 1 : 0) || undefined },
                        ...(isSubscription ? [{ id: 'connection' as const, label: 'Connection' }] : []),
                        { id: 'tests', label: 'Tests', badge: d.assertions.length },
                      ]}
                    />
                    <div className="flex-1 min-h-0 overflow-auto">
                      {sub === 'variables' && <CodeEditor language="json" value={d.variables} onChange={(variables) => set({ variables })} minimal />}
                      {sub === 'headers' && (
                        <div className="p-2">
                          <KeyValueEditor rows={d.headers} onChange={(headers) => set({ headers })} keyPlaceholder="Header" />
                        </div>
                      )}
                      {sub === 'auth' && <AuthEditor auth={d.auth} onChange={(auth) => set({ auth })} />}
                      {sub === 'connection' && (
                        <div className="h-full flex flex-col">
                          <p className="px-2 py-1.5 text-xs text-muted border-b border-line">Payload of <span className="mono">connection_init</span> (JSON), for servers that read auth there, e.g. {'{ "authorization": "Bearer {{token}}" }'}. The Auth tab is also sent as a handshake header.</p>
                          <div className="flex-1 min-h-0">
                            <CodeEditor language="json" value={d.connectionParams ?? ''} onChange={(connectionParams) => set({ connectionParams })} minimal />
                          </div>
                        </div>
                      )}
                      {sub === 'scripts' && <ScriptsPanel pre={d.preRequestScript ?? ''} post={d.testScript ?? ''} onPre={(v) => set({ preRequestScript: v })} onPost={(v) => set({ testScript: v })} />}
                      {sub === 'tests' && <AssertionEditor checks={d.assertions} onChange={(assertions) => set({ assertions })} groups={['Response', 'Body', 'GraphQL']} />}
                    </div>
                  </div>
                </Split>
              </div>
            </div>
            <div className="h-full flex flex-col min-h-0">
              {events && !result?.error ? (
                <div className="h-full flex flex-col min-h-0">
                  <div className="flex items-center gap-2 px-3 h-9 border-b border-line text-sm shrink-0">
                    <Badge tone={subscription ? 'ok' : 'default'}>{subscription ? 'subscribed' : 'ended'}</Badge>
                    {subscription?.protocol && <span className="text-xs text-muted mono">{subscription.protocol}</span>}
                    <span className="text-muted ml-auto">{events.filter((e) => e.type === 'next').length} events</span>
                  </div>
                  <Split id="gql-sub-events" direction="vertical" initial={45}>
                    <div className="h-full overflow-auto">
                      {events.map((e, i) => (
                        <button key={i} onClick={() => setEventSel(i)} className={cx('w-full flex items-center gap-2 px-3 py-1 text-left text-sm border-b border-line/50 hover:bg-hover', eventSel === i && 'bg-accent/10')}>
                          <span className="text-xs text-muted tabular-nums shrink-0">{new Date(e.time).toLocaleTimeString()}</span>
                          <Badge tone={e.type === 'next' ? 'accent' : e.type === 'error' ? 'bad' : 'default'}>{e.type}</Badge>
                          <span className="mono text-xs truncate">{e.message ?? JSON.stringify(e.data)}</span>
                        </button>
                      ))}
                    </div>
                    <div className="h-full overflow-auto">{eventSel !== undefined && events[eventSel]?.data !== undefined ? <JsonTree data={events[eventSel]!.data} /> : <Empty title="Select an event" />}</div>
                  </Split>
                </div>
              ) : result?.error ? (
                <ErrorPanel error={result.error} context={{ endpoint: d.endpoint, query: d.query }} />
              ) : result?.response ? (
                <>
                  <div className="flex items-center gap-3 px-3 h-9 border-b border-line text-sm shrink-0">
                    <Badge tone={statusTone(result.response.status)}>{result.response.status}</Badge>
                    <span className="text-muted">{formatMs(result.response.durationMs)}</span>
                    {!!result.errors?.length && <Badge tone="bad">{result.errors.length} GraphQL error(s)</Badge>}
                  </div>
                  <Tabs
                    value={resTab}
                    onChange={setResTab}
                    tabs={[
                      { id: 'response', label: 'Response' },
                      { id: 'raw', label: 'Raw' },
                      { id: 'tests', label: 'Tests', badge: result.checks?.length },
                    ]}
                  />
                  <div className="flex-1 min-h-0">
                    {resTab === 'response' && (result.response.json !== undefined ? <JsonTree data={result.response.json} onAssert={(a) => (set({ assertions: [...d.assertions, a as never] }), useApp.getState().toast(`Added a check on ${a.path} (Tests tab)`, 'success'))} onSaveVariable={(v) => void saveResponseVariable(v, env, d.testScript).then((testScript) => testScript !== undefined && set({ testScript }))} /> : <RawView text={result.response.bodyPreview} />)}
                    {resTab === 'raw' && <RawView text={result.response.bodyPreview} />}
                    {resTab === 'tests' && (
                      <div className="h-full overflow-auto">
                        <CheckList checks={result.checks ?? []} />
                        {!!result.scriptLogs?.length && (
                          <div className="border-t border-line p-3">
                            <div className="text-xs font-medium text-muted mb-1">Script output</div>
                            <pre className="mono text-xs whitespace-pre-wrap break-all">{result.scriptLogs.map((l) => `[${l.phase}] ${l.message}`).join('\n')}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <Empty icon={<Play size={26} />} title="Run the operation to see the response">
                  Introspect the endpoint to enable autocomplete, validation and the schema explorer.
                </Empty>
              )}
            </div>
          </Split>
        </Split>
      </div>
    </div>
  );
}

function SchemaExplorer({ schema, error, sdl, onInsert, onBuild, onIntrospect, loading }: { schema?: SchemaSummary; error?: NormalizedError; sdl?: string; onInsert(field: string): void; onBuild(field: string): void; onIntrospect(): void; loading: boolean }) {
  const [filter, setFilter] = useState('');
  const [stack, setStack] = useState<string[]>([]);
  const [showSdl, setShowSdl] = useState(false);
  if (error) return <div className="overflow-auto">{<ErrorPanel error={error} />}</div>;
  if (!schema)
    return (
      <Empty icon={<BookOpen size={24} />} title="No schema loaded">
        <Button className="mt-2" onClick={onIntrospect} loading={loading}>
          Introspect schema
        </Button>
      </Empty>
    );
  const current = stack.length ? schema.types.find((t) => t.name === stack[stack.length - 1]) : undefined;
  const roots = [schema.queryType, schema.mutationType, schema.subscriptionType].filter(Boolean) as string[];
  const typeLink = (t: string) => {
    const name = t.replace(/[[\]!]/g, '');
    return (
      <button className="text-[#953800] dark:text-[#ffa657] hover:underline mono" onClick={() => setStack([...stack, name])}>
        {t}
      </button>
    );
  };
  const f = filter.toLowerCase();
  return (
    <div className="h-full flex flex-col text-sm bg-panel/40">
      <div className="p-2 flex gap-1 border-b border-line">
        {stack.length > 0 && (
          <Button size="sm" variant="ghost" icon={<ChevronLeft size={12} />} onClick={() => setStack(stack.slice(0, -1))}>
            Back
          </Button>
        )}
        <Input className="flex-1 h-6 min-h-6 text-xs" placeholder="Search types and fields" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button size="sm" variant="ghost" onClick={() => setShowSdl(!showSdl)}>
          SDL
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        {showSdl ? (
          <RawView text={sdl ?? ''} />
        ) : current ? (
          <div className="p-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold mono">{current.name}</span>
              <Badge>{current.kind.toLowerCase().replace('_', ' ')}</Badge>
            </div>
            {current.description && <p className="text-muted mt-1">{current.description}</p>}
            {current.interfaces?.length ? <p className="text-xs mt-1">implements {current.interfaces.map((i) => <span key={i}>{typeLink(i)} </span>)}</p> : null}
            <div className="mt-3 flex flex-col gap-2">
              {current.fields
                ?.filter((x) => !f || x.name.toLowerCase().includes(f))
                .map((x) => (
                  <div key={x.name} className="group">
                    <div className="flex items-start gap-2">
                      <div className="flex items-center gap-1 flex-wrap min-w-0 flex-1">
                        <button className={cx('mono text-[#0550ae] dark:text-[#79c0ff] hover:underline', x.deprecated && 'line-through')} title="Insert field" onClick={() => onInsert(x.name)}>
                          {x.name}
                        </button>
                        {x.args?.length ? <span className="text-muted mono text-xs">({x.args.map((a) => `${a.name}: ${a.type}`).join(', ')})</span> : null}
                        <span className="text-muted">:</span> {typeLink(x.type)}
                      </div>
                      {roots.includes(current.name) && (
                        <button
                          className="shrink-0 mt-0.5 opacity-60 group-hover:opacity-100 text-muted hover:text-fg flex items-center gap-1 text-xs"
                          title={`Build a ${current.name === schema.mutationType ? 'mutation' : current.name === schema.subscriptionType ? 'subscription' : 'query'} for ${x.name}: variables for its arguments and a selection of its fields`}
                          aria-label={`Build operation for ${x.name}`}
                          onClick={() => onBuild(`${current.name}.${x.name}`)}
                        >
                          <Wand2 size={12} /> Build
                        </button>
                      )}
                    </div>
                    {x.description && <div className="text-xs text-muted">{x.description}</div>}
                    {x.deprecated && <div className="text-xs text-warn">Deprecated: {x.deprecated}</div>}
                  </div>
                ))}
              {current.enumValues?.map((v) => (
                <div key={v.name} className="mono">
                  {v.name} {v.description && <span className="text-xs text-muted font-sans">— {v.description}</span>}
                </div>
              ))}
              {current.possibleTypes?.length ? <div className="text-xs">Possible types: {current.possibleTypes.map((p) => <span key={p}>{typeLink(p)} </span>)}</div> : null}
            </div>
          </div>
        ) : (
          <div className="py-1">
            <div className="px-3 py-1 text-[0.7rem] uppercase text-muted tracking-wider">Root types</div>
            {roots.map((r) => (
              <button key={r} className="w-full text-left px-3 py-1 hover:bg-hover mono" onClick={() => setStack([r])}>
                {r}
              </button>
            ))}
            <div className="px-3 py-1 mt-2 text-[0.7rem] uppercase text-muted tracking-wider">All types ({schema.types.length})</div>
            {schema.types
              .filter((t) => !roots.includes(t.name) && (!f || t.name.toLowerCase().includes(f) || t.fields?.some((x) => x.name.toLowerCase().includes(f))))
              .map((t) => (
                <button key={t.name} className="w-full text-left px-3 py-1 hover:bg-hover flex items-center gap-2" onClick={() => setStack([t.name])}>
                  <span className="mono">{t.name}</span>
                  <span className="text-[0.7rem] text-muted">{t.kind.toLowerCase().replace('_', ' ')}</span>
                </button>
              ))}
            <div className="px-3 py-1 mt-2 text-[0.7rem] uppercase text-muted tracking-wider">Directives</div>
            {schema.directives.map((dr) => (
              <div key={dr.name} className="px-3 py-0.5 mono text-xs" title={dr.description}>
                @{dr.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
