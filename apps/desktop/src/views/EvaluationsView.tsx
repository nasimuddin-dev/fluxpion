import { FlaskConical, History, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { asError, call } from '../api';
import { persisted, useApp } from '../store';
import type { CheckConfig, ProviderConfig } from '../types';
import { templateVars, timeAgo } from '../lib/format';
import { AssertionEditor } from '../components/AssertionEditor';
import { CodeEditor } from '../components/CodeEditor';
import { RunPanel } from '../components/RunPanel';
import { Badge, Button, cx, Empty, Field, Input, Select, Split, Tabs } from '../components/ui';

interface Draft {
  name: string;
  type: 'llm' | 'rag';
  provider: string;
  model: string;
  temperature?: number;
  system: string;
  prompt: string;
  format: 'text' | 'json';
  datasetFormat: 'jsonl' | 'json' | 'csv' | 'md';
  dataset: string;
  expectedField: string;
  evaluators: CheckConfig[];
  concurrency: number;
  limit?: number;
  retries: number;
}

const drafts = persisted<Draft>('eval', {
  name: 'Intent classification',
  type: 'llm',
  provider: '',
  model: '',
  temperature: 0,
  system: '',
  prompt: 'Classify the customer intent. Respond with JSON {"intent": "cancellation" | "refill" | "booking" | "other"}.\n\nCustomer: {{input}}',
  format: 'json',
  datasetFormat: 'jsonl',
  dataset: '{"input":"Cancel my appointment","expected":"cancellation"}\n{"input":"I need a refill","expected":"refill"}\n{"input":"Can I book for Tuesday?","expected":"booking"}',
  expectedField: 'expected',
  evaluators: [
    { type: 'exact-match', path: '$.intent', expected: '{{expected}}' },
    { type: 'latency', max: 5000 },
  ],
  concurrency: 4,
  retries: 1,
});

function countRecords(text: string, fmt: Draft['datasetFormat']): number {
  if (fmt === 'jsonl') return text.split('\n').filter((l) => l.trim()).length;
  if (fmt === 'csv') return Math.max(0, text.split('\n').filter((l) => l.trim()).length - 1);
  if (fmt === 'md') return Math.max(0, text.split('\n').filter((l) => l.trim().startsWith('|')).length - 2);
  try {
    const d = JSON.parse(text);
    return Array.isArray(d) ? d.length : 1;
  } catch {
    return 0;
  }
}

function previewRecords(text: string, fmt: Draft['datasetFormat']): Array<Record<string, unknown>> {
  try {
    if (fmt === 'jsonl') return text.split('\n').filter((l) => l.trim()).slice(0, 5).map((l) => JSON.parse(l));
    if (fmt === 'json') {
      const d = JSON.parse(text);
      return (Array.isArray(d) ? d : [d]).slice(0, 5);
    }
    if (fmt === 'csv') {
      const [h, ...rows] = text.split('\n').filter((l) => l.trim());
      const keys = h!.split(',').map((s) => s.trim());
      return rows.slice(0, 5).map((r) => Object.fromEntries(r.split(',').map((v, i) => [keys[i], v])));
    }
  } catch {
    return [];
  }
  return [];
}

/** Evaluation Lab: dataset × prompt × model × evaluators, streamed through the test runner. */
export function EvaluationsView() {
  const [d, setD] = useState<Draft>(drafts.load);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [runId, setRunId] = useState<string>();
  const [runs, setRuns] = useState<Array<{ id: string; name: string; startedAt: string; passed: number; total: number }>>([]);
  const [sub, setSub] = useState<'prompt' | 'dataset' | 'evaluators'>('dataset');
  const env = useApp((s) => s.environment);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  useEffect(() => drafts.save(d), [d]);
  useEffect(() => {
    void call<ProviderConfig[]>('ai.providers').then((p) => {
      setProviders(p);
      if (!d.provider && p[0]) set({ provider: p[0].id, model: p[0].defaultModel ?? '' });
    });
    void call('runs.list', { limit: 30 }).then((r) => setRuns(r.items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const count = useMemo(() => countRecords(d.dataset, d.datasetFormat), [d.dataset, d.datasetFormat]);
  const preview = useMemo(() => previewRecords(d.dataset, d.datasetFormat), [d.dataset, d.datasetFormat]);
  const vars = templateVars(d.prompt);

  const run = async () => {
    try {
      const template: Record<string, unknown> =
        d.type === 'llm'
          ? {
              name: d.name,
              type: 'llm',
              model: { provider: d.provider, name: d.model || undefined, temperature: d.temperature },
              ...(d.system ? { system: d.system } : {}),
              prompt: d.prompt,
              ...(d.format === 'json' ? { responseFormat: { type: 'json' } } : {}),
              evaluators: d.evaluators,
            }
          : { name: d.name, type: 'rag', model: { provider: d.provider, name: d.model || undefined, temperature: d.temperature }, ...(d.prompt.includes('{{context}}') ? { prompt: d.prompt } : {}), evaluators: d.evaluators };
      const r = await call<{ runId: string }>('eval.run', { name: d.name, template, datasetText: d.dataset, datasetFormat: d.datasetFormat, expectedField: d.expectedField, concurrency: d.concurrency, limit: d.limit, retries: d.retries, environment: env });
      setRunId(r.runId);
      setRuns((rs) => [{ id: r.runId, name: d.name, startedAt: new Date().toISOString(), passed: 0, total: 0 }, ...rs]);
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };

  return (
    <Split id="eval-main" initial={42}>
      <div className="h-full flex flex-col">
        <div className="p-2 border-b border-line flex flex-col gap-2">
          <div className="flex gap-2">
            <Input className="flex-1 font-medium" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Evaluation name" />
            <Select value={d.type} onChange={(e) => set({ type: e.target.value as Draft['type'] })} aria-label="Evaluation type">
              <option value="llm">Prompt / LLM</option>
              <option value="rag">RAG</option>
            </Select>
            <Button variant="primary" icon={<Play size={13} />} onClick={run} disabled={!count || !d.provider}>
              Run {count ? `${d.limit ? Math.min(d.limit, count) : count} cases` : ''}
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_70px_70px_70px_70px] gap-2">
            <Field label="Provider">
              <Select value={d.provider} onChange={(e) => set({ provider: e.target.value, model: providers.find((p) => p.id === e.target.value)?.defaultModel ?? '' })}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model">
              <Input className="mono" value={d.model} onChange={(e) => set({ model: e.target.value })} />
            </Field>
            <Field label="Temp.">
              <Input type="number" step="0.1" value={d.temperature ?? ''} onChange={(e) => set({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </Field>
            <Field label="Workers">
              <Input type="number" min={1} max={64} value={d.concurrency} onChange={(e) => set({ concurrency: Math.max(1, Number(e.target.value)) })} />
            </Field>
            <Field label="Retries">
              <Input type="number" min={0} value={d.retries} onChange={(e) => set({ retries: Math.max(0, Number(e.target.value)) })} />
            </Field>
            <Field label="Limit">
              <Input type="number" value={d.limit ?? ''} placeholder="all" onChange={(e) => set({ limit: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
          </div>
        </div>
        <Tabs
          value={sub}
          onChange={setSub}
          tabs={[
            { id: 'dataset', label: 'Dataset', badge: count },
            { id: 'prompt', label: d.type === 'rag' ? 'Prompt (optional)' : 'Prompt' },
            { id: 'evaluators', label: 'Evaluators', badge: d.evaluators.length },
          ]}
        />
        <div className="flex-1 min-h-0">
          {sub === 'dataset' && (
            <div className="h-full flex flex-col">
              <div className="flex items-center gap-3 px-3 py-1.5 text-sm border-b border-line">
                {(['jsonl', 'json', 'csv', 'md'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-1">
                    <input type="radio" checked={d.datasetFormat === f} onChange={() => set({ datasetFormat: f })} /> {f.toUpperCase()}
                  </label>
                ))}
                <label className="ml-auto flex items-center gap-1 text-xs text-muted">
                  expected field
                  <Input className="h-6 min-h-6 w-24 text-xs" value={d.expectedField} onChange={(e) => set({ expectedField: e.target.value })} />
                </label>
                <Button
                  size="sm"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.jsonl,.json,.csv,.md,.ndjson';
                    input.onchange = async () => {
                      const f = input.files?.[0];
                      if (!f) return;
                      const ext = f.name.split('.').pop()!.toLowerCase();
                      set({ dataset: await f.text(), datasetFormat: ext === 'ndjson' ? 'jsonl' : (ext as Draft['datasetFormat']) });
                    };
                    input.click();
                  }}
                >
                  Load file…
                </Button>
              </div>
              <div className="flex-1 min-h-0">
                <Split id="eval-dataset" direction="vertical" initial={65}>
                  <CodeEditor language={d.datasetFormat === 'json' ? 'json' : 'plaintext'} value={d.dataset} onChange={(dataset) => set({ dataset })} />
                  <div className="h-full overflow-auto p-2 text-xs">
                    <div className="text-muted mb-1">
                      Preview · {count} records · each record's fields are available as {'{{field}}'} in the prompt and evaluators
                      {d.type === 'rag' && ' · RAG records need question, contexts [{id,text}] and optionally answer/expected'}
                    </div>
                    {preview.length > 0 && (
                      <table className="w-full">
                        <thead>
                          <tr>
                            {Object.keys(preview[0]!).map((k) => (
                              <th key={k} className={cx('text-left px-1 font-medium', vars.includes(k) || k === d.expectedField ? 'text-accent' : 'text-muted')}>
                                {k}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((r, i) => (
                            <tr key={i} className="border-t border-line">
                              {Object.keys(preview[0]!).map((k) => (
                                <td key={k} className="px-1 py-0.5 mono truncate max-w-48">
                                  {typeof r[k] === 'object' ? JSON.stringify(r[k]) : String(r[k] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </Split>
              </div>
            </div>
          )}
          {sub === 'prompt' && (
            <div className="h-full flex flex-col">
              <div className="flex items-center gap-3 px-3 py-1.5 text-sm border-b border-line">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={d.format === 'json'} onChange={(e) => set({ format: e.target.checked ? 'json' : 'text' })} /> JSON output
                </label>
                <span className="text-xs text-muted">
                  Variables: {vars.map((v) => (
                    <Badge key={v} tone={preview[0] && v in preview[0] ? 'accent' : 'bad'}>
                      {v}
                    </Badge>
                  ))}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <CodeEditor language="markdown" value={d.prompt} onChange={(prompt) => set({ prompt })} />
              </div>
            </div>
          )}
          {sub === 'evaluators' && (
            <div className="overflow-auto h-full">
              <p className="px-3 pt-3 text-xs text-muted">
                Deterministic checks are the source of truth for deterministic requirements. Similarity/RAG heuristics are approximate; LLM-judge scores are model-generated and labelled as such.
              </p>
              <AssertionEditor checks={d.evaluators} onChange={(evaluators) => set({ evaluators })} groups={['Body', 'AI', 'RAG', 'Safety', 'Response']} />
            </div>
          )}
        </div>
      </div>
      <div className="h-full flex flex-col min-h-0">
        {runId ? (
          <RunPanel runId={runId} expectedTotal={d.limit ? Math.min(d.limit, count) : count} />
        ) : (
          <div className="h-full flex flex-col">
            <Empty icon={<FlaskConical size={28} />} title="Run an evaluation">
              Datasets are streamed record-by-record with bounded concurrency, retries and rate limiting. Results are written to disk and can be compared against a baseline.
            </Empty>
            {runs.length > 0 && (
              <div className="border-t border-line max-h-72 overflow-auto">
                <div className="px-3 py-2 text-xs text-muted font-semibold flex items-center gap-1">
                  <History size={12} /> Recent runs
                </div>
                {runs.map((r) => (
                  <button key={r.id} className="w-full text-left px-3 py-1.5 hover:bg-hover text-sm flex gap-2" onClick={() => setRunId(r.id)}>
                    <span className="truncate">{r.name}</span>
                    <span className="ml-auto text-xs text-muted">
                      {r.total ? `${r.passed}/${r.total} · ` : ''}
                      {timeAgo(r.startedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Split>
  );
}
