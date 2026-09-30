import { Activity, Braces, Download, FileBarChart, FileCode2, FileText, GitCompare, Square, Target } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { asError, call, on } from '../api';
import { useApp } from '../store';
import type { RunSummary, TestResult, Trace } from '../types';
import { formatCost, formatMs, plural } from '../lib/format';
import { CheckList, ErrorPanel, StatusIcon } from './Results';
import { TraceView } from './TraceView';
import { finishSave, viewContent, type SaveResult } from '../lib/files';
import { Badge, Button, cx, Empty, Field, Input, Metric, Modal, Select, Split, Tabs, VirtualList, Menu, MetricGrid } from './ui';

interface Progress {
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  running: number;
}

const PAGE = 200;

/** Show test files relative to the workspace's tests/ folder (keeps absolute paths out of screenshots). */
function displayPath(file: string): string {
  const p = file.split('\\').join('/');
  const i = p.lastIndexOf('/tests/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Live progress + paged, virtualised results for a test/evaluation run. Results are read from disk page by page. */
const humanize = (k: string) => k.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function RunPanel({ runId, expectedTotal }: { runId: string; expectedTotal?: number }) {
  const [progress, setProgress] = useState<Progress>({ completed: 0, passed: 0, failed: 0, skipped: 0, errors: 0, running: 0 });
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [done, setDone] = useState(false);
  const [live, setLive] = useState<TestResult[]>([]);
  const [rows, setRows] = useState<TestResult[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<TestResult>();
  const [baselineOpen, setBaselineOpen] = useState(false);
  const loadingPage = useRef(false);

  useEffect(() => {
    setProgress({ completed: 0, passed: 0, failed: 0, skipped: 0, errors: 0, running: 0 });
    setLive([]);
    setRows([]);
    setSummary(null);
    setDone(false);
    setSel(undefined);
    void call<RunSummary | null>('runs.summary', { runId }).then((s) => {
      if (s) {
        setSummary(s);
        setDone(true);
      }
    });
    const a = on<Array<{ type: string; runId: string; result?: TestResult; completed?: number; passed?: number; failed?: number; skipped?: number; errors?: number; running?: number; summary?: RunSummary }>>('run.events', (evs) => {
      const mine = evs.filter((e) => e.runId === runId);
      if (!mine.length) return;
      const results = mine.filter((e) => e.type === 'test-end').map((e) => e.result!);
      if (results.length) setLive((l) => [...l, ...results].slice(-2000));
      const p = [...mine].reverse().find((e) => e.type === 'progress');
      if (p) setProgress({ completed: p.completed!, passed: p.passed!, failed: p.failed!, skipped: p.skipped!, errors: p.errors!, running: p.running! });
      const end = mine.find((e) => e.type === 'run-end');
      if (end) setSummary(end.summary!);
    });
    const b = on<{ runId: string }>('run.finished', (p) => p.runId === runId && setDone(true));
    return () => {
      a();
      b();
    };
  }, [runId]);

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (loadingPage.current) return;
      loadingPage.current = true;
      try {
        const offset = reset ? 0 : rows.length;
        const r = await call<{ items: TestResult[]; total: number }>('runs.results', { runId, offset, limit: PAGE, status, query: query || undefined });
        setRows((x) => (reset ? r.items : [...x, ...r.items]));
        setTotal(r.total);
      } finally {
        loadingPage.current = false;
      }
    },
    [runId, rows.length, status, query],
  );
  useEffect(() => {
    if (done) void loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, status, query]);

  const list = done ? rows : live.filter((r) => (status === 'all' || (status === 'failed' ? r.status === 'failed' || r.status === 'error' : r.status === status)) && (!query || r.name.toLowerCase().includes(query.toLowerCase())));
  const s = summary;
  const completed = s?.total ?? progress.completed;
  const pct = expectedTotal ? Math.min(100, (completed / expectedTotal) * 100) : undefined;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-line flex-wrap">
        {!done ? (
          <>
            <Activity size={15} className="text-accent" />
            <span className="text-sm font-medium">Running…</span>
            <Button size="sm" variant="danger" icon={<Square size={11} />} onClick={() => call('runs.cancel', { runId })}>
              Cancel
            </Button>
          </>
        ) : (
          <Badge tone={s && s.failed + s.errors === 0 && !s.cancelled ? 'ok' : 'bad'}>{s?.cancelled ? 'cancelled' : s && s.failed + s.errors === 0 ? 'passed' : 'failed'}</Badge>
        )}
        <span className="flex items-center gap-1.5 flex-wrap text-sm tabular-nums">
          <Badge tone="ok">{s?.passed ?? progress.passed} passed</Badge>
          {(s?.failed ?? progress.failed) > 0 && <Badge tone="bad">{s?.failed ?? progress.failed} failed</Badge>}
          {(s?.errors ?? progress.errors) > 0 && <Badge tone="bad">{s?.errors ?? progress.errors} errors</Badge>}
          {(s?.skipped ?? progress.skipped) > 0 && <Badge tone="warn">{s?.skipped ?? progress.skipped} skipped</Badge>}
          {!done && progress.running > 0 && <span className="text-muted text-xs">{progress.running} running</span>}
        </span>
        {done && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" icon={<FileBarChart size={12} />} onClick={() =>
              call<{ path: string; view?: { content: string; encoding: 'base64'; type: string } }>('runs.openReport', { runId, format: 'html' })
                .then((r) => r.view && viewContent(r.view))
                .catch((e) => useApp.getState().toast(asError(e).message, 'error'))
            }>
              HTML report
            </Button>
            <ExportMenu runId={runId} />
            <Button size="sm" icon={<GitCompare size={12} />} onClick={() => setBaselineOpen(true)}>
              Baselines
            </Button>
          </div>
        )}
      </div>
      {!done && (
        <div className="h-1 bg-panel2 relative overflow-hidden">
          {pct !== undefined ? <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /> : <div className="absolute inset-0 indeterminate" />}
        </div>
      )}
      {s && (
        <MetricGrid compact className="p-2 border-b border-line max-h-[35%] overflow-auto">
          <Metric label="Duration" value={formatMs(s.durationMs)} />
          <Metric label="Latency p50 / p95" value={`${formatMs(s.latency.p50)} / ${formatMs(s.latency.p95)}`} sub={`p99 ${formatMs(s.latency.p99)}`} />
          {s.tokens.totalTokens > 0 && <Metric label="Tokens" value={s.tokens.totalTokens.toLocaleString()} sub={`${s.tokens.inputTokens} in / ${s.tokens.outputTokens} out`} />}
          {s.costUsd > 0 && <Metric label="Est. cost" value={formatCost(s.costUsd)} />}
          {Object.entries(s.scores).map(([k, v]) => (
            <Metric key={k} label={humanize(k)} value={v.mean.toFixed(3)} sub={`score · ${v.count} check${v.count === 1 ? '' : 's'}`} tone={v.mean >= 0.7 ? 'ok' : 'warn'} />
          ))}
        </MetricGrid>
      )}
      <div className="flex-1 min-h-0">
        <Split id="run-results" initial={48}>
          <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 p-2 border-b border-line">
              <Select className="h-7 min-h-7 py-0 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
                <option value="all">All</option>
                <option value="failed">Failed & errors</option>
                <option value="passed">Passed</option>
                <option value="skipped">Skipped</option>
              </Select>
              <Input className="flex-1 h-7 min-h-7 text-sm" placeholder="Filter by name" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="text-xs text-muted tabular-nums">{done ? `${rows.length}/${total}` : `${live.length} shown`}</span>
            </div>
            {list.length ? (
              <VirtualList
                className="flex-1"
                items={list}
                rowHeight={30}
                onEndReached={done && rows.length < total ? () => void loadPage(false) : undefined}
                render={(r) => (
                  <button title={r.name} onClick={() => setSel(r)} className={cx('w-full h-full flex items-center gap-2 px-3 border-b border-line/50 text-sm text-left hover:bg-hover', sel?.id === r.id && sel.attempts === r.attempts && 'bg-accent/10')}>
                    <StatusIcon status={r.status} />
                    <span className="truncate flex-1 min-w-0">{r.name}</span>
                    <span className="text-[0.7rem] text-muted uppercase tracking-wide shrink-0">{r.type}</span>
                    <span className="text-xs text-muted tabular-nums w-14 text-right shrink-0">{formatMs(r.latencyMs ?? r.durationMs)}</span>
                  </button>
                )}
              />
            ) : (
              <Empty title={done ? 'No results match' : 'Waiting for results…'} />
            )}
          </div>
          <div className="h-full min-h-0">{sel ? <ResultDetail r={sel} /> : <Empty icon={<Target size={24} />} title="Select a result to inspect checks, output and trace" />}</div>
        </Split>
      </div>
      {baselineOpen && <BaselineModal runId={runId} onClose={() => setBaselineOpen(false)} />}
    </div>
  );
}

