import { useState } from 'react';
import { formatMs, plural } from '../lib/format';
import { axisMs, ChartCard, chartKeys, ChartTip, PointLine, Swatch, useWidth } from './charts';
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
      <RunTipBody r={r} />
    </ChartTip>
  );
}

function RunTipBody({ r }: { r: RunRow }) {
  return (
    <>
      <div className="font-medium text-fg max-w-[240px] truncate">{r.name}</div>
      <div className="text-muted mt-0.5">
        {r.passed}/{r.total} passed{r.durationMs !== undefined ? ` · ${formatMs(r.durationMs)}` : ''}
        {r.environment ? ` · ${r.environment}` : ''}
      </div>
      <div className="text-muted">{new Date(r.startedAt).toLocaleString()}</div>
    </>
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
      <div ref={ref} {...chartKeys(runs.length, hover, setHover, onSelect && ((i) => onSelect(runs[i]!.id)))} className="relative outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded" onMouseLeave={() => setHover(undefined)}>
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
  const timed = runs.filter((r) => typeof r.durationMs === 'number');
  if (!timed.length) return null;
  return (
    <ChartCard title="Run duration">
      <PointLine
        items={timed}
        value={(r) => r.durationMs!}
        color={(r) => (r.failed + r.errors ? 'var(--bad)' : 'var(--ok)')}
        keyOf={(r) => r.id}
        axis={axisMs}
        tip={(r) => <RunTipBody r={r} />}
        label="Duration of each run"
        onPick={onSelect && ((r) => onSelect(r.id))}
      />
    </ChartCard>
  );
}

/** The runs at a glance (shown when no run is selected): pass rate and duration of the last 40 runs. */
export function RunsOverview({ runs, onSelect, hint = 'Click a bar or point, or a run in the list, to see its results.' }: { runs: RunRow[]; onSelect?(id: string): void; hint?: string }) {
  const last = runs.slice(0, 40).reverse();
  if (!last.length) return <Empty title="No runs yet">Run tests, a suite or a collection; each run is listed here with its results and charts.</Empty>;
  return (
    <div className="h-full overflow-auto p-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <PassRate runs={last} onSelect={onSelect} />
        <RunDurations runs={last} onSelect={onSelect} />
      </div>
      <p className="text-xs text-muted mt-3">{hint}</p>
    </div>
  );
}
