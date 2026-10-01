import { ChevronDown, ChevronRight, CopyPlus, Download, ExternalLink, FileCode2, FolderInput, FolderPlus, FolderX, GitCompare, Inbox, Layers, MoreHorizontal, PanelLeftClose, Pencil, Plug, Plus, RefreshCw, ScanSearch, Trash2, Unplug, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { asError, call, on } from '../api';
import { confirmAction, promptText, useApp } from '../store';
import type { Collection, CollectionNode, Library, LibraryItem, McpServerConfig } from '../types';
import { uid } from '../lib/format';
import { addToFolder, CATEGORY_META, CollectionTree, type ExtraGroup } from './CollectionTree';
import type { RequestCategory } from '../lib/collection-filter';
import { closeTabsFor, newRequestItems, useEditorTabsStore } from './EditorTabs';
import { isDocView, useDocs } from '../lib/docs';
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
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cx('group mx-1 flex items-center rounded-md pr-1 transition-colors', active ? 'bg-accent-soft' : menuOpen ? 'bg-hover' : 'hover:bg-hover')}
      onContextMenu={(e) => {
        if (!menu) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button title={title ?? label} onClick={onClick} className="flex-1 min-w-0 flex items-center gap-2 h-7 pl-6 pr-1 text-sm text-left">
        {icon && <span className="text-muted shrink-0">{icon}</span>}
        <span className="truncate flex-1">{label}</span>
        {sub && <span className="text-xs text-muted truncate max-w-[45%]">{sub}</span>}
      </button>
      {menu && (
        <Menu
          width={230}
          open={menuOpen}
          onOpenChange={setMenuOpen}
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

const NONE: SavedItem[] = [];
/** Saved items by the collection they're shown in. */
function groupByCollection(items: SavedItem[]): Map<string, SavedItem[]> {
  const map = new Map<string, SavedItem[]>();
  for (const i of items) if (i.collectionId) map.set(i.collectionId, [...(map.get(i.collectionId) ?? []), i]);
  return map;
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

const WIDTH_KEY = 'aps.explorer.width';
const DEFAULT_WIDTH = 272;
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, 200), Math.min(640, window.innerWidth * 0.6)));

/** The sidebar's width: dragged on its right edge, remembered; double-click the edge resets it. */
function useExplorerWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      return w ? clampWidth(w) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const save = (w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      /* storage unavailable */
    }
  };
  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar (double-click to reset)"
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize group/resize outline-none"
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const start = width;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => setWidth(clampWidth(start + ev.clientX - startX));
        const up = (ev: PointerEvent) => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          save(clampWidth(start + ev.clientX - startX));
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => save(DEFAULT_WIDTH)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          save(clampWidth(width + (e.key === 'ArrowRight' ? 16 : -16)));
        }
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-accent/60 group-focus-visible/resize:bg-accent" />
    </div>
  );
  return { width, handle };
}

