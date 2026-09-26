import { KeyRound, Play, Plus, RefreshCw, Save, Square, Trash2, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stringifyYaml } from '../lib/yaml';
import { asError, call, on, type NormalizedError } from '../api';
import { persisted, useApp } from '../store';
import { useIntent, useSendShortcut } from '../hooks';
import type { CheckConfig, CheckResult, ProviderConfig } from '../types';
import { formatCost, formatMs, templateVars, uid } from '../lib/format';
import { AssertionEditor } from '../components/AssertionEditor';
import { CodeEditor } from '../components/CodeEditor';
import { JsonTree } from '../components/JsonView';
import { CheckList, ErrorPanel } from '../components/Results';
import { Badge, Button, cx, Empty, Field, IconButton, Input, Metric, Select, Split, Tabs } from '../components/ui';

interface ChatResult {
  id: string;
  provider: string;
  model: string;
  text: string;
  json?: unknown;
  isJson: boolean;
  schemaValid?: boolean;
  schemaErrors?: string[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  usageEstimated?: boolean;
  costUsd?: number;
  priceVersion?: string;
  timing: { totalMs: number; firstTokenMs?: number; interTokenMsAvg?: number };
  finishReason?: string;
  checks: CheckResult[];
  renderedPrompt: string;
  traceId: string;
  error?: NormalizedError;
}

interface Draft {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  input: Record<string, string>;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
  format: 'text' | 'json' | 'json_schema';
  schema: string;
  expected: string;
  evaluators: CheckConfig[];
  compare: Array<{ provider: string; name: string }>;
}

const drafts = persisted<Draft>('ai', {
  provider: '',
  model: '',
  system: 'You are a helpful assistant for a veterinary clinic.',
  prompt: 'Classify the following customer message. Respond with JSON {"category": "..."}.\n\n{{message}}',
  input: { message: 'I want to cancel my appointment' },
  temperature: 0,
  format: 'json',
  schema: '{\n  "type": "object",\n  "required": ["category"],\n  "properties": { "category": { "type": "string" } }\n}',
  expected: '',
  evaluators: [{ type: 'json-schema' }],
  compare: [],
});

export function AiLabView() {
  const [tab, setTab] = useState<'playground' | 'compare' | 'providers'>('playground');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const load = useCallback(() => call<ProviderConfig[]>('ai.providers').then(setProviders), []);
  useEffect(() => {
    void load();
  }, [load]);
  useIntent('ai', (p) => {
    if (p?.tab) setTab(p.tab);
    if (p?.providerId) setTab('providers');
    if (p?.reset) setTab('playground');
  });
  return (
    <div className="h-full flex flex-col">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'playground', label: 'Playground' },
          { id: 'compare', label: 'Model comparison' },
          { id: 'providers', label: 'Providers', badge: providers.length },
        ]}
      />
      <div className="flex-1 min-h-0">
        {tab === 'playground' && <Playground providers={providers} />}
        {tab === 'compare' && <Compare providers={providers} />}
        {tab === 'providers' && <Providers providers={providers} onSaved={load} />}
      </div>
    </div>
  );
}

function useDraft() {
  const [d, setD] = useState<Draft>(drafts.load);
  useEffect(() => drafts.save(d), [d]);
  return [d, (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))] as const;
}

