import { AlarmClock, FolderInput, Workflow, Braces, ChevronDown, Undo2, Wand2, ChevronRight, Code2, CopyPlus, ExternalLink, FilePlus2, Folder, FolderCog, FolderPlus, Link2, MoreHorizontal, Pencil, Play, SquareTerminal, Star, Terminal, TerminalSquare, Trash2, Settings2 } from 'lucide-react';
import { useState } from 'react';
import type { Collection, CollectionFolder, CollectionNode, SavedHttpRequest } from '../types';
import { asError, call } from '../api';
import { cx, Menu, type MenuItem } from './ui';
import { confirmAction, promptText, useApp } from '../store';
import { MoveDialog, subtreeIds } from './MoveDialog';
import { closeTabsFor } from './EditorTabs';
import { uid } from '../lib/format';
import { FolderEditor } from './FolderEditor';
import { countCategory, hasCategory, isEmptyFolder, matchesCollectionNode, requestCategory, type RequestCategory } from '../lib/collection-filter';

export function mapNodes(nodes: CollectionNode[], fn: (n: CollectionNode) => CollectionNode | null): CollectionNode[] {
  const out: CollectionNode[] = [];
  for (const n of nodes) {
    const r = fn(n);
    if (!r) continue;
    out.push(r.kind === 'folder' ? { ...r, items: mapNodes(r.items, fn) } : r);
  }
  return out;
}

export function findNode(nodes: CollectionNode[], id: string): CollectionNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === 'folder') {
      const f = findNode(n.items, id);
      if (f) return f;
    }
  }
  return undefined;
}

export function addToFolder(nodes: CollectionNode[], folderId: string | undefined, node: CollectionNode): CollectionNode[] {
  if (!folderId) return [...nodes, node];
  return mapNodes(nodes, (n) => (n.kind === 'folder' && n.id === folderId ? { ...n, items: [...n.items, node] } : n));
}

/** Insert a node right before the node with this id, wherever it is in the tree. */
export function insertBefore(nodes: CollectionNode[], beforeId: string, node: CollectionNode): CollectionNode[] {
  return nodes.flatMap((n) => (n.id === beforeId ? [node, n] : n.kind === 'folder' ? [{ ...n, items: insertBefore(n.items, beforeId, node) }] : [n]));
}

/** Insert a copy right after the node with this id, wherever it is in the tree. */
export function duplicateNode(nodes: CollectionNode[], id: string, copy: (n: CollectionNode) => CollectionNode): CollectionNode[] {
  return nodes.flatMap((n) => (n.id === id ? [n, copy(n)] : n.kind === 'folder' ? [{ ...n, items: duplicateNode(n.items, id, copy) }] : [n]));
}

/** Rows of one list (a collection's or folder's direct items) shown at first, and added by "Show more". */
const LIST_PAGE = 300;

/** How each category of request looks in the tree. */
export const CATEGORY_META: Record<RequestCategory, { label: string; badge: string; cls: string }> = {
  rest: { label: 'REST', badge: 'HTTP', cls: 'text-ok' },
  soap: { label: 'SOAP', badge: 'SOAP', cls: 'text-[#0ea5e9]' },
  graphql: { label: 'GraphQL', badge: 'GQL', cls: 'text-[#e535ab]' },
  grpc: { label: 'gRPC', badge: 'gRPC', cls: 'text-[#2ea99e]' },
  websocket: { label: 'WebSocket & MQTT', badge: 'WS', cls: 'text-[#d97706]' },
};

/** Saved items of a collection that aren't collection requests (gRPC calls, WebSocket connections). */
export interface ExtraGroup {
  cat: 'grpc' | 'websocket';
  items: Array<{ id: string; name: string; folder?: string; badge?: string }>;
  onOpen(id: string): void;
  menu?(id: string): MenuItem[];
  /** Show the item in another collection (dragged onto it). */
  onMoveTo?(id: string, collectionId: string): void;
}

