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
  House,
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
import { ConsolePanel } from './ConsolePanel';
import { EnvQuickLook } from './EnvQuickLook';
import { promptText, useApp, type ViewId, type DialogRequest } from '../store';
import { AiGeneratedNotice, ErrorPanel } from './Results';
import { Badge, Button, cx, IconButton, Input, Kbd, Modal, Spinner, Tooltip } from './ui';
import { Toaster as SonnerToaster } from 'sonner';

export const NAV: Array<{ id: ViewId; label: string; icon: ReactNode; group: string }> = [
  { id: 'home', label: 'Home', icon: <House size={18} />, group: 'Start' },
  { id: 'rest', label: 'REST', icon: <Network size={18} />, group: 'Protocols' },
  { id: 'graphql', label: 'GraphQL', icon: <GitBranch size={18} />, group: 'Protocols' },
  { id: 'websocket', label: 'WebSocket', icon: <Radio size={18} />, group: 'Protocols' },
  { id: 'mcp', label: 'MCP', icon: <Plug size={18} />, group: 'Protocols' },
  { id: 'ai', label: 'AI Lab', icon: <Sparkles size={18} />, group: 'AI' },
  { id: 'evaluations', label: 'Evaluations', icon: <FlaskConical size={18} />, group: 'AI' },
  { id: 'tests', label: 'Tests', icon: <ShieldCheck size={18} />, group: 'Automation' },
  { id: 'load', label: 'Load', icon: <Gauge size={18} />, group: 'Automation' },
  { id: 'traces', label: 'Traces', icon: <Activity size={18} />, group: 'Observe' },
  { id: 'collections', label: 'Collections', icon: <FolderTree size={18} />, group: 'Workspace' },
  { id: 'history', label: 'History', icon: <History size={18} />, group: 'Workspace' },
  { id: 'environments', label: 'Envs', icon: <KeyRound size={18} />, group: 'Workspace' },
];

