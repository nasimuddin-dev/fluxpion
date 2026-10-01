import { useEffect, useState } from 'react';
import { call, on } from '../api';
import { formatMs, timeAgo } from '../lib/format';
import { axisMs, ChartCard, ChartTip, niceMax, useWidth } from './charts';
import { Badge, cx } from './ui';

/** From `load.history` (LoadRunRecord in core). */
export interface LoadRun {
  id: string;
  startedAt: string;
  savedId?: string;
  name: string;
  target: string;
  environment?: string;
  virtualUsers: number;
  durationSec: number;
  stopped?: boolean;
  requests: number;
  throughput: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  passed?: boolean;
}

const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;

/** One metric across the last runs (oldest left): a line, points coloured by the run's result. */
function Trend({ runs, title, value, format, axis }: { runs: LoadRun[]; title: string; value(r: LoadRun): number; format(v: number): string; axis(v: number): string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const H = 120;
  const pad = { l: 48, r: 8, t: 8, b: 16 };
  const max = niceMax(Math.max(1, ...runs.map(value)));
  const innerW = Math.max(0, width - pad.l - pad.r);
  const x = (i: number) => pad.l + (runs.length < 2 ? innerW / 2 : (i / (runs.length - 1)) * innerW);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = runs.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value(r)).toFixed(1)}`).join(' ');
  const color = (r: LoadRun) => (r.passed === false || r.errorRate > 0.01 ? 'var(--bad)' : 'var(--ok)');
  const onMove = (e: React.MouseEvent) => {
    if (!runs.length) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < runs.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  const last = runs[runs.length - 1];
  return (
    <ChartCard title={title} aside={last ? <span>last <b className="text-fg">{format(value(last))}</b></span> : undefined}>
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(undefined)}>
        <svg width={width} height={H} role="img" aria-label={`${title} of the last ${runs.length} load tests`}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {t === 0 ? '0' : axis(t)}
              </text>
            </g>
          ))}
          {runs.length > 1 && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={1} />}
          {runs.map((r, i) => (
            <circle key={r.id} cx={x(i)} cy={y(value(r))} r={hover === i ? 5 : 4} fill={color(r)} stroke="var(--bg)" strokeWidth={2} />
          ))}
        </svg>
        {hover !== undefined && runs[hover] && (
          <ChartTip x={x(hover)} width={width}>
            <div className="font-medium text-fg">
              {format(value(runs[hover]!))} · {timeAgo(runs[hover]!.startedAt)}
            </div>
            <div className="text-muted mt-0.5">
              {runs[hover]!.virtualUsers} VUs · {runs[hover]!.durationSec}s · errors {pct(runs[hover]!.errorRate)}
            </div>
          </ChartTip>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Earlier load tests (of the opened saved load test, or all): p95 and throughput trends and a list.
 * Every finished load test is recorded by the backend.
 */
export function LoadHistory({ savedId }: { savedId?: string }) {
  const [runs, setRuns] = useState<LoadRun[]>([]);
  useEffect(() => {
    const load = () => void call<LoadRun[]>('load.history', { savedId, limit: 30 }).then(setRuns, () => setRuns([]));
    load();
    return on('load.recorded', load);
  }, [savedId]);
  if (!runs.length) return null;
  const ordered = [...runs].reverse();
  return (
    <section aria-label="Earlier load tests" className="flex flex-col gap-2">
      <div className="text-xs text-muted font-semibold">{savedId ? 'Earlier runs of this load test' : 'Earlier load tests'}</div>
      {ordered.length > 1 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <Trend runs={ordered} title="p95 latency" value={(r) => r.p95} format={formatMs} axis={axisMs} />
          <Trend runs={ordered} title="Throughput" value={(r) => r.throughput} format={(v) => `${Math.round(v)}/s`} axis={(v) => String(Math.round(v))} />
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs text-muted text-left">
          <tr>
            <th className="font-medium py-1">When</th>
            {!savedId && <th className="font-medium">Load test</th>}
            <th className="font-medium text-right">VUs</th>
            <th className="font-medium text-right">Req/s</th>
            <th className="font-medium text-right">p95</th>
            <th className="font-medium text-right">Errors</th>
            <th className="font-medium text-right">Result</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {runs.map((r) => (
            <tr key={r.id} className="border-t border-line" title={`${r.target}${r.environment ? ` · ${r.environment}` : ''}`}>
              <td className="py-1 pr-2 whitespace-nowrap">{timeAgo(r.startedAt)}</td>
              {!savedId && <td className="pr-2 truncate max-w-56">{r.name}</td>}
              <td className="text-right">{r.virtualUsers}</td>
              <td className="text-right">{Math.round(r.throughput)}</td>
              <td className="text-right">{formatMs(r.p95)}</td>
              <td className={cx('text-right', r.errorRate > 0.01 && 'text-bad')}>{pct(r.errorRate)}</td>
              <td className="text-right">{r.passed === undefined ? (r.stopped ? <Badge tone="warn">stopped</Badge> : <span className="text-muted">—</span>) : <Badge tone={r.passed ? 'ok' : 'bad'}>{r.passed ? 'passed' : 'failed'}</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