function ExportMenu({ runId }: { runId: string }) {
  const exp = (format: 'html' | 'json' | 'junit' | 'markdown') => void call<SaveResult>('runs.exportReport', { runId, format }).then((r) => finishSave(r, 'Report'));
  return (
    <Menu
      width={210}
      items={[
        { label: 'HTML report', icon: <FileBarChart size={14} />, onSelect: () => exp('html') },
        { label: 'JSON results', icon: <Braces size={14} />, onSelect: () => exp('json') },
        { label: 'JUnit XML (CI)', icon: <FileCode2 size={14} />, onSelect: () => exp('junit') },
        { label: 'Markdown summary', icon: <FileText size={14} />, onSelect: () => exp('markdown') },
      ]}
      trigger={
        <Button size="sm" icon={<Download size={12} />}>
          Export
        </Button>
      }
    />
  );
}

export function ResultDetail({ r }: { r: TestResult }) {
  const [tab, setTab] = useState<'checks' | 'io' | 'trace' | 'meta'>('checks');
  const [trace, setTrace] = useState<Trace | null>();
  useEffect(() => {
    setTrace(undefined);
    setTab('checks');
  }, [r]);
  useEffect(() => {
    if (tab === 'trace' && r.traceId && trace === undefined) void call<Trace | null>('traces.get', { id: r.traceId }).then((t) => setTrace(t ?? null));
  }, [tab, r.traceId, trace]);
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-line">
        <div className="flex items-center gap-2">
          <StatusIcon status={r.status} />
          <span className="font-medium">{r.name}</span>
        </div>
        <div className="text-xs text-muted mt-0.5 flex gap-3 flex-wrap">
          <span>{r.type}</span>
          {r.model && <span>{r.model}</span>}
          <span>{formatMs(r.durationMs)}</span>
          {r.tokens && <span>{r.tokens.totalTokens} tokens</span>}
          {r.costUsd !== undefined && <span>{formatCost(r.costUsd)}</span>}
          {r.attempts > 1 && <span>{r.attempts} attempts</span>}
          {r.file && <span className="mono truncate" title={r.file}>{displayPath(r.file)}</span>}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'checks', label: 'Checks', badge: r.checks.length },
          { id: 'io', label: 'Input / output' },
          { id: 'trace', label: 'Trace' },
          { id: 'meta', label: 'Metadata' },
        ]}
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'checks' && (
          <>
            {r.error && <ErrorPanel error={{ ...r.error, details: undefined }} context={{ test: r.name, input: r.input }} />}
            {r.status === 'skipped' && <div className="p-3 text-sm text-warn">Skipped: {String(r.metadata?.reason ?? '')}</div>}
            <CheckList checks={r.checks} />
          </>
        )}
        {tab === 'io' && (
          <div className="p-3 flex flex-col gap-3 text-sm">
            <div>
              <div className="text-xs text-muted font-semibold mb-1">Input</div>
              <pre className="mono text-xs whitespace-pre-wrap bg-panel p-2 rounded">{r.input ?? '—'}</pre>
            </div>
            <div>
              <div className="text-xs text-muted font-semibold mb-1">Output</div>
              <pre className="mono text-xs whitespace-pre-wrap bg-panel p-2 rounded">{r.output ?? '—'}</pre>
            </div>
          </div>
        )}
        {tab === 'trace' && (trace ? <TraceView trace={trace} /> : trace === null ? <Empty title="No trace stored for this result" /> : <Empty title="Loading…" />)}
        {tab === 'meta' && <pre className="p-3 mono text-xs whitespace-pre-wrap">{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>}
      </div>
    </div>
  );
}

