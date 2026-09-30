import { ChevronDown, ChevronRight, Download, FileCode2, FolderPlus, FolderTree, GitCompare, Layers, MoreHorizontal, PanelLeftClose, Plug, Plus, Radio, RefreshCw, ScanSearch, Upload, Waypoints } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { asError, call, on } from '../api';
import { promptText, useApp, type ViewId } from '../store';
import type { Collection, Library, McpServerConfig } from '../types';
import { uid } from '../lib/format';
import { addToFolder, CollectionTree } from './CollectionTree';
import { newRequestItems } from './EditorTabs';
import { Button, cx, IconButton, Input, Menu } from './ui';

/**
 * The Collections explorer: the one sidebar of the request editors. It's organised by what you work with:
 * collections (HTTP and GraphQL), gRPC requests, WebSocket / MQTT connections, MCP servers and API
 * definitions. Environments, monitors, AI prompts, evaluations and load tests live in their own views.
 */

const openKey = 'aps.explorer.sections.v2';
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

/** A collapsible section: icon, title, count, and a + that creates that kind of item. */
function Section({
  id,
  title,
  icon,
  count,
  addLabel,
  onAdd,
  children,
  def = true,
  sections,
  forceOpen,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  count?: number;
  addLabel?: string;
  onAdd?(): void;
  children: ReactNode;
  def?: boolean;
  sections: ReturnType<typeof useOpenSections>;
  forceOpen?: boolean;
}) {
  const open = forceOpen || sections.isOpen(id, def);
  return (
    <div className="border-b border-line/60">
      <div className="group flex items-center h-9 pl-1.5 pr-1 sticky top-0 bg-panel z-10">
        <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => sections.toggle(id, def)} aria-expanded={open}>
          {open ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
          <span className="text-muted shrink-0">{icon}</span>
          <span className="text-[0.82rem] font-semibold truncate">{title}</span>
          {count !== undefined && count > 0 && <span className="text-[0.7rem] px-1.5 rounded-full bg-panel2 text-muted tabular-nums">{count}</span>}
        </button>
        {onAdd && (
          <IconButton label={addLabel ?? 'New'} className="h-6 w-6 opacity-60 group-hover:opacity-100 focus:opacity-100" onClick={onAdd}>
            <Plus size={13} />
          </IconButton>
        )}
      </div>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

function Row({ icon, label, sub, onClick, title }: { icon?: ReactNode; label: string; sub?: ReactNode; onClick(): void; title?: string }) {
  return (
    <button title={title ?? label} onClick={onClick} className="w-[calc(100%-0.5rem)] mx-1 flex items-center gap-2 h-7 pl-6 pr-2 rounded-md text-sm text-left transition-colors hover:bg-hover">
      {icon && <span className="text-muted shrink-0">{icon}</span>}
      <span className="truncate flex-1">{label}</span>
      {sub && <span className="text-xs text-muted truncate max-w-[45%]">{sub}</span>}
    </button>
  );
}

/** What a section is for, and a button to start, when it's empty. */
function EmptyHint({ text, action, onAction }: { text: string; action: string; onAction(): void }) {
  return (
    <div className="px-6 py-1.5 flex flex-col items-start gap-1.5">
      <p className="text-xs text-muted leading-snug">{text}</p>
      <Button size="sm" icon={<Plus size={12} />} onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

/** Saved items grouped by their folder (items without one first). */
function byFolder<T extends { folder?: string }>(items: T[]): Array<{ folder?: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const i of items) groups.set(i.folder ?? '', [...(groups.get(i.folder ?? '') ?? []), i]);
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).map(([folder, list]) => ({ folder: folder || undefined, items: list }));
}

function FolderLabel({ name }: { name: string }) {
  return <div className="pl-6 pr-3 pt-1.5 pb-0.5 text-[0.7rem] font-medium text-muted truncate">{name}</div>;
}

interface SavedItem {
  id: string;
  name: string;
  folder?: string;
}

export function Explorer() {
  const ws = useApp((s) => s.workspace);
  const sections = useOpenSections();
  const [filter, setFilter] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [grpc, setGrpc] = useState<SavedItem[]>([]);
  const [sockets, setSockets] = useState<SavedItem[]>([]);
  const [servers, setServers] = useState<Array<McpServerConfig & { connected?: boolean }>>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  // the request that's open (as recorded for Back / Forward) is highlighted in the tree
  const openRequestId = useApp((s) => s.nav.current.payload?.requestId as string | undefined);

  const load = useCallback(async () => {
    const quiet = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const empty: Library<unknown> = { folders: [], items: [] };
    const [c, g, w, s, sp] = await Promise.all([
      quiet(call<Collection[]>('col.list'), []),
      quiet(call<Library<unknown>>('lib.get', { kind: 'grpc' }), empty),
      quiet(call<Library<unknown>>('lib.get', { kind: 'websocket' }), empty),
      quiet(call<Array<McpServerConfig & { connected?: boolean }>>('mcp.servers'), []),
      quiet(call<string[]>('openapi.specs'), []),
    ]);
    setCollections(c.filter((x) => !x.problem));
    setGrpc(g.items);
    setSockets(w.items);
    setServers(s);
    setSpecs(sp);
  }, []);
  useEffect(() => {
    void load();
  }, [load, ws?.id]);
  // saving anything (in any view), or connecting an MCP server, refreshes the lists
  useEffect(() => on('data.changed', () => void load()), [load]);

  const f = filter.trim().toLowerCase();
  const match = (...t: Array<string | undefined>) => !f || t.some((x) => x?.toLowerCase().includes(f));
  const shownGrpc = grpc.filter((i) => match(i.name, i.folder));
  const shownSockets = sockets.filter((i) => match(i.name, i.folder));
  const shownServers = servers.filter((s) => match(s.name, s.transport));
  const shownSpecs = specs.filter((s) => match(s));

  const intent = useApp.getState().openIntent;
  const setView = (v: ViewId) => useApp.getState().setView(v);
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
  const importDefinition = () => intent('collections', { import: true });

  return (
    <aside aria-label="Collections explorer" className="w-[272px] shrink-0 border-r border-line bg-panel flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 h-10 border-b border-line shrink-0">
        <Layers size={15} className="text-accent shrink-0" />
        <span className="font-semibold text-sm flex-1 truncate" title={ws?.name}>
          {ws?.name ?? 'Workspace'}
        </span>
        <Menu
          width={240}
          trigger={
            <IconButton label="New" className="h-7 w-7">
              <Plus size={15} />
            </IconButton>
          }
          items={[{ label: 'Collection', icon: <FolderPlus size={14} />, onSelect: () => void newCollection() }, ...newRequestItems().map((it, i) => (i === 0 ? { ...it, separator: true } : it))]}
        />
        <Menu
          width={250}
          trigger={
            <IconButton label="More: import, export, refresh" className="h-7 w-7">
              <MoreHorizontal size={15} />
            </IconButton>
          }
          items={[
            { label: 'Import (OpenAPI, Postman, Insomnia, Bruno, HAR …)', icon: <Upload size={14} />, onSelect: importDefinition },
            { label: 'Export collections or the workspace', icon: <Download size={14} />, onSelect: () => intent('collections', {}) },
            { label: 'Refresh', icon: <RefreshCw size={14} />, separator: true, onSelect: () => void load() },
          ]}
        />
        <IconButton label="Hide the sidebar (Ctrl+B)" className="h-7 w-7" onClick={() => useApp.getState().toggleExplorer(false)}>
          <PanelLeftClose size={14} />
        </IconButton>
      </div>
      <div className="p-2 shrink-0">
        <Input className="w-full h-7 min-h-7 text-sm" placeholder="Filter" aria-label="Filter requests, connections, servers and definitions" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="flex-1 overflow-auto">
        <Section id="collections" title="Collections" icon={<FolderTree size={14} />} count={collections.length} sections={sections} forceOpen={!!f} addLabel="New collection" onAdd={() => void newCollection()}>
          {collections.length ? (
            <CollectionTree
              collections={collections}
              filter={filter}
              activeRequestId={openRequestId}
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
            <EmptyHint text="HTTP and GraphQL requests, organised in folders. Save a request with Ctrl+S, or import OpenAPI, Postman, Insomnia, Bruno or HAR." action="New collection" onAction={() => void newCollection()} />
          )}
        </Section>

        <Section id="grpc" title="gRPC" icon={<Waypoints size={14} />} count={grpc.length} sections={sections} def={grpc.length > 0} forceOpen={!!f && shownGrpc.length > 0} addLabel="New gRPC request" onAdd={() => setView('grpc')}>
          {grpc.length ? (
            byFolder(shownGrpc).map((g) => (
              <div key={g.folder ?? ''}>
                {g.folder && <FolderLabel name={g.folder} />}
                {g.items.map((i) => (
                  <Row key={i.id} icon={<Waypoints size={13} />} label={i.name} onClick={() => intent('grpc', { savedId: i.id })} />
                ))}
              </div>
            ))
          ) : (
            <EmptyHint text="Saved gRPC calls: the server, method, message and metadata." action="New gRPC request" onAction={() => setView('grpc')} />
          )}
        </Section>

        <Section id="websocket" title="WebSocket & MQTT" icon={<Radio size={14} />} count={sockets.length} sections={sections} def={sockets.length > 0} forceOpen={!!f && shownSockets.length > 0} addLabel="New connection" onAdd={() => setView('websocket')}>
          {sockets.length ? (
            byFolder(shownSockets).map((g) => (
              <div key={g.folder ?? ''}>
                {g.folder && <FolderLabel name={g.folder} />}
                {g.items.map((i) => (
                  <Row key={i.id} icon={<Radio size={13} />} label={i.name} onClick={() => intent('websocket', { savedId: i.id })} />
                ))}
              </div>
            ))
          ) : (
            <EmptyHint text="Saved WebSocket, Socket.IO and MQTT connections with their messages." action="New connection" onAction={() => setView('websocket')} />
          )}
        </Section>

        <Section id="mcp" title="MCP servers" icon={<Plug size={14} />} count={servers.length} sections={sections} def={servers.length > 0} forceOpen={!!f && shownServers.length > 0} addLabel="Add an MCP server" onAdd={() => intent('mcp', { addServer: true })}>
          {servers.length ? (
            shownServers.map((s) => (
              <Row
                key={s.id}
                icon={<span className={cx('block w-2 h-2 rounded-full', s.connected ? 'bg-ok' : 'bg-line-strong')} />}
                label={s.name}
                sub={s.connected ? 'connected' : s.transport}
                title={`${s.name} (${s.connected ? 'connected' : 'not connected'})`}
                onClick={() => intent('mcp', { serverId: s.id })}
              />
            ))
          ) : (
            <EmptyHint text="MCP servers to inspect and test: a local command, Streamable HTTP, SSE or a mock." action="Add server" onAction={() => intent('mcp', { addServer: true })} />
          )}
        </Section>

        <Section id="specs" title="API definitions" icon={<FileCode2 size={14} />} count={specs.length} sections={sections} def={specs.length > 0} forceOpen={!!f && shownSpecs.length > 0} addLabel="Import an OpenAPI document" onAdd={importDefinition}>
          {specs.length ? (
            shownSpecs.map((s) => (
              <Menu
                key={s}
                width={220}
                align="start"
                trigger={
                  <button className="w-[calc(100%-0.5rem)] mx-1 flex items-center gap-2 h-7 pl-6 pr-2 rounded-md text-sm text-left hover:bg-hover data-[state=open]:bg-hover">
                    <FileCode2 size={13} className="text-muted shrink-0" />
                    <span className="truncate">{s.replace(/^specs\//, '')}</span>
                  </button>
                }
                items={[
                  { label: 'API coverage', icon: <ScanSearch size={14} />, onSelect: () => useApp.getState().set({ apiCoverage: { spec: s } }) },
                  { label: 'Compare versions', icon: <GitCompare size={14} />, onSelect: () => useApp.getState().set({ openapiDiff: true }) },
                ]}
              />
            ))
          ) : (
            <EmptyHint text="OpenAPI documents: importing one keeps it here for contract checks, API coverage and comparing versions." action="Import OpenAPI" onAction={importDefinition} />
          )}
        </Section>
      </div>
    </aside>
  );
}