function ModelPicker({ providers, provider, model, onChange }: { providers: ProviderConfig[]; provider: string; model: string; onChange(p: string, m: string): void }) {
  const [models, setModels] = useState<string[]>([]);
  const env = useApp((s) => s.environment);
  const p = providers.find((x) => x.id === provider) ?? providers[0];
  useEffect(() => {
    if (!provider && providers[0]) onChange(providers[0].id, providers[0].defaultModel ?? '');
  }, [provider, providers, onChange]);
  const refresh = () =>
    p &&
    call<string[]>('ai.models', { providerId: p.id, environment: env })
      .then(setModels)
      .catch((e) => useApp.getState().toast(`Could not list models: ${asError(e).message}`, 'error'));
  return (
    <div className="flex items-center gap-1">
      <Select aria-label="Provider" value={p?.id ?? ''} onChange={(e) => onChange(e.target.value, providers.find((x) => x.id === e.target.value)?.defaultModel ?? '')}>
        {providers.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Input aria-label="Model" list={`models-${p?.id}`} className="w-48 mono" placeholder={p?.defaultModel ?? 'model name'} value={model} onChange={(e) => onChange(p?.id ?? '', e.target.value)} />
      <datalist id={`models-${p?.id}`}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <IconButton label="Fetch model list" onClick={refresh}>
        <RefreshCw size={13} />
      </IconButton>
    </div>
  );
}

function Params({ d, set }: { d: Draft; set(p: Partial<Draft>): void }) {
  const num = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <div className="grid grid-cols-4 gap-2 text-xs">
      <Field label="Temperature">
        <Input type="number" step="0.1" min="0" max="2" value={d.temperature ?? ''} onChange={(e) => set({ temperature: num(e.target.value) })} />
      </Field>
      <Field label="Top P">
        <Input type="number" step="0.05" min="0" max="1" value={d.topP ?? ''} onChange={(e) => set({ topP: num(e.target.value) })} />
      </Field>
      <Field label="Max tokens">
        <Input type="number" value={d.maxTokens ?? ''} onChange={(e) => set({ maxTokens: num(e.target.value) })} />
      </Field>
      <Field label="Seed">
        <Input type="number" value={d.seed ?? ''} onChange={(e) => set({ seed: num(e.target.value) })} />
      </Field>
    </div>
  );
}

function responseFormat(d: Draft) {
  if (d.format === 'text') return undefined;
  if (d.format === 'json') return { type: 'json' as const };
  try {
    return { type: 'json_schema' as const, name: 'output', schema: JSON.parse(d.schema) };
  } catch {
    return { type: 'json' as const };
  }
}

function parseExpected(s: string): unknown {
  if (!s.trim()) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function PromptEditor({ d, set }: { d: Draft; set(p: Partial<Draft>): void }) {
  const [sub, setSub] = useState<'prompt' | 'system' | 'format' | 'evaluators'>('prompt');
  const vars = useMemo(() => [...new Set([...templateVars(d.prompt), ...templateVars(d.system)])], [d.prompt, d.system]);
  return (
    <div className="h-full flex flex-col">
      <Tabs
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'prompt', label: 'Prompt template' },
          { id: 'system', label: 'System' },
          { id: 'format', label: 'Structured output', badge: d.format !== 'text' ? d.format : undefined },
          { id: 'evaluators', label: 'Evaluators', badge: d.evaluators.length },
        ]}
      />
      <div className="flex-1 min-h-0">
        {sub === 'prompt' && (
          <Split id="ai-prompt-vars" direction="vertical" initial={62}>
            <CodeEditor language="markdown" value={d.prompt} onChange={(prompt) => set({ prompt })} />
            <div className="h-full overflow-auto p-3">
              <div className="text-xs font-semibold text-muted mb-2">Input variables {vars.length ? '' : '— use {{name}} in the template'}</div>
              <div className="flex flex-col gap-2">
                {vars.map((v) => (
                  <Field key={v} label={v}>
                    <textarea className="field text-sm min-h-9" rows={1} value={d.input[v] ?? ''} onChange={(e) => set({ input: { ...d.input, [v]: e.target.value } })} />
                  </Field>
                ))}
              </div>
            </div>
          </Split>
        )}
        {sub === 'system' && <CodeEditor language="markdown" value={d.system} onChange={(system) => set({ system })} />}
        {sub === 'format' && (
          <div className="h-full flex flex-col">
            <div className="flex gap-4 px-3 py-2 text-sm border-b border-line">
              {(['text', 'json', 'json_schema'] as const).map((f) => (
                <label key={f} className="flex items-center gap-1">
                  <input type="radio" checked={d.format === f} onChange={() => set({ format: f })} /> {f === 'text' ? 'Free text' : f === 'json' ? 'JSON mode' : 'JSON Schema'}
                </label>
              ))}
            </div>
            {d.format === 'json_schema' ? (
              <div className="flex-1 min-h-0">
                <CodeEditor value={d.schema} onChange={(schema) => set({ schema })} />
              </div>
            ) : (
              <p className="p-3 text-sm text-muted">{d.format === 'json' ? 'The provider is asked for JSON output; validity is checked on every response.' : 'No output structure is enforced.'}</p>
            )}
          </div>
        )}
        {sub === 'evaluators' && (
          <div className="overflow-auto h-full">
            <div className="p-3 pb-0">
              <Field label="Expected output (optional, JSON or text) — used by exact-match, similarity and judge">
                <Input className="mono" value={d.expected} onChange={(e) => set({ expected: e.target.value })} placeholder='{"category": "cancellation"}' />
              </Field>
            </div>
            <AssertionEditor checks={d.evaluators} onChange={(evaluators) => set({ evaluators })} groups={['Body', 'AI', 'Safety', 'Response']} />
          </div>
        )}
      </div>
    </div>
  );
}

