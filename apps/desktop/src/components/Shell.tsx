import {
  Activity,
  BookOpen,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Cpu,
  FlaskConical,
  FolderTree,
  Gauge,
  GitBranch,
  History,
  KeyRound,
  Layers,
  Network,
  Plug,
  Plus,
  Radio,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { call, asError, modKey, on } from '../api';
import logoUrl from '../../build/logo.svg';
import { useApp, type ViewId } from '../store';
import { AiGeneratedNotice, ErrorPanel } from './Results';
import { Badge, Button, cx, IconButton, Input, Kbd, Modal, Spinner } from './ui';

export const NAV: Array<{ id: ViewId; label: string; icon: ReactNode; group: string }> = [
  { id: 'rest', label: 'REST', icon: <Network size={17} />, group: 'Protocols' },
  { id: 'graphql', label: 'GraphQL', icon: <GitBranch size={17} />, group: 'Protocols' },
  { id: 'websocket', label: 'WebSocket', icon: <Radio size={17} />, group: 'Protocols' },
  { id: 'mcp', label: 'MCP', icon: <Plug size={17} />, group: 'Protocols' },
  { id: 'ai', label: 'AI Lab', icon: <Sparkles size={17} />, group: 'AI' },
  { id: 'evaluations', label: 'Evaluations', icon: <FlaskConical size={17} />, group: 'AI' },
  { id: 'tests', label: 'Tests', icon: <ShieldCheck size={17} />, group: 'Automation' },
  { id: 'load', label: 'Load', icon: <Gauge size={17} />, group: 'Automation' },
  { id: 'traces', label: 'Traces', icon: <Activity size={17} />, group: 'Observe' },
  { id: 'collections', label: 'Collections', icon: <FolderTree size={17} />, group: 'Workspace' },
  { id: 'history', label: 'History', icon: <History size={17} />, group: 'Workspace' },
  { id: 'environments', label: 'Envs', icon: <KeyRound size={17} />, group: 'Workspace' },
];

export function Sidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  return (
    <nav aria-label="Main navigation" className="w-[76px] shrink-0 border-r border-line bg-panel flex flex-col items-stretch py-1 overflow-y-auto overflow-x-hidden">
      {NAV.map((n, i) => (
        <div key={n.id}>
          {i > 0 && NAV[i - 1]!.group !== n.group && <div className="mx-3 my-1 border-t border-line" />}
          <button
            onClick={() => setView(n.id)}
            aria-current={view === n.id ? 'page' : undefined}
            title={n.label}
            className={cx('w-full flex flex-col items-center gap-0.5 py-1.5 text-[0.66rem] relative', view === n.id ? 'text-accent' : 'text-muted hover:text-fg')}
          >
            {view === n.id && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
            {n.icon}
            <span className="w-full truncate px-0.5 text-center">{n.label}</span>
          </button>
        </div>
      ))}
      <div className="mt-auto">
        <button onClick={() => setView('settings')} className={cx('w-full flex flex-col items-center gap-0.5 py-2 text-[0.68rem]', view === 'settings' ? 'text-accent' : 'text-muted hover:text-fg')}>
          <Settings size={17} />
          Settings
        </button>
      </div>
    </nav>
  );
}

function WorkspaceMenu() {
  const ws = useApp((s) => s.workspace);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [creating, setCreating] = useState<null | 'create' | 'rename' | 'duplicate'>(null);
  const [name, setName] = useState('');
  const { toast, refreshWorkspace } = useApp.getState();
  useEffect(() => {
    if (open) void call('ws.list').then(setList);
  }, [open]);
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      await refreshWorkspace();
      if (msg) toast(msg, 'success');
      setOpen(false);
    } catch (e) {
      toast(asError(e).message, 'error');
    }
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-hover text-sm font-medium max-w-64" aria-haspopup="menu">
        <Layers size={14} className="text-muted" />
        <span className="truncate">{ws?.name ?? 'No workspace'}</span>
        <ChevronDown size={13} className="text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 top-8 z-40 w-72 rounded-lg border border-line bg-bg shadow-xl p-1 text-sm">
            <div className="px-2 py-1 text-[0.7rem] uppercase tracking-wider text-muted">Workspaces</div>
            {list.map((w) => (
              <button key={w.id} className="w-full text-left px-2 py-1.5 rounded hover:bg-hover flex items-center gap-2" onClick={() => act(() => call('ws.open', { ref: w.path }))}>
                <span className="w-3.5">{w.path === ws?.path && <Check size={13} className="text-accent" />}</span>
                <span className="truncate">{w.name}</span>
              </button>
            ))}
            <div className="border-t border-line my-1" />
            {[
              ['New workspace…', () => (setName(''), setCreating('create'))],
              ['Rename…', () => (setName(ws?.name ?? ''), setCreating('rename'))],
              ['Duplicate…', () => (setName(`${ws?.name} copy`), setCreating('duplicate'))],
              ['Open folder…', () => act(() => call('ws.open', {}))],
              ['Export workspace…', () => act(() => call('ws.export'), 'Workspace exported (secrets excluded)')],
              [
                'Import workspace…',
                () => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.json';
                  input.onchange = async () => {
                    const f = input.files?.[0];
                    if (f) await act(async () => call('ws.import', { bundle: JSON.parse(await f.text()) }), 'Workspace imported');
                  };
                  input.click();
                },
              ],
              [
                'Delete a workspace…',
                () => {
                  const other = list.filter((w) => w.path !== ws?.path);
                  const target = prompt(`Type the name of the workspace to delete permanently:\n${other.map((w) => `• ${w.name}`).join('\n')}`);
                  const w = other.find((x) => x.name === target);
                  if (w && confirm(`Permanently delete "${w.name}" and all its files?`)) void act(() => call('ws.delete', { ref: w.path }), 'Workspace deleted');
                },
              ],
            ].map(([label, fn]) => (
              <button key={label as string} className="w-full text-left px-2 py-1.5 rounded hover:bg-hover pl-7" onClick={fn as () => void}>
                {label as string}
              </button>
            ))}
          </div>
        </>
      )}
      {creating && (
        <Modal
          title={creating === 'create' ? 'New workspace' : creating === 'rename' ? 'Rename workspace' : 'Duplicate workspace'}
          onClose={() => setCreating(null)}
          width={420}
          footer={
            <>
              <Button onClick={() => setCreating(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!name.trim()}
                onClick={() => {
                  const n = name.trim();
                  setCreating(null);
                  if (creating === 'create') void act(() => call('ws.create', { name: n }), 'Workspace created');
                  else if (creating === 'rename') void act(() => call('ws.update', { name: n }), 'Renamed');
                  else void act(async () => call('ws.open', { ref: (await call('ws.duplicate', { ref: ws!.path, name: n })).path }), 'Workspace duplicated');
                }}
              >
                {creating === 'create' ? 'Create' : creating === 'rename' ? 'Rename' : 'Duplicate'}
              </Button>
            </>
          }
        >
          <Input autoFocus className="w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name" />
        </Modal>
      )}
    </div>
  );
}

