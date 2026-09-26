import { useEffect, useRef, useState } from 'react';
import { call } from '../api';
import { useApp } from '../store';
import { cx, useDebounced } from './ui';

interface VarInfo {
  name: string;
  scope?: string;
  value?: string;
  secret?: boolean;
}

/**
 * Single-line input that highlights {{variables}} (resolved = blue, unresolved = red) and shows
 * where each value comes from on hover. Uses an overlay so the native input keeps full editing behaviour.
 */
export function VarInput({ value, onChange, placeholder, className, onEnter, collectionId, ariaLabel }: { value: string; onChange(v: string): void; placeholder?: string; className?: string; onEnter?(): void; collectionId?: string; ariaLabel?: string }) {
  const env = useApp((s) => s.environment);
  const [vars, setVars] = useState<Record<string, VarInfo>>({});
  const debounced = useDebounced(value, 300);
  const overlay = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!/\{\{/.test(debounced)) return setVars({});
    void call<VarInfo[]>('vars.inspect', { environment: env, collectionId, template: debounced }).then((list) => setVars(Object.fromEntries(list.map((v) => [v.name, v]))));
  }, [debounced, env, collectionId]);
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    parts.push(value.slice(last, m.index));
    const name = m[1]!.trim();
    const base = name.split('.')[0]!;
    const dynamic = name.startsWith('$');
    const info = vars[base];
    const resolved = dynamic || info?.scope !== undefined;
    parts.push(
      <span key={m.index} className={resolved ? 'var-token' : 'var-missing'}>
        {m[0]}
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(value.slice(last));
  const tooltip = Object.values(vars)
    .map((v) => (v.scope ? `${v.name} = ${v.secret ? '••••••' : v.value} (${v.scope})` : `${v.name}: not defined in the current environment`))
    .join('\n');
  return (
    <div className={cx('relative field p-0 flex items-center', className)} title={tooltip || undefined}>
      <div ref={overlay} aria-hidden className="absolute inset-0 px-2 flex items-center whitespace-pre overflow-hidden mono pointer-events-none">
        <span>{parts}</span>
      </div>
      <input
        ref={input}
        aria-label={ariaLabel}
        className="relative w-full h-full bg-transparent outline-none px-2 mono"
        style={{ color: 'transparent', caretColor: 'var(--fg)' }}
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => overlay.current && (overlay.current.scrollLeft = e.currentTarget.scrollLeft)}
        onKeyUp={(e) => overlay.current && (overlay.current.scrollLeft = e.currentTarget.scrollLeft)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
    </div>
  );
}
