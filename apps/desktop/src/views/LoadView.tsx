import { AlertTriangle, Gauge, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { asError, call, on } from '../api';
import { confirmAction, persisted, useApp } from '../store';
import type { Collection, CollectionNode, KeyValue, LatencyStats, ProviderConfig } from '../types';
import { formatBytes, formatCost, formatMs, plural } from '../lib/format';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { VarInput } from '../components/VarInput';
import { Badge, Button, cx, Empty, Field, Input, Metric, Select, Split, Tabs, Toggle, MetricGrid } from '../components/ui';
import { ErrorPanel } from '../components/Results';
import type { NormalizedError } from '../api';

interface Snapshot {
  elapsedSec: number;
  done: boolean;
  activeVUs: number;
  requests: number;
  errors: number;
  connectionFailures: number;
  errorRate: number;
  throughput: number;
  currentRps: number;
  bytes: number;
  latency: LatencyStats;
  statusCodes: Record<string, number>;
  errorKinds: Record<string, number>;
  ai?: { inputTokens: number; outputTokens: number; totalTokens: number; tokensPerSec: number; costUsd?: number; ttft: LatencyStats; interTokenMsAvg?: number; generation: LatencyStats };
  series: Array<{ t: number; rps: number; p95: number; errors: number; vus: number }>;
  perRequest?: Array<{ name: string; requests: number; errors: number; latency: LatencyStats }>;
  iterations?: number;
}

/** Folders of a collection (with their path), for picking part of it. */
function foldersOf(c: Collection | undefined): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const walk = (nodes: CollectionNode[], path: string[]) => {
    for (const n of nodes) if (n.kind === 'folder') (out.push({ id: n.id, name: [...path, n.name].join(' / ') }), walk(n.items, [...path, n.name]));
  };
  walk(c?.items ?? [], []);
  return out;
}

const drafts = persisted('load', {
  kind: 'http' as 'http' | 'llm' | 'collection',
  collectionId: '',
  folderId: '',
  warmUp: true,
  method: 'GET',
  url: '{{baseUrl}}/health',
  headers: [] as KeyValue[],
  body: '',
  provider: '',
  model: '',
  prompt: 'Say hello in one short sentence.',
  vus: 10,
  duration: 15,
  rampUp: 3,
  rampDown: 2,
  rps: '' as string | number,
  think: 0,
  allowRemote: false,
  allowProduction: false,
});