export function TopBar() {
  const set = useApp((s) => s.set);
  return (
    <header className="h-10 shrink-0 border-b border-line flex items-center gap-2 px-2 bg-bg" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex items-center gap-2 pl-1 pr-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <img src={logoUrl} alt="" className="h-6 w-6" />
        <span className="font-semibold text-sm hidden md:inline">Protolens</span>
      </div>
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <WorkspaceMenu />
      </div>
      <button
        onClick={() => set({ searchOpen: true })}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="mx-auto flex items-center gap-2 h-7 w-[min(440px,40vw)] rounded-md border border-line bg-panel px-2.5 text-sm text-muted hover:border-accent/50"
      >
        <Search size={14} />
        <span>Search requests, tests, tools, traces…</span>
        <span className="ml-auto">
          <Kbd>{modKey}+Shift+F</Kbd>
        </span>
      </button>
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Button size="sm" variant="ghost" onClick={() => set({ paletteOpen: true })} icon={<TerminalSquare size={14} />}>
          <span className="hidden lg:inline">Commands</span> <Kbd>{modKey}+K</Kbd>
        </Button>
        <IconButton label="AI assistant" onClick={() => set({ assistant: { task: 'free', title: 'Ask the assistant', context: {} } })}>
          <Bot size={16} />
        </IconButton>
        <IconButton label="Settings" onClick={() => useApp.getState().setView('settings')}>
          <Settings size={16} />
        </IconButton>
      </div>
    </header>
  );
}

