import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatMs, timeAgo } from '../lib/format';
import { cx } from './ui';

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

/** Width of an element, kept current (charts draw at their real size: round markers, crisp text). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Card({ title, aside, legend, children }: { title: string; aside?: ReactNode; legend?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel/40 p-3 min-w-0">
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">{title}</h3>
        {aside && <div className="ml-auto text-xs text-muted">{aside}</div>}
      </div>
      {children}
      {legend && <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted">{legend}</div>}
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** The hover card shared by the charts: what one run did. */
function Tip({ r, x, width }: { r: RunPoint; x: number; width: number }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-popover px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
      style={{ left: Math.max(0, Math.min(x + 12, width - 190)) }}
    >
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
    </div>
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

const nice = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

/** Run time over the last runs: one line (one axis), each point coloured by its result, the median dashed. */
export function RunTimeChart({ runs }: { runs: RunPoint[] }) {
  const ordered = useMemo(() => [...runs].slice(0, 60).reverse(), [runs]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const H = 150;
  const pad = { l: 44, r: 8, t: 8, b: 20 };
  const max = nice(Math.max(...ordered.map((r) => r.durationMs), 1));
  const sorted = [...ordered.map((r) => r.durationMs)].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0;
  const innerW = Math.max(0, width - pad.l - pad.r);
  const x = (i: number) => pad.l + (ordered.length < 2 ? innerW / 2 : (i / (ordered.length - 1)) * innerW);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = ordered.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.durationMs).toFixed(1)}`).join(' ');
  const onMove = (e: React.MouseEvent) => {
    if (!ordered.length) return;
    const bx = e.currentTarget.getBoundingClientRect().left;
    const px = e.clientX - bx;
    let best = 0;
    for (let i = 1; i < ordered.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  return (
    <Card title="Run time" aside={ordered.length ? <span>median <b className="text-fg">{formatMs(median)}</b></span> : undefined}>
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(undefined)}>
        <svg width={width} height={H} role="img" aria-label={`Run time of the last ${ordered.length} runs, median ${formatMs(median)}`}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {t === 0 ? '0' : formatMs(t)}
              </text>
            </g>
          ))}
          {ordered.length > 1 && <line x1={pad.l} x2={width - pad.r} y1={y(median)} y2={y(median)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} />}
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={1} />}
          {ordered.map((r, i) => (
            <circle key={r.runId} cx={x(i)} cy={y(r.durationMs)} r={hover === i ? 5 : 4} fill={statusColor(r.status)} stroke="var(--bg)" strokeWidth={2} />
          ))}
          {ordered.length > 0 && (
            <>
              <text x={pad.l} y={H - 4} fontSize={10} fill="var(--muted)">
                {timeAgo(ordered[0]!.startedAt)}
              </text>
              <text x={width - pad.r} y={H - 4} fontSize={10} fill="var(--muted)" textAnchor="end">
                {timeAgo(ordered[ordered.length - 1]!.startedAt)}
              </text>
            </>
          )}
        </svg>
        {hover !== undefined && ordered[hover] && <Tip r={ordered[hover]!} x={x(hover)} width={width} />}
      </div>
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
