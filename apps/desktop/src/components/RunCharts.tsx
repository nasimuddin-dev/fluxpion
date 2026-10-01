import { useEffect, useState } from 'react';
import { call } from '../api';
import { formatMs, plural } from '../lib/format';
import { ChartCard, ChartTip, niceMax, Swatch, useWidth } from './charts';
import { StatusIcon } from './Results';
import { Empty } from './ui';

/** From `runs.breakdown` (runBreakdown in core). */
interface Breakdown {
  timed: number;
  histogram: Array<{
    fromMs: number;
    toMs?: number;
    passed: number;
    failed: number;
  }>;
  slowest: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    latencyMs: number;
  }>;
  byType: Record<string, { passed: number; failed: number; skipped: number }>;
  failingChecks: Array<{ name: string; count: number }>;
}

const TYPE_LABEL: Record<string, string> = {
  http: 'REST',
  graphql: 'GraphQL',
  grpc: 'gRPC',
  mcp: 'MCP',
  llm: 'AI',
  websocket: 'WebSocket',
  script: 'Script',
  evaluation: 'Evaluation',
};
/** Round bounds read better short: 250 ms, 1 s, 2.5 s. */
const bound = (ms: number) => (ms < 1000 ? `${ms} ms` : `${ms / 1000} s`);
const bucketLabel = (b: Breakdown['histogram'][number]) => (b.toMs === undefined ? `≥ ${bound(b.fromMs)}` : b.fromMs === 0 ? `< ${bound(b.toMs)}` : `${bound(b.fromMs)}–${bound(b.toMs)}`);

