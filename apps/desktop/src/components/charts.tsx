import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Width of an element, kept current (charts draw at their real size: round markers, crisp text). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
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

/** A chart's frame: small caps title, an aside (headline number) and a legend row under the plot. */
export function ChartCard({ title, aside, legend, children, className }: { title: string; aside?: ReactNode; legend?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={'rounded-xl border border-line bg-panel/40 p-3 min-w-0 ' + (className ?? '')}>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">{title}</h3>
        {aside && <div className="ml-auto text-xs text-muted">{aside}</div>}
      </div>
      {children}
      {legend && <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted">{legend}</div>}
    </section>
  );
}

export function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** A hover card positioned at x inside a chart of the given width. */
export function ChartTip({ x, width, children, top = 0 }: { x: number; width: number; children: ReactNode; top?: number }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-lg border border-line bg-popover px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
      style={{ top, left: Math.max(0, Math.min(x + 12, width - 200)) }}
    >
      {children}
    </div>
  );
}

/** A round number at or above v (1, 2, 5 × 10ⁿ) for an axis maximum. */
export const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

/** A duration for an axis tick: 250 ms, 1 s, 2.5 s (no trailing zeros). */
export const axisMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${Number((ms / 1000).toFixed(2))} s`);

/**
 * How long something took next to the others in a list, as a thin bar (log scale, so a few slow
 * items don't flatten the rest). Decorative: the number is always shown beside it.
 */
export function DurationBar({ ms, max, bad, className }: { ms: number; max: number; bad?: boolean; className?: string }) {
  const w = max > 0 ? Math.max(0.04, Math.log1p(Math.max(0, ms)) / Math.log1p(max)) : 0;
  return (
    <span aria-hidden className={'inline-block h-1 w-16 rounded-full bg-hover/70 overflow-hidden align-middle ' + (className ?? '')}>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(1, w) * 100}%`, background: bad ? 'var(--bad)' : 'var(--accent)' }} />
    </span>
  );
}

/** Results of the latest runs as tiny blocks, oldest left (green passed, red failed or could not run). */
export function RecentRuns({ statuses, className }: { statuses: string[]; className?: string }) {
  if (!statuses.length) return null;
  const passed = statuses.filter((s) => s === 'passed').length;
  const label = statuses.length === 1 ? `The last run ${passed ? 'passed' : 'failed'}` : `${passed} of the last ${statuses.length} runs passed (oldest left)`;
  return (
    <span className={'inline-flex items-end gap-px h-3 shrink-0 ' + (className ?? '')} role="img" aria-label={label} title={label}>
      {statuses.map((s, i) => (
        <span key={i} className="w-[3px] h-full rounded-[1px]" style={{ background: s === 'passed' ? 'var(--ok)' : 'var(--bad)', opacity: 0.85 }} />
      ))}
    </span>
  );
}

/**
 * A metric across items (oldest left): one line, each point coloured by its item (e.g. passed / failed),
 * a crosshair and tooltip on hover, an optional dashed reference line (a median), labels under the ends.
 * One axis; the item under the mouse can be picked with a click.
 */
export function PointLine<T>({
  items,
  value,
  color,
  keyOf,
  axis,
  tip,
  ends,
  reference,
  label,
  height = 150,
  onPick,
}: {
  items: T[];
  value(d: T): number;
  color(d: T): string;
  keyOf(d: T): string;
  axis(v: number): string;
  tip(d: T): ReactNode;
  /** Text under the first and last point (e.g. "2h ago"). */
  ends?(d: T): string;
  reference?: number;
  label: string;
  height?: number;
  onPick?(d: T): void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const H = height;
  const pad = { l: 48, r: 8, t: 8, b: ends ? 20 : 12 };
  const max = niceMax(Math.max(1, ...items.map(value)));
  const innerW = Math.max(0, width - pad.l - pad.r);
  const x = (i: number) => pad.l + (items.length < 2 ? innerW / 2 : (i / (items.length - 1)) * innerW);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = items.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value(d)).toFixed(1)}`).join(' ');
  const onMove = (e: React.MouseEvent) => {
    if (!items.length) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < items.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  return (
    <div ref={ref} className={'relative' + (onPick ? ' cursor-pointer' : '')} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} onClick={() => hover !== undefined && items[hover] && onPick?.(items[hover]!)}>
      <svg width={width} height={H} role="img" aria-label={label}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
              {t === 0 ? '0' : axis(t)}
            </text>
          </g>
        ))}
        {reference !== undefined && items.length > 1 && <line x1={pad.l} x2={width - pad.r} y1={y(reference)} y2={y(reference)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} />}
        {items.length > 1 && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={1} />}
        {items.map((d, i) => (
          <circle key={keyOf(d)} cx={x(i)} cy={y(value(d))} r={hover === i ? 5 : 4} fill={color(d)} stroke="var(--bg)" strokeWidth={2} />
        ))}
        {ends && items.length > 0 && (
          <>
            <text x={pad.l} y={H - 4} fontSize={10} fill="var(--muted)">
              {ends(items[0]!)}
            </text>
            <text x={width - pad.r} y={H - 4} fontSize={10} fill="var(--muted)" textAnchor="end">
              {ends(items[items.length - 1]!)}
            </text>
          </>
        )}
      </svg>
      {hover !== undefined && items[hover] && (
        <ChartTip x={x(hover)} width={width}>
          {tip(items[hover]!)}
        </ChartTip>
      )}
    </div>
  );
}
