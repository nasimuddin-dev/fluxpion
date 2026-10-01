import { useMemo, useState } from 'react';
import { formatMs, timeAgo } from '../lib/format';
import { cx } from './ui';
import { axisMs, ChartCard as Card, ChartTip, PointLine, Swatch, useWidth } from './charts';

/** A monitor run, as the charts need it. */
export interface RunPoint {
  runId: string;
  startedAt: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'error';
  total: number;
  passed: number;
  failed: number;
  errors: number;
  p50Ms?: number;
}

const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', error: 'Could not run' } as const;
const statusColor = (s: RunPoint['status']) => (s === 'passed' ? 'var(--ok)' : 'var(--bad)');

/** The hover card shared by the charts: what one run did. */
function Tip({ r, x, width }: { r: RunPoint; x: number; width: number }) {
  return (
    <ChartTip x={x} width={width}>
      <TipBody r={r} />
    </ChartTip>
  );
}

function TipBody({ r }: { r: RunPoint }) {
  return (
    <>
      <div className="flex items-center gap-1.5 font-medium text-fg">
        <span className="w-2 h-2 rounded-full" style={{ background: statusColor(r.status) }} />
        {STATUS_LABEL[r.status]} · {timeAgo(r.startedAt)}
      </div>
      <div className="text-muted mt-0.5">
        {r.total ? `${r.passed}/${r.total} requests passed · ` : ''}
        {formatMs(r.durationMs)}
        {r.p50Ms !== undefined ? ` · median response ${formatMs(r.p50Ms)}` : ''}
      </div>
      <div className="text-muted">{new Date(r.startedAt).toLocaleString()}</div>
    </>
  );
}

/** Share of runs that passed since a time (undefined when there were none). */
function uptimeSince(runs: RunPoint[], ms: number): number | undefined {
  const since = Date.now() - ms;
  const inRange = runs.filter((r) => Date.parse(r.startedAt) >= since);
  if (!inRange.length) return undefined;
  return Math.round((inRange.filter((r) => r.status === 'passed').length / inRange.length) * 1000) / 10;
}

const pct = (v?: number) => (v === undefined ? '—' : `${v}%`);

