import {
  AlarmClock,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FlaskConical,
  FolderPlus,
  FolderTree,
  Gauge,
  KeyRound,
  PanelLeftClose,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  ScanSearch,
  GitCompare,
  Settings2,
  Sparkles,
  Upload,
  Waypoints,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { asError, call, on } from '../api';
import { promptText, useApp, type ViewId } from '../store';
import type { Collection, Library, McpServerConfig } from '../types';
import { plural, uid } from '../lib/format';
import { addToFolder, CollectionTree } from './CollectionTree';
import { Badge, cx, Empty, IconButton, Input, Menu, Tooltip } from './ui';

/** Saved items of the other protocols (library/<kind>.json) and the view that opens them. */
const SAVED_KINDS: Array<{ kind: string; label: string; view: ViewId; icon: ReactNode }> = [
  { kind: 'grpc', label: 'gRPC requests', view: 'grpc', icon: <Waypoints size={13} /> },
  { kind: 'websocket', label: 'WebSocket connections', view: 'websocket', icon: <Radio size={13} /> },
  { kind: 'ai-prompts', label: 'AI prompts', view: 'ai', icon: <Sparkles size={13} /> },
  { kind: 'evaluations', label: 'Evaluations', view: 'evaluations', icon: <FlaskConical size={13} /> },
  { kind: 'load-tests', label: 'Load tests', view: 'load', icon: <Gauge size={13} /> },
];

interface MonitorRow {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  lastResult?: { status: string };
}

const openKey = 'aps.explorer.sections';
function useOpenSections() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(openKey) ?? '{}');
    } catch {
      return {};
    }
  });
  const toggle = (id: string, def: boolean) =>
    setOpen((o) => {
      const next = { ...o, [id]: !(o[id] ?? def) };
      try {
        localStorage.setItem(openKey, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return { isOpen: (id: string, def = true) => open[id] ?? def, toggle };
}

/** A collapsible section: chevron, uppercase title, count, and actions on hover (Postman's workspace sidebar). */
function Section({ id, title, count, actions, children, def = true, sections, forceOpen }: { id: string; title: string; count?: number; actions?: ReactNode; children: ReactNode; def?: boolean; sections: ReturnType<typeof useOpenSections>; forceOpen?: boolean }) {
  const open = forceOpen || sections.isOpen(id, def);
  return (
    <div className="border-b border-line/60">
      <div className="group flex items-center h-8 pl-1.5 pr-1 sticky top-0 bg-panel z-10">
        <button className="flex items-center gap-1 flex-1 min-w-0 text-left" onClick={() => sections.toggle(id, def)} aria-expanded={open}>
          {open ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
          <span className="text-[11px] font-semibold tracking-wider uppercase text-muted truncate">{title}</span>
          {count !== undefined && count > 0 && <span className="text-[0.68rem] text-muted tabular-nums">{count}</span>}
        </button>
        <div className="flex items-center opacity-60 group-hover:opacity-100 focus-within:opacity-100">{actions}</div>
      </div>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

function Row({ icon, label, sub, onClick, badge, title, active }: { icon?: ReactNode; label: string; sub?: string; onClick(): void; badge?: ReactNode; title?: string; active?: boolean }) {
  return (
    <button title={title} onClick={onClick} className={cx('w-[calc(100%-0.5rem)] mx-1 flex items-center gap-2 h-7 px-2 rounded-md text-sm text-left transition-colors', active ? 'bg-accent-soft' : 'hover:bg-hover')}>
      {icon && <span className="text-muted shrink-0">{icon}</span>}
      <span className="truncate flex-1">{label}</span>
      {sub && <span className="text-xs text-muted truncate max-w-[40%]">{sub}</span>}
      {badge}
    </button>
  );
}

/**
 * The Collections explorer: everything saved in the workspace in one place, next to the navigation rail and
 * available in every view. Collections (REST and GraphQL), saved gRPC / WebSocket / AI / evaluation / load
 * items, MCP servers, environments, API specs and monitors; clicking an item opens it in its editor.
 */
export function Explorer() {
  const ws = useApp((s) => s.workspace);
  const env = useApp((s) => s.environment);
  const sections = useOpenSections();
  const [filter, setFilter] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [libs, setLibs] = useState<Record<string, Library<unknown>>>({});
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  const [monitors, setMonitors] = useState<MonitorRow[]>([]);

  const load = useCallback(async () => {
    const quiet = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const [c, s, sp, m, ...ls] = await Promise.all([
      quiet(call<Collection[]>('col.list'), []),
      quiet(call<McpServerConfig[]>('mcp.servers'), []),
      quiet(call<string[]>('openapi.specs'), []),
      quiet(call<MonitorRow[]>('monitor.list'), []),
      ...SAVED_KINDS.map((k) => quiet(call<Library<unknown>>('lib.get', { kind: k.kind }), { folders: [], items: [] })),
    ]);
    setCollections(c.filter((x) => !x.problem));
    setServers(s);
    setSpecs(sp);
    setMonitors(m);
    setLibs(Object.fromEntries(SAVED_KINDS.map((k, i) => [k.kind, ls[i]!])));
  }, []);
  useEffect(() => {
    void load();
  }, [load, ws?.id]);
  // anything that saves collections, saved items, environments or monitors (in any view) refreshes the list
  useEffect(() => on('data.changed', () => void load()), [load]);

  const f = filter.trim().toLowerCase();
  const match = (...t: Array<string | undefined>) => !f || t.some((x) => x?.toLowerCase().includes(f));
  const savedGroups = useMemo(
    () => SAVED_KINDS.map((k) => ({ ...k, items: (libs[k.kind]?.items ?? []).filter((i) => match(i.name, i.folder)) })).filter((g) => g.items.length || (!f && (libs[g.kind]?.items.length ?? 0) > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [libs, f],
  );
  const shownServers = servers.filter((s) => match(s.name, s.transport));
  const shownEnvs = (ws?.environments ?? []).filter((e) => match(e.name));
  const shownSpecs = specs.filter((s) => match(s));
  const shownMonitors = monitors.filter((m) => match(m.name));
  const savedCount = SAVED_KINDS.reduce((a, k) => a + (libs[k.kind]?.items.length ?? 0), 0);

  const saveCollection = async (c: Collection) => {
    try {
      await call('col.save', c);
      await load();
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const newCollection = async () => {
    const name = await promptText('New collection', { message: 'Collection name', placeholder: 'My API', okLabel: 'Create' });
    if (name) await saveCollection({ schemaVersion: '1.0', id: uid('col-'), name, version: 0, variables: [], items: [], updatedAt: '' });
  };
  const newEnvironment = async () => {
    const name = await promptText('New environment', { placeholder: 'Staging', okLabel: 'Create' });
    if (!name) return;
    const id = uid('env-');
    await call('env.save', { env: { id, name, variables: [{ key: 'baseUrl', value: '' }] } });
    await useApp.getState().refreshWorkspace();
    useApp.getState().openIntent('environments', { environmentId: id });
  };
  const intent = useApp.getState().openIntent;

  return (
    <aside aria-label="Collections explorer" className="w-[272px] shrink-0 border-r border-line bg-panel flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 h-10 border-b border-line shrink-0">
        <FolderTree size={15} className="text-accent shrink-0" />
        <span className="font-semibold text-sm flex-1 truncate">Collections</span>
        <Menu
          width={220}
          trigger={
            <IconButton label="New" className="h-7 w-7">
              <Plus size={15} />
            </IconButton>
          }
          items={[
            { label: 'Collection', icon: <FolderPlus size={14} />, onSelect: () => void newCollection() },
            { label: 'HTTP request', icon: <Plus size={14} />, onSelect: () => intent('rest', { newTab: true }) },
            { label: 'GraphQL request', icon: <Plus size={14} />, onSelect: () => intent('graphql', { reset: true }) },
            { label: 'Environment', icon: <KeyRound size={14} />, separator: true, onSelect: () => void newEnvironment() },
            { label: 'MCP server', icon: <Plug size={14} />, onSelect: () => intent('mcp', { addServer: true }) },
            { label: 'Monitor', icon: <AlarmClock size={14} />, onSelect: () => useApp.getState().setView('monitors') },
          ]}
        />
        <IconButton label="Import (OpenAPI, Postman, Insomnia, Bruno, HAR …)" className="h-7 w-7" onClick={() => intent('collections', { import: true })}>
          <Upload size={14} />
        </IconButton>
        <IconButton label="Export (collections, workspace)" className="h-7 w-7" onClick={() => intent('collections', {})}>
          <Download size={14} />
        </IconButton>
        <IconButton label="Refresh" className="h-7 w-7" onClick={() => void load()}>
          <RefreshCw size={13} />
        </IconButton>
        <IconButton label="Hide the explorer (Ctrl+B)" className="h-7 w-7" onClick={() => useApp.getState().toggleExplorer(false)}>
          <PanelLeftClose size={14} />
        </IconButton>
      </div>
      <div className="p-2 shrink-0">
        <Input className="w-full h-7 min-h-7 text-sm" placeholder="Filter everything" aria-label="Filter collections, saved items and environments" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="flex-1 overflow-auto">
        <Section
          id="collections"
          title="Collections"
          count={collections.length}
          sections={sections}
          forceOpen={!!f}
          actions={
            <IconButton label="New collection" className="h-6 w-6" onClick={() => void newCollection()}>
              <Plus size={13} />
            </IconButton>
          }
        >
          {collections.length ? (
            <CollectionTree
              collections={collections}
              filter={filter}
              onOpen={(c, n) => intent(n.kind === 'graphql' ? 'graphql' : 'rest', { collectionId: c.id, requestId: n.id })}
              onChange={(c) => void saveCollection(c)}
              onRun={(c, folderId) => intent('collections', { collectionId: c.id, run: true, folderId })}
              onNewRequest={(c, folderId) => {
                const node = { kind: 'http' as const, id: uid('req-'), name: 'New request', request: { method: 'GET', url: '{{baseUrl}}/' }, assertions: [] };
                void saveCollection({ ...c, items: addToFolder(c.items, folderId, node) }).then(() => intent('rest', { collectionId: c.id, requestId: node.id }));
              }}
              onSettings={(c) => intent('collections', { collectionId: c.id })}
            />
          ) : (
            <Empty icon={<FolderTree size={20} />} title="No collections yet">
              Create one with +, save a request with Ctrl+S, or import OpenAPI, Postman, Insomnia, Bruno or HAR.
            </Empty>
          )}
        </Section>

        <Section id="saved" title="Saved requests" count={savedCount + servers.length} sections={sections} forceOpen={!!f} def={savedCount + servers.length > 0}>
          {shownServers.length > 0 && <GroupLabel icon={<Plug size={12} />} label="MCP servers" />}
          {shownServers.map((s) => (
            <Row key={s.id} icon={<Plug size={13} />} label={s.name} sub={s.transport} onClick={() => intent('mcp', { serverId: s.id })} />
          ))}
          {savedGroups.map((g) => (
            <div key={g.kind}>
              <GroupLabel icon={g.icon} label={g.label} />
              {g.items.map((i) => (
                <Row key={i.id} icon={g.icon} label={i.name} sub={i.folder} onClick={() => intent(g.view, { savedId: i.id })} />
              ))}
            </div>
          ))}
          {!savedCount && !servers.length && <p className="px-3 py-2 text-xs text-muted">gRPC requests, WebSocket connections, MCP servers, AI prompts, evaluations and load tests you save appear here.</p>}
        </Section>

        <Section
          id="environments"
          title="Environments"
          count={ws?.environments.length}
          sections={sections}
          forceOpen={!!f}
          actions={
            <IconButton label="New environment" className="h-6 w-6" onClick={() => void newEnvironment()}>
              <Plus size={13} />
            </IconButton>
          }
        >
          {shownEnvs.map((e) => (
            <div key={e.id} className="group/env flex items-center">
              <Row
                icon={<span className="block w-2 h-2 rounded-full" style={{ background: e.color ?? (e.isProduction ? 'var(--bad)' : 'var(--ok)') }} />}
                label={e.name}
                active={e.name === env}
                title="Make this the active environment"
                badge={e.isProduction ? <Badge tone="bad">prod</Badge> : e.name === env ? <span className="text-[0.68rem] text-accent">active</span> : undefined}
                onClick={() => useApp.getState().setEnvironment(e.name)}
              />
              <Tooltip content="Edit">
                <button aria-label={`Edit ${e.name}`} className="opacity-0 group-hover/env:opacity-100 p-1 mr-1 rounded text-muted hover:text-fg hover:bg-hover" onClick={() => intent('environments', { environmentId: e.id })}>
                  <Settings2 size={13} />
                </button>
              </Tooltip>
            </div>
          ))}
          {!ws?.environments.length && <p className="px-3 py-2 text-xs text-muted">Environments hold variables such as baseUrl and tokens.</p>}
        </Section>

        <Section
          id="specs"
          title="API specs"
          count={specs.length}
          sections={sections}
          def={specs.length > 0}
          forceOpen={!!f && shownSpecs.length > 0}
          actions={
            <IconButton label="Import an OpenAPI document" className="h-6 w-6" onClick={() => intent('collections', { import: true })}>
              <Plus size={13} />
            </IconButton>
          }
        >
          {shownSpecs.map((s) => (
            <div key={s} className="flex items-center">
              <Menu
                width={220}
                align="start"
                trigger={
                  <button className="w-[calc(100%-0.5rem)] mx-1 flex items-center gap-2 h-7 px-2 rounded-md text-sm text-left hover:bg-hover data-[state=open]:bg-hover">
                    <FileCode2 size={13} className="text-muted shrink-0" />
                    <span className="truncate">{s.replace(/^specs\//, '')}</span>
                  </button>
                }
                items={[
                  { label: 'API coverage', icon: <ScanSearch size={14} />, onSelect: () => useApp.getState().set({ apiCoverage: { spec: s } }) },
                  { label: 'Compare versions', icon: <GitCompare size={14} />, onSelect: () => useApp.getState().set({ openapiDiff: true }) },
                ]}
              />
            </div>
          ))}
          {!specs.length && <p className="px-3 py-2 text-xs text-muted">Importing an OpenAPI document keeps it in specs/, for contract checks, coverage and version diffs.</p>}
        </Section>

        <Section id="monitors" title="Monitors" count={monitors.length} sections={sections} def={monitors.length > 0} forceOpen={!!f && shownMonitors.length > 0}>
          {shownMonitors.map((m) => (
            <Row
              key={m.id}
              icon={<span className={cx('block w-2 h-2 rounded-full', !m.lastResult ? 'bg-muted/50' : m.lastResult.status === 'passed' ? 'bg-ok' : 'bg-bad')} />}
              label={m.name}
              sub={m.enabled ? m.schedule : 'paused'}
              onClick={() => intent('monitors', { monitorId: m.id })}
            />
          ))}
          {!monitors.length && <p className="px-3 py-2 text-xs text-muted">Monitors run a collection on a schedule. {plural(0, 'monitor')} yet.</p>}
        </Section>
      </div>
    </aside>
  );
}

function GroupLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5 text-[0.7rem] font-medium text-muted">
      {icon}
      {label}
    </div>
  );
}

