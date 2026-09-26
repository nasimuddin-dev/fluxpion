import { ChevronDown, ChevronRight, ChevronUp, Copy, Search, WrapText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx, IconButton, Input, VirtualList } from './ui';

const ROW = 20;

interface TreeRow {
  depth: number;
  key?: string;
  path: string;
  value: unknown;
  expandable: boolean;
  count?: number;
  closing?: string;
}

function summary(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).length}}`;
  return '';
}

/**
 * Virtualised JSON tree: only rows for expanded nodes are materialised and only visible rows are
 * rendered, so multi-megabyte payloads stay responsive.
 */
export function JsonTree({ data, query }: { data: unknown; query?: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['$']));
  useEffect(() => {
    // auto-expand first level on new data
    const s = new Set(['$']);
    if (data && typeof data === 'object') for (const k of Object.keys(data as object).slice(0, 50)) s.add(`$.${k}`);
    setExpanded(s);
  }, [data]);

  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    const walk = (v: unknown, key: string | undefined, path: string, depth: number) => {
      const expandable = !!v && typeof v === 'object';
      out.push({ depth, key, path, value: v, expandable, count: expandable ? Object.keys(v as object).length : undefined });
      if (expandable && expanded.has(path)) {
        const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as object);
        const limit = 5000;
        entries.slice(0, limit).forEach(([k, x]) => walk(x, k, Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`, depth + 1));
        if (entries.length > limit) out.push({ depth: depth + 1, path: `${path}#more`, value: `… ${entries.length - limit} more items (use Raw view / Save response)`, expandable: false });
        out.push({ depth, path: `${path}#close`, value: undefined, expandable: false, closing: Array.isArray(v) ? ']' : '}' });
      }
    };
    walk(data, undefined, '$', 0);
    return out;
  }, [data, expanded]);

  const q = query?.toLowerCase();
  const toggle = (p: string) => {
    const s = new Set(expanded);
    if (s.has(p)) s.delete(p);
    else s.add(p);
    setExpanded(s);
  };
  const expandAll = () => {
    const s = new Set<string>();
    let n = 0;
    const walk = (v: unknown, p: string) => {
      if (!v || typeof v !== 'object' || n > 20000) return;
      s.add(p);
      n++;
      for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? `${p}[${k}]` : `${p}.${k}`);
    };
    walk(data, '$');
    setExpanded(s);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-2 py-1 text-xs text-muted shrink-0">
        <button className="hover:text-fg" onClick={expandAll}>
          Expand all
        </button>
        <button className="hover:text-fg" onClick={() => setExpanded(new Set(['$']))}>
          Collapse all
        </button>
        <span className="ml-auto">Click a key to copy its JSONPath</span>
      </div>
      <VirtualList
        className="flex-1 mono text-[0.9em]"
        items={rows}
        rowHeight={ROW}
        render={(r) => {
          if (r.closing) return <div style={{ paddingLeft: r.depth * 14 + 18 }} className="text-muted leading-5">{r.closing}</div>;
          const isHit = q && ((r.key ?? '').toLowerCase().includes(q) || (!r.expandable && String(r.value).toLowerCase().includes(q)));
          return (
            <div className={cx('flex items-center leading-5 whitespace-nowrap hover:bg-hover', isHit && 'search-hit')} style={{ paddingLeft: r.depth * 14 + 4 }}>
              <span className="w-3.5 inline-flex">
                {r.expandable && (
                  <button aria-label={expanded.has(r.path) ? 'Collapse' : 'Expand'} onClick={() => toggle(r.path)} className="text-muted">
                    {expanded.has(r.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                )}
              </span>
              {r.key !== undefined && (
                <button title={`Copy ${r.path}`} onClick={() => navigator.clipboard.writeText(r.path)} className="text-[#0550ae] dark:text-[#79c0ff] hover:underline">
                  {/^\d+$/.test(r.key) ? r.key : `"${r.key}"`}
                </button>
              )}
              {r.key !== undefined && <span className="text-muted mr-1">:</span>}
              {r.expandable ? (
                <span className="text-muted cursor-pointer" onClick={() => toggle(r.path)}>
                  {Array.isArray(r.value) ? '[' : '{'}
                  {!expanded.has(r.path) && <span> {summary(r.value)} {Array.isArray(r.value) ? ']' : '}'}</span>}
                </span>
              ) : (
                <Scalar v={r.value} />
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

function Scalar({ v }: { v: unknown }) {
  if (v === null) return <span className="text-muted">null</span>;
  if (typeof v === 'string') {
    const s = v.length > 500 ? v.slice(0, 500) + '…' : v;
    return <span className="text-[#0a3069] dark:text-[#a5d6ff]" title={v.length > 500 ? `${v.length} chars` : undefined}>"{s}"</span>;
  }
  if (typeof v === 'number') return <span className="text-[#0550ae] dark:text-[#79c0ff]">{v}</span>;
  if (typeof v === 'boolean') return <span className="text-[#cf222e] dark:text-[#ff7b72]">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

/**
 * Virtualised raw text viewer with search. Very long lines are split into fixed-width
 * segments so a single 50 MB line never becomes one DOM node.
 */
export function RawView({ text, language }: { text: string; language?: string }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [wrapAt, setWrapAt] = useState(true);
  const lines = useMemo(() => {
    const raw = text.split('\n');
    if (!wrapAt) return raw;
    const out: string[] = [];
    for (const l of raw) {
      if (l.length <= 400) out.push(l);
      else for (let i = 0; i < l.length; i += 400) out.push(l.slice(i, i + 400));
    }
    return out;
  }, [text, wrapAt]);
  const matches = useMemo(() => {
    if (!query) return [] as number[];
    const q = query.toLowerCase();
    const m: number[] = [];
    for (let i = 0; i < lines.length && m.length < 10000; i++) if (lines[i]!.toLowerCase().includes(q)) m.push(i);
    return m;
  }, [lines, query]);
  useEffect(() => setActive(0), [query]);
  const activeLine = matches[active];
  const highlight = (l: string, isActive: boolean) => {
    if (!query) return l || ' ';
    const parts: React.ReactNode[] = [];
    const lower = l.toLowerCase();
    const q = query.toLowerCase();
    let i = 0;
    let k = 0;
    for (;;) {
      const j = lower.indexOf(q, i);
      if (j < 0) break;
      parts.push(l.slice(i, j));
      parts.push(
        <mark key={k++} className={isActive ? 'search-hit-active' : 'search-hit'}>
          {l.slice(j, j + q.length)}
        </mark>,
      );
      i = j + q.length;
    }
    parts.push(l.slice(i));
    return parts;
  };
  void language;
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 py-1 shrink-0 border-b border-line">
        <Search size={13} className="text-muted" />
        <Input
          className="h-6 min-h-6 text-xs w-56"
          placeholder="Search response"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length) setActive((a) => (e.shiftKey ? (a - 1 + matches.length) % matches.length : (a + 1) % matches.length));
          }}
        />
        {query && <span className="text-xs text-muted tabular-nums">{matches.length ? `${active + 1}/${matches.length}${matches.length >= 10000 ? '+' : ''}` : 'no matches'}</span>}
        <IconButton label="Previous match" onClick={() => matches.length && setActive((a) => (a - 1 + matches.length) % matches.length)}>
          <ChevronUp size={14} />
        </IconButton>
        <IconButton label="Next match" onClick={() => matches.length && setActive((a) => (a + 1) % matches.length)}>
          <ChevronDown size={14} />
        </IconButton>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Wrap long lines" active={wrapAt} onClick={() => setWrapAt(!wrapAt)}>
            <WrapText size={14} />
          </IconButton>
          <IconButton label="Copy" onClick={() => navigator.clipboard.writeText(text)}>
            <Copy size={14} />
          </IconButton>
        </div>
      </div>
      <VirtualList
        className="flex-1 mono text-[0.9em]"
        items={lines}
        rowHeight={ROW}
        scrollToIndex={activeLine}
        render={(l, i) => (
          <div className="flex leading-5 whitespace-pre">
            <span className="w-12 shrink-0 text-right pr-3 text-muted select-none opacity-60">{i + 1}</span>
            <span>{highlight(l, i === activeLine)}</span>
          </div>
        )}
      />
    </div>
  );
}
