import { Download, History, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import { confirmAction, useApp } from '../store';
import { useIntent } from '../hooks';
import type { HttpRequestSpec } from '../types';
import { formatBytes, formatMs, groupByDay } from '../lib/format';
import { DurationBar } from '../components/charts';
import { finishSave, type SaveResult } from '../lib/files';
import { JsonTree } from '../components/JsonView';
import { Badge, Button, cx, Empty, Input, Select, Split, statusTone, VirtualList } from '../components/ui';

interface Entry {
  id: string;
  timestamp: string;
  kind: string;
  name: string;
  method?: string;
  url?: string;
  status?: number | string;
  durationMs?: number;
  size?: number;
  request?: unknown;
  traceId?: string;
}

export function HistoryView() {
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const [sel, setSel] = useState<Entry>();
  const load = useCallback(
    async (reset = true) => {
      const r = await call<{ items: Entry[]; total: number }>('history.list', { query: query || undefined, kind: kind || undefined, failed: failedOnly || undefined, limit: 200, offset: reset ? 0 : items.length });
      setItems((x) => (reset ? r.items : [...x, ...r.items]));
      setTotal(r.total);
    },
    [query, kind, failedOnly, items.length],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(true), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, failedOnly]);
  useEffect(() => {
    const onVis = () => useApp.getState().view === 'history' && void load(true);
    return useApp.subscribe((s, p) => s.view !== p.view && onVis());
  }, [load]);
  useIntent('history', async (p) => {
    if (p?.historyId) setSel(await call('history.get', { id: p.historyId }));
  });
  const rows = useMemo(() => groupByDay(items, (e) => e.timestamp), [items]);
  // the slowest loaded entry sets the scale of the duration bars
  const maxMs = useMemo(() => Math.max(1, ...items.map((e) => e.durationMs ?? 0)), [items]);
  const reopen = (e: Entry) => {
    if (e.kind === 'http') useApp.getState().openIntent('rest', { request: e.request as HttpRequestSpec, name: e.name });
    else if (e.kind === 'llm') useApp.getState().openIntent('ai', {});
    else if (e.kind === 'mcp') useApp.getState().openIntent('mcp', {});
    else if (e.kind === 'graphql') useApp.getState().openIntent('graphql', {});
    else if (e.kind === 'grpc') useApp.getState().openIntent('grpc', { request: e.request });
  };
  return (
    <Split id="history" initial={45}>
      <div className="h-full flex flex-col">
        <div className="flex gap-2 p-2 border-b border-line">
          <Input className="flex-1" placeholder="Search history (name, URL, method, status)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">All</option>
            {['http', 'graphql', 'grpc', 'mcp', 'llm'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
          <label className="flex items-center gap-1 text-xs text-muted whitespace-nowrap" title="Only responses that failed: 4xx/5xx, transport errors, non-OK gRPC codes, MCP tool errors">
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed
          </label>
          <Button
            variant="ghost"
            icon={<Download size={13} />}
            title="Export the HTTP and GraphQL entries shown here as a HAR file (secrets are masked)"
            onClick={() => void call<SaveResult>('history.exportHar', { query: query || undefined, kind: kind || undefined }).then((r) => finishSave(r, 'HAR file'))}
          >
            HAR
          </Button>
          <Button
            variant="ghost"
            icon={<Trash2 size={13} />}
            onClick={async () => {
              if (!(await confirmAction({ title: 'Clear history', message: 'Clear the request history of this workspace?', detail: 'Saved requests, collections and run reports are not affected.', confirmLabel: 'Clear history', danger: true }))) return;
              await call('history.clear');
              void load(true);
            }}
          >
            Clear
          </Button>
        </div>
        <div className="text-xs text-muted px-3 py-1">{total.toLocaleString()} {total === 1 ? 'entry' : 'entries'} · grouped by day · double-click to open</div>
        {items.length ? (
          <VirtualList
            className="flex-1"
            items={rows}
            rowHeight={44}
            onEndReached={items.length < total ? () => void load(false) : undefined}
            render={(row) => {
              if ('header' in row)
                return (
                  <div className="h-full flex items-end px-3 pb-1.5 border-b border-line bg-panel/60 text-xs font-semibold text-muted uppercase tracking-wide" role="heading" aria-level={3}>
                    {row.header}
                  </div>
                );
              const e = row.item;
              return (
              <button onDoubleClick={() => reopen(e)} onClick={() => setSel(e)} className={cx('w-full h-full text-left px-3 border-b border-line/60 flex flex-col justify-center', sel?.id === e.id ? 'bg-accent/10' : 'hover:bg-hover')}>
                <div className="flex items-center gap-2 text-sm">
                  {e.method && <span className={cx('mono method-badge text-[0.64rem] font-bold w-14 shrink-0', `method-${e.method}`)}>{e.method}</span>}
                  {!e.method && <Badge>{e.kind}</Badge>}
                  <span className="truncate">{e.url ?? e.name}</span>
                  {e.status !== undefined && (
                    <span className="ml-auto">
                      <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted flex gap-2">
                  <span>{new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {e.durationMs !== undefined && (
                    <span className="inline-flex items-center gap-1.5">
                      <DurationBar ms={e.durationMs} max={maxMs} bad={statusTone(e.status) === 'bad'} />
                      {formatMs(e.durationMs)}
                    </span>
                  )}
                  {e.size !== undefined && <span>{formatBytes(e.size)}</span>}
                </div>
              </button>
              );
            }}
          />
        ) : (
          <Empty icon={<History size={24} />} title="No history yet" />
        )}
      </div>
      <div className="h-full flex flex-col">
        {sel ? (
          <>
            <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
              <span className="font-medium truncate">{sel.name}</span>
              <div className="ml-auto flex gap-2">
                {sel.traceId && (
                  <Button size="sm" onClick={() => useApp.getState().openIntent('traces', { traceId: sel.traceId })}>
                    View trace
                  </Button>
                )}
                <Button size="sm" variant="primary" icon={<RotateCcw size={12} />} onClick={() => reopen(sel)}>
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={12} />}
                  onClick={async () => {
                    await call('history.delete', { id: sel.id });
                    setSel(undefined);
                    void load(true);
                  }}
                />
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <JsonTree data={{ timestamp: sel.timestamp, kind: sel.kind, status: sel.status, durationMs: sel.durationMs, request: sel.request }} />
            </div>
            <p className="text-xs text-muted p-2 border-t border-line">History stores redacted request metadata; response bodies are kept on disk under payloads/.</p>
          </>
        ) : (
          <Empty title="Select an entry" />
        )}
      </div>
    </Split>
  );
}
