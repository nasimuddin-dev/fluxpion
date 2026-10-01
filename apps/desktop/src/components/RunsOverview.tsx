import { useState } from 'react';
import { formatMs, plural } from '../lib/format';
import { axisMs, ChartCard, ChartTip, niceMax, Swatch, useWidth } from './charts';
import { Empty } from './ui';

/** A run in a list of runs (runs.list). */
export interface RunRow {
  id: string;
  name: string;
  startedAt: string;
  durationMs?: number;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  environment?: string;
}

/** Passed / failed share of one run as a thin bar (for run lists). */
export function RunMiniBar({ r }: { r: RunRow }) {
  const bad = r.failed + r.errors;
  const rest = Math.max(0, r.total - r.passed - bad);
  if (!r.total) return null;
  return (
    <span className="flex h-1 gap-px mt-1 rounded-full overflow-hidden" aria-hidden>
      {r.passed > 0 && <span className="bg-ok" style={{ flex: r.passed }} />}
      {bad > 0 && <span className="bg-bad" style={{ flex: bad }} />}
      {rest > 0 && <span className="bg-warn" style={{ flex: rest }} />}
    </span>
  );
}

function RunTip({ r, x, width }: { r: RunRow; x: number; width: number }) {
  return (
    <ChartTip x={x} width={width}>
      <div className="font-medium text-fg max-w-[240px] truncate">{r.name}</div>
      <div className="text-muted mt-0.5">
        {r.passed}/{r.total} passed{r.durationMs !== undefined ? ` · ${formatMs(r.durationMs)}` : ''}
        {r.environment ? ` · ${r.environment}` : ''}
      </div>
      <div className="text-muted">{new Date(r.startedAt).toLocaleString()}</div>
    </ChartTip>
  );
}

/** Pass rate of each of the last runs (oldest left): one column per run, the share of its tests that passed. */
function PassRate({ runs, onSelect }: { runs: RunRow[]; onSelect?(id: string): void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const H = 150;
  const pad = { l: 40, r: 6, t: 8, b: 18 };
  const innerW = Math.max(0, width - pad.l - pad.r);
  const slot = runs.length ? innerW / runs.length : 0;
  const bw = Math.max(3, Math.min(20, slot * 0.7));
  const base = H - pad.b;
  const y = (v: number) => base - v * (base - pad.t);
  const x = (i: number) => pad.l + slot * i + slot / 2;
  const all = runs.reduce((a, r) => a + r.total, 0);
  const passed = runs.reduce((a, r) => a + r.passed, 0);
  return (
    <ChartCard
      title="Pass rate by run"
      aside={
        all ? (
          <span>
            overall <b className="text-fg">{Math.round((passed / all) * 1000) / 10}%</b>
          </span>
        ) : undefined
      }
      legend={
        <>
          <Swatch color="var(--ok)" label="Every test passed" />
          <Swatch color="var(--bad)" label="Some failed" />
          <span className="ml-auto">{plural(runs.length, 'run')}, oldest left</span>
        </>
      }
    >
      <div ref={ref} className="relative" onMouseLeave={() => setHover(undefined)}>
        <svg width={width} height={H} role="img" aria-label="Share of tests that passed in each run">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {t * 100}%
              </text>
            </g>
          ))}
          {runs.map((r, i) => {
            const v = r.total ? r.passed / r.total : 0;
            return (
              <g key={r.id} onMouseEnter={() => setHover(i)} onClick={() => onSelect?.(r.id)} className={onSelect ? 'cursor-pointer' : undefined} opacity={hover === undefined || hover === i ? 1 : 0.5}>
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={base - pad.t} fill="transparent" />
                <rect x={x(i) - bw / 2} y={Math.min(y(v), base - 2)} width={bw} height={Math.max(2, base - y(v))} rx={2} fill={r.failed + r.errors ? 'var(--bad)' : 'var(--ok)'} />
              </g>
            );
          })}
        </svg>
        {hover !== undefined && runs[hover] && <RunTip r={runs[hover]!} x={x(hover)} width={width} />}
      </div>
    </ChartCard>
  );
}

/** Duration of each of the last runs (oldest left): one line, points coloured by result. */
function RunDurations({ runs, onSelect }: { runs: RunRow[]; onSelect?(id: string): void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const timed = runs.filter((r) => typeof r.durationMs === 'number');
  const H = 150;
  const pad = { l: 48, r: 8, t: 8, b: 18 };
  const max = niceMax(Math.max(1, ...timed.map((r) => r.durationMs!)));
  const innerW = Math.max(0, width - pad.l - pad.r);
  const x = (i: number) => pad.l + (timed.length < 2 ? innerW / 2 : (i / (timed.length - 1)) * innerW);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = timed.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.durationMs!).toFixed(1)}`).join(' ');
  const onMove = (e: React.MouseEvent) => {
    if (!timed.length) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < timed.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  if (!timed.length) return null;
  return (
    <ChartCard title="Run duration">
      <div ref={ref} className={'relative' + (onSelect ? ' cursor-pointer' : '')} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} onClick={() => hover !== undefined && onSelect?.(timed[hover]!.id)}>
        <svg width={width} height={H} role="img" aria-label="Duration of each run">
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {t === 0 ? '0' : axisMs(t)}
              </text>
            </g>
          ))}
          {timed.length > 1 && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={1} />}
          {timed.map((r, i) => (
            <circle key={r.id} cx={x(i)} cy={y(r.durationMs!)} r={hover === i ? 5 : 4} fill={r.failed + r.errors ? 'var(--bad)' : 'var(--ok)'} stroke="var(--bg)" strokeWidth={2} />
          ))}
        </svg>
        {hover !== undefined && timed[hover] && <RunTip r={timed[hover]!} x={x(hover)} width={width} />}
      </div>
    </ChartCard>
  );
}

/** The runs at a glance (shown when no run is selected): pass rate and duration of the last 40 runs. */
export function RunsOverview({ runs, onSelect }: { runs: RunRow[]; onSelect?(id: string): void }) {
  const last = runs.slice(0, 40).reverse();
  if (!last.length) return <Empty title="No runs yet">Run tests, a suite or a collection; each run is listed here with its results and charts.</Empty>;
  return (
    <div className="h-full overflow-auto p-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <PassRate runs={last} onSelect={onSelect} />
        <RunDurations runs={last} onSelect={onSelect} />
      </div>
      <p className="text-xs text-muted mt-3">Click a bar or point, or a run in the list, to see its results.</p>
    </div>
  );
}
