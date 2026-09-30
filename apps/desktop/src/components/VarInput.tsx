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

const DYNAMIC: VarInfo[] = [
  { name: '$uuid', scope: 'dynamic', value: 'random UUID' },
  { name: '$timestamp', scope: 'dynamic', value: 'Unix time (s)' },
  { name: '$isoTimestamp', scope: 'dynamic', value: 'ISO-8601 time' },
  { name: '$randomInt', scope: 'dynamic', value: '0–1000' },
  { name: '$randomEmail', scope: 'dynamic', value: 'user…@example.test' },
];

/**
 * Single-line input that highlights {{variables}} (resolved = blue, unresolved = red), shows where
 * each value comes from on hover, and autocompletes variable names after typing `{{`.
 * Uses an overlay so the native input keeps full editing behaviour.
 */
export function VarInput({
  value,
  onChange,
  placeholder,
  className,
  onEnter,
  collectionId,
  ariaLabel,
  onPasteText,
  cell,
  list,
}: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  className?: string;
  onEnter?(): void;
  collectionId?: string;
  ariaLabel?: string;
  /** Return true to consume the pasted text (e.g. to import a cURL command). */
  onPasteText?(text: string): boolean;
  /** Borderless, for table cells (headers, params, form fields). */
  cell?: boolean;
  /** id of a <datalist> with value suggestions. */
  list?: string;
}) {
  const env = useApp((s) => s.environment);
  const [vars, setVars] = useState<Record<string, VarInfo>>({});
  const [all, setAll] = useState<VarInfo[]>([]);
  const [suggest, setSuggest] = useState<{ prefix: string; start: number; index: number } | null>(null);
  const debounced = useDebounced(value, 300);
  const overlay = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!/\{\{/.test(debounced)) return setVars({});
    void call<VarInfo[]>('vars.inspect', { environment: env, collectionId, template: debounced }).then((list) => setVars(Object.fromEntries(list.map((v) => [v.name, v]))));
  }, [debounced, env, collectionId]);

  const loadAll = () => void call<VarInfo[]>('vars.inspect', { environment: env, collectionId }).then((list) => setAll([...list.filter((v) => v.name !== 'workspaceDir'), ...DYNAMIC]));

  /** Show suggestions when the caret is inside an unfinished `{{name`. */
  const updateSuggest = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /\{\{\s*([\w.$-]*)$/.exec(before);
    if (!m) return setSuggest(null);
    if (!all.length) loadAll();
    setSuggest({ prefix: m[1]!, start: caret - m[1]!.length, index: 0 });
  };
  const matches = suggest ? all.filter((v) => v.name.toLowerCase().includes(suggest.prefix.toLowerCase())).slice(0, 8) : [];
  const pick = (v: VarInfo) => {
    if (!suggest || !input.current) return;
    const caret = input.current.selectionStart ?? value.length;
    const after = value.slice(caret).replace(/^[\w.$-]*\}{0,2}/, '');
    const next = value.slice(0, suggest.start) + v.name + '}}' + after;
    onChange(next);
    setSuggest(null);
    const pos = suggest.start + v.name.length + 2;
    requestAnimationFrame(() => input.current?.setSelectionRange(pos, pos));
  };

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    parts.push(value.slice(last, m.index));
    const name = m[1]!.trim();
    const base = name.split('.')[0]!;
    const resolved = name.startsWith('$') || vars[base]?.scope !== undefined;
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
    <div
      className={cx(cell ? 'relative flex items-center min-h-[26px] rounded focus-within:bg-field focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]' : 'relative field p-0 flex items-center', className)}
      title={suggest ? undefined : tooltip || undefined}
    >
      <div ref={overlay} aria-hidden className={cx('absolute inset-0 flex items-center whitespace-pre overflow-hidden mono pointer-events-none', cell ? 'px-1.5' : 'px-2')}>
        <span>{parts}</span>
      </div>
      <input
        ref={input}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        className={cx('relative w-full h-full bg-transparent outline-none mono', cell ? 'px-1.5 py-[3px]' : 'px-2')}
        list={list}
        style={{ color: 'transparent', caretColor: 'var(--caret)' }}
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          updateSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (onPasteText?.(text)) e.preventDefault();
        }}
        onBlur={() => setTimeout(() => setSuggest(null), 150)}
        onScroll={(e) => overlay.current && (overlay.current.scrollLeft = e.currentTarget.scrollLeft)}
        onKeyUp={(e) => overlay.current && (overlay.current.scrollLeft = e.currentTarget.scrollLeft)}
        onKeyDown={(e) => {
          if (suggest && matches.length) {
            if (e.key === 'ArrowDown') return (e.preventDefault(), setSuggest({ ...suggest, index: (suggest.index + 1) % matches.length }));
            if (e.key === 'ArrowUp') return (e.preventDefault(), setSuggest({ ...suggest, index: (suggest.index - 1 + matches.length) % matches.length }));
            if (e.key === 'Enter' || e.key === 'Tab') return (e.preventDefault(), pick(matches[suggest.index]!));
            if (e.key === 'Escape') return setSuggest(null);
          }
          if (e.key === 'Enter') onEnter?.();
        }}
      />
      {suggest && matches.length > 0 && (
        <div role="listbox" className="absolute left-0 top-full mt-1 z-40 w-96 max-w-full rounded-md border border-line bg-bg shadow-xl py-1 text-sm">
          {matches.map((v, i) => (
            <button
              key={v.name}
              role="option"
              aria-selected={i === suggest.index}
              onMouseDown={(e) => (e.preventDefault(), pick(v))}
              className={cx('w-full text-left px-3 py-1.5 flex items-center gap-2', i === suggest.index && 'bg-accent/10')}
            >
              <span className="mono">{v.name}</span>
              <span className="ml-auto text-xs text-muted truncate max-w-48">{v.secret ? '••••••' : v.value}</span>
              <span className="text-[0.7rem] text-muted border border-line rounded px-1">{v.scope}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