function Playground({ providers }: { providers: ProviderConfig[] }) {
  const [d, set] = useDraft();
  const [running, setRunning] = useState<string>();
  const [stream, setStream] = useState('');
  const [result, setResult] = useState<ChatResult | { error: NormalizedError }>();
  const [resTab, setResTab] = useState<'output' | 'json' | 'evaluation' | 'prompt'>('output');
  const env = useApp((s) => s.environment);
  const idRef = useRef<string | undefined>(undefined);
  useEffect(
    () =>
      on<Array<{ id: string; delta: string }>>('ai.deltas', (items) => {
        const mine = items.filter((i) => i.id === idRef.current).map((i) => i.delta);
        if (mine.length) setStream((s) => s + mine.join(''));
      }),
    [],
  );
  const onModel = useCallback((provider: string, model: string) => set({ provider, model }), [set]);
  const run = async () => {
    const id = uid('ai-');
    idRef.current = id;
    setRunning(id);
    setStream('');
    setResult(undefined);
    setResTab('output');
    useApp.getState().setActivity(id, `Running ${d.model || 'model'}`);
    try {
      const r = await call<ChatResult>('ai.chat', {
        requestId: id,
        provider: d.provider,
        model: d.model,
        system: d.system || undefined,
        prompt: d.prompt,
        input: d.input,
        temperature: d.temperature,
        topP: d.topP,
        maxTokens: d.maxTokens,
        seed: d.seed,
        responseFormat: responseFormat(d),
        stream: true,
        environment: env,
        evaluators: d.evaluators,
        expected: parseExpected(d.expected),
      });
      setResult(r);
    } catch (e) {
      setResult({ error: asError(e) });
    } finally {
      setRunning(undefined);
      useApp.getState().setActivity(id);
    }
  };
  useSendShortcut('ai', () => !running && void run());
  const saveAsTest = async () => {
    const name = prompt('Test name', 'Prompt test');
    if (!name) return;
    const test: Record<string, unknown> = {
      name,
      type: 'llm',
      model: { provider: d.provider, name: d.model || undefined, temperature: d.temperature, topP: d.topP, maxTokens: d.maxTokens, seed: d.seed },
      ...(d.system ? { system: d.system } : {}),
      prompt: d.prompt,
      input: d.input,
      ...(responseFormat(d) ? { responseFormat: responseFormat(d) } : {}),
      ...(parseExpected(d.expected) !== undefined ? { expected: parseExpected(d.expected) } : {}),
      evaluators: d.evaluators,
    };
    const path = `ai/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.yaml`;
    await call('tests.write', { path, content: stringifyYaml(test) });
    useApp.getState().toast(`Saved tests/${path}`, 'success');
  };
  if (!providers.length) return <NoProviders />;
  const r = result && !('error' in result) ? result : undefined;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-line flex-wrap">
        <ModelPicker providers={providers} provider={d.provider} model={d.model} onChange={onModel} />
        <div className="ml-auto flex gap-2">
          <Button icon={<Save size={13} />} onClick={saveAsTest}>
            Save as test
          </Button>
          {running ? (
            <Button variant="danger" icon={<Square size={12} />} onClick={() => call('ai.cancel', { id: running })}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={<Play size={13} />} onClick={run} title="Run (Ctrl+Enter)">
              Run
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Split id="ai-play" initial={50}>
          <div className="h-full flex flex-col">
            <div className="p-2 border-b border-line">
              <Params d={d} set={set} />
            </div>
            <div className="flex-1 min-h-0">
              <PromptEditor d={d} set={set} />
            </div>
          </div>
          <div className="h-full flex flex-col min-h-0">
            {result && 'error' in result ? (
              <ErrorPanel error={result.error!} context={{ provider: d.provider, model: d.model }} />
            ) : running || r ? (
              <>
                <div className="flex gap-2 p-2 flex-wrap border-b border-line">
                  <Metric label="Latency" value={r ? formatMs(r.timing.totalMs) : '…'} />
                  <Metric label="Time to first token" value={r?.timing.firstTokenMs !== undefined ? formatMs(r.timing.firstTokenMs) : '–'} />
                  <Metric label="Tokens in / out" value={r ? `${r.usage.inputTokens} / ${r.usage.outputTokens}` : '…'} sub={r?.usageEstimated ? 'estimated' : undefined} />
                  <Metric label="Est. cost" value={r ? formatCost(r.costUsd) : '…'} sub={r?.priceVersion ? `prices ${r.priceVersion}` : r ? 'no price configured' : undefined} />
                  {r && d.format !== 'text' && <Metric label="Structured output" value={r.schemaValid === false ? 'invalid' : r.isJson ? 'valid' : 'not JSON'} tone={r.schemaValid === false || !r.isJson ? 'bad' : 'ok'} />}
                </div>
                <Tabs
                  value={resTab}
                  onChange={setResTab}
                  tabs={[
                    { id: 'output', label: 'Output' },
                    ...(r?.isJson ? [{ id: 'json' as const, label: 'JSON' }] : []),
                    { id: 'evaluation', label: 'Evaluation', badge: r?.checks.length },
                    { id: 'prompt', label: 'Rendered prompt' },
                  ]}
                  right={r && <span className="text-xs text-muted pr-2">{r.provider} · {r.model} · {r.finishReason}</span>}
                />
                <div className="flex-1 min-h-0 overflow-auto">
                  {resTab === 'output' && <pre className="p-3 whitespace-pre-wrap text-sm leading-relaxed">{r ? r.text : stream}{running && <span className="inline-block w-2 h-4 bg-accent align-middle ml-0.5 animate-pulse" />}</pre>}
                  {resTab === 'json' && r && <JsonTree data={r.json} />}
                  {resTab === 'evaluation' && r && (
                    <>
                      {r.schemaErrors?.length ? <div className="p-3 text-sm text-bad">Schema errors: {r.schemaErrors.join('; ')}</div> : null}
                      <CheckList checks={r.checks} />
                    </>
                  )}
                  {resTab === 'prompt' && r && <pre className="p-3 whitespace-pre-wrap text-sm mono">{r.renderedPrompt}</pre>}
                </div>
              </>
            ) : (
              <Empty icon={<Play size={26} />} title="Run the prompt">
                Streams the response and measures latency, time-to-first-token, tokens and estimated cost. Prompts and responses stay on this machine unless the selected provider is remote.
              </Empty>
            )}
          </div>
        </Split>
      </div>
    </div>
  );
}

function Compare({ providers }: { providers: ProviderConfig[] }) {
  const [d, set] = useDraft();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Array<ChatResult & { error?: NormalizedError }>>([]);
  const env = useApp((s) => s.environment);
  const rows = d.compare.length ? d.compare : providers.slice(0, 2).map((p) => ({ provider: p.id, name: p.defaultModel ?? '' }));
  const run = async () => {
    setRunning(true);
    try {
      setResults(
        await call('ai.compare', {
          requestId: uid('cmp-'),
          models: rows,
          system: d.system || undefined,
          prompt: d.prompt,
          input: d.input,
          temperature: d.temperature,
          topP: d.topP,
          maxTokens: d.maxTokens,
          seed: d.seed,
          responseFormat: responseFormat(d),
          environment: env,
          evaluators: [...d.evaluators, ...(parseExpected(d.expected) !== undefined ? [{ type: 'similarity', name: 'similarity to expected' }] : [])],
          expected: parseExpected(d.expected),
        }),
      );
    } finally {
      setRunning(false);
    }
  };
  if (!providers.length) return <NoProviders />;
  return (
    <Split id="ai-compare" initial={38}>
      <div className="h-full flex flex-col">
        <div className="p-2 border-b border-line flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted">Models</div>
          {rows.map((m, i) => (
            <div key={i} className="flex items-center gap-1">
              <ModelPicker providers={providers} provider={m.provider} model={m.name} onChange={(p, name) => set({ compare: rows.map((x, j) => (j === i ? { provider: p, name } : x)) })} />
              <IconButton label="Remove model" onClick={() => set({ compare: rows.filter((_, j) => j !== i) })}>
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" icon={<Plus size={12} />} onClick={() => set({ compare: [...rows, { provider: providers[0]!.id, name: providers[0]!.defaultModel ?? '' }] })}>
              Add model
            </Button>
            <Button size="sm" variant="primary" icon={<Play size={12} />} loading={running} onClick={run} className="ml-auto">
              Run comparison
            </Button>
          </div>
          <Params d={d} set={set} />
        </div>
        <div className="flex-1 min-h-0">
          <PromptEditor d={d} set={set} />
        </div>
      </div>
      <div className="h-full overflow-auto">
        {results.length ? (
          <>
            <p className="px-3 py-2 text-xs text-muted border-b border-line">
              Measurements only — there is no universal ranking. Choose the criteria that matter for your use case and inspect the underlying outputs.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-3 py-2 w-40">Metric</th>
                  {results.map((r, i) => (
                    <th key={i} className="px-3 py-2">
                      {r.provider} · <span className="mono">{r.model}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Latency', (r: ChatResult) => formatMs(r.timing?.totalMs)],
                    ['Time to first token', (r: ChatResult) => formatMs(r.timing?.firstTokenMs)],
                    ['Input tokens', (r: ChatResult) => r.usage?.inputTokens],
                    ['Output tokens', (r: ChatResult) => r.usage?.outputTokens],
                    ['Est. cost', (r: ChatResult) => formatCost(r.costUsd)],
                    ['Valid JSON', (r: ChatResult) => (d.format === 'text' ? '–' : r.isJson ? '✓' : '✗')],
                    ['Schema valid', (r: ChatResult) => (r.schemaValid === undefined ? '–' : r.schemaValid ? '✓' : '✗')],
                    ['Checks passed', (r: ChatResult) => (r.checks ? `${r.checks.filter((c) => c.passed).length}/${r.checks.length}` : '–')],
                  ] as Array<[string, (r: ChatResult) => React.ReactNode]>
                ).map(([label, fn]) => (
                  <tr key={label} className="border-b border-line">
                    <td className="px-3 py-1.5 text-muted">{label}</td>
                    {results.map((r, i) => (
                      <td key={i} className="px-3 py-1.5 tabular-nums">
                        {r.error ? <span className="text-bad">{r.error.kind}</span> : fn(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="align-top">
                  <td className="px-3 py-2 text-muted">Output</td>
                  {results.map((r, i) => (
                    <td key={i} className="px-3 py-2">
                      {r.error ? <span className="text-bad text-xs">{r.error.message}</span> : <pre className="whitespace-pre-wrap text-xs mono max-h-80 overflow-auto">{r.text}</pre>}
                    </td>
                  ))}
                </tr>
                <tr className="align-top">
                  <td className="px-3 py-2 text-muted">Evaluation</td>
                  {results.map((r, i) => (
                    <td key={i} className="px-1 py-1">
                      {r.checks && <CheckList checks={r.checks} compact />}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <Empty title="Compare models side by side">Runs the same prompt against every selected model and reports latency, tokens, cost, structured-output validity and your evaluators.</Empty>
        )}
      </div>
    </Split>
  );
}

function NoProviders() {
  return (
    <Empty icon={<WifiOff size={26} />} title="No AI providers configured">
      Add an OpenAI-compatible, Azure OpenAI, Anthropic, Gemini or Ollama provider in the Providers tab. The built-in "mock" provider works fully offline.
    </Empty>
  );
}

const KINDS: Array<[ProviderConfig['kind'], string, string]> = [
  ['openai-compatible', 'OpenAI-compatible', 'https://api.openai.com/v1'],
  ['azure-openai', 'Azure OpenAI', 'https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT'],
  ['anthropic', 'Anthropic', 'https://api.anthropic.com'],
  ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com'],
  ['ollama', 'Ollama (local)', 'http://127.0.0.1:11434/v1'],
  ['mock', 'Mock (offline, deterministic)', 'mock://local'],
];

function Providers({ providers, onSaved }: { providers: ProviderConfig[]; onSaved(): void }) {
  const [list, setList] = useState<ProviderConfig[]>(providers);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [sel, setSel] = useState(providers[0]?.id);
  const [testing, setTesting] = useState(false);
  const env = useApp((s) => s.environment);
  useEffect(() => setList(providers), [providers]);
  const p = list.find((x) => x.id === sel);
  const upd = (patch: Partial<ProviderConfig>) => setList(list.map((x) => (x.id === sel ? { ...x, ...patch } : x)));
  const save = async () => {
    try {
      await call('ai.saveProviders', { providers: list.map(({ hasKey: _h, ...x }) => x), keys });
      setKeys({});
      onSaved();
      useApp.getState().toast('Providers saved. API keys are stored in the OS credential store.', 'success');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const test = async () => {
    if (!p) return;
    setTesting(true);
    try {
      await save();
      const models = await call<string[]>('ai.models', { providerId: p.id, environment: env });
      useApp.getState().toast(`Connected — ${models.length} models available`, 'success');
    } catch (e) {
      useApp.getState().toast(`Connection failed: ${asError(e).message}`, 'error');
    } finally {
      setTesting(false);
    }
  };
  return (
    <Split id="ai-providers" initial={26}>
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-auto">
          {list.map((x) => (
            <button key={x.id} onClick={() => setSel(x.id)} className={cx('w-full text-left px-3 py-2 border-b border-line/60', sel === x.id ? 'bg-accent/10' : 'hover:bg-hover')}>
              <div className="text-sm font-medium flex items-center gap-2">
                {x.name}
                {x.hasKey && <KeyRound size={11} className="text-warn" />}
              </div>
              <div className="text-xs text-muted">{KINDS.find((k) => k[0] === x.kind)?.[1]}</div>
            </button>
          ))}
        </div>
        <div className="p-2 border-t border-line">
          <Button
            size="sm"
            icon={<Plus size={12} />}
            onClick={() => {
              const id = uid('prov-');
              setList([...list, { id, name: 'New provider', kind: 'openai-compatible', baseUrl: KINDS[0]![2] }]);
              setSel(id);
            }}
          >
            Add provider
          </Button>
        </div>
      </div>
      <div className="h-full overflow-auto">
        {p ? (
          <div className="p-4 flex flex-col gap-3 max-w-2xl">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={p.name} onChange={(e) => upd({ name: e.target.value })} />
              </Field>
              <Field label="Kind">
                <Select value={p.kind} onChange={(e) => upd({ kind: e.target.value as ProviderConfig['kind'], baseUrl: KINDS.find((k) => k[0] === e.target.value)![2] })}>
                  {KINDS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Base URL" hint={p.kind === 'azure-openai' ? 'Include the deployment path; set the API version below.' : undefined}>
              <Input className="mono" value={p.baseUrl} onChange={(e) => upd({ baseUrl: e.target.value })} />
            </Field>
            {p.kind !== 'mock' && (
              <Field label="API key" hint={p.hasKey ? 'A key is stored in the OS credential store. Type to replace it.' : 'Stored encrypted in the OS credential store — never in workspace files. You can also reference {{$env.NAME}} in the field below.'}>
                <Input type="password" placeholder={p.hasKey ? '••••••••••••' : 'sk-…'} value={keys[p.id] ?? ''} onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })} />
              </Field>
            )}
            {p.kind !== 'mock' && (
              <Field label="API key reference (advanced)" hint="Leave empty to use the stored key. CI: {{$env.OPENAI_API_KEY}} or APS_SECRET_PROVIDER_<ID>_APIKEY.">
                <Input className="mono" value={p.apiKey?.includes('$secret') ? '' : p.apiKey ?? ''} onChange={(e) => upd({ apiKey: e.target.value || undefined })} placeholder="{{$env.MY_KEY}}" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default model">
                <Input className="mono" value={p.defaultModel ?? ''} onChange={(e) => upd({ defaultModel: e.target.value || undefined })} />
              </Field>
              <Field label="Embedding model">
                <Input className="mono" value={p.embeddingModel ?? ''} onChange={(e) => upd({ embeddingModel: e.target.value || undefined })} />
              </Field>
              {(p.kind === 'azure-openai' || p.kind === 'anthropic') && (
                <Field label="API version">
                  <Input className="mono" value={p.apiVersion ?? ''} placeholder={p.kind === 'anthropic' ? '2023-06-01' : '2024-10-21'} onChange={(e) => upd({ apiVersion: e.target.value || undefined })} />
                </Field>
              )}
            </div>
            <div className="font-medium text-sm mt-2">Rate limits</div>
            <div className="grid grid-cols-4 gap-2">
              {(['requestsPerSecond', 'requestsPerMinute', 'tokensPerMinute', 'concurrency'] as const).map((k) => (
                <Field key={k} label={{ requestsPerSecond: 'Req/sec', requestsPerMinute: 'Req/min', tokensPerMinute: 'Tokens/min', concurrency: 'Concurrency' }[k]}>
                  <Input type="number" value={p.rateLimit?.[k] ?? ''} onChange={(e) => upd({ rateLimit: { ...p.rateLimit, [k]: e.target.value ? Number(e.target.value) : undefined } })} />
                </Field>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Button variant="primary" onClick={save}>
                Save
              </Button>
              <Button onClick={test} loading={testing}>
                Test connection
              </Button>
              <Button variant="ghost" className="ml-auto text-bad" icon={<Trash2 size={13} />} onClick={() => confirm(`Remove ${p.name}?`) && setList(list.filter((x) => x.id !== p.id))}>
                Remove
              </Button>
            </div>
            <Badge>Cloud providers require network access; prompts are only sent to the provider you select.</Badge>
          </div>
        ) : (
          <Empty title="Select a provider" />
        )}
      </div>
    </Split>
  );
}