/** How long the run's tests took: one column per latency range, passed at the base, failed above. */
function LatencyHistogram({ data }: { data: Breakdown['histogram'] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const H = 160;
  const pad = { l: 36, r: 6, t: 8, b: 22 };
  const max = Math.max(2, niceMax(Math.max(...data.map((b) => b.passed + b.failed), 1)));
  const innerW = Math.max(0, width - pad.l - pad.r);
  const slot = data.length ? innerW / data.length : 0;
  const bw = Math.max(4, Math.min(48, slot * 0.72));
  const base = H - pad.b;
  const h = (v: number) => (v / max) * (base - pad.t);
  const x = (i: number) => pad.l + slot * i + slot / 2;
  return (
    <ChartCard
      title="Response time"
      aside="tests per range"
      legend={
        <>
          <Swatch color="var(--ok)" label="Passed" />
          <Swatch color="var(--bad)" label="Failed" />
        </>
      }
    >
      <div ref={ref} className="relative" onMouseLeave={() => setHover(undefined)}>
        <svg width={width} height={H} role="img" aria-label="Tests per response-time range">
          {[0, Math.round(max / 2), max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={base - h(t)} y2={base - h(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={base - h(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {t}
              </text>
            </g>
          ))}
          {data.map((b, i) => {
            const okH = h(b.passed);
            const badH = h(b.failed);
            return (
              <g key={b.fromMs} onMouseEnter={() => setHover(i)} opacity={hover === undefined || hover === i ? 1 : 0.5}>
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={base - pad.t} fill="transparent" />
                {okH > 0 && <rect x={x(i) - bw / 2} y={base - okH} width={bw} height={okH} rx={2} fill="var(--ok)" />}
                {badH > 0 && <rect x={x(i) - bw / 2} y={base - okH - badH - (okH > 0 ? 2 : 0)} width={bw} height={badH} rx={2} fill="var(--bad)" />}
                <text x={x(i)} y={H - 6} fontSize={10} fill="var(--muted)" textAnchor="middle">
                  {slot > 64 ? bucketLabel(b) : b.toMs === undefined ? `≥${formatMs(b.fromMs)}` : `<${formatMs(b.toMs)}`}
                </text>
              </g>
            );
          })}
        </svg>
        {hover !== undefined && data[hover] && (
          <ChartTip x={x(hover)} width={width}>
            <div className="font-medium text-fg">{bucketLabel(data[hover]!)}</div>
            <div className="text-muted mt-0.5">
              {plural(data[hover]!.passed, 'test')} passed · {data[hover]!.failed} failed
            </div>
          </ChartTip>
        )}
      </div>
    </ChartCard>
  );
}

/** Results per test type as one proportional bar each (passed, failed, skipped). */
function ByType({ byType }: { byType: Breakdown['byType'] }) {
  const rows = Object.entries(byType).sort((a, b) => b[1].passed + b[1].failed + b[1].skipped - (a[1].passed + a[1].failed + a[1].skipped));
  const max = Math.max(...rows.map(([, v]) => v.passed + v.failed + v.skipped), 1);
  return (
    <ChartCard
      title="By type"
      legend={
        <>
          <Swatch color="var(--ok)" label="Passed" />
          <Swatch color="var(--bad)" label="Failed" />
          <Swatch color="var(--warn)" label="Skipped" />
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {rows.map(([t, v]) => {
          const total = v.passed + v.failed + v.skipped;
          return (
            <div key={t} className="flex items-center gap-2 text-xs" title={`${TYPE_LABEL[t] ?? t}: ${v.passed} passed, ${v.failed} failed, ${v.skipped} skipped`}>
              <span className="w-20 shrink-0 text-muted truncate">{TYPE_LABEL[t] ?? t}</span>
              <span className="flex-1 h-3 flex gap-0.5">
                <span className="flex h-full gap-0.5" style={{ width: `${(total / max) * 100}%` }}>
                  {v.passed > 0 && <span className="h-full rounded-sm bg-ok" style={{ flex: v.passed }} />}
                  {v.failed > 0 && <span className="h-full rounded-sm bg-bad" style={{ flex: v.failed }} />}
                  {v.skipped > 0 && <span className="h-full rounded-sm bg-warn" style={{ flex: v.skipped }} />}
                </span>
              </span>
              <span className="w-16 text-right tabular-nums text-fg">
                {v.passed}/{total}
              </span>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

/** The run at a glance: response-time histogram, results per type, slowest tests and the checks that failed most. */
export function RunCharts({ runId, onPick }: { runId: string; onPick?(name: string): void }) {
  const [data, setData] = useState<Breakdown>();
  useEffect(() => {
    setData(undefined);
    void call<Breakdown>('runs.breakdown', { runId }).then(setData, () => setData(undefined));
  }, [runId]);
  if (!data) return <Empty title="Loading…" />;
  if (!data.timed && !Object.keys(data.byType).length) return <Empty title="No results in this run" />;
  return (
    <div className="h-full overflow-auto p-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {data.timed > 0 && <LatencyHistogram data={data.histogram} />}
        <ByType byType={data.byType} />
        {data.slowest.length > 0 && (
          <ChartCard title="Slowest tests">
            <div className="flex flex-col">
              {data.slowest.map((r) => (
                <button
                  key={r.id}
                  className="flex items-center gap-2 py-1 px-1 -mx-1 rounded text-xs text-left min-w-0 hover:bg-hover"
                  title={`Show ${r.name} in the results`}
                  onClick={() => onPick?.(r.name)}
                >
                  <StatusIcon status={r.status} />
                  <span className="truncate flex-1 min-w-0 text-fg">{r.name}</span>
                  <span className="w-16 text-right tabular-nums shrink-0 text-fg">{formatMs(r.latencyMs)}</span>
                </button>
              ))}
            </div>
          </ChartCard>
        )}
        {data.failingChecks.length > 0 && (
          <ChartCard title="Checks that failed most">
            <div className="flex flex-col">
              {data.failingChecks.map((c) => (
                <div key={c.name} className="flex items-center gap-2 py-1 text-xs min-w-0">
                  <span className="truncate flex-1 min-w-0 text-fg" title={c.name}>
                    {c.name}
                  </span>
                  <span className="text-bad tabular-nums shrink-0">{plural(c.count, 'time')}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