export function StatusBar() {
  const ws = useApp((s) => s.workspace);
  const env = useApp((s) => s.environment);
  const activity = useApp((s) => s.activity);
  const info = useApp((s) => s.info);
  const mcp = useApp((s) => s.mcpConnected);
  const logsOpen = useApp((s) => s.logsOpen);
  const envObj = ws?.environments.find((e) => e.name === env);
  const acts = Object.values(activity);
  return (
    <footer className="h-7 shrink-0 border-t border-line bg-panel flex items-center gap-4 px-3 text-xs text-muted">
      <label className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: envObj?.color ?? (envObj?.isProduction ? 'var(--bad)' : 'var(--ok)') }} />
        <select
          aria-label="Environment"
          className="bg-transparent outline-none hover:text-fg cursor-pointer"
          value={env ?? ''}
          onChange={(e) => useApp.getState().setEnvironment(e.target.value || undefined)}
        >
          <option value="">No environment</option>
          {ws?.environments.map((e) => (
            <option key={e.id} value={e.name}>
              {e.name}
              {e.isProduction ? ' (production)' : ''}
            </option>
          ))}
        </select>
        {envObj?.isProduction && <Badge tone="bad">PRODUCTION</Badge>}
      </label>
      <span className="flex items-center gap-1" title="Connected MCP servers">
        <Plug size={12} /> {mcp} connected
      </span>
      <span className="flex items-center gap-1.5">
        {acts.length ? (
          <>
            <Spinner size={11} /> {acts[0]}
            {acts.length > 1 ? ` (+${acts.length - 1})` : ''}
          </>
        ) : (
          <>
            <Cpu size={12} /> Idle
          </>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1" title={`Secrets are stored with ${info?.secretBackend}`}>
        <KeyRound size={12} /> {info?.secretBackend}
      </span>
      <span title="Metadata storage">{info?.metaBackend === 'sqlite' ? 'SQLite' : info?.metaBackend}</span>
      <button className={cx('flex items-center gap-1 hover:text-fg', logsOpen && 'text-fg')} onClick={() => useApp.getState().set({ logsOpen: !logsOpen })}>
        <ScrollText size={12} /> Logs
      </button>
    </footer>
  );
}

export function LogsPanel() {
  const [logs, setLogs] = useState<Array<{ time: string; level: string; scope: string; message: string; data?: unknown }>>([]);
  const [level, setLevel] = useState('ALL');
  useEffect(() => {
    void call('logs.recent').then(setLogs);
    return on('log', (rec) => setLogs((l) => [...l.slice(-499), rec]));
  }, []);
  const shown = logs.filter((l) => level === 'ALL' || l.level === level);
  return (
    <div className="h-48 border-t border-line bg-panel flex flex-col shrink-0">
      <div className="flex items-center gap-2 px-3 h-7 border-b border-line text-xs">
        <span className="font-medium">Logs</span>
        <span className="text-muted">secrets are always redacted</span>
        <select className="ml-auto bg-transparent" value={level} onChange={(e) => setLevel(e.target.value)}>
          {['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <IconButton label="Close logs" onClick={() => useApp.getState().set({ logsOpen: false })}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-auto mono text-[0.8rem] px-3 py-1">
        {shown.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap">
            <span className="text-muted">{l.time.slice(11, 23)}</span> <span className={cx(l.level === 'ERROR' && 'text-bad', l.level === 'WARN' && 'text-warn')}>{l.level.padEnd(5)}</span> {l.message}
            {l.data !== undefined && <span className="text-muted"> {JSON.stringify(l.data)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}

export function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const set = useApp((s) => s.set);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const filtered = useMemo(() => {
    const t = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => t.every((w) => c.label.toLowerCase().includes(w) || c.hint?.toLowerCase().includes(w)));
  }, [q, commands]);
  useEffect(() => setIdx(0), [q]);
  const close = () => set({ paletteOpen: false });
  const run = (c?: PaletteCommand) => {
    if (!c) return;
    close();
    c.run();
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Command palette" className="w-[560px] max-w-[92vw] rounded-lg border border-line bg-bg shadow-2xl overflow-hidden">
        <input
          autoFocus
          className="w-full h-11 px-4 bg-transparent outline-none border-b border-line"
          placeholder="Type a command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(filtered.length - 1, i + 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
            if (e.key === 'Enter') run(filtered[idx]);
          }}
        />
        <div role="listbox" className="max-h-[50vh] overflow-auto py-1">
          {filtered.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === idx}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(c)}
              className={cx('w-full text-left px-4 py-2 text-sm flex items-center', i === idx && 'bg-accent/10')}
            >
              {c.label}
              {c.hint && <span className="ml-auto text-xs text-muted">{c.hint}</span>}
            </button>
          ))}
          {!filtered.length && <div className="px-4 py-6 text-sm text-muted">No matching commands</div>}
        </div>
      </div>
    </div>
  );
}