/** Availability, like a status page: one block per run (oldest → newest), passed or not, with uptime over 24 h and 7 days. */
export function AvailabilityStrip({ runs }: { runs: RunPoint[] }) {
  const ordered = useMemo(() => [...runs].slice(0, 90).reverse(), [runs]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const gap = 2;
  const block = ordered.length ? Math.max(3, Math.min(14, (width - gap * (ordered.length - 1)) / ordered.length)) : 0;
  return (
    <Card
      title="Availability"
      aside={
        <span>
          24 h <b className="text-fg">{pct(uptimeSince(runs, 864e5))}</b> · 7 days <b className="text-fg">{pct(uptimeSince(runs, 7 * 864e5))}</b>
        </span>
      }
      legend={
        <>
          <Swatch color="var(--ok)" label="Passed" />
          <Swatch color="var(--bad)" label="Failed or could not run" />
          <span className="ml-auto">{ordered.length === 1 ? 'the last run' : ordered.length ? `last ${ordered.length} runs, oldest left` : ''}</span>
        </>
      }
    >
      <div ref={ref} className="relative h-8" onMouseLeave={() => setHover(undefined)}>
        <svg width={width} height={32} role="img" aria-label={`${ordered.filter((r) => r.status === 'passed').length} of the last ${ordered.length} runs passed`}>
          {ordered.map((r, i) => (
            <rect
              key={r.runId}
              x={i * (block + gap)}
              y={0}
              width={block}
              height={32}
              rx={2}
              fill={statusColor(r.status)}
              opacity={hover === undefined || hover === i ? 0.9 : 0.45}
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        {hover !== undefined && ordered[hover] && <div className="absolute left-0 top-9 w-full h-0"><Tip r={ordered[hover]!} x={hover * (block + gap)} width={width} /></div>}
      </div>
    </Card>
  );
}

/** Run time over the last runs: one line (one axis), each point coloured by its result, the median dashed. */
export function RunTimeChart({ runs }: { runs: RunPoint[] }) {
  const ordered = useMemo(() => [...runs].slice(0, 60).reverse(), [runs]);
  const sorted = ordered.map((r) => r.durationMs).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0;
  return (
    <Card title="Run time" aside={ordered.length ? <span>median <b className="text-fg">{formatMs(median)}</b></span> : undefined}>
      <PointLine
        items={ordered}
        value={(r) => r.durationMs}
        color={(r) => statusColor(r.status)}
        keyOf={(r) => r.runId}
        axis={axisMs}
        reference={median}
        ends={(r) => timeAgo(r.startedAt)}
        tip={(r) => <TipBody r={r} />}
        label={`Run time of the last ${ordered.length} runs, median ${formatMs(median)}`}
      />
    </Card>
  );
}

/** Requests per run: passed stacked under failed (failed + errors), one bar per run. */
export function RequestsChart({ runs }: { runs: RunPoint[] }) {
  const ordered = useMemo(() => [...runs].slice(0, 40).reverse(), [runs]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const H = 150;
  const pad = { l: 28, r: 4, t: 8, b: 20 };
  const max = Math.max(...ordered.map((r) => r.total), 1);
  const innerW = Math.max(0, width - pad.l - pad.r);
  const gap = 2;
  const bw = ordered.length ? Math.max(3, Math.min(18, (innerW - gap * (ordered.length - 1)) / ordered.length)) : 0;
  const h = (v: number) => (v / max) * (H - pad.t - pad.b);
  const base = H - pad.b;
  const anyFailed = ordered.some((r) => r.failed + r.errors > 0);
  return (
    <Card
      title="Requests per run"
      legend={
        <>
          <Swatch color="var(--ok)" label="Passed" />
          <Swatch color="var(--bad)" label="Failed" />
          {!anyFailed && ordered.length > 0 && <span className="ml-auto">every request passed</span>}
        </>
      }
    >
      <div ref={ref} className="relative" onMouseLeave={() => setHover(undefined)}>
        <svg width={width} height={H} role="img" aria-label="Requests passed and failed per run">
          {[0, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={base - h(t)} y2={base - h(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={base - h(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {t}
              </text>
            </g>
          ))}
          {ordered.map((r, i) => {
            const bx = pad.l + i * (bw + gap);
            const bad = r.failed + r.errors;
            const okH = h(r.passed);
            const badH = h(bad);
            return (
              <g key={r.runId} onMouseEnter={() => setHover(i)} opacity={hover === undefined || hover === i ? 1 : 0.5}>
                {/* the hit target is the whole column, not only the bar */}
                <rect x={bx} y={pad.t} width={bw} height={base - pad.t} fill="transparent" />
                {okH > 0 && <rect x={bx} y={base - okH} width={bw} height={okH} rx={2} fill="var(--ok)" />}
                {badH > 0 && <rect x={bx} y={base - okH - badH - (okH > 0 ? gap : 0)} width={bw} height={badH} rx={2} fill="var(--bad)" />}
                {r.total === 0 && <rect x={bx} y={base - 2} width={bw} height={2} rx={1} fill="var(--bad)" />}
              </g>
            );
          })}
        </svg>
        {hover !== undefined && ordered[hover] && <Tip r={ordered[hover]!} x={pad.l + hover * (bw + gap)} width={width} />}
      </div>
    </Card>
  );
}

/** The monitor's charts: availability across the top, run time and requests side by side. */
export function MonitorCharts({ runs }: { runs: RunPoint[] }) {
  if (!runs.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <AvailabilityStrip runs={runs} />
      <div className={cx('grid gap-3', '@container')} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <RunTimeChart runs={runs} />
        <RequestsChart runs={runs} />
      </div>
    </div>
  );
}
