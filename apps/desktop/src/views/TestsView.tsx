import { ChevronDown, ChevronRight, FileCode2, FilePlus2, Folder, History, KeyRound, Layers, Play, Save, ShieldCheck, Trash2, Workflow } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { asError, call } from '../api';
import { confirmAction, promptText, useApp } from '../store';
import { useIntent, useSaveShortcut } from '../hooks';
import { timeAgo } from '../lib/format';
import { CodeEditor } from '../components/CodeEditor';
import { RunMiniBar, RunsOverview, type RunRow } from '../components/RunsOverview';
import { RunPanel } from '../components/RunPanel';
import { SidebarShell } from '../components/SidebarShell';
import { EnvironmentsPane } from '../components/SidebarPanes';
import { finishSave, type SaveResult } from '../lib/files';
import { Badge, Button, cx, Empty, IconButton, Input, Menu, SectionTitle, Split, Tabs } from '../components/ui';

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
  grpc: `name: Say hello
type: grpc
target: "{{grpcHost}}"          # host:port, or grpcs://host:port for TLS
method: hello.HelloService/SayHello
message: { greeting: TestPion }
protos: []                      # empty: ask the server (reflection)
assertions:
  - type: grpc-status
    expected: OK
`,
  websocket: `name: Echo server replies
type: websocket                  # socketio for Socket.IO, mqtt for MQTT
url: "{{wsUrl}}"
send:
  - hello
  - { type: ping }
waitMs: 1500
assertions:
  - type: equals
    path: $.received[0]
    expected: hello
`,
  mqtt: `name: A command is acknowledged
type: mqtt
url: "{{mqttBroker}}"            # mqtt://, mqtts://, ws:// or wss://
subscribe: [clinic/7/acks]
send:
  - { topic: clinic/7/commands, payload: { action: recheck }, qos: 1 }
waitMs: 1500
assertions:
  - type: equals
    path: $.received[0].topic
    expected: clinic/7/acks
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
  // filter the tree by file or folder path (matching folders stay open)
  const [treeFilter, setTreeFilter] = useState('');
  const tf = treeFilter.trim().toLowerCase();
  const filterTree = (nodes: Node[]): Node[] =>
    !tf ? nodes : nodes.flatMap((n) => (n.kind === 'dir' ? ((c) => (c.length ? [{ ...n, children: c }] : []))(filterTree(n.children ?? [])) : n.path.toLowerCase().includes(tf) ? [n] : []));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<string>();
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [preview, setPreview] = useState<{ tests: Array<{ id?: string; name: string; type: string; tags?: string[] }>; suite?: { name: string; tests: string[] } } | { error: string }>();
  const [runId, setRunId] = useState<string>();
  const [runs, setRuns] = useState<RunRow[]>([]);
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
    if (content !== saved && file && !(await confirmAction({ title: 'Unsaved changes', message: `tests/${file} has unsaved changes.`, detail: 'Open the other file and discard them? Save with Ctrl+S to keep them.', confirmLabel: 'Discard changes', danger: true }))) return;
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
    const name = await promptText('New test file', { message: 'File path inside tests/ (e.g. rest/health.yaml)', okLabel: 'Create', value: kind === 'suite' ? 'regression.suite.yaml' : `${kind === 'http' ? 'rest' : kind === 'llm' ? 'ai' : kind === 'mqtt' ? 'websocket' : kind}/new-test.yaml` });
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
      if (latest) void call<SaveResult>('runs.exportReport', { runId: latest.id, format: 'html' }).then((r) => finishSave(r, 'Report'));
      else useApp.getState().toast('No runs to export yet');
    }
  });

  useSaveShortcut('tests', () => void save());

  const renderTree = (nodes: Node[], depth = 0): React.ReactNode =>
    nodes.map((n) =>
      n.kind === 'dir' ? (
        <div key={n.path}>
          <div className="group flex items-center h-7 hover:bg-hover pr-1 text-sm" style={{ paddingLeft: 6 + depth * 12 }}>
            <button className="flex items-center gap-1 flex-1 min-w-0" onClick={() => setOpen({ ...open, [n.path]: !(open[n.path] ?? true) })}>
              {tf || (open[n.path] ?? true) ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
              <Folder size={13} className="text-muted" />
              <span className="truncate">{n.name}</span>
            </button>
            <IconButton label={`Run ${n.name}`} className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => run([n.path], n.path)}>
              <Play size={11} />
            </IconButton>
          </div>
          {(tf || (open[n.path] ?? true)) && renderTree(n.children ?? [], depth + 1)}
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
      <SidebarShell
        id="tests"
        panes={[
          {
            id: 'tests',
            label: 'Tests',
            icon: <ShieldCheck size={13} />,
            render: () => (
              <>
                <SectionTitle
                  right={
                    <div className="flex items-center">
                      <Menu
                        width={220}
                        items={(
                          [
                            ['http', 'New REST test'],
                            ['graphql', 'New GraphQL test'],
                            ['grpc', 'New gRPC test'],
                            ['websocket', 'New WebSocket test'],
                            ['mqtt', 'New MQTT test'],
                            ['mcp', 'New MCP test'],
                            ['llm', 'New AI test'],
                            ['suite', 'New suite'],
                          ] as const
                        ).map(([kind, label], i) => ({ label, icon: kind === 'suite' ? <Layers size={13} /> : <FilePlus2 size={13} />, separator: i === 7, onSelect: () => void newFile(kind) }))}
                        trigger={
                          <button aria-label="New test file" title="New test file (REST, GraphQL, gRPC, WebSocket, MQTT, MCP, AI or a suite)" className="flex items-center gap-1 h-6 px-1.5 rounded-md text-xs text-muted hover:text-fg hover:bg-hover data-[state=open]:bg-hover">
                            <FilePlus2 size={13} />
                            New
                            <ChevronDown size={11} />
                          </button>
                        }
                      />
                      <IconButton label="Run in CI (GitHub Actions, GitLab, Azure, Jenkins)" className="ml-1" onClick={() => useApp.getState().set({ ci: {} })}>
                        <Workflow size={13} />
                      </IconButton>
                    </div>
                  }
                >
                  Tests
                </SectionTitle>
                {tree.length > 0 && (
                  <div className="px-2 pb-2">
                    <Input className="w-full h-7 min-h-7 text-sm" placeholder="Filter test files" aria-label="Filter test files" value={treeFilter} onChange={(e) => setTreeFilter(e.target.value)} />
                  </div>
                )}
                <div className="flex-1 overflow-auto">{tree.length ? (tf && !filterTree(tree).length ? <p className="px-3 py-4 text-sm text-muted text-center">No test files match this filter.</p> : renderTree(filterTree(tree))) : <Empty title="No test files">Use New to create a REST, GraphQL, gRPC, WebSocket, MCP or AI test, or save one from the MCP view / AI Lab.</Empty>}</div>
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
              </>
            ),
          },
          { id: 'environments', label: 'Environments', icon: <KeyRound size={13} />, render: () => <EnvironmentsPane /> },
          {
            id: 'runs',
            label: 'Runs',
            icon: <History size={13} />,
            render: () => (
              <div className="flex-1 min-h-0 flex flex-col">
                <RunList
                  runs={runs}
                  active={runId}
                  onSelect={(id) => {
                    setRunId(id);
                    setTab('run');
                  }}
                />
              </div>
            ),
          },
        ]}
      />
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
                    if (!(await confirmAction({ title: 'Delete test file', message: `Delete tests/${file}?`, detail: 'This cannot be undone (unless the workspace is in git).', confirmLabel: 'Delete file', danger: true }))) return;
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
                    Test files are plain YAML/JSON in the workspace <span className="mono">tests/</span> folder — commit them to git and run them in CI with <span className="mono">testpion test</span>.
                  </p>
                </div>
              </Split>
            ) : (
              <Empty icon={<FileCode2 size={28} />} title="Select a test file">
                Pick a file on the left to edit it and preview its tests, or use <b>New</b> to create one.
              </Empty>
            )
          ) : runId ? (
            <Split id="tests-runs" initial={22} min={12}>
              <RunList runs={runs} active={runId} onSelect={setRunId} />
              <RunPanel
                key={runId}
                runId={runId}
                onRerunFailed={(id) =>
                  void call<{ runId: string }>('tests.rerunFailed', { runId: id, environment: env, concurrency: opts.concurrency, retries: opts.retries }).then(
                    (r) => {
                      setRunId(r.runId);
                      setTimeout(loadRuns, 500);
                    },
                    (e) => useApp.getState().toast(asError(e).message, 'error'),
                  )
                }
              />
            </Split>
          ) : (
            <Split id="tests-runs" initial={22} min={12}>
              <RunList runs={runs} active={runId} onSelect={setRunId} />
              <RunsOverview runs={runs} onSelect={setRunId} />
            </Split>
          )}
        </div>
      </div>
    </Split>
  );
}

function RunList({ runs, active, onSelect }: { runs: RunRow[]; active?: string; onSelect(id: string): void }) {
  // filter by name / environment, and only the runs where something failed
  const [query, setQuery] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const q = query.toLowerCase();
  const shown = runs.filter((r) => (!failedOnly || r.failed + r.errors > 0) && (!q || `${r.name} ${r.environment ?? ''}`.toLowerCase().includes(q)));
  return (
    <div className="h-full flex flex-col min-h-0">
      {runs.length > 3 && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
          <Input className="h-7 min-h-7 text-sm flex-1 min-w-0" placeholder="Filter runs" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter runs" />
          <label className="flex items-center gap-1 text-xs text-muted whitespace-nowrap">
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed
          </label>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {shown.map((r) => (
          <button key={r.id} onClick={() => onSelect(r.id)} className={cx('w-full text-left px-3 py-2 border-b border-line/60', active === r.id ? 'bg-accent/10' : 'hover:bg-hover')}>
            <div className="text-sm truncate">{r.name}</div>
            <RunMiniBar r={r} />
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
        {runs.length > 0 && !shown.length && <div className="p-3 text-sm text-muted">No runs match</div>}
      </div>
    </div>
  );
}