function Chart({ series, field, color, label, format }: { series: Snapshot['series']; field: 'rps' | 'p95' | 'errors' | 'vus'; color: string; label: string; format?(v: number): string }) {
  const w = 480;
  const h = 110;
  const vals = series.map((s) => s[field]);
  const max = Math.max(1, ...vals);
  const pts = series.map((s, i) => `${(i / Math.max(1, series.length - 1)) * w},${h - (s[field] / max) * (h - 12) - 4}`).join(' ');
  const last = vals[vals.length - 1] ?? 0;
  return (
    <div className="rounded-md border border-line bg-panel p-2">
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="text-fg tabular-nums">{format ? format(last) : last}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28" preserveAspectRatio="none" role="img" aria-label={`${label} chart`}>
        <line x1="0" x2={w} y1={h - 4} y2={h - 4} stroke="var(--line)" />
        {series.length > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="text-[0.7rem] text-muted">max {format ? format(max) : max}</div>
    </div>
  );
}

export function LoadView() {
  const [d, setD] = useState(drafts.load);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [id, setId] = useState<string>();
  const [snap, setSnap] = useState<Snapshot>();
  const [error, setError] = useState<NormalizedError>();
  const [tab, setTab] = useState<'headers' | 'body'>('headers');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [prep, setPrep] = useState<{ requests: string[]; unresolved: string[]; warmUp?: { passed: number; failed: number } }>();
  const env = useApp((s) => s.environment);
  const ws = useApp((s) => s.workspace);
  const idRef = useRef<string | undefined>(undefined);
  idRef.current = id;
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  useEffect(() => drafts.save(d), [d]);
  useEffect(() => {
    void call<ProviderConfig[]>('ai.providers').then(setProviders);
    void call<Collection[]>('col.list').then((cs) => setCollections(cs.filter((c) => !(c as { problem?: string }).problem)));
    const a = on<{ id: string; snapshot: Snapshot }>('load.snapshot', (p) => {
      if (p.id !== idRef.current) return;
      setSnap(p.snapshot);
      if (p.snapshot.done) {
        useApp.getState().setActivity(p.id);
        setId(undefined);
      }
    });
    const b = on<{ id: string; error: NormalizedError }>('load.error', (p) => {
      if (p.id !== idRef.current) return;
      setError(p.error);
      useApp.getState().setActivity(p.id);
      setId(undefined);
    });
    return () => {
      a();
      b();
    };
  }, []);
  const isProd = ws?.environments.find((e) => e.name === env)?.isProduction;
  const start = async () => {
    setError(undefined);
    setSnap(undefined);
    if (d.allowRemote && !(await confirmAction({ title: 'Load test a remote host', message: 'You are about to generate load against a host that is not on this computer.', detail: 'Only continue if you own this system or are explicitly authorised to load test it.', confirmLabel: 'Start load test', tone: 'warning' }))) return;
    setPrep(undefined);
    const collectionId = d.collectionId || collections[0]?.id;
    if (d.kind === 'collection' && !collectionId) return setError({ kind: 'ValidationError', message: 'There is no collection to load-test' } as NormalizedError);
    setPreparing(d.kind === 'collection');
    try {
      const target =
        d.kind === 'http'
          ? { kind: 'http', request: { method: d.method, url: d.url, headers: d.headers, body: d.body ? { type: /^\s*[{[]/.test(d.body) ? 'json' : 'text', content: d.body } : undefined } }
          : d.kind === 'llm'
            ? { kind: 'llm', model: { provider: d.provider || providers[0]?.id, name: d.model || undefined }, prompt: d.prompt, stream: true }
            : { kind: 'sequence', requests: [] };
      const r = await call<{ id: string; requests?: string[]; unresolved?: string[]; warmUp?: { passed: number; failed: number } }>('load.start', {
        environment: env,
        collection: d.kind === 'collection' ? { collectionId, selection: d.folderId ? [d.folderId] : undefined, warmUp: d.warmUp } : undefined,
        config: {
          target,
          virtualUsers: d.vus,
          durationSec: d.duration,
          rampUpSec: d.rampUp,
          rampDownSec: d.rampDown,
          requestsPerSecond: d.rps ? Number(d.rps) : undefined,
          thinkTimeMs: d.think || undefined,
          allowRemoteHosts: d.allowRemote,
          allowProduction: d.allowProduction,
        },
      });
      setId(r.id);
      if (r.requests) setPrep({ requests: r.requests, unresolved: r.unresolved ?? [], warmUp: r.warmUp });
      useApp.getState().setActivity(r.id, `Load test: ${d.vus} VUs`);
    } catch (e) {
      setError(asError(e));
    } finally {
      setPreparing(false);
    }
  };
  const collection = collections.find((c) => c.id === (d.collectionId || collections[0]?.id));
  const s = snap;
  return (
    <Split id="load-main" initial={34}>
      <div className="h-full overflow-auto p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Gauge size={16} />
          <span className="font-semibold">Load test</span>
          <Select className="ml-auto" value={d.kind} onChange={(e) => set({ kind: e.target.value as 'http' | 'llm' | 'collection' })} aria-label="Target">
            <option value="http">HTTP endpoint</option>
            <option value="collection">Collection</option>
            <option value="llm">LLM provider</option>
          </Select>
        </div>
        {d.kind === 'collection' ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Collection">
                <Select value={collection?.id ?? ''} onChange={(e) => set({ collectionId: e.target.value, folderId: '' })}>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Requests">
                <Select value={d.folderId} onChange={(e) => set({ folderId: e.target.value })}>
                  <option value="">The whole collection</option>
                  {foldersOf(collection).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Toggle checked={d.warmUp} onChange={(warmUp) => set({ warmUp })} label="Run it once first with scripts (for example to log in), then use the variables they set" />
            <p className="text-xs text-muted">Every virtual user sends the HTTP and GraphQL requests in order, again and again. Scripts don't run under load; variables are resolved once, before it starts.</p>
          </>
        ) : d.kind === 'http' ? (
          <>
            <div className="flex gap-2">
              <Select className="w-24 mono" value={d.method} onChange={(e) => set({ method: e.target.value })}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <VarInput className="flex-1 h-8" value={d.url} onChange={(url) => set({ url })} ariaLabel="Target URL" />
            </div>
            <div className="border border-line rounded-md">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'headers', label: 'Headers', badge: d.headers.length },
                  { id: 'body', label: 'Body' },
                ]}
              />
              {tab === 'headers' ? (
                <div className="p-1">
                  <KeyValueEditor rows={d.headers} onChange={(headers) => set({ headers })} />
                </div>
              ) : (
                <textarea className="w-full min-h-24 mono text-xs p-2 bg-transparent outline-none" value={d.body} onChange={(e) => set({ body: e.target.value })} placeholder='{"example": true}' />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Provider">
                <Select value={d.provider} onChange={(e) => set({ provider: e.target.value })}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Model">
                <Input className="mono" value={d.model} onChange={(e) => set({ model: e.target.value })} />
              </Field>
            </div>
            <Field label="Prompt">
              <textarea className="field min-h-20" value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
            </Field>
            <p className="text-xs text-warn">LLM load tests consume real tokens and may incur provider costs.</p>
          </>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Virtual users">
            <Input type="number" min={1} value={d.vus} onChange={(e) => set({ vus: Math.max(1, Number(e.target.value)) })} />
          </Field>
          <Field label="Duration (s)">
            <Input type="number" min={1} value={d.duration} onChange={(e) => set({ duration: Math.max(1, Number(e.target.value)) })} />
          </Field>
          <Field label="Max req/sec">
            <Input type="number" value={d.rps} placeholder="unlimited" onChange={(e) => set({ rps: e.target.value })} />
          </Field>
          <Field label="Ramp-up (s)">
            <Input type="number" min={0} value={d.rampUp} onChange={(e) => set({ rampUp: Number(e.target.value) })} />
          </Field>
          <Field label="Ramp-down (s)">
            <Input type="number" min={0} value={d.rampDown} onChange={(e) => set({ rampDown: Number(e.target.value) })} />
          </Field>
          <Field label="Think time (ms)">
            <Input type="number" min={0} value={d.think} onChange={(e) => set({ think: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="rounded-md border border-warn/40 bg-warn/5 p-3 text-sm flex flex-col gap-2">
          <div className="flex items-center gap-2 font-medium text-warn">
            <AlertTriangle size={14} /> Safeguards
          </div>
          <p className="text-xs text-muted">By default only localhost and private-network hosts can be targeted, and environments marked as production are blocked.</p>
          <Toggle checked={d.allowRemote} onChange={(allowRemote) => set({ allowRemote })} label="Allow remote hosts (I am authorised to test the target)" />
          {isProd && <Toggle checked={d.allowProduction} onChange={(allowProduction) => set({ allowProduction })} label="Allow this production environment" />}
          {isProd && <Badge tone="bad">Active environment is marked PRODUCTION</Badge>}
        </div>
        {id ? (
          <Button variant="danger" icon={<Square size={12} />} onClick={() => call('load.stop', { id })}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" icon={<Play size={13} />} loading={preparing} onClick={start}>
            {preparing ? (d.warmUp ? 'Warming up…' : 'Preparing…') : 'Start load test'}
          </Button>
        )}
      </div>
      <div className="h-full overflow-auto">
        {error && <ErrorPanel error={error} />}
        {s ? (
          <div className="p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone={s.done ? 'ok' : 'accent'}>{s.done ? 'finished' : 'running'}</Badge>
              <span className="text-sm text-muted">
                {s.elapsedSec}s elapsed · {s.activeVUs} active VUs
              </span>
            </div>
            <MetricGrid>
              <Metric label="Requests" value={s.requests.toLocaleString()} />
              <Metric label="Throughput" value={`${s.throughput}/s`} />
              <Metric label="Error rate" value={`${(s.errorRate * 100).toFixed(2)}%`} tone={s.errorRate > 0.01 ? 'bad' : 'ok'} sub={`${s.connectionFailures} connection failures`} />
              <Metric label="p50" value={formatMs(s.latency.p50)} />
              <Metric label="p90" value={formatMs(s.latency.p90)} />
              <Metric label="p95" value={formatMs(s.latency.p95)} />
              <Metric label="p99" value={formatMs(s.latency.p99)} />
              <Metric label="Transferred" value={formatBytes(s.bytes)} />
            </MetricGrid>
            {s.ai && (
              <MetricGrid>
                <Metric label="Tokens / sec" value={s.ai.tokensPerSec} />
                <Metric label="Input tokens" value={s.ai.inputTokens.toLocaleString()} />
                <Metric label="Output tokens" value={s.ai.outputTokens.toLocaleString()} />
                <Metric label="TTFT p50 / p95" value={`${formatMs(s.ai.ttft.p50)} / ${formatMs(s.ai.ttft.p95)}`} />
                <Metric label="Between tokens" value={formatMs(s.ai.interTokenMsAvg)} />
                <Metric label="Generation p50" value={formatMs(s.ai.generation.p50)} />
                <Metric label="Est. cost" value={formatCost(s.ai.costUsd)} />
              </MetricGrid>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Chart series={s.series} field="rps" color="var(--accent)" label="Requests / second" />
              <Chart series={s.series} field="p95" color="var(--judge)" label="p95 latency (per second)" format={(v) => formatMs(v)} />
              <Chart series={s.series} field="errors" color="var(--bad)" label="Errors / second" />
              <Chart series={s.series} field="vus" color="var(--ok)" label="Virtual users" />
            </div>
            {prep && (prep.unresolved.length > 0 || prep.warmUp) && (
              <div className="text-xs text-muted">
                {prep.warmUp && `Warm-up: ${prep.warmUp.passed} passed${prep.warmUp.failed ? `, ${prep.warmUp.failed} failed` : ''}. `}
                {prep.unresolved.length > 0 && <span className="text-warn">Unresolved variables: {prep.unresolved.join(', ')}.</span>}
              </div>
            )}
            {s.perRequest && (
              <div>
                <div className="text-xs text-muted font-semibold mb-1">Per request · {plural(s.iterations ?? 0, 'pass', 'passes')} through the collection</div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted text-left">
                    <tr>
                      <th className="font-medium py-1">Request</th>
                      <th className="font-medium text-right">Requests</th>
                      <th className="font-medium text-right">Errors</th>
                      <th className="font-medium text-right">p50</th>
                      <th className="font-medium text-right">p95</th>
                      <th className="font-medium text-right">p99</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {s.perRequest.map((p) => (
                      <tr key={p.name} className="border-t border-line">
                        <td className="py-1 pr-2">{p.name}</td>
                        <td className="text-right">{p.requests.toLocaleString()}</td>
                        <td className={cx('text-right', p.errors ? 'text-bad' : '')}>{p.errors.toLocaleString()}</td>
                        <td className="text-right">{formatMs(p.latency.p50)}</td>
                        <td className="text-right">{formatMs(p.latency.p95)}</td>
                        <td className="text-right">{formatMs(p.latency.p99)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <div className="text-xs text-muted font-semibold mb-1">Status code distribution</div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(s.statusCodes).map(([k, v]) => (
                  <Badge key={k} tone={/^2/.test(k) ? 'ok' : /^[45]/.test(k) || isNaN(Number(k)) ? 'bad' : 'warn'}>
                    {k}: {v}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        ) : (
          !error && (
            <Empty icon={<Gauge size={28} />} title="Configure and start a load test">
              Reports throughput, p50/p90/p95/p99 latency, error rate, status distribution and — for LLM targets — tokens/sec, time to first token and cost.
            </Empty>
          )
        )}
      </div>
    </Split>
  );
}