/** Tree of collections → folders → requests with inline actions. */
export function CollectionTree({
  collections,
  activeRequestId,
  onOpen,
  onChange,
  onNewRequest,
  onRun,
  onSettings,
  filter,
  favoritesOnly = false,
  onMoved,
  newRequestLabel,
  categorize = false,
  extraGroups,
  onNewOfCategory,
}: {
  collections: Collection[];
  activeRequestId?: string;
  onOpen(c: Collection, node: CollectionNode): void;
  onChange(c: Collection): void;
  onNewRequest(c: Collection, folderId?: string): void;
  /** Open the Collection Runner for a collection or one of its folders. */
  onRun?(c: Collection, folderId?: string): void;
  /** Open a collection's settings (variables, auth, scripts, runner, docs, mock): shown in its menu. */
  onSettings?(c: Collection): void;
  filter?: string;
  /** Show starred requests while retaining their containing folders for context. */
  favoritesOnly?: boolean;
  /** Requests (ids) moved from one collection to another, so open tabs can follow them. */
  onMoved?(ids: string[], fromCollectionId: string, toCollectionId: string): void;
  /** Label of the "New request" menu entry (e.g. "New GraphQL request"). */
  newRequestLabel?: string;
  /** Group each collection's requests by what they are (REST, SOAP, GraphQL, gRPC, WebSocket). */
  categorize?: boolean;
  /** A collection's gRPC calls and WebSocket connections (saved outside the collection file). */
  extraGroups?(c: Collection): ExtraGroup[];
  /** Create a request of this category in a collection (the + of a category, the collection menu). */
  onNewOfCategory?(c: Collection, cat: RequestCategory): void;
}) {
  const [menuFor, setMenuFor] = useState<string>();
  const [moving, setMoving] = useState<{ c: Collection; n: CollectionNode }>();
  /** Delete a request or folder, with Undo in the toast (puts the collection back as it was). */
  /** A copy of the collection with everything it holds (its gRPC calls and connections too). */
  const duplicateCollection = async (c: Collection) => {
    try {
      const copy = await call<Collection>('col.duplicate', { id: c.id });
      useApp.getState().toast(`Duplicated as "${copy.name}"`, 'success');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  /** Move a collection to Recently deleted (restorable for 30 days); its tabs close. */
  const deleteCollection = async (c: Collection) => {
    if (!(await confirmAction({ title: 'Delete collection', message: `Delete the collection "${c.name}" and all its requests?`, detail: 'You can restore it from Recently deleted for 30 days. Its gRPC calls and connections stay, under Not in a collection.', confirmLabel: 'Delete collection', danger: true }))) return;
    try {
      closeTabsFor(c.items.flatMap(subtreeIds));
      await call('col.delete', { id: c.id });
      useApp.getState().toast(`Deleted "${c.name}"`, 'info');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const renameNode = async (c: Collection, n: CollectionNode) => {
    const name = await promptText(n.kind === 'folder' ? 'Rename folder' : 'Rename request', { value: n.name, okLabel: 'Rename' });
    if (name) onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? { ...x, name } : x)) });
  };
  const deleteNode = async (c: Collection, n: CollectionNode) => {
    const ok =
      n.kind === 'folder'
        ? await confirmAction({ title: 'Delete folder', message: `Delete the folder "${n.name}" and all requests in it?`, confirmLabel: 'Delete folder', danger: true })
        : await confirmAction({ title: 'Delete request', message: `Delete the request "${n.name}"?`, detail: 'Its saved examples are deleted too.', confirmLabel: 'Delete request', danger: true });
    if (ok) removeWithUndo(c, n);
  };
  /** F2 renames and Delete deletes the focused request or folder (like a file tree). */
  const rowKeys = (c: Collection, n: CollectionNode) => (e: React.KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      void renameNode(c, n);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void deleteNode(c, n);
    }
  };
  const removeWithUndo = (c: Collection, n: CollectionNode) => {
    onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? null : x)) });
    // its tabs (and those of everything in a deleted folder) close too
    closeTabsFor(subtreeIds(n));
    useApp.getState().toast(`Deleted "${n.name}"`, 'info', { label: 'Undo', onClick: () => onChange(c) });
  };
  // drag and drop: a request or folder onto a request (before it), a folder (into it) or a collection (top level)
  const [drag, setDrag] = useState<{ c: Collection; n: CollectionNode }>();
  const [dropAt, setDropAt] = useState<{ id: string; mode: 'before' | 'into' }>();
  const canDrop = (place: { beforeId?: string; folderId?: string }) => {
    if (!drag) return false;
    const own = subtreeIds(drag.n);
    return !(place.beforeId && own.includes(place.beforeId)) && !(place.folderId && own.includes(place.folderId));
  };
  const drop = (to: Collection, place: { beforeId?: string; folderId?: string }) => {
    const d = drag;
    setDrag(undefined);
    setDropAt(undefined);
    if (!d || !canDrop(place)) return;
    const insert = (items: CollectionNode[]) => (place.beforeId ? insertBefore(items, place.beforeId, d.n) : addToFolder(items, place.folderId, d.n));
    const without = mapNodes(d.c.items, (x) => (x.id === d.n.id ? null : x));
    if (to.id === d.c.id) onChange({ ...d.c, items: insert(without) });
    else {
      onChange({ ...to, items: insert(to.items) });
      onChange({ ...d.c, items: without });
      onMoved?.(subtreeIds(d.n), d.c.id, to.id);
    }
  };
  const dragProps = (c: Collection, n: CollectionNode) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', n.name);
      setDrag({ c, n });
    },
    onDragEnd: () => (setDrag(undefined), setDropAt(undefined)),
  });
  // a gRPC call or connection dragged onto another collection moves there
  const [dragExtra, setDragExtra] = useState<{ g: ExtraGroup; id: string; from: string }>();
  const collectionDropProps = (c: Collection) => {
    const nodes = dropProps(c, c.id, 'into', {});
    const extraHere = () => !!dragExtra?.g.onMoveTo && dragExtra.from !== c.id;
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!extraHere()) return nodes.onDragOver(e);
        e.preventDefault();
        e.stopPropagation();
        if (dropAt?.id !== c.id) setDropAt({ id: c.id, mode: 'into' });
      },
      onDragLeave: nodes.onDragLeave,
      onDrop: (e: React.DragEvent) => {
        if (!extraHere()) return nodes.onDrop(e);
        e.preventDefault();
        e.stopPropagation();
        const d = dragExtra!;
        setDragExtra(undefined);
        setDropAt(undefined);
        d.g.onMoveTo!(d.id, c.id);
      },
    };
  };
  const dropProps = (c: Collection, id: string, mode: 'before' | 'into', place: { beforeId?: string; folderId?: string }) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDrop(place)) return;
      e.preventDefault();
      e.stopPropagation();
      if (dropAt?.id !== id || dropAt.mode !== mode) setDropAt({ id, mode });
    },
    onDragLeave: () => dropAt?.id === id && setDropAt(undefined),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drop(c, place);
    },
  });
  const dropClass = (id: string) => (dropAt?.id !== id ? undefined : dropAt.mode === 'into' ? 'ring-1 ring-inset ring-accent bg-accent/10' : 'shadow-[inset_0_2px_0_var(--accent)]');
  const move = (from: Collection, n: CollectionNode, to: Collection, folderId: string | undefined) => {
    const without = { ...from, items: mapNodes(from.items, (x) => (x.id === n.id ? null : x)) };
    if (to.id === from.id) onChange({ ...without, items: addToFolder(without.items, folderId, n) });
    else {
      // add to the new collection first: a failed save then leaves a copy rather than losing the request
      onChange({ ...to, items: addToFolder(to.items, folderId, n) });
      onChange(without);
    }
    onMoved?.(subtreeIds(n), from.id, to.id);
    setMoving(undefined);
    useApp.getState().toast(`Moved "${n.name}" to ${to.name}${folderId ? ` › ${findNode(to.items, folderId)?.name ?? ''}` : ''}`, 'success');
  };
  const environment = useApp((s) => s.environment);
  /** Copy a saved request as its URL or as code, with variables resolved from the active environment. */
  const copyAs = async (c: Collection, n: SavedHttpRequest, language: string, what: string) => {
    try {
      const r = await call<{ text: string; containsSecrets: boolean }>('http.copyCode', { request: n.request, environment, collectionId: c.id, requestId: n.id, language });
      await navigator.clipboard.writeText(r.text);
      useApp.getState().toast(`Copied ${what}${r.containsSecrets ? ' (it includes secret values such as tokens)' : ''}`, 'success');
    } catch (e) {
      useApp.getState().toast(`Couldn't copy: ${asError(e).message}`, 'error');
    }
  };
  const copyMenu = (c: Collection, n: SavedHttpRequest): MenuItem[] => [
    { label: 'Copy URL', icon: <Link2 size={14} />, onSelect: () => void copyAs(c, n, 'url', 'the URL') },
    { label: 'Copy as cURL (bash)', icon: <Terminal size={14} />, onSelect: () => void copyAs(c, n, 'curl', 'as cURL (bash)') },
    { label: 'Copy as cURL (cmd)', icon: <SquareTerminal size={14} />, onSelect: () => void copyAs(c, n, 'curl-windows', 'as cURL (cmd)') },
    { label: 'Copy as PowerShell', icon: <TerminalSquare size={14} />, onSelect: () => void copyAs(c, n, 'powershell', 'as PowerShell') },
    { label: 'Copy as fetch', icon: <Braces size={14} />, onSelect: () => void copyAs(c, n, 'fetch', 'as fetch') },
    { label: 'More code snippets…', icon: <Code2 size={14} />, onSelect: () => useApp.getState().openIntent('rest', { collectionId: c.id, requestId: n.id, showCode: true }) },
  ];
  /** Rewrite the collection's scripts between Postman's pm.* and TestPion's tp.* (both always work). */
  const convertScripts = async (c: Collection, to: 'tp' | 'pm') => {
    const from = to === 'tp' ? 'pm' : 'tp';
    try {
      const r = await call<{ changed: number; replacements: number; skipped: Array<{ where: string; reason: string }>; collection?: Collection }>('col.convertScripts', { collectionId: c.id, to, dryRun: true });
      const skippedNote = r.skipped.length ? `\n\n${r.skipped.length} script${r.skipped.length === 1 ? '' : 's'} left as they are: ${r.skipped.slice(0, 3).map((s) => `${s.where} (${s.reason})`).join('; ')}${r.skipped.length > 3 ? ' …' : ''}` : '';
      if (!r.changed || !r.collection) {
        useApp.getState().toast(`No scripts in "${c.name}" use ${from}.*${r.skipped.length ? ` (${r.skipped.length} skipped)` : ''}`, 'success');
        return;
      }
      const ok = await confirmAction({
        title: `Convert scripts to ${to}.*`,
        message: `${r.changed} script${r.changed === 1 ? '' : 's'} in "${c.name}" use ${from}.* (${r.replacements} place${r.replacements === 1 ? '' : 's'}).`,
        detail: `They will use ${to}.* instead. Both names always work in TestPion, and exports to Postman always use pm.*. Only code changes, not text in strings or comments.${skippedNote}`,
        confirmLabel: 'Convert',
        tone: 'question',
      });
      if (!ok) return;
      onChange(r.collection);
      useApp.getState().toast(`Converted ${r.changed} script${r.changed === 1 ? '' : 's'} to ${to}.*`, 'success');
    } catch (e) {
      useApp.getState().toast(`Couldn't convert the scripts: ${asError(e).message}`, 'error');
    }
  };
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('aps.tree.open') ?? '{}');
    } catch {
      return {};
    }
  });
  const toggle = (id: string) => {
    const next = { ...open, [id]: !open[id] };
    setOpen(next);
    localStorage.setItem('aps.tree.open', JSON.stringify(next));
  };
  const [editing, setEditing] = useState<{ c: Collection; folder: CollectionFolder }>();
  const f = filter?.toLowerCase();
  const matches = (n: CollectionNode) => matchesCollectionNode(n, filter, favoritesOnly);

  // in a category, a folder shows when it holds requests of that category (empty folders: the first category)
  const inScope = (n: CollectionNode, scope?: { cat: RequestCategory; first: boolean }) =>
    !scope || (n.kind === 'folder' ? hasCategory(n.items, scope.cat) || (scope.first && isEmptyFolder(n)) : requestCategory(n) === scope.cat);
  // a very long list (thousands of requests in one folder) is shown a page at a time, so the sidebar stays fast
  const [limits, setLimits] = useState<Record<string, number>>({});
  const renderNodes = (c: Collection, nodes: CollectionNode[], depth: number, scope?: { cat: RequestCategory; first: boolean }, listId: string = c.id): React.ReactNode => {
    const list = nodes.filter((n) => matches(n) && inScope(n, scope));
    const listKey = `${listId}:${scope?.cat ?? ''}`;
    let limit = limits[listKey] ?? LIST_PAGE;
    if (list.length > limit && activeRequestId) {
      // the open request is always in view
      const at = list.findIndex((n) => n.id === activeRequestId);
      if (at >= limit) limit = at + 20;
    }
    const shown = list.length > limit ? list.slice(0, limit) : list;
    const rows = shown.map((n) => {
      const pad = { paddingLeft: 8 + depth * 12 };
      if (n.kind === 'folder') {
        const isOpen = open[n.id] ?? !!f;
        return (
          <div key={n.id}>
            <div className={cx('group flex items-center h-8 text-sm rounded-md mx-1 hover:bg-hover pr-1 transition-colors', dropClass(n.id))} style={pad} {...dragProps(c, n)} {...dropProps(c, n.id, 'into', { folderId: n.id })}>
              <button className="flex items-center gap-1 flex-1 min-w-0 text-left" onClick={() => toggle(n.id)} onKeyDown={rowKeys(c, n)}>
                {isOpen ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
                <Folder size={13} className="text-muted shrink-0" />
                <span className="truncate">{n.name}</span>
                {(n.preRequestScript || n.testScript || n.variables?.length) && <span className="w-1.5 h-1.5 rounded-full bg-accent/70 shrink-0" title="Has folder scripts or variables" />}
              </button>
              <NodeMenu
                onEdit={() => setEditing({ c, folder: n })}
                onMove={() => setMoving({ c, n })}
                onRename={() => void renameNode(c, n)}
                onDelete={() => void deleteNode(c, n)}
                onNewRequest={() => onNewRequest(c, n.id)}
                newRequestLabel={newRequestLabel}
                onRun={onRun && (() => onRun(c, n.id))}
                runLabel="Run folder"
                onMonitor={() => useApp.getState().openIntent('monitors', { create: { collectionId: c.id, selection: [n.id] } })}
                onNewFolder={async () => {
                  const name = await promptText('New folder', { message: 'Folder name', okLabel: 'Create' });
                  if (name) onChange({ ...c, items: addToFolder(c.items, n.id, { kind: 'folder', id: uid('fld-'), name, items: [] } as CollectionFolder) });
                }}
              />
            </div>
            {isOpen && renderNodes(c, n.items, depth + 1, scope, n.id)}
          </div>
        );
      }
      const method = n.kind === 'http' ? n.request.method : 'GQL';
      const examples = n.kind === 'http' ? n.examples ?? [] : [];
      const exKey = `${n.id}:examples`;
      const examplesOpen = !!open[exKey];
      return (
        <div key={n.id}>
        <div
          className={cx('group flex items-center h-8 text-sm pr-1 rounded-md mx-1 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_2rem]', activeRequestId === n.id ? 'bg-accent-soft text-fg' : 'hover:bg-hover', menuFor === n.id && 'bg-hover', dropClass(n.id))}
          style={pad}
          {...dragProps(c, n)}
          {...dropProps(c, n.id, 'before', { beforeId: n.id })}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuFor(n.id);
          }}
        >
          {examples.length > 0 && (
            <button className="shrink-0 -mr-3.5 w-3.5 text-muted hover:text-fg" aria-label={examplesOpen ? 'Hide examples' : `Show ${examples.length} examples`} aria-expanded={examplesOpen} onClick={() => toggle(exKey)}>
              {examplesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )}
          <button className="flex items-center gap-2 flex-1 min-w-0 text-left pl-4" onClick={() => onOpen(c, n)} onKeyDown={rowKeys(c, n)} title="Enter opens · F2 renames · Delete deletes">
            <span className={cx('mono method-badge text-[0.64rem] font-bold w-10 shrink-0', n.kind === 'http' ? `method-${method}` : 'text-[#e535ab]')}>{method.slice(0, 5)}</span>
            <span className="truncate">{n.name}</span>
          </button>
          <NodeMenu
            open={menuFor === n.id}
            onOpenChange={(o) => setMenuFor(o ? n.id : undefined)}
            onOpen={() => onOpen(c, n)}
            copyItems={n.kind === 'http' ? copyMenu(c, n) : undefined}
            onRename={() => void renameNode(c, n)}
            onDelete={() => void deleteNode(c, n)}
            onDuplicate={() => onChange({ ...c, items: duplicateNode(c.items, n.id, (x) => ({ ...x, id: uid('req-'), name: `${x.name} copy` })) })}
            onMove={() => setMoving({ c, n })}
            onToggleFavorite={() => onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id && x.kind !== 'folder' ? { ...x, favorite: !x.favorite } : x)) })}
            favorite={!!n.favorite}
          />
        </div>
        {examplesOpen &&
          examples.map((ex) => (
            <button
              key={ex.id}
              className="w-full flex items-center gap-2 h-7 text-xs rounded-md mx-1 pr-2 hover:bg-hover text-left text-muted hover:text-fg"
              style={{ paddingLeft: 8 + depth * 12 + 28 }}
              title="Saved example: opens the request (see its Examples tab)"
              onClick={() => onOpen(c, n)}
            >
              <span className={cx('mono font-bold w-9 shrink-0', ex.status < 300 ? 'text-ok' : ex.status < 400 ? 'text-warn' : 'text-bad')}>{ex.status}</span>
              <span className="truncate">{ex.name}</span>
            </button>
          ))}
        </div>
      );
    });
    const hidden = list.length - shown.length;
    return (
      <>
        {rows}
        {hidden > 0 && (
          <button className="mx-1 h-7 w-[calc(100%-0.5rem)] rounded-md text-xs text-accent text-left hover:bg-hover" style={{ paddingLeft: 8 + depth * 12 + 16 }} onClick={() => setLimits((l) => ({ ...l, [listKey]: limit + LIST_PAGE }))}>
            Show {Math.min(hidden, LIST_PAGE)} more ({hidden} not shown; the filter searches all of them)
          </button>
        )}
      </>
    );
  };

  const categoryRow = (c: Collection, cat: RequestCategory, count: number, isOpen: boolean) => {
    const key = `${c.id}:cat:${cat}`;
    // the same menu as every other row (right-click or ⋯): create here, run the collection, fold
    const items: MenuItem[] = [
      ...(onNewOfCategory ? [{ label: `New ${CATEGORY_META[cat].label} request`, icon: <FilePlus2 size={14} />, onSelect: () => onNewOfCategory(c, cat) }] : []),
      ...(onRun ? [{ label: 'Run collection', icon: <Play size={14} />, onSelect: () => onRun(c) }] : []),
      { label: isOpen ? 'Collapse' : 'Expand', icon: isOpen ? <ChevronRight size={14} /> : <ChevronDown size={14} />, separator: true, onSelect: () => toggle(key) },
    ];
    return (
    <div
      className={cx('group flex items-center h-8 text-sm rounded-md mx-1 pr-1 transition-colors', menuFor === key ? 'bg-hover' : 'hover:bg-hover')}
      style={{ paddingLeft: 20 }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuFor(key);
      }}
      {...(cat === 'rest' || cat === 'soap' || cat === 'graphql' ? dropProps(c, `${c.id}:${cat}`, 'into', {}) : {})}
    >
      <button className="flex items-center gap-1.5 flex-1 min-w-0 text-left" onClick={() => toggle(key)} aria-expanded={isOpen}>
        {isOpen ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
        <span className={cx('mono text-[0.6rem] font-bold w-8 shrink-0', CATEGORY_META[cat].cls)}>{CATEGORY_META[cat].badge}</span>
        <span className="truncate font-medium">{CATEGORY_META[cat].label}</span>
        <span className="text-[0.7rem] px-1.5 rounded-full bg-panel2 text-muted tabular-nums">{count}</span>
      </button>
      {onNewOfCategory && (
        <button
          aria-label={`New ${CATEGORY_META[cat].label} request in ${c.name}`}
          title={`New ${CATEGORY_META[cat].label} request`}
          className="grid place-items-center h-6 w-6 rounded-md text-muted hover:text-fg hover:bg-panel2 opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={() => onNewOfCategory(c, cat)}
        >
          <FilePlus2 size={13} />
        </button>
      )}
      <Menu
        width={230}
        open={menuFor === key}
        onOpenChange={(o) => setMenuFor(o ? key : undefined)}
        items={items}
        trigger={
          <button aria-label={`More actions for ${CATEGORY_META[cat].label}`} className="grid place-items-center h-6 w-6 rounded-md text-muted hover:text-fg hover:bg-panel2 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal size={14} />
          </button>
        }
      />
    </div>
    );
  };
  const renderExtra = (g: ExtraGroup, depth: number, from?: string) => {
    const shown = g.items.filter((i) => !f || i.name.toLowerCase().includes(f) || i.folder?.toLowerCase().includes(f));
    const folders = [...new Set(shown.map((i) => i.folder ?? ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    return folders.map((folder) => (
      <div key={folder}>
        {folder && (
          <div className="flex items-center gap-1 h-7 text-xs text-muted truncate mx-1" style={{ paddingLeft: 8 + depth * 12 + 13 }}>
            <Folder size={12} className="shrink-0" />
            <span className="truncate">{folder}</span>
          </div>
        )}
        {shown
          .filter((i) => (i.folder ?? '') === folder)
          .map((i) => (
            <div
              key={i.id}
              draggable={!!g.onMoveTo}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', i.name);
                setDragExtra({ g, id: i.id, from: from ?? '' });
              }}
              onDragEnd={() => (setDragExtra(undefined), setDropAt(undefined))}
              className={cx('group flex items-center h-8 text-sm pr-1 rounded-md mx-1 transition-colors', activeRequestId === i.id ? 'bg-accent-soft text-fg' : menuFor === i.id ? 'bg-hover' : 'hover:bg-hover')}
              style={{ paddingLeft: 8 + (depth + (folder ? 1 : 0)) * 12 }}
              onContextMenu={(e) => {
                if (!g.menu) return;
                e.preventDefault();
                setMenuFor(i.id);
              }}
            >
              <button className="flex items-center gap-2 flex-1 min-w-0 text-left pl-4" onClick={() => g.onOpen(i.id)} title={i.name}>
                <span className={cx('mono text-[0.64rem] font-bold w-10 shrink-0', CATEGORY_META[g.cat].cls)}>{i.badge ?? CATEGORY_META[g.cat].badge}</span>
                <span className="truncate">{i.name}</span>
              </button>
              {g.menu && (
                <Menu
                  width={230}
                  open={menuFor === i.id}
                  onOpenChange={(o) => setMenuFor(o ? i.id : undefined)}
                  trigger={
                    <button aria-label={`More actions for ${i.name}`} className="grid place-items-center h-6 w-6 rounded-md text-muted hover:text-fg hover:bg-panel2 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100">
                      <MoreHorizontal size={14} />
                    </button>
                  }
                  items={g.menu(i.id)}
                />
              )}
            </div>
          ))}
      </div>
    ));
  };
  /** A collection's contents: grouped by category when it holds more than one kind of request. */
  const renderContents = (c: Collection) => {
    if (!categorize) return renderNodes(c, c.items, 1);
    const extras = (extraGroups?.(c) ?? []).filter((g) => g.items.length);
    const cats = (['rest', 'soap', 'graphql'] as const).filter((k) => hasCategory(c.items, k));
    const hasEmptyFolders = c.items.some(isEmptyFolder);
    if (!cats.length && hasEmptyFolders) cats.push('rest');
    // the category level shows even for one kind, so every collection reads the same way
    if (!cats.length && !extras.length)
      return (
        <>
          {renderNodes(c, c.items, 1)}
          {extras.map((g) => (
            <div key={g.cat}>{renderExtra(g, 1, c.id)}</div>
          ))}
        </>
      );
    return (
      <>
        {cats.map((cat, i) => {
          const isOpen = !!f || (open[`${c.id}:cat:${cat}`] ?? true);
          if (f && !c.items.some((n) => matches(n) && inScope(n, { cat, first: i === 0 }))) return null;
          return (
            <div key={cat}>
              {categoryRow(c, cat, countCategory(c.items, cat), isOpen)}
              {isOpen && renderNodes(c, c.items, 2, { cat, first: i === 0 })}
            </div>
          );
        })}
        {extras.map((g) => {
          const isOpen = !!f || (open[`${c.id}:cat:${g.cat}`] ?? true);
          if (f && !g.items.some((i) => i.name.toLowerCase().includes(f) || i.folder?.toLowerCase().includes(f))) return null;
          return (
            <div key={g.cat}>
              {categoryRow(c, g.cat, g.items.length, isOpen)}
              {isOpen && renderExtra(g, 2, c.id)}
            </div>
          );
        })}
      </>
    );
  };
  const extraMatches = (c: Collection) => (extraGroups?.(c) ?? []).some((g) => g.items.some((i) => !f || i.name.toLowerCase().includes(f) || i.folder?.toLowerCase().includes(f)));

  return (
    <div className="text-sm">
      {editing && (
        <FolderEditor
          folder={editing.folder}
          onClose={() => setEditing(undefined)}
          onSave={(folder) => onChange({ ...editing.c, items: mapNodes(editing.c.items, (x) => (x.id === folder.id && x.kind === 'folder' ? { ...folder, items: x.items } : x)) })}
        />
      )}
      {moving && <MoveDialog node={moving.n} from={moving.c} collections={collections} onClose={() => setMoving(undefined)} onMove={(to, folderId) => move(moving.c, moving.n, to, folderId)} />}
      {collections.map((c) => {
        // grouped by category, collections start folded: the workspace lists them, expanding shows the categories
        const holdsActive = !!activeRequestId && (!!findNode(c.items, activeRequestId) || (extraGroups?.(c) ?? []).some((g) => g.items.some((i) => i.id === activeRequestId)));
        const isOpen = categorize && f ? true : open[c.id] ?? (!categorize || holdsActive);
        if (categorize && f && !c.items.some(matches) && !extraMatches(c)) return null;
        return (
          <div key={c.id}>
            <div
              className={cx('group flex items-center h-8 rounded-md mx-1 hover:bg-hover pr-1 pl-1.5 transition-colors', menuFor === c.id && 'bg-hover', dropClass(c.id))}
              {...collectionDropProps(c)}
              onContextMenu={(e) => {
                if (c.problem) return;
                e.preventDefault();
                setMenuFor(c.id);
              }}
            >
              <button className="flex items-center gap-1 flex-1 min-w-0 text-left font-medium" onClick={() => toggle(c.id)}>
                {isOpen ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
                <span className={cx('truncate', c.problem && 'text-bad')} title={c.problem}>
                  {c.name}
                </span>
              </button>
              {!c.problem && (
                <NodeMenu
                  open={menuFor === c.id}
                  onOpenChange={(o) => setMenuFor(o ? c.id : undefined)}
                  onRename={async () => {
                    const name = (await promptText('Rename collection', { value: c.name, okLabel: 'Rename' }))?.trim();
                    if (name) onChange({ ...c, name });
                  }}
                  onDuplicate={() => void duplicateCollection(c)}
                  onDelete={() => void deleteCollection(c)}
                  extraItems={[
                    ...(onNewOfCategory
                      ? (['graphql', 'soap', 'grpc', 'websocket'] as const).map((cat) => ({ label: `New ${CATEGORY_META[cat].label} request`, icon: <FilePlus2 size={14} />, onSelect: () => onNewOfCategory(c, cat) }))
                      : []),
                    ...(onSettings ? [{ label: 'Settings, runner & docs', icon: <Settings2 size={14} />, onSelect: () => onSettings(c) }] : []),
                    { label: 'Run in CI…', icon: <Workflow size={14} />, onSelect: () => useApp.getState().set({ ci: { collection: c.id } }) },
                    { label: 'Convert scripts to tp.*', icon: <Wand2 size={14} />, onSelect: () => void convertScripts(c, 'tp') },
                    { label: 'Convert scripts to pm.*', icon: <Undo2 size={14} />, onSelect: () => void convertScripts(c, 'pm') },
                  ]}
                  onNewRequest={() => onNewRequest(c)}
                  newRequestLabel={newRequestLabel}
                  onRun={onRun && (() => onRun(c))}
                  runLabel="Run collection"
                  onMonitor={() => useApp.getState().openIntent('monitors', { create: { collectionId: c.id } })}
                  onNewFolder={async () => {
                    const name = await promptText('New folder', { message: 'Folder name', okLabel: 'Create' });
                    if (name) onChange({ ...c, items: [...c.items, { kind: 'folder', id: uid('fld-'), name, items: [] }] });
                  }}
                />
              )}
            </div>
            {isOpen && renderContents(c)}
            {isOpen && !c.items.length && !(extraGroups?.(c) ?? []).some((g) => g.items.length) && <div className="pl-8 py-1 text-xs text-muted">Empty collection</div>}
          </div>
        );
      })}
      {!collections.some((c) => c.items.some(matches) || (categorize && extraMatches(c))) && (
        <p className="px-3 py-4 text-sm text-muted text-center">
          {favoritesOnly ? 'No favorite requests yet. Use a request’s menu to add one.' : f ? 'No requests match this filter.' : 'No requests in these collections yet.'}
        </p>
      )}
    </div>
  );
}

function NodeMenu({
  onEdit,
  onRename,
  onDelete,
  onNewRequest,
  onNewFolder,
  onDuplicate,
  onMove,
  onToggleFavorite,
  favorite,
  onRun,
  runLabel = 'Run',
  onMonitor,
  onOpen,
  copyItems,
  extraItems,
  open,
  onOpenChange,
  newRequestLabel = 'New request',
}: {
  newRequestLabel?: string;
  onEdit?(): void;
  onRename?(): void;
  onDelete?(): void;
  onNewRequest?(): void;
  onNewFolder?(): void;
  onDuplicate?(): void;
  /** Move to another folder or collection. */
  onMove?(): void;
  onToggleFavorite?(): void;
  favorite?: boolean;
  onRun?(): void;
  runLabel?: string;
  /** Run it on a schedule (opens Monitors with a new monitor). */
  onMonitor?(): void;
  /** Open the request (in a tab). */
  onOpen?(): void;
  /** Copy URL / Copy as cURL … (requests only). */
  copyItems?: MenuItem[];
  /** More items (e.g. collection tools), after a separator. */
  extraItems?: MenuItem[];
  /** Controlled open state, so a right-click on the row can open the menu. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const items: MenuItem[] = [];
  const add = (label: string, icon: React.ReactNode, fn?: () => void, extra: Partial<MenuItem> = {}) => fn && items.push({ label, icon, onSelect: fn, ...extra });
  add('Open in tab', <ExternalLink size={14} />, onOpen);
  add(runLabel, <Play size={14} />, onRun);
  add('Monitor on a schedule…', <AlarmClock size={14} />, onMonitor);
  add('Edit folder (scripts, variables, auth)', <FolderCog size={14} />, onEdit, { separator: !!onRun });
  add(newRequestLabel, <FilePlus2 size={14} />, onNewRequest, { separator: !!onRun });
  add('New folder', <FolderPlus size={14} />, onNewFolder);
  add('Rename', <Pencil size={14} />, onRename, { separator: !!(onNewRequest || onNewFolder) });
  add('Duplicate', <CopyPlus size={14} />, onDuplicate);
  add('Move to…', <FolderInput size={14} />, onMove);
  add(favorite ? 'Remove from favorites' : 'Add to favorites', <Star size={14} />, onToggleFavorite);
  copyItems?.forEach((it, i) => items.push(i === 0 ? { ...it, separator: true } : it));
  extraItems?.forEach((it, i) => items.push(i === 0 ? { ...it, separator: true } : it));
  add('Delete', <Trash2 size={14} />, onDelete, { danger: true, separator: true });
  return (
    <Menu
      items={items}
      width={230}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button aria-label="More actions" className="p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-panel2 hover:text-fg focus:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-panel2 transition-opacity">
          <MoreHorizontal size={15} />
        </button>
      }
    />
  );
}
