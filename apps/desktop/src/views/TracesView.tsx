import { Activity, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import { useIntent } from '../hooks';
import type { Trace } from '../types';
import { formatMs, timeAgo } from '../lib/format';
import { TraceView } from '../components/TraceView';
import { Badge, cx, Empty, IconButton, Input, Select, Split, VirtualList } from '../components/ui';

interface TraceMeta {
  id: string;
  name: string;
  kind: string;
  status: string;
  startTime: number;
  durationMs: number;
  spanCount: number;
}

export function TracesView() {
  const [items, setItems] = useState<TraceMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [sel, setSel] = useState<string>();
  const [trace, setTrace] = useState<Trace | null>();
  const load = useCallback(
    async (reset = true) => {
      const r = await call<{ items: TraceMeta[]; total: number }>('traces.list', { query: query || undefined, kind: kind || undefined, limit: 200, offset: reset ? 0 : items.length });
      setItems((x) => (reset ? r.items : [...x, ...r.items]));
      setTotal(r.total);
    },
    [query, kind, items.length],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(true), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind]);
  useEffect(() => {
    if (!sel) return;
    setTrace(undefined);
    void call<Trace | null>('traces.get', { id: sel }).then(setTrace);
  }, [sel]);
  useIntent('traces', (p) => p?.traceId && setSel(p.traceId));
  return (
    <Split id="traces" initial={32}>
      <div className="h-full flex flex-col">
        <div className="flex gap-2 p-2 border-b border-line">
          <Input className="flex-1" placeholder="Filter traces" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">All kinds</option>
            {['http', 'graphql', 'mcp', 'llm', 'test'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
          <IconButton label="Refresh" onClick={() => load(true)}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
        <div className="text-xs text-muted px-3 py-1">{total.toLocaleString()} traces</div>
        {items.length ? (
          <VirtualList
            className="flex-1"
            items={items}
            rowHeight={44}
            onEndReached={items.length < total ? () => void load(false) : undefined}
            render={(t) => (
              <button onClick={() => setSel(t.id)} className={cx('w-full h-full text-left px-3 border-b border-line/60 flex flex-col justify-center', sel === t.id ? 'bg-accent/10' : 'hover:bg-hover')}>
                <div className="flex items-center gap-2 text-sm">
                  <span className={cx('w-1.5 h-1.5 rounded-full', t.status === 'ok' ? 'bg-ok' : 'bg-bad')} />
                  <span className="truncate min-w-0" title={t.name}>{t.name}</span>
                  <span className="ml-auto text-xs text-muted tabular-nums whitespace-nowrap shrink-0 pl-2">{formatMs(t.durationMs)}</span>
                </div>
                <div className="text-xs text-muted flex gap-2 pl-3.5">
                  <Badge>{t.kind}</Badge>
                  {t.spanCount} spans · {timeAgo(t.startTime)}
                </div>
              </button>
            )}
          />
        ) : (
          <Empty icon={<Activity size={24} />} title="No traces yet">
            Every request, MCP call, LLM call and test run produces an OpenTelemetry-shaped trace.
          </Empty>
        )}
      </div>
      <div className="h-full min-h-0">{trace ? <TraceView trace={trace} /> : sel ? <Empty title={trace === null ? 'Trace not found' : 'Loading…'} /> : <Empty title="Select a trace" />}</div>
    </Split>
  );
}