interface RegressionReport {
  baseline: string;
  regressions: Array<{ id: string; kind: string; message: string }>;
  improvements: Array<{ id: string; kind: string; message: string }>;
  summary: Array<{ metric: string; baseline: number; current: number; delta: number; deltaPct: number; regressed: boolean }>;
  passed: boolean;
}

function BaselineModal({ runId, onClose }: { runId: string; onClose(): void }) {
  const [baselines, setBaselines] = useState<Array<{ name: string; createdAt: string; tests: number }>>([]);
  const [name, setName] = useState('');
  const [compareWith, setCompareWith] = useState('');
  const [th, setTh] = useState({ latencyPct: 25, tokensPct: 20, scoreDrop: 0.05 });
  const [report, setReport] = useState<RegressionReport>();
  const load = () =>
    call('baselines.list').then((b) => {
      setBaselines(b);
      setCompareWith((c) => c || b[0]?.name || '');
    });
  useEffect(() => {
    void load();
  }, []);
  return (
    <Modal title="Baselines & regression" onClose={onClose} width={760}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-end gap-2">
          <Field label="Save this run as baseline" className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. main-2026-09" />
          </Field>
          <Button disabled={!name} onClick={() => call('baselines.save', { runId, name }).then(() => (useApp.getState().toast('Baseline saved', 'success'), void load()))}>
            Save baseline
          </Button>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <Field label="Compare with">
            <Select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
              {baselines.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} ({plural(b.tests, 'test')})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Latency +%">
            <Input className="w-20" type="number" value={th.latencyPct} onChange={(e) => setTh({ ...th, latencyPct: Number(e.target.value) })} />
          </Field>
          <Field label="Tokens +%">
            <Input className="w-20" type="number" value={th.tokensPct} onChange={(e) => setTh({ ...th, tokensPct: Number(e.target.value) })} />
          </Field>
          <Field label="Score drop">
            <Input className="w-20" type="number" step="0.01" value={th.scoreDrop} onChange={(e) => setTh({ ...th, scoreDrop: Number(e.target.value) })} />
          </Field>
          <Button variant="primary" disabled={!compareWith} onClick={() => call<RegressionReport>('baselines.compare', { runId, name: compareWith, thresholds: th }).then(setReport)}>
            Compare
          </Button>
        </div>
        {report && (
          <div>
            <Badge tone={report.passed ? 'ok' : 'bad'}>{report.passed ? 'No regressions beyond thresholds' : `${report.regressions.length + report.summary.filter((m) => m.regressed).length} regression(s)`}</Badge>
            <table className="w-full mt-2 text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1">Metric</th>
                  <th>Baseline</th>
                  <th>Current</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map((m) => (
                  <tr key={m.metric} className={cx('border-t border-line', m.regressed && 'text-bad')}>
                    <td className="py-1">{m.metric}</td>
                    <td className="tabular-nums">{m.baseline}</td>
                    <td className="tabular-nums">{m.current}</td>
                    <td className="tabular-nums">
                      {m.delta > 0 ? '+' : ''}
                      {m.delta} ({m.deltaPct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 max-h-60 overflow-auto">
              {report.regressions.map((r, i) => (
                <div key={i} className="text-bad text-xs">
                  ✗ {r.id}: {r.message}
                </div>
              ))}
              {report.improvements.map((r, i) => (
                <div key={i} className="text-ok text-xs">
                  ✓ {r.id}: {r.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
