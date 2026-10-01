import { BookmarkPlus, Camera, Download, ExternalLink, Sparkles } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useState } from 'react';
import { call, visualizationUrl } from '../api';
import type { CheckResult, HttpResponseData, Trace } from '../types';
import { SseEvents } from './SseEvents';
import { formatBytes, formatMs } from '../lib/format';
import { CheckList } from './Results';
import { ResponseHistory } from './ResponseHistory';
import { JsonTree, RawView, type TreeAssertion, type TreeVariable } from './JsonView';
import { TraceView } from './TraceView';
import { finishSave, type SaveResult } from '../lib/files';
import { Badge, Button, cx, Empty, statusTone, Tabs } from './ui';
import { JsonTable, tableRowsOf } from './JsonTable';

type Tab = 'body' | 'events' | 'headers' | 'cookies' | 'timeline' | 'tests' | 'trace' | 'code' | 'stream' | 'history';

export function ResponseViewer({
  response,
  checks,
  traceId,
  curl,
  stream,
  scriptLogs,
  visualizer,
  requestId,
  historyId,
  onSuggestAssertions,
  onAddAssertion,
  onUpdateSnapshot,
  onSaveVariable,
  onSaveExample,
  onGenerateTests,
  onExplain,
}: {
  response: HttpResponseData;
  checks?: CheckResult[];
  traceId?: string;
  curl?: string;
  stream?: string;
  scriptLogs?: string[];
  /** Output of `pm.visualizer.set(template, data)`, rendered by the backend. */
  visualizer?: { html?: string; error?: string; vizId?: string };
  /** Saved request: enables the History tab (earlier responses, compare). */
  requestId?: string;
  /** History entry of this response (marked "latest"). */
  historyId?: string;
  onSuggestAssertions?(): void;
  /** Clicking a field in the JSON tree can add a check on it to the request's Tests. */
  onAddAssertion?(a: TreeAssertion): void;
  /** Replace a snapshot check's stored copy with this response (at the check's path). */
  onUpdateSnapshot?(path: string): void;
  onSaveVariable?(v: TreeVariable): void;
  /** Save this response as an example of the request. */
  onSaveExample?(): void;
  /** Ask the AI assistant for pm tests for this response. */
  onGenerateTests?(): void;
  /** Ask the AI assistant to explain this (error) response. */
  onExplain?(): void;
}) {
  // an event stream opens on its events
  const [tab, setTab] = useState<Tab>(() => (checks?.some((c) => !c.passed) ? 'tests' : response.events ? 'events' : 'body'));
  // a response with a visualization opens on it, like Postman's Visualize view
  const [mode, setMode] = useState<'pretty' | 'table' | 'raw' | 'preview' | 'visualize'>(() => (visualizer ? 'visualize' : 'pretty'));
  useEffect(() => {
    if (visualizer) setMode('visualize');
    else setMode((m) => (m === 'visualize' ? 'pretty' : m));
  }, [visualizer]);
  const visualHtml = useMemo(() => (visualizer?.html !== undefined ? visualPage(visualizer.html) : undefined), [visualizer]);
  const [trace, setTrace] = useState<Trace>();
  const isJson = response.json !== undefined;
  // an array of objects (or a body holding one) can also be read as a table
  const table = useMemo(() => (isJson ? tableRowsOf(response.json) : undefined), [isJson, response.json]);
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
        {response.httpVersion === '2' && (
          <Badge title="The response came over HTTP/2 (request Settings ▸ HTTP/1.1 only to turn it off)">HTTP/2</Badge>
        )}
        {!!response.attempts && response.attempts > 1 && (
          <Badge tone="warn" title="Earlier attempts failed and were retried (request Settings ▸ Retries)">
            {response.attempts} attempts
          </Badge>
        )}
        {response.truncated && (
          <Badge tone="warn" title="Only the first part of the body is shown. The full payload was streamed to disk.">
            preview truncated
          </Badge>
        )}
        {checks && checks.length > 0 && <Badge tone={failed ? 'bad' : 'ok'}>{failed ? `${failed} failed` : `${checks.length} passed`}</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {onExplain && response.status >= 400 && (
            <Button size="sm" variant="ghost" icon={<Sparkles size={12} />} onClick={onExplain} title="Ask the AI assistant what this error means and how to fix it">
              Explain
            </Button>
          )}
          {onGenerateTests && (
            <Button size="sm" variant="ghost" icon={<Sparkles size={12} />} onClick={onGenerateTests} title="Write pm tests for this response with the AI assistant (added to the Post-response script)">
              Generate tests
            </Button>
          )}
          {onAddAssertion && isJson && (
            <Button size="sm" variant="ghost" icon={<Camera size={12} />} title="Add a check that later responses keep this response's shape (fields and types); in the Tests tab it can compare values too and ignore fields" onClick={() => onAddAssertion({ type: 'snapshot', path: '$', expected: response.json, mode: 'shape' })}>
              Snapshot
            </Button>
          )}
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
            <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={() => call<SaveResult>('http.saveBody', { payloadPath: response.payloadPath, name: 'response' + (isJson ? '.json' : '.txt') }).then((r) => finishSave(r, 'Response'))}>
              Save response
            </Button>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(response.events ? [{ id: 'events' as Tab, label: 'Events', badge: response.events.length }] : []),
          { id: 'body', label: 'Body' },
          { id: 'headers', label: 'Headers', badge: response.headers.length },
          { id: 'cookies', label: 'Cookies', badge: response.cookies.length },
          { id: 'timeline', label: 'Timeline' },
          { id: 'tests', label: 'Tests', badge: checks?.length },
          ...(stream ? [{ id: 'stream' as Tab, label: 'Stream' }] : []),
          { id: 'trace', label: 'Trace' },
          ...(requestId ? [{ id: 'history' as Tab, label: 'History' }] : []),
          ...(curl ? [{ id: 'code' as Tab, label: 'cURL' }] : []),
        ]}
        right={
          tab === 'body' && (
            <div className="flex rounded-md border border-line overflow-hidden text-xs">
              {(['pretty', ...(table ? ['table'] : []), 'raw', ...(isHtml ? ['preview'] : []), ...(visualizer ? ['visualize'] : [])] as const).map((m) => (
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
            <JsonTree data={response.json} onAssert={onAddAssertion} onSaveVariable={onSaveVariable} />
          ) : mode === 'table' && table ? (
            <JsonTable rows={table.rows} path={table.path} />
          ) : mode === 'visualize' && visualizer ? (
            <div className="h-full flex flex-col">
              {visualizer.error && <div className="px-3 py-2 text-sm text-bad border-b border-line">{visualizer.error}</div>}
              {visualizer.vizId ? (
                // scripts allowed (charts), on the isolated tpviz origin: no same-origin access to the app
                <iframe title="Visualization" sandbox="allow-scripts" className="flex-1 w-full bg-white" src={visualizationUrl(visualizer.vizId)} />
              ) : (
                visualHtml !== undefined && <iframe title="Visualization" sandbox="" className="flex-1 w-full bg-white" srcDoc={visualHtml} />
              )}
            </div>
          ) : mode === 'preview' ? (
            <iframe title="HTML preview" sandbox="" className="w-full h-full bg-white" srcDoc={response.bodyPreview} />
          ) : (
            <RawView text={mode === 'pretty' ? prettyText : response.bodyPreview} />
          ))}
        {tab === 'headers' && <KvTable rows={response.headers} />}
        {tab === 'history' && requestId && <ResponseHistory requestId={requestId} latestId={historyId} />}
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
            <CheckList
              checks={checks ?? []}
              actions={(c) =>
                onUpdateSnapshot && c.type === 'snapshot' && !c.passed ? (
                  <Button size="sm" variant="ghost" icon={<Camera size={12} />} title="The API changed on purpose: keep this response as the new snapshot" onClick={() => onUpdateSnapshot(String((c.metadata as { path?: string } | undefined)?.path ?? '$'))}>
                    Update snapshot
                  </Button>
                ) : null
              }
            />
            {!!scriptLogs?.length && (
              <div className="border-t border-line">
                <div className="px-3 py-1.5 text-xs text-muted font-semibold">Script console</div>
                <pre className="px-3 pb-3 mono text-xs whitespace-pre-wrap">{scriptLogs.join('\n')}</pre>
              </div>
            )}
          </div>
        )}
        {tab === 'stream' && <RawView text={stream ?? ''} />}
        {tab === 'events' && response.events && <SseEvents events={response.events} stopped={response.streamStopped} dropped={response.eventsDropped} />}
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

/**
 * A visualization page for the sandboxed frame: sanitised (no scripts, event handlers or remote
 * frames) and given a readable default style. The frame has no script or same-origin rights either.
 */
function visualPage(html: string): string {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: false, FORCE_BODY: true, ADD_TAGS: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'] });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2230;margin:16px}
table{border-collapse:collapse}th,td{border:1px solid #d9dbe3;padding:4px 10px;text-align:left}th{background:#f3f4f8}
</style></head><body>${clean}</body></html>`;
}
