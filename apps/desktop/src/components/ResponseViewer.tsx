import { BookmarkPlus, Download, ExternalLink, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import type { CheckResult, HttpResponseData, Trace } from '../types';
import { formatBytes, formatMs } from '../lib/format';
import { useApp } from '../store';
import { CheckList } from './Results';
import { JsonTree, RawView } from './JsonView';
import { TraceView } from './TraceView';
import { Badge, Button, cx, Empty, statusTone, Tabs } from './ui';

type Tab = 'body' | 'headers' | 'cookies' | 'timeline' | 'tests' | 'trace' | 'code' | 'stream';

export function ResponseViewer({
  response,
  checks,
  traceId,
  curl,
  stream,
  scriptLogs,
  onSuggestAssertions,
  onSaveExample,
}: {
  response: HttpResponseData;
  checks?: CheckResult[];
  traceId?: string;
  curl?: string;
  stream?: string;
  scriptLogs?: string[];
  onSuggestAssertions?(): void;
  /** Save this response as an example of the request. */
  onSaveExample?(): void;
}) {
  const [tab, setTab] = useState<Tab>(() => (checks?.some((c) => !c.passed) ? 'tests' : 'body'));
  const [mode, setMode] = useState<'pretty' | 'raw' | 'preview'>('pretty');
  const [trace, setTrace] = useState<Trace>();
  const isJson = response.json !== undefined;
  const isHtml = /html/i.test(response.contentType);
  const prettyText = useMemo(() => (isJson ? JSON.stringify(response.json, null, 2) : response.bodyPreview), [response, isJson]);
  useEffect(() => {
    if (tab === 'trace' && traceId && trace?.traceId !== traceId) void call<Trace>('traces.get', { id: traceId }).then(setTrace);
  }, [tab, traceId, trace]);
  const failed = checks?.filter((c) => !c.passed).length ?? 0;
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3 h-9 border-b border-line text-sm shrink-0">
        <Badge tone={statusTone(response.status)}>
          {response.status} {response.statusText}
        </Badge>
        <span className="text-muted">
          Time <span className="text-fg tabular-nums">{formatMs(response.durationMs)}</span>
        </span>
        <span className="text-muted">
          Size <span className="text-fg tabular-nums">{formatBytes(response.size)}</span>
        </span>
        {response.truncated && (
          <Badge tone="warn" title="Only the first part of the body is shown. The full payload was streamed to disk.">
            preview truncated
          </Badge>
        )}
        {checks && checks.length > 0 && <Badge tone={failed ? 'bad' : 'ok'}>{failed ? `${failed} failed` : `${checks.length} passed`}</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {onSuggestAssertions && (
            <Button size="sm" variant="ghost" icon={<Sparkles size={12} />} onClick={onSuggestAssertions}>
              Suggest assertions
            </Button>
          )}
          {onSaveExample && (
            <Button size="sm" variant="ghost" icon={<BookmarkPlus size={12} />} onClick={onSaveExample} title="Save this response as an example of the request">
              Save as example
            </Button>
          )}
          {response.payloadPath && (
            <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={() => call('http.saveBody', { payloadPath: response.payloadPath, name: 'response' + (isJson ? '.json' : '.txt') }).then((p) => p && useApp.getState().toast(`Saved to ${p}`, 'success'))}>
              Save response
            </Button>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'body', label: 'Body' },
          { id: 'headers', label: 'Headers', badge: response.headers.length },
          { id: 'cookies', label: 'Cookies', badge: response.cookies.length },
          { id: 'timeline', label: 'Timeline' },
          { id: 'tests', label: 'Tests', badge: checks?.length },
          ...(stream ? [{ id: 'stream' as Tab, label: 'Stream' }] : []),
          { id: 'trace', label: 'Trace' },
          ...(curl ? [{ id: 'code' as Tab, label: 'cURL' }] : []),
        ]}
        right={
          tab === 'body' && (
            <div className="flex rounded-md border border-line overflow-hidden text-xs">
              {(['pretty', 'raw', ...(isHtml ? ['preview'] : [])] as const).map((m) => (
                <button key={m} className={cx('px-2 h-6 capitalize', mode === m ? 'bg-accent text-white' : 'hover:bg-hover')} onClick={() => setMode(m as typeof mode)}>
                  {m}
                </button>
              ))}
            </div>
          )
        }
      />
      <div className="flex-1 min-h-0">
        {tab === 'body' &&
          (!response.bodyPreview ? (
            <Empty title="Empty body" />
          ) : mode === 'pretty' && isJson ? (
            <JsonTree data={response.json} />
          ) : mode === 'preview' ? (
            <iframe title="HTML preview" sandbox="" className="w-full h-full bg-white" srcDoc={response.bodyPreview} />
          ) : (
            <RawView text={mode === 'pretty' ? prettyText : response.bodyPreview} />
          ))}
        {tab === 'headers' && <KvTable rows={response.headers} />}
        {tab === 'cookies' &&
          (response.cookies.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-3 py-1.5">Name</th>
                  <th>Value</th>
                  <th>Attributes</th>
                </tr>
              </thead>
              <tbody>
                {response.cookies.map((c, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-1 mono">{c.name}</td>
                    <td className="mono break-all">{c.value}</td>
                    <td className="text-muted text-xs">{Object.entries(c.attributes).map(([k, v]) => (v === 'true' ? k : `${k}=${v}`)).join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No cookies" />
          ))}
        {tab === 'timeline' && <Timeline phases={response.timeline} url={response.url} />}
        {tab === 'tests' && (
          <div className="overflow-auto h-full">
            <CheckList checks={checks ?? []} />
            {!!scriptLogs?.length && (
              <div className="border-t border-line">
                <div className="px-3 py-1.5 text-xs text-muted font-semibold">Script console</div>
                <pre className="px-3 pb-3 mono text-xs whitespace-pre-wrap">{scriptLogs.join('\n')}</pre>
              </div>
            )}
          </div>
        )}
        {tab === 'stream' && <RawView text={stream ?? ''} />}
        {tab === 'trace' && (trace ? <TraceView trace={trace} /> : <Empty title="Loading trace…" />)}
        {tab === 'code' && <RawView text={curl ?? ''} />}
      </div>
    </div>
  );
}

export function KvTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-sm table-fixed">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-b border-line">
              <td className="px-3 py-1 mono text-muted w-1/3 align-top break-all">{k}</td>
              <td className="px-3 py-1 mono break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ phases, url }: { phases: Array<{ name: string; startMs: number; durationMs: number }>; url: string }) {
  const total = phases.find((p) => p.name === 'total')?.durationMs ?? 1;
  return (
    <div className="p-4 text-sm flex flex-col gap-2 max-w-3xl">
      <div className="text-muted text-xs mono break-all">{url}</div>
      {phases.map((p) => (
        <div key={p.name} className="grid grid-cols-[140px_1fr_80px] items-center gap-3">
          <span className={cx(p.name === 'total' && 'font-semibold')}>{p.name}</span>
          <div className="h-3 bg-panel2 rounded relative overflow-hidden">
            <div className={cx('absolute top-0 bottom-0 rounded', p.name === 'total' ? 'bg-muted/60' : 'bg-accent')} style={{ left: `${(p.startMs / total) * 100}%`, width: `${Math.max(0.5, (p.durationMs / total) * 100)}%` }} />
          </div>
          <span className="text-right tabular-nums">{formatMs(p.durationMs)}</span>
        </div>
      ))}
      <p className="text-xs text-muted mt-2 flex items-center gap-1">
        <ExternalLink size={11} /> Full span details are available in the Trace tab.
      </p>
    </div>
  );
}
