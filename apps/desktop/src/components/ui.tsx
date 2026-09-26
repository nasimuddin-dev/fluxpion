import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'default' | 'ghost' | 'danger';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'default', size = 'md', loading, icon, className, children, disabled, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap select-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-[0.95rem]',
        variant === 'primary' && 'bg-accent border-accent text-white hover:brightness-110',
        variant === 'default' && 'bg-panel border-line hover:bg-hover',
        variant === 'ghost' && 'border-transparent hover:bg-hover',
        variant === 'danger' && 'bg-bad border-bad text-white hover:brightness-110',
        className,
      )}
      {...p}
    >
      {loading ? <Loader2 size={14} className="spin" /> : icon}
      {children}
    </button>
  ),
);

export function IconButton({ label, children, className, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button aria-label={label} title={label} className={cx('inline-flex items-center justify-center rounded-md h-7 w-7 text-muted hover:text-fg hover:bg-hover disabled:opacity-40', active && 'bg-hover text-fg', className)} {...p}>
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx('field', className)} {...p} />);

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('field pr-6', className)} {...p}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1 text-xs', className)}>
      <span className="text-muted font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-4 w-7 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line')}
      >
        <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', checked ? 'left-3.5' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className, right }: { tabs: Array<{ id: NoInfer<T>; label: ReactNode; badge?: ReactNode }>; value: T; onChange(v: NoInfer<T>): void; className?: string; right?: ReactNode }) {
  return (
    <div role="tablist" className={cx('flex items-center gap-0.5 border-b border-line px-2 min-h-8 shrink-0 overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('px-2.5 h-8 text-[0.92rem] border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5', value === t.id ? 'border-accent text-fg font-medium' : 'border-transparent text-muted hover:text-fg')}
        >
          {t.label}
          {t.badge !== undefined && t.badge !== null && t.badge !== 0 && <span className="text-[0.7rem] px-1.5 rounded-full bg-panel2 text-muted">{t.badge}</span>}
        </button>
      ))}
      {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default', title }: { children: ReactNode; tone?: 'default' | 'ok' | 'bad' | 'warn' | 'accent' | 'judge'; title?: string }) {
  const tones = {
    default: 'bg-panel2 text-muted border-line',
    ok: 'text-ok border-ok/40 bg-ok/10',
    bad: 'text-bad border-bad/40 bg-bad/10',
    warn: 'text-warn border-warn/40 bg-warn/10',
    accent: 'text-accent border-accent/40 bg-accent/10',
    judge: 'text-judge border-judge/40 bg-judge/10',
  };
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded px-1.5 text-[0.72rem] leading-5 border font-medium whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

export function statusTone(status?: number | string): 'ok' | 'bad' | 'warn' | 'default' {
  if (typeof status === 'number') return status < 300 ? 'ok' : status < 400 ? 'warn' : 'bad';
  if (status === 'passed' || status === 'ok' || status === 'success') return 'ok';
  if (status === 'failed' || status === 'error') return 'bad';
  if (status === 'skipped') return 'warn';
  return 'default';
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-center gap-2 p-8 text-muted">
      {icon && <div className="opacity-60">{icon}</div>}
      <div className="text-fg font-medium">{title}</div>
      {children && <div className="text-sm max-w-md">{children}</div>}
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin text-muted" />;
}

export function Modal({ title, onClose, children, footer, width = 560 }: { title: ReactNode; onClose(): void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="bg-bg border border-line rounded-lg shadow-2xl max-h-[80vh] flex flex-col" style={{ width, maxWidth: '92vw' }}>
        <div className="flex items-center justify-between px-4 h-11 border-b border-line shrink-0">
          <div className="font-semibold">{title}</div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="p-4 overflow-auto">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-line flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

/** Resizable two-pane split. Size is persisted per `id`. */
export function Split({ id, direction = 'horizontal', initial = 50, min = 15, children }: { id: string; direction?: 'horizontal' | 'vertical'; initial?: number; min?: number; children: [ReactNode, ReactNode] }) {
  const [pct, setPct] = useState(() => Number(localStorage.getItem(`aps.split.${id}`)) || initial);
  const ref = useRef<HTMLDivElement>(null);
  const onDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = ref.current!;
      const rect = el.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const p = direction === 'horizontal' ? ((ev.clientX - rect.left) / rect.width) * 100 : ((ev.clientY - rect.top) / rect.height) * 100;
        setPct(Math.min(100 - min, Math.max(min, p)));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setPct((p) => {
          localStorage.setItem(`aps.split.${id}`, String(p));
          return p;
        });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [direction, id, min],
  );
  const h = direction === 'horizontal';
  return (
    <div ref={ref} className={cx('flex min-h-0 min-w-0 h-full w-full', h ? 'flex-row' : 'flex-col')}>
      <div className="min-h-0 min-w-0 overflow-hidden flex flex-col" style={{ flexBasis: `${pct}%` }}>
        {children[0]}
      </div>
      <div
        role="separator"
        aria-orientation={h ? 'vertical' : 'horizontal'}
        onPointerDown={onDown}
        className={cx('shrink-0 bg-line hover:bg-accent transition-colors', h ? 'w-px cursor-col-resize hover:w-0.5' : 'h-px cursor-row-resize hover:h-0.5')}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden flex flex-col">{children[1]}</div>
    </div>
  );
}

/** Fixed-row-height virtual list: renders only visible rows, so 1M rows cost the same as 50. */
export function VirtualList<T>({
  items,
  rowHeight,
  render,
  className,
  overscan = 8,
  scrollToIndex,
  onEndReached,
}: {
  items: T[];
  rowHeight: number;
  render(item: T, index: number): ReactNode;
  className?: string;
  overscan?: number;
  scrollToIndex?: number;
  onEndReached?(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (scrollToIndex === undefined || !ref.current) return;
    const el = ref.current;
    const top = scrollToIndex * rowHeight;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - rowHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, [scrollToIndex, rowHeight]);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  useEffect(() => {
    if (onEndReached && end >= items.length - 5 && items.length) onEndReached();
  }, [end, items.length, onEndReached]);
  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++)
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}>
        {render(items[i]!, i)}
      </div>,
    );
  return (
    <div ref={ref} className={cx('overflow-auto relative', className)} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>{rows}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="text-[0.7rem] px-1.5 py-0.5 rounded border border-line bg-panel text-muted font-mono">{children}</kbd>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between h-8 px-3 text-[0.72rem] uppercase tracking-wider text-muted font-semibold shrink-0">
      <span>{children}</span>
      {right}
    </div>
  );
}

export function Metric({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn'; sub?: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2 min-w-[110px]">
      <div className="text-[0.72rem] text-muted">{label}</div>
      <div className={cx('text-lg font-semibold tabular-nums', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="text-[0.72rem] text-muted">{sub}</div>}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
