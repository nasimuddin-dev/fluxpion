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
