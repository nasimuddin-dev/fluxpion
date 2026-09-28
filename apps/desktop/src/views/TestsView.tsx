import { ChevronDown, ChevronRight, FileCode2, FilePlus2, Folder, Layers, Play, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { asError, call } from '../api';
import { promptText, useApp } from '../store';
import { useIntent } from '../hooks';
import { timeAgo } from '../lib/format';
import { CodeEditor } from '../components/CodeEditor';
import { RunPanel } from '../components/RunPanel';
import { Badge, Button, cx, Empty, IconButton, Input, SectionTitle, Split, Tabs } from '../components/ui';

interface Node {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: Node[];
}

const TEMPLATES: Record<string, string> = {
  http: `name: Health check
type: http
method: GET
url: "{{baseUrl}}/health"
assertions:
  - type: status
    expected: 200
  - type: latency
    max: 1000
`,
  graphql: `name: Get patient
type: graphql
endpoint: "{{graphqlEndpoint}}"
query: |
  query GetPatient($id: ID!) {
    patient(id: $id) { id name }
  }
variables:
  id: "123"
assertions:
  - type: graphql-no-errors
  - type: exists
    path: $.data.patient.id
`,
  mcp: `name: Search customer tool
type: mcp
server: customer-mcp
tool: search_customer
arguments:
  customer_id: "123"
assertions:
  - type: status
    expected: success
  - type: equals
    path: $.customer.id
    expected: "123"
`,
  llm: `name: Intent classification
type: llm
model:
  provider: mock
  temperature: 0
input:
  message: I need to cancel my appointment
prompt: |
  Classify the customer intent as JSON {"intent": "..."}.
  {{message}}
responseFormat:
  type: json
evaluators:
  - type: json-schema
  - type: exact-match
    path: $.intent
    expected: cancellation
limits:
  latency_ms: 3000
`,
  suite: `name: Regression
tests:
  - rest
  - ai
concurrency: 4
retries: 1
`,
};

export function TestsView() {
  const [tree, setTree] = useState<Node[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<string>();
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [preview, setPreview] = useState<{ tests: Array<{ id?: string; name: string; type: string; tags?: string[] }>; suite?: { name: string; tests: string[] } } | { error: string }>();
  const [runId, setRunId] = useState<string>();
  const [runs, setRuns] = useState<Array<{ id: string; name: string; startedAt: string; passed: number; failed: number; errors: number; total: number; environment?: string }>>([]);
  const [tab, setTab] = useState<'editor' | 'run'>('editor');
  const [opts, setOpts] = useState({ concurrency: 4, retries: 0, grep: '', tags: '' });
  const env = useApp((s) => s.environment);

  const loadTree = useCallback(() => call<Node[]>('tests.tree').then(setTree), []);
  const loadRuns = useCallback(() => call('runs.list', { limit: 50 }).then((r) => setRuns(r.items)), []);
  useEffect(() => {
    void loadTree();
    void loadRuns();
  }, [loadTree, loadRuns]);

  const openFile = async (path: string) => {
    if (content !== saved && file && !confirm('Discard unsaved changes?')) return;
    const text = await call<string>('tests.read', { path });
    setFile(path);
    setContent(text);
    setSaved(text);
    setTab('editor');
    call('tests.preview', { path }).then(setPreview, (e) => setPreview({ error: asError(e).message }));
  };
  const save = async () => {
    if (!file) return;
    await call('tests.write', { path: file, content });
    setSaved(content);
    call('tests.preview', { path: file }).then(setPreview, (e) => setPreview({ error: asError(e).message }));
    void loadTree();
  };
  const run = async (paths: string[], name?: string) => {
    if (file && content !== saved) await save();
    try {
      const r = await call<{ runId: string }>('tests.run', {
        paths,
        name,
        environment: env,
        concurrency: opts.concurrency,
        retries: opts.retries,
        grep: opts.grep || undefined,
        tags: opts.tags ? opts.tags.split(',').map((s) => s.trim()) : undefined,
      });
      setRunId(r.runId);
      setTab('run');
      setTimeout(loadRuns, 500);
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const newFile = async (kind: string) => {
    const name = await promptText('New test file', { message: 'File path inside tests/ (e.g. rest/health.yaml)', okLabel: 'Create', value: kind === 'suite' ? 'regression.suite.yaml' : `${kind === 'http' ? 'rest' : kind === 'llm' ? 'ai' : kind}/new-test.yaml` });
    if (!name) return;
    await call('tests.write', { path: name, content: TEMPLATES[kind] });
    await loadTree();
    await openFile(name);
  };

  useIntent('tests', async (p) => {
    if (p?.path) await openFile(p.path);
    if (p?.runId) {
      setRunId(p.runId);
      setTab('run');
    }
    if (p?.runAll) void run([], 'All tests');
    if (p?.runCurrent && file) void run([file], file);
    if (p?.exportLatest) {
      const latest = runs[0];
      if (latest) void call('runs.exportReport', { runId: latest.id, format: 'html' });
      else useApp.getState().toast('No runs to export yet');
    }
  });

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && useApp.getState().view === 'tests') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const renderTree = (nodes: Node[], depth = 0): React.ReactNode =>
    nodes.map((n) =>
      n.kind === 'dir' ? (
        <div key={n.path}>
          <div className="group flex items-center h-7 hover:bg-hover pr-1 text-sm" style={{ paddingLeft: 6 + depth * 12 }}>
            <button className="flex items-center gap-1 flex-1 min-w-0" onClick={() => setOpen({ ...open, [n.path]: !(open[n.path] ?? true) })}>
              {open[n.path] ?? true ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
              <Folder size={13} className="text-muted" />
              <span className="truncate">{n.name}</span>
            </button>
            <IconButton label={`Run ${n.name}`} className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => run([n.path], n.path)}>
              <Play size={11} />
            </IconButton>
          </div>
          {(open[n.path] ?? true) && renderTree(n.children ?? [], depth + 1)}
        </div>
      ) : (
        <div key={n.path} className={cx('group flex items-center h-7 pr-1 text-sm', file === n.path ? 'bg-accent/10' : 'hover:bg-hover')} style={{ paddingLeft: 20 + depth * 12 }}>
          <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => openFile(n.path)}>
            {n.name.includes('.suite.') ? <Layers size={13} className="text-judge" /> : <FileCode2 size={13} className="text-muted" />}
            <span className="truncate">{n.name}</span>
          </button>
          {/\.(ya?ml|json)$/.test(n.name) && (
            <IconButton label={`Run ${n.name}`} className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => run([n.path], n.path)}>
              <Play size={11} />
            </IconButton>
          )}
        </div>
      ),
    );

  return (
    <Split id="tests-main" initial={22} min={14}>
      <div className="h-full flex flex-col bg-panel/50">
        <SectionTitle
          right={
            <div className="flex items-center">
              <select aria-label="New test file" className="bg-transparent text-xs text-muted hover:text-fg cursor-pointer w-5" value="" onChange={(e) => e.target.value && void newFile(e.target.value)}>
                <option value="">+</option>
                <option value="http">New REST test</option>
                <option value="graphql">New GraphQL test</option>
                <option value="mcp">New MCP test</option>
                <option value="llm">New AI test</option>
                <option value="suite">New suite</option>
              </select>
              <FilePlus2 size={13} className="text-muted -ml-4 pointer-events-none" />
            </div>
          }
        >
          Tests
        </SectionTitle>
        <div className="flex-1 overflow-auto">{tree.length ? renderTree(tree) : <Empty title="No test files">Use + to create a REST, GraphQL, MCP or AI test, or save one from the MCP view / AI Lab.</Empty>}</div>
        <div className="border-t border-line p-2 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">Workers</span>
              <Input type="number" min={1} value={opts.concurrency} onChange={(e) => setOpts({ ...opts, concurrency: Math.max(1, Number(e.target.value)) })} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">Retries</span>
              <Input type="number" min={0} value={opts.retries} onChange={(e) => setOpts({ ...opts, retries: Math.max(0, Number(e.target.value)) })} />
            </label>
            <Input className="text-xs" placeholder="grep name" value={opts.grep} onChange={(e) => setOpts({ ...opts, grep: e.target.value })} />
            <Input className="text-xs" placeholder="tags" value={opts.tags} onChange={(e) => setOpts({ ...opts, tags: e.target.value })} />
          </div>
          <Button variant="primary" icon={<Play size={13} />} onClick={() => run([], 'All tests')}>
            Run all tests
          </Button>
        </div>
      </div>
      <div className="h-full flex flex-col min-w-0">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'editor', label: file ?? 'Editor' },
            { id: 'run', label: 'Runs', badge: runs.length },
          ]}
          right={
            tab === 'editor' &&
            file && (
              <>
                <Button size="sm" icon={<Save size={12} />} onClick={save} disabled={content === saved}>
                  Save
                </Button>
                <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={() => run([file], file)}>
                  Run
                </Button>
                <IconButton
                  label="Delete file"
                  onClick={async () => {
                    if (!confirm(`Delete tests/${file}?`)) return;
                    await call('tests.delete', { path: file });
                    setFile(undefined);
                    void loadTree();
                  }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </>
            )
          }
        />
        <div className="flex-1 min-h-0">
          {tab === 'editor' ? (
            file ? (
              <Split id="tests-editor" initial={65}>
                <CodeEditor language={file.endsWith('.json') ? 'json' : file.endsWith('.jsonl') || file.endsWith('.csv') ? 'plaintext' : 'yaml'} path={`tests/${file}`} value={content} onChange={setContent} />
                <div className="h-full overflow-auto text-sm">
                  <SectionTitle>Parsed tests</SectionTitle>
                  {preview && 'error' in preview ? (
                    <div className="px-3 text-bad text-xs">{preview.error}</div>
                  ) : preview?.suite ? (
                    <div className="px-3">
                      <Badge tone="judge">suite</Badge> <b>{preview.suite.name}</b>
                      <ul className="mt-2 list-disc ml-5 text-xs mono">
                        {preview.suite.tests.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    preview?.tests.map((t, i) => (
                      <div key={i} className="px-3 py-1 flex items-center gap-2 border-b border-line/50">
                        <Badge>{t.type}</Badge>
                        <span className="truncate">{t.name}</span>
                        {t.tags?.map((g) => (
                          <Badge key={g} tone="accent">
                            {g}
                          </Badge>
                        ))}
                      </div>
                    ))
                  )}
                  <p className="p-3 text-xs text-muted">
                    Test files are plain YAML/JSON in the workspace <span className="mono">tests/</span> folder — commit them to git and run them in CI with <span className="mono">fluxpion test</span>.
                  </p>
                </div>
              </Split>
            ) : (
              <Empty icon={<FileCode2 size={28} />} title="Select a test file" />
            )
          ) : runId ? (
            <Split id="tests-runs" initial={22} min={12}>
              <RunList runs={runs} active={runId} onSelect={setRunId} />
              <RunPanel key={runId} runId={runId} />
            </Split>
          ) : (
            <Split id="tests-runs" initial={22} min={12}>
              <RunList runs={runs} active={runId} onSelect={setRunId} />
              <Empty title="Select a run" />
            </Split>
          )}
        </div>
      </div>
    </Split>
  );
}

function RunList({ runs, active, onSelect }: { runs: Array<{ id: string; name: string; startedAt: string; passed: number; failed: number; errors: number; total: number; environment?: string }>; active?: string; onSelect(id: string): void }) {
  return (
    <div className="h-full overflow-auto">
      {runs.map((r) => (
        <button key={r.id} onClick={() => onSelect(r.id)} className={cx('w-full text-left px-3 py-2 border-b border-line/60', active === r.id ? 'bg-accent/10' : 'hover:bg-hover')}>
          <div className="text-sm truncate">{r.name}</div>
          <div className="text-xs text-muted flex gap-2">
            <span className={r.failed + r.errors ? 'text-bad' : 'text-ok'}>
              {r.passed}/{r.total}
            </span>
            {r.environment && <span>{r.environment}</span>}
            <span className="ml-auto">{timeAgo(r.startedAt)}</span>
          </div>
        </button>
      ))}
      {!runs.length && <div className="p-3 text-sm text-muted">No runs yet</div>}
    </div>
  );
}
