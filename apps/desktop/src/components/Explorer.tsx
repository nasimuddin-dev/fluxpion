import { ChevronDown, ChevronRight, Download, FileCode2, FolderInput, FolderPlus, FolderX, GitCompare, Inbox, Layers, MoreHorizontal, PanelLeftClose, Plug, Plus, RefreshCw, ScanSearch, Upload } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { asError, call, on } from '../api';
import { promptText, useApp, type ViewId } from '../store';
import type { Collection, CollectionNode, Library, LibraryItem, McpServerConfig } from '../types';
import { uid } from '../lib/format';
import { addToFolder, CATEGORY_META, CollectionTree, type ExtraGroup } from './CollectionTree';
import type { RequestCategory } from '../lib/collection-filter';
import { newRequestItems } from './EditorTabs';
import { Button, cx, IconButton, Input, Menu, type MenuItem } from './ui';

/**
 * The Collections explorer: the one sidebar of the request editors. The workspace lists its collections;
 * expanding one shows what it holds by category (REST, SOAP, GraphQL, gRPC, WebSocket & MQTT). MCP servers
 * and API definitions belong to the whole workspace and follow the collections. Environments, monitors,
 * AI prompts, evaluations and load tests live in their own views.
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

function Row({ icon, label, sub, onClick, title, active, menu }: { icon?: ReactNode; label: string; sub?: ReactNode; onClick(): void; title?: string; active?: boolean; menu?: MenuItem[] }) {
  return (
    <div className={cx('group mx-1 flex items-center rounded-md pr-1 transition-colors', active ? 'bg-accent-soft' : 'hover:bg-hover')}>
      <button title={title ?? label} onClick={onClick} className="flex-1 min-w-0 flex items-center gap-2 h-7 pl-6 pr-1 text-sm text-left">
        {icon && <span className="text-muted shrink-0">{icon}</span>}
        <span className="truncate flex-1">{label}</span>
        {sub && <span className="text-xs text-muted truncate max-w-[45%]">{sub}</span>}
      </button>
      {menu && (
        <Menu
          width={230}
          trigger={
            <button aria-label={`More actions for ${label}`} className="grid place-items-center h-6 w-6 rounded-md text-muted hover:text-fg hover:bg-panel2 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={14} />
            </button>
          }
          items={menu}
        />
      )}
    </div>
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
  /** The collection it's shown in (gRPC calls and WebSocket connections are saved outside collections). */
  collectionId?: string;
  badge?: string;
}

const SOAP_ENVELOPE = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
  </soap:Body>