interface SearchHit {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  ref: Record<string, string>;
}

export function SearchDialog() {
  const set = useApp((s) => s.set);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [idx, setIdx] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = q.trim() ? await call<SearchHit[]>('ws.search', { query: q }) : [];
      if (n === seq.current) {
        setHits(r);
        setIdx(0);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q]);
  const close = () => set({ searchOpen: false });
  const open = (h?: SearchHit) => {
    if (!h) return;
    close();
    const { openIntent } = useApp.getState();
    if (h.kind === 'request') openIntent('rest', { collectionId: h.ref.collectionId, requestId: h.ref.requestId });
    else if (h.kind === 'graphql') openIntent('graphql', { collectionId: h.ref.collectionId, requestId: h.ref.requestId });
    else if (h.kind === 'collection') openIntent('collections', { collectionId: h.ref.collectionId });
    else if (h.kind === 'test') openIntent('tests', { path: h.ref.testPath });
    else if (h.kind === 'environment-variable') openIntent('environments', { environmentId: h.ref.environmentId });
    else if (h.kind === 'mcp-server') openIntent('mcp', { serverId: h.ref.serverId });
    else if (h.kind === 'provider') openIntent('ai', { providerId: h.ref.providerId });
    else if (h.kind === 'history') openIntent('history', { historyId: h.ref.historyId });
    else if (h.kind === 'trace') openIntent('traces', { traceId: h.ref.traceId });
    else if (h.kind === 'run') openIntent('tests', { runId: h.ref.runId });
  };
  const icons: Record<string, ReactNode> = {
    request: <Network size={14} />,
    graphql: <GitBranch size={14} />,
    collection: <FolderTree size={14} />,
    test: <ShieldCheck size={14} />,
    'environment-variable': <KeyRound size={14} />,
    'mcp-server': <Plug size={14} />,
    provider: <Sparkles size={14} />,
    history: <History size={14} />,
    trace: <Activity size={14} />,
    run: <Boxes size={14} />,
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Search" className="w-[640px] max-w-[92vw] rounded-lg border border-line bg-bg shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Search size={16} className="text-muted" />
          <input
            autoFocus
            className="w-full h-11 bg-transparent outline-none"
            placeholder="Search the workspace"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(hits.length - 1, i + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
              if (e.key === 'Enter') open(hits[idx]);
            }}
          />
        </div>
        <div className="max-h-[55vh] overflow-auto py-1" role="listbox">
          {hits.map((h, i) => (
            <button key={`${h.kind}:${h.id}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => open(h)} className={cx('w-full text-left px-4 py-2 flex items-center gap-3', i === idx && 'bg-accent/10')}>
              <span className="text-muted">{icons[h.kind]}</span>
              <span className="min-w-0">
                <div className="text-sm truncate">{h.title}</div>
                {h.subtitle && <div className="text-xs text-muted truncate">{h.subtitle}</div>}
              </span>
              <span className="ml-auto text-[0.7rem] text-muted">{h.kind}</span>
            </button>
          ))}
          {q && !hits.length && <div className="px-4 py-6 text-sm text-muted">No results</div>}
          {!q && <div className="px-4 py-6 text-sm text-muted">Searches requests, collections, tests, GraphQL operations, MCP servers, providers, environment variables, history, traces and runs.</div>}
        </div>
      </div>
    </div>
  );
}

/** AI assistant drawer. Output is always labelled as an AI-generated suggestion. */
export function AssistantPanel() {
  const req = useApp((s) => s.assistant)!;
  const set = useApp((s) => s.set);
  const [question, setQuestion] = useState(req.question ?? '');
  const [answer, setAnswer] = useState<{ text: string; provider: string; model: string } | undefined>();
  const [error, setError] = useState<ReturnType<typeof asError>>();
  const [loading, setLoading] = useState(false);
  const env = useApp((s) => s.environment);
  const ask = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setAnswer(await call('assistant.ask', { task: req.task, context: req.context, question, environment: env }));
    } catch (e) {
      setError(asError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (req.task !== 'free') void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);
  return (
    <aside className="w-[420px] shrink-0 border-l border-line bg-bg flex flex-col" aria-label="AI assistant">
      <div className="h-10 flex items-center gap-2 px-3 border-b border-line">
        <Bot size={16} className="text-judge" />
        <span className="font-medium text-sm truncate">{req.title}</span>
        <IconButton label="Close assistant" className="ml-auto" onClick={() => set({ assistant: undefined })}>
          <X size={15} />
        </IconButton>
      </div>
      <AiGeneratedNotice />
      <div className="flex-1 overflow-auto p-3 text-sm">
        {loading && (
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> Thinking…
          </div>
        )}
        {error && <ErrorPanel error={error} />}
        {answer && (
          <>
            <pre className="whitespace-pre-wrap font-sans leading-relaxed">{answer.text}</pre>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted">
              <Badge tone="judge">
                <BookOpen size={10} /> {answer.provider} · {answer.model}
              </Badge>
              <button className="hover:text-fg" onClick={() => navigator.clipboard.writeText(answer.text)}>
                Copy
              </button>
            </div>
          </>
        )}
        {!loading && !answer && !error && req.task === 'free' && <p className="text-muted">Ask about an API error, a GraphQL schema, an MCP tool, or how to write a test. Context from the current view is included when available.</p>}
      </div>
      <div className="p-3 border-t border-line flex gap-2">
        <Input className="flex-1" placeholder="Ask a follow-up…" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
        <Button variant="primary" onClick={ask} loading={loading} icon={<Plus size={0} className="hidden" />}>
          Ask
        </Button>
      </div>
    </aside>
  );
}

export function Toaster() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="fixed bottom-10 right-4 z-[60] flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'rounded-md border px-3 py-2 text-sm shadow-lg max-w-sm bg-bg',
            t.kind === 'error' && 'border-bad/50 text-bad',
            t.kind === 'success' && 'border-ok/50',
            t.kind === 'info' && 'border-line',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Renders the pending `ask()` dialog, if any. */
export function DialogHost() {
  const d = useApp((s) => s.dialog);
  if (!d) return null;
  return (
    <Modal
      title={d.title}
      onClose={() => d.resolve(d.cancelId)}
      width={520}
      footer={d.buttons.map((b) => (
        <Button key={b.id} variant={b.variant ?? 'default'} autoFocus={b.variant === 'primary'} onClick={() => d.resolve(b.id)}>
          {b.label}
        </Button>
      ))}
    >
      <p className="text-sm font-medium">{d.message}</p>
      {d.detail && <p className="text-sm text-muted whitespace-pre-line mt-3 max-h-72 overflow-auto">{d.detail}</p>}
    </Modal>
  );
}

/** Blocking progress overlay (updates). */
export function ProgressHost() {
  const p = useApp((s) => s.progress);
  if (!p) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 grid place-items-center" role="alertdialog" aria-label={p.title}>
      <div className="w-[420px] rounded-lg border border-line bg-bg p-5 shadow-2xl">
        <div className="font-semibold">{p.title}</div>
        <div className="text-sm text-muted mt-1">{p.message}</div>
        <div className="mt-4 h-2 rounded bg-panel2 relative overflow-hidden">
          {p.fraction === null ? <div className="absolute inset-0 indeterminate" /> : <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(p.fraction * 100)}%` }} />}
        </div>
      </div>
    </div>
  );
}