export function Explorer() {
  const ws = useApp((s) => s.workspace);
  const { width, handle } = useExplorerWidth();
  const sections = useOpenSections();
  const [filter, setFilter] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [grpc, setGrpc] = useState<SavedItem[]>([]);
  const [looseOpen, setLooseOpen] = useState(true);
  const [sockets, setSockets] = useState<SavedItem[]>([]);
  const [servers, setServers] = useState<Array<McpServerConfig & { connected?: boolean }>>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  // the request that's open (as recorded for Back / Forward) is highlighted in the tree
  // (or, for a tab restored at start-up, the item its active tab shows)
  const navItem = useApp((s) => (s.nav.current.payload?.requestId ?? s.nav.current.payload?.savedId) as string | undefined);
  const view = useApp((s) => s.view);
  const activeDoc = useDocs((s) => s.active[view]);
  const tabItem = useEditorTabsStore((s) => {
    const group = isDocView(view) ? `${view}:${activeDoc ?? 'main'}` : view;
    const tabs = s.byView[group] ?? [];
    return (tabs.find((t) => t.key === s.activeByView[group]) ?? (tabs.length === 1 ? tabs[0] : undefined))?.item;
  });
  const openRequestId = tabItem ?? navItem;

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
  // (coalesced: a run or an import saves many things in a row, one reload follows the last of them)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = on('data.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 120);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [load]);

  const grpcByCollection = useMemo(() => groupByCollection(grpc), [grpc]);
  const socketsByCollection = useMemo(() => groupByCollection(sockets), [sockets]);
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
  /** Change a saved gRPC call / connection list (move, rename, duplicate, delete): the one place that loads, edits and saves it. */
  const editLibrary = async (kind: 'grpc' | 'websocket', fn: (items: Array<LibraryItem<unknown>>) => Array<LibraryItem<unknown>>) => {
    try {
      const lib = await call<Library<unknown>>('lib.get', { kind });
      await call('lib.save', { kind, library: { folders: lib.folders, items: fn(lib.items) } });
      await load();
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const moveItem = (kind: 'grpc' | 'websocket', id: string, collectionId: string | undefined) => editLibrary(kind, (items) => items.map((i) => (i.id === id ? { ...i, collectionId } : i)));
  /** The menu of a gRPC call or connection: the same actions as a request's (open, rename, duplicate, move, delete). */
  const moveMenu = (kind: 'grpc' | 'websocket', item: SavedItem): MenuItem[] => [
    { label: 'Open in tab', icon: <ExternalLink size={14} />, onSelect: () => intent(kind, { savedId: item.id }) },
    {
      label: 'Rename',
      icon: <Pencil size={14} />,
      onSelect: async () => {
        const name = (await promptText(`Rename ${kind === 'grpc' ? 'gRPC call' : 'connection'}`, { value: item.name, okLabel: 'Rename' }))?.trim();
        if (name) await editLibrary(kind, (items) => items.map((i) => (i.id === item.id ? { ...i, name } : i)));
      },
    },
    {
      label: 'Duplicate',
      icon: <CopyPlus size={14} />,
      onSelect: () => void editLibrary(kind, (items) => items.flatMap((i) => (i.id === item.id ? [i, { ...i, id: uid('lib-'), name: `${i.name} copy`, updatedAt: new Date().toISOString() }] : [i]))),
    },
    {
      label: 'Move to',
      icon: <FolderInput size={14} />,
      onSelect: () => undefined,
      items: collections.filter((c) => c.id !== item.collectionId).map((c) => ({ label: c.name, onSelect: () => void moveItem(kind, item.id, c.id) })),
    },
    ...(item.collectionId && colIds.has(item.collectionId) ? [{ label: 'Remove from the collection', icon: <FolderX size={14} />, onSelect: () => void moveItem(kind, item.id, undefined) }] : []),
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      danger: true,
      separator: true,
      onSelect: async () => {
        if (!(await confirmAction({ title: kind === 'grpc' ? 'Delete gRPC call' : 'Delete connection', message: `Delete "${item.name}"?`, confirmLabel: 'Delete', danger: true }))) return;
        closeTabsFor([item.id]);
        await editLibrary(kind, (items) => items.filter((i) => i.id !== item.id));
      },
    },
  ];
  /** Change the MCP server list (rename, duplicate, delete). */
  const editServers = async (fn: (list: McpServerConfig[]) => McpServerConfig[]) => {
    try {
      await call('mcp.saveServers', { servers: fn(servers.map(({ connected: _c, ...s }) => s as McpServerConfig)) });
      await load();
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  /** The menu of an MCP server: open, connect, rename, duplicate, delete. */
  const serverMenu = (s: McpServerConfig & { connected?: boolean }): MenuItem[] => [
    { label: 'Open in tab', icon: <ExternalLink size={14} />, onSelect: () => intent('mcp', { serverId: s.id }) },
    s.connected
      ? { label: 'Disconnect', icon: <Unplug size={14} />, onSelect: () => void call('mcp.disconnect', { serverId: s.id }).then(load) }
      : { label: 'Connect', icon: <Plug size={14} />, onSelect: () => intent('mcp', { serverId: s.id, connect: true }) },
    { label: 'Settings', icon: <Pencil size={14} />, onSelect: () => intent('mcp', { serverId: s.id, tab: 'settings' }) },
    {
      label: 'Rename',
      icon: <Pencil size={14} />,
      separator: true,
      onSelect: async () => {
        const name = (await promptText('Rename MCP server', { value: s.name, okLabel: 'Rename' }))?.trim();
        if (name) await editServers((list) => list.map((x) => (x.id === s.id ? { ...x, name } : x)));
      },
    },
    { label: 'Duplicate', icon: <CopyPlus size={14} />, onSelect: () => void editServers((list) => list.flatMap((x) => (x.id === s.id ? [x, { ...x, id: uid('mcp-'), name: `${x.name} copy` }] : [x]))) },
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      danger: true,
      separator: true,
      onSelect: async () => {
        if (!(await confirmAction({ title: 'Remove MCP server', message: `Remove the MCP server "${s.name}"?`, detail: 'Saved tests that call it will fail until you add it again.', confirmLabel: 'Remove server', danger: true }))) return;
        closeTabsFor([s.id]);
        if (s.connected) await call('mcp.disconnect', { serverId: s.id }).catch(() => undefined);
        await editServers((list) => list.filter((x) => x.id !== s.id));
      },
    },
  ];
  /** Saved before items could belong to a collection: put gRPC calls and connections in a collection each. */
  const organizeLoose = async () => {
    try {
      let moved = 0;
      for (const [kind, name] of [
        ['grpc', 'gRPC'],
        ['websocket', 'WebSocket & MQTT'],
      ] as const) {
        const items = loose(kind === 'grpc' ? grpc : sockets);
        if (!items.length) continue;
        let col = collections.find((c) => c.name === name);
        if (!col) {
          col = { schemaVersion: '1.0', id: uid('col-'), name, version: 0, variables: [], items: [], updatedAt: '' };
          await call('col.save', col);
        }
        const ids = new Set(items.map((i) => i.id));
        const colId = col.id;
        await editLibrary(kind, (list) => list.map((i) => (ids.has(i.id) ? { ...i, collectionId: colId } : i)));
        moved += items.length;
      }
      useApp.getState().toast(`Moved ${moved} item${moved === 1 ? '' : 's'} into collections`, 'success');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const extraGroups = (c: Collection): ExtraGroup[] => [
    { cat: 'grpc', items: grpcByCollection.get(c.id) ?? NONE, onOpen: (id) => intent('grpc', { savedId: id }), menu: (id) => moveMenu('grpc', grpc.find((i) => i.id === id)!) },
    { cat: 'websocket', items: socketsByCollection.get(c.id) ?? NONE, onOpen: (id) => intent('websocket', { savedId: id }), menu: (id) => moveMenu('websocket', sockets.find((i) => i.id === id)!) },
  ];
  const newOfCategory = (c: Collection, cat: RequestCategory) => {
    if (cat === 'grpc' || cat === 'websocket') return intent(cat, { newDoc: true, collectionId: c.id });
    const node = newNode(cat)!;
    void saveCollection({ ...c, items: addToFolder(c.items, undefined, node) }).then(() => intent(cat === 'graphql' ? 'graphql' : 'rest', { collectionId: c.id, requestId: node.id }));
  };

  return (
    <aside aria-label="Collections explorer" style={{ width }} className="relative shrink-0 border-r border-line bg-panel flex flex-col min-h-0">
      {handle}
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
            <div className="group flex items-center h-9 pl-1.5 pr-1">
              <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => setLooseOpen((o) => !o)} aria-expanded={looseOpen || !!f} title="gRPC calls and connections saved outside a collection: use Move to collection in their menu">
                {looseOpen || f ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
                <Inbox size={14} className="text-muted shrink-0" />
                <span className="text-[0.82rem] font-semibold truncate flex-1">Not in a collection</span>
                <span className="text-[0.7rem] px-1.5 rounded-full bg-panel2 text-muted tabular-nums">{looseGrpc.length + looseSockets.length}</span>
              </button>
              <IconButton label="Put them in collections (gRPC, WebSocket & MQTT)" className="h-6 w-6 ml-1" onClick={() => void organizeLoose()}>
                <FolderInput size={13} />
              </IconButton>
            </div>
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
                active={openRequestId === s.id}
                onClick={() => intent('mcp', { serverId: s.id })}
                menu={serverMenu(s)}
              />
            ))
          ) : (
            <EmptyHint text="MCP servers to inspect and test: a local command, Streamable HTTP, SSE or a mock." action="Add server" onAction={() => intent('mcp', { addServer: true })} />
          )}
        </Section>

        <Section id="specs" title="API definitions" icon={<FileCode2 size={14} />} count={specs.length} sections={sections} def={specs.length > 0} forceOpen={!!f && shownSpecs.length > 0} addLabel="Import an OpenAPI document" onAdd={importDefinition}>
          {specs.length ? (
            shownSpecs.map((s) => (
              <Row
                key={s}
                icon={<FileCode2 size={13} />}
                label={s.replace(/^specs\//, '')}
                title={s}
                active={openRequestId === s}
                onClick={() => intent('apidef', { spec: s })}
                menu={[
                  { label: 'Open in tab', icon: <ExternalLink size={14} />, onSelect: () => intent('apidef', { spec: s, tab: 'definition' }) },
                  { label: 'API coverage', icon: <ScanSearch size={14} />, onSelect: () => intent('apidef', { spec: s, tab: 'coverage' }) },
                  { label: 'Compare versions', icon: <GitCompare size={14} />, onSelect: () => intent('apidef', { spec: s, tab: 'compare' }) },
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
