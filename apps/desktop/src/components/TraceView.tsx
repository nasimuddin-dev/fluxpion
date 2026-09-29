import { useMemo, useState } from 'react';
import type { Span, Trace } from '../types';
import { formatMs } from '../lib/format';
import { Badge, cx, Split, Tabs } from './ui';
import { JsonTree } from './JsonView';

const KIND_COLORS: Record<string, string> = {
  http: '#0969da',
  graphql: '#e535ab',
  llm: '#8250df',
  mcp: '#bf8700',
  tool: '#d4a72c',
  evaluation: '#1a7f37',
  test: '#6e7781',
  script: '#57606a',
  internal: '#8c959f',
};

export function spanRows(trace: Trace): Array<{ span: Span; depth: number }> {
  const ids = new Set(trace.spans.map((s) => s.spanId));
  const children = new Map<string | undefined, Span[]>();
  for (const s of trace.spans) {
    const k = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : undefined;
    (children.get(k) ?? children.set(k, []).get(k)!).push(s);
  }
  const out: Array<{ span: Span; depth: number }> = [];
  const walk = (p: string | undefined, d: number) => {
    for (const s of (children.get(p) ?? []).sort((a, b) => a.startTime - b.startTime)) {
      out.push({ span: s, depth: d });
      walk(s.spanId, d + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** Waterfall view of a normalised trace (spans for HTTP, GraphQL, LLM, tool, MCP and evaluation). */
export function TraceView({ trace }: { trace: Trace }) {
  const rows = useMemo(() => spanRows(trace), [trace]);
  const [sel, setSel] = useState<string | undefined>(rows[0]?.span.spanId);
  const [tab, setTab] = useState<'attributes' | 'input' | 'output' | 'events'>('attributes');
  const start = trace.startTime;
  const end = Math.max(trace.endTime ?? 0, ...trace.spans.map((s) => s.endTime ?? s.startTime));
  const total = Math.max(1, end - start);
  const span = trace.spans.find((s) => s.spanId === sel);
  const tokens = trace.spans.reduce((a, s) => a + (Number(s.attributes.inputTokens) || 0) + (Number(s.attributes.outputTokens) || 0), 0);
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3 h-9 border-b border-line text-sm shrink-0">
        <span className="font-medium truncate min-w-0">{trace.name}</span>
        <Badge tone={trace.status === 'ok' ? 'ok' : trace.status === 'error' ? 'bad' : 'default'}>{trace.status}</Badge>
        <span className="text-muted whitespace-nowrap tabular-nums shrink-0">
          {formatMs(total)} · {trace.spans.length} spans{tokens > 0 ? ` · ${tokens.toLocaleString()} tokens` : ''}
        </span>
        <span className="text-muted mono text-xs ml-auto truncate min-w-0 hidden xl:inline" title="Trace ID (OpenTelemetry-compatible)">
          {trace.traceId}
        </span>
      </div>
      <Split id="trace" direction="vertical" initial={55}>
        <div className="overflow-auto h-full">
          {rows.map(({ span: s, depth }) => {
            const left = ((s.startTime - start) / total) * 100;
            const width = Math.max(0.4, (((s.endTime ?? end) - s.startTime) / total) * 100);
            return (
              <button
                key={s.spanId}
                onClick={() => setSel(s.spanId)}
                className={cx('w-full flex items-center h-7 text-sm border-b border-line/60 text-left hover:bg-hover', sel === s.spanId && 'bg-accent/10')}
              >
                <div className="w-[38%] shrink-0 truncate flex items-center gap-1.5" style={{ paddingLeft: 8 + depth * 14 }}>
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: KIND_COLORS[s.kind] ?? '#888' }} />
                  <span className={cx('truncate', s.status === 'error' && 'text-bad')}>{s.name}</span>
                </div>
                <div className="flex-1 relative h-full mr-3">
                  <div className="absolute top-1.5 h-4 rounded-sm opacity-80" style={{ left: `${left}%`, width: `${width}%`, background: s.status === 'error' ? 'var(--bad)' : KIND_COLORS[s.kind] ?? '#888' }} />
                  <span className="absolute top-1 text-[0.72rem] text-muted tabular-nums" style={{ left: `min(${left + width}% + 4px, calc(100% - 60px))` }}>
                    {formatMs(s.durationMs)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="h-full flex flex-col min-h-0">
          {span ? (
            <>
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'attributes', label: 'Attributes' },
                  { id: 'input', label: 'Input' },
                  { id: 'output', label: 'Output' },
                  { id: 'events', label: 'Events', badge: span.events?.length },
                ]}
                right={
                  <span className="text-xs text-muted pr-2">
                    {span.kind} · {formatMs(span.durationMs)} {span.error && <span className="text-bad">· {span.error}</span>}
                  </span>
                }
              />
              <div className="flex-1 min-h-0">
                <JsonTree
                  data={
                    tab === 'attributes'
                      ? JSON.parse(JSON.stringify({ spanId: span.spanId, parentSpanId: span.parentSpanId, startTime: new Date(span.startTime).toISOString(), status: span.status, ...span.attributes }))
                      : tab === 'input'
                        ? span.input ?? null
                        : tab === 'output'
                          ? span.output ?? null
                          : span.events ?? []
                  }
                />
              </div>
            </>
          ) : (
            <div className="p-4 text-muted text-sm">Select a span</div>
          )}
        </div>
      </Split>
    </div>
  );
}