export function Sidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const item = (id: ViewId, label: string, icon: ReactNode, shortcut?: string) => (
    <Tooltip content={shortcut ? `${label}  ·  ${shortcut}` : label} side="right">
      <button
        onClick={() => setView(id)}
        aria-current={view === id ? 'page' : undefined}
        aria-label={label}
        className={cx(
          'group w-full flex flex-col items-center gap-1 py-2 rounded-lg text-[0.74rem] font-medium transition-colors duration-150',
          view === id ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg hover:bg-hover',
        )}
      >
        <span className="transition-transform duration-150 group-active:scale-90">{icon}</span>
        <span className="w-full truncate px-0.5 text-center leading-tight">{label}</span>
      </button>
    </Tooltip>
  );
  return (
    <nav aria-label="Main navigation" className="w-[84px] shrink-0 border-r border-line bg-panel flex flex-col items-stretch gap-0.5 px-1.5 py-2 overflow-y-auto overflow-x-hidden">
      {NAV.map((n, i) => (
        <div key={n.id}>
          {i > 0 && NAV[i - 1]!.group !== n.group && <div className="mx-2 my-1.5 border-t border-line" />}
          {item(n.id, n.label, n.icon, i < 9 ? `${modKey}+Alt+${i + 1}` : undefined)}
        </div>
      ))}
      <div className="mt-auto pt-2">{item('settings', 'Settings', <Settings size={18} />, `${modKey}+,`)}</div>
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
      <button onClick={() => setOpen(!open)} className={cx('flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-hover text-sm font-medium max-w-64 transition-colors', open && 'bg-hover')} aria-haspopup="menu" aria-expanded={open}>
        <Layers size={14} className="text-muted" />
        <span className="truncate">{ws?.name ?? 'No workspace'}</span>
        <ChevronDown size={13} className="text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 top-9 z-40 w-72 rounded-lg border border-line bg-bg shadow-lg p-1 text-sm animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150">
            <div className="px-2 py-1 text-[0.7rem] uppercase tracking-wider text-muted">Workspaces</div>
            {list.map((w) => (
              <button key={w.id} className="w-full text-left px-2 h-8 rounded-md hover:bg-hover transition-colors flex items-center gap-2" onClick={() => act(() => call('ws.open', { ref: w.path }))}>
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
                'Import…',
                () => {
                  // a workspace export opens as a new workspace; Postman / OpenAPI / HAR files are added to this one
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.json,.yaml,.yml,.har';
                  input.onchange = async () => {
                    const f = input.files?.[0];
                    if (!f) return;
                    let r: { kind: string; name?: string; format?: string; collection?: string; environment?: string; workspace?: string } | undefined;
                    await act(async () => (r = await call('ws.importFile', { text: await f.text() })));
                    if (r?.kind === 'workspace') toast(`Workspace "${r.name}" imported and opened`, 'success');
                    else if (r) {
                      const what = [r.collection && `collection "${r.collection}"`, r.environment && `environment "${r.environment}"`].filter(Boolean).join(' and ');
                      toast(`Imported ${what || r.format} (${r.format}) into "${r.workspace}"`, 'success');
                      useApp.getState().openIntent('collections', {});
                    }
                  };
                  input.click();
                },
              ],
              [
                'Delete a workspace…',
                async () => {
                  const other = list.filter((w) => w.path !== ws?.path);
                  const target = await promptText('Delete a workspace', { message: 'Type the name of the workspace to delete permanently', detail: other.length ? `Workspaces: ${other.map((w) => w.name).join(', ')}` : 'There are no other workspaces (the open one cannot be deleted).', okLabel: 'Continue' });
                  const w = other.find((x) => x.name === target);
                  if (w && confirm(`Permanently delete "${w.name}" and all its files?`)) void act(() => call('ws.delete', { ref: w.path }), 'Workspace deleted');
                },
              ],
            ].map(([label, fn]) => (
              <button key={label as string} className="w-full text-left px-2 h-8 rounded-md hover:bg-hover transition-colors pl-7" onClick={fn as () => void}>
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

/** Postman-style environment switcher with a coloured dot (red for production). */
export function EnvironmentPicker() {
  const ws = useApp((s) => s.workspace);
  const env = useApp((s) => s.environment);
  const envObj = ws?.environments.find((e) => e.name === env);
  const dot = envObj ? (envObj.color ?? (envObj.isProduction ? 'var(--bad)' : 'var(--ok)')) : 'var(--line-strong)';
  return (
    <Tooltip content="Active environment">
      <label className={cx('relative flex items-center h-8 rounded-md border bg-bg shadow-sm transition-colors', envObj?.isProduction ? 'border-bad/50' : 'border-line-strong hover:border-muted/50')}>
        <span className="absolute left-2.5 w-2 h-2 rounded-full pointer-events-none" style={{ background: dot }} />
        <select
          aria-label="Environment"
          className="appearance-none bg-transparent outline-none h-full pl-6 pr-7 text-sm cursor-pointer max-w-52 truncate"
          style={{ backgroundImage: 'var(--select-chevron)', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
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
      </label>
    </Tooltip>
  );
}

export function TopBar() {
  const set = useApp((s) => s.set);
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
  return (
    <header className="h-12 shrink-0 border-b border-line flex items-center gap-2 px-3 bg-bg" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex items-center gap-2 pr-1" style={noDrag}>
        <img src={logoUrl} alt="" className="h-7 w-7" />
        <span className="font-semibold tracking-tight hidden md:inline">FluxPion</span>
      </div>
      <span className="h-5 w-px bg-line hidden md:block" />
      <div style={noDrag}>
        <WorkspaceMenu />
      </div>
      <button
        onClick={() => set({ searchOpen: true })}
        style={noDrag}
        className="mx-auto flex items-center gap-2 h-8 w-[min(460px,38vw)] rounded-lg border border-line bg-panel px-3 text-sm text-muted transition-colors hover:border-line-strong hover:bg-hover"
      >
        <Search size={15} />
        <span className="truncate">Search requests, tests, tools, traces…</span>
        <span className="ml-auto hidden sm:inline">
          <Kbd>{modKey}+Shift+F</Kbd>
        </span>
      </button>
      <div className="flex items-center gap-1.5" style={noDrag}>
        <EnvironmentPicker />
        <EnvQuickLook />
        <Button size="md" variant="ghost" onClick={() => set({ paletteOpen: true })} icon={<TerminalSquare size={15} />}>
          <span className="hidden lg:inline">Commands</span> <Kbd>{modKey}+K</Kbd>
        </Button>
        <IconButton label="AI assistant" onClick={() => set({ assistant: { task: 'free', title: 'Ask the assistant', context: {} } })}>
          <Bot size={17} />
        </IconButton>
        <IconButton label="Settings" onClick={() => useApp.getState().setView('settings')}>
          <Settings size={17} />
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
  const bottomTab = useApp((s) => s.bottomTab);
  const envObj = ws?.environments.find((e) => e.name === env);
  const acts = Object.values(activity);
  return (
    <footer className="h-7 shrink-0 border-t border-line bg-panel flex items-center gap-4 px-3 text-[0.75rem] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: envObj ? (envObj.color ?? (envObj.isProduction ? 'var(--bad)' : 'var(--ok)')) : 'var(--line-strong)' }} />
        {env ?? 'No environment'}
        {envObj?.isProduction && <Badge tone="bad">PRODUCTION</Badge>}
      </span>
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
      {(['console', 'logs'] as const).map((t) => (
        <button
          key={t}
          className={cx('flex items-center gap-1 hover:text-fg', logsOpen && bottomTab === t && 'text-fg')}
          title={t === 'console' ? 'Console: requests and script output (Ctrl+Alt+C)' : 'Application logs'}
          onClick={() => useApp.getState().set(logsOpen && bottomTab === t ? { logsOpen: false } : { logsOpen: true, bottomTab: t })}
        >
          {t === 'console' ? <TerminalSquare size={12} /> : <ScrollText size={12} />} {t === 'console' ? 'Console' : 'Logs'}
        </button>
      ))}
    </footer>
  );
}

/** The bottom panel: Postman-style Console and the application logs. */
export function LogsPanel() {
  const tab = useApp((s) => s.bottomTab);
  return (
    <div className="h-60 border-t border-line bg-panel flex flex-col shrink-0">
      <div className="flex items-center gap-1 px-2 h-8 border-b border-line text-xs shrink-0">
        {(['console', 'logs'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={cx('px-2 h-6 rounded-md font-medium', tab === t ? 'bg-hover text-fg' : 'text-muted hover:text-fg')} onClick={() => useApp.getState().set({ bottomTab: t })}>
            {t === 'console' ? 'Console' : 'Logs'}
          </button>
        ))}
        <IconButton label="Close panel" className="ml-auto" onClick={() => useApp.getState().set({ logsOpen: false })}>
          <X size={13} />
        </IconButton>
      </div>
      {tab === 'console' ? <ConsolePanel /> : <AppLogs />}
    </div>
  );
}

function AppLogs() {
  const [logs, setLogs] = useState<Array<{ time: string; level: string; scope: string; message: string; data?: unknown }>>([]);
  const [level, setLevel] = useState('ALL');
  useEffect(() => {
    void call('logs.recent').then(setLogs);
    return on('log', (rec) => setLogs((l) => [...l.slice(-499), rec]));
  }, []);
  const shown = logs.filter((l) => level === 'ALL' || l.level === level);
  return (
    <>
      <div className="flex items-center gap-2 px-3 h-7 border-b border-line text-xs shrink-0">
        <span className="text-muted">Application logs · secrets are always redacted</span>
        <select className="ml-auto bg-transparent" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Log level">
          {['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-auto mono text-[0.8rem] px-3 py-1">
        {shown.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap">
            <span className="text-muted">{l.time.slice(11, 23)}</span> <span className={cx(l.level === 'ERROR' && 'text-bad', l.level === 'WARN' && 'text-warn')}>{l.level.padEnd(5)}</span> {l.message}
            {l.data !== undefined && <span className="text-muted"> {JSON.stringify(l.data)}</span>}
          </div>
        ))}
      </div>
    </>
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
  const theme = useApp((s) => s.settings?.theme ?? 'system');
  return (
    <SonnerToaster
      position="bottom-right"
      offset={40}
      theme={theme}
      richColors
      closeButton
      toastOptions={{ className: 'font-sans', style: { fontSize: '0.9rem' } }}
    />
  );
}

/** Renders the pending `ask()` dialog, if any. */
export function DialogHost() {
  const d = useApp((s) => s.dialog);
  return d ? <DialogView key={d.title + d.message} d={d} /> : null;
}

function DialogView({ d }: { d: DialogRequest }) {
  const [value, setValue] = useState(d.input?.value ?? '');
  const primary = d.buttons.find((b) => b.variant === 'primary');
  return (
    <Modal
      title={d.title}
      onClose={() => d.resolve(d.cancelId, value)}
      width={d.input ? 440 : 520}
      footer={d.buttons.map((b) => (
        <Button key={b.id} variant={b.variant ?? 'default'} autoFocus={!d.input && b.variant === 'primary'} disabled={!!d.input && b === primary && !value.trim()} onClick={() => d.resolve(b.id, value)}>
          {b.label}
        </Button>
      ))}
    >
      {d.message && <p className="text-sm font-medium">{d.message}</p>}
      {d.detail && <p className="text-sm text-muted whitespace-pre-line mt-3 max-h-72 overflow-auto">{d.detail}</p>}
      {d.input && (
        <Input
          autoFocus
          className={cx('w-full', (d.message || d.detail) && 'mt-3')}
          value={value}
          placeholder={d.input.placeholder}
          aria-label={d.title}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && primary && value.trim()) d.resolve(primary.id, value);
          }}
        />
      )}
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