</soap:Envelope>`;

/** A new request of this category as a collection node (gRPC and WebSocket open their editors instead). */
function newNode(cat: RequestCategory): CollectionNode | undefined {
  if (cat === 'rest') return { kind: 'http', id: uid('req-'), name: 'New request', request: { method: 'GET', url: '{{baseUrl}}/' }, assertions: [] };
  if (cat === 'soap')
    return {
      kind: 'http',
      id: uid('req-'),
      name: 'New SOAP request',
      request: { method: 'POST', url: '{{baseUrl}}/', headers: [{ key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true }, { key: 'SOAPAction', value: '', enabled: true }], body: { type: 'xml', content: SOAP_ENVELOPE } },
      assertions: [],
    };
  if (cat === 'graphql') return { kind: 'graphql', id: uid('gql-'), name: 'New GraphQL request', request: { endpoint: '{{baseUrl}}/graphql', query: 'query {\n  \n}', variables: '', headers: [] }, assertions: [] };
  return undefined;
}

export function Explorer() {
  const ws = useApp((s) => s.workspace);
  const sections = useOpenSections();
  const [filter, setFilter] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [grpc, setGrpc] = useState<SavedItem[]>([]);
  const [looseOpen, setLooseOpen] = useState(true);
  const [sockets, setSockets] = useState<SavedItem[]>([]);
  const [servers, setServers] = useState<Array<McpServerConfig & { connected?: boolean }>>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  // the request that's open (as recorded for Back / Forward) is highlighted in the tree
  const openRequestId = useApp((s) => (s.nav.current.payload?.requestId ?? s.nav.current.payload?.savedId) as string | undefined);

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
    setGrpc(g.items.map(({ data: _, ...i }) => i));
    const wsBadge = (d: unknown) => ((d as { mode?: string })?.mode === 'mqtt' ? 'MQTT' : (d as { mode?: string })?.mode === 'socketio' ? 'SIO' : 'WS');
    setSockets(w.items.map(({ data, ...i }) => ({ ...i, badge: wsBadge(data) })));
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
  // gRPC calls and connections not (or no longer) in a collection
  const colIds = new Set(collections.map((c) => c.id));
  const loose = (items: SavedItem[]) => items.filter((i) => !i.collectionId || !colIds.has(i.collectionId));
  const looseGrpc = loose(grpc).filter((i) => match(i.name, i.folder));
  const looseSockets = loose(sockets).filter((i) => match(i.name, i.folder));
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
  /** Show a saved gRPC call / connection in another collection (or in none). */
  const moveItem = async (kind: 'grpc' | 'websocket', id: string, collectionId: string | undefined) => {
    try {
      const lib = await call<Library<unknown>>('lib.get', { kind });
      const items = lib.items.map((i: LibraryItem<unknown>) => (i.id === id ? { ...i, collectionId } : i));
      await call('lib.save', { kind, library: { folders: lib.folders, items } });
      await load();
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const moveMenu = (kind: 'grpc' | 'websocket', item: SavedItem): MenuItem[] => [
    { label: 'Open', onSelect: () => intent(kind, { savedId: item.id }) },
    ...collections
      .filter((c) => c.id !== item.collectionId)
      .map((c, i) => ({ label: `Move to ${c.name}`, icon: <FolderInput size={14} />, separator: i === 0, onSelect: () => void moveItem(kind, item.id, c.id) })),
    ...(item.collectionId && colIds.has(item.collectionId) ? [{ label: 'Remove from the collection', icon: <FolderX size={14} />, separator: true, onSelect: () => void moveItem(kind, item.id, undefined) }] : []),
  ];
  const extraGroups = (c: Collection): ExtraGroup[] => [
    { cat: 'grpc', items: grpc.filter((i) => i.collectionId === c.id), onOpen: (id) => intent('grpc', { savedId: id }), menu: (id) => moveMenu('grpc', grpc.find((i) => i.id === id)!) },
    { cat: 'websocket', items: sockets.filter((i) => i.collectionId === c.id), onOpen: (id) => intent('websocket', { savedId: id }), menu: (id) => moveMenu('websocket', sockets.find((i) => i.id === id)!) },
  ];
  const newOfCategory = (c: Collection, cat: RequestCategory) => {
    if (cat === 'grpc' || cat === 'websocket') return intent(cat, { newDoc: true, collectionId: c.id });
    const node = newNode(cat)!;
    void saveCollection({ ...c, items: addToFolder(c.items, undefined, node) }).then(() => intent(cat === 'graphql' ? 'graphql' : 'rest', { collectionId: c.id, requestId: node.id }));
  };

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
        {collections.length ? (
          <div className="pb-2 border-b border-line/60">
            <CollectionTree
              collections={collections}
              filter={filter}
              categorize
              extraGroups={extraGroups}
              onNewOfCategory={newOfCategory}
              activeRequestId={openRequestId}
              onOpen={(c, n) => intent(n.kind === 'graphql' ? 'graphql' : 'rest', { collectionId: c.id, requestId: n.id })}
              onChange={(c) => void saveCollection(c)}
              onRun={(c, folderId) => intent('collections', { collectionId: c.id, run: true, folderId })}
              onNewRequest={(c, folderId) => {
                const node = newNode('rest')!;
                void saveCollection({ ...c, items: addToFolder(c.items, folderId, node) }).then(() => intent('rest', { collectionId: c.id, requestId: node.id }));
              }}
              onSettings={(c) => intent('collections', { collectionId: c.id })}
            />
          </div>
        ) : (
          <div className="border-b border-line/60 py-2">
            <EmptyHint text="Collections hold your requests: REST, SOAP, GraphQL, gRPC and WebSocket, organised in folders. Create one, or import OpenAPI, Postman, Insomnia, Bruno, WSDL or HAR." action="New collection" onAction={() => void newCollection()} />
          </div>
        )}

        {(looseGrpc.length > 0 || looseSockets.length > 0) && (
          <div className="border-b border-line/60">
            <button className="flex items-center gap-1.5 w-full h-9 pl-1.5 pr-2 text-left" onClick={() => setLooseOpen((o) => !o)} aria-expanded={looseOpen || !!f} title="gRPC calls and connections saved outside a collection: use Move to collection in their menu">
              {looseOpen || f ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
              <Inbox size={14} className="text-muted shrink-0" />
              <span className="text-[0.82rem] font-semibold truncate flex-1">Not in a collection</span>
              <span className="text-[0.7rem] px-1.5 rounded-full bg-panel2 text-muted tabular-nums">{looseGrpc.length + looseSockets.length}</span>
            </button>
            {(looseOpen || !!f) && (
              <div className="pb-2">
                {(
                  [
                    ['grpc', looseGrpc],
                    ['websocket', looseSockets],
                  ] as const
                ).map(([kind, items]) =>
                  byFolder(items).map((g) => (
                    <div key={`${kind}:${g.folder ?? ''}`}>
                      {g.folder && <FolderLabel name={g.folder} />}
                      {g.items.map((i) => (
                        <Row key={i.id} icon={<span className={cx('mono text-[0.6rem] font-bold w-8 inline-block', CATEGORY_META[kind].cls)}>{i.badge ?? CATEGORY_META[kind].badge}</span>} label={i.name} active={openRequestId === i.id} onClick={() => intent(kind, { savedId: i.id })} menu={moveMenu(kind, i)} />
                      ))}
                    </div>
                  )),
                )}
              </div>
            )}
          </div>
        )}

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
