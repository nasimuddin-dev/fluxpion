import { ChevronDown, ChevronRight, Copy, FilePlus2, Folder, FolderCog, FolderPlus, MoreHorizontal, Pencil, Play, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Collection, CollectionFolder, CollectionNode } from '../types';
import { cx, Menu, type MenuItem } from './ui';
import { promptText } from '../store';
import { uid } from '../lib/format';
import { FolderEditor } from './FolderEditor';
import { matchesCollectionNode } from '../lib/collection-filter';

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

/** Tree of collections → folders → requests with inline actions. */
export function CollectionTree({
  collections,
  activeRequestId,
  onOpen,
  onChange,
  onNewRequest,
  onRun,
  filter,
  favoritesOnly = false,
}: {
  collections: Collection[];
  activeRequestId?: string;
  onOpen(c: Collection, node: CollectionNode): void;
  onChange(c: Collection): void;
  onNewRequest(c: Collection, folderId?: string): void;
  /** Open the Collection Runner for a collection or one of its folders. */
  onRun?(c: Collection, folderId?: string): void;
  filter?: string;
  /** Show starred requests while retaining their containing folders for context. */
  favoritesOnly?: boolean;
}) {
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

  const renderNodes = (c: Collection, nodes: CollectionNode[], depth: number): React.ReactNode =>
    nodes.filter(matches).map((n) => {
      const pad = { paddingLeft: 8 + depth * 12 };
      if (n.kind === 'folder') {
        const isOpen = open[n.id] ?? !!f;
        return (
          <div key={n.id}>
            <div className="group flex items-center h-8 text-sm rounded-md mx-1 hover:bg-hover pr-1 transition-colors" style={pad}>
              <button className="flex items-center gap-1 flex-1 min-w-0 text-left" onClick={() => toggle(n.id)}>
                {isOpen ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
                <Folder size={13} className="text-muted shrink-0" />
                <span className="truncate">{n.name}</span>
                {(n.preRequestScript || n.testScript || n.variables?.length) && <span className="w-1.5 h-1.5 rounded-full bg-accent/70 shrink-0" title="Has folder scripts or variables" />}
              </button>
              <NodeMenu
                onEdit={() => setEditing({ c, folder: n })}
                onRename={async () => {
                  const name = await promptText('Rename folder', { value: n.name, okLabel: 'Rename' });
                  if (name) onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? { ...x, name } : x)) });
                }}
                onDelete={() => confirm(`Delete folder "${n.name}" and its requests?`) && onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? null : x)) })}
                onNewRequest={() => onNewRequest(c, n.id)}
                onRun={onRun && (() => onRun(c, n.id))}
                runLabel="Run folder"
                onNewFolder={async () => {
                  const name = await promptText('New folder', { message: 'Folder name', okLabel: 'Create' });
                  if (name) onChange({ ...c, items: addToFolder(c.items, n.id, { kind: 'folder', id: uid('fld-'), name, items: [] } as CollectionFolder) });
                }}
              />
            </div>
            {isOpen && renderNodes(c, n.items, depth + 1)}
          </div>
        );
      }
      const method = n.kind === 'http' ? n.request.method : 'GQL';
      const examples = n.kind === 'http' ? n.examples ?? [] : [];
      const exKey = `${n.id}:examples`;
      const examplesOpen = !!open[exKey];
      return (
        <div key={n.id}>
        <div className={cx('group flex items-center h-8 text-sm pr-1 rounded-md mx-1 transition-colors', activeRequestId === n.id ? 'bg-accent-soft text-fg' : 'hover:bg-hover')} style={pad}>
          {examples.length > 0 && (
            <button className="shrink-0 -mr-3.5 w-3.5 text-muted hover:text-fg" aria-label={examplesOpen ? 'Hide examples' : `Show ${examples.length} examples`} aria-expanded={examplesOpen} onClick={() => toggle(exKey)}>
              {examplesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )}
          <button className="flex items-center gap-2 flex-1 min-w-0 text-left pl-4" onClick={() => onOpen(c, n)}>
            <span className={cx('mono text-[0.7rem] font-bold w-9 shrink-0', n.kind === 'http' ? `method-${method}` : 'text-[#e535ab]')}>{method.slice(0, 5)}</span>
            <span className="truncate">{n.name}</span>
          </button>
          <NodeMenu
            onRename={async () => {
              const name = await promptText('Rename request', { value: n.name, okLabel: 'Rename' });
              if (name) onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? { ...x, name } : x)) });
            }}
            onDelete={() => confirm(`Delete "${n.name}"?`) && onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? null : x)) })}
            onDuplicate={() => onChange({ ...c, items: mapNodes(c.items, (x) => x).flatMap((x) => (x.id === n.id ? [x, { ...x, id: uid('req-'), name: `${x.name} copy` }] : [x])) })}
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

  return (
    <div className="text-sm">
      {editing && (
        <FolderEditor
          folder={editing.folder}
          onClose={() => setEditing(undefined)}
          onSave={(folder) => onChange({ ...editing.c, items: mapNodes(editing.c.items, (x) => (x.id === folder.id && x.kind === 'folder' ? { ...folder, items: x.items } : x)) })}
        />
      )}
      {collections.map((c) => {
        const isOpen = open[c.id] ?? true;
        return (
          <div key={c.id}>
            <div className="group flex items-center h-8 rounded-md mx-1 hover:bg-hover pr-1 pl-1.5 transition-colors">
              <button className="flex items-center gap-1 flex-1 min-w-0 text-left font-medium" onClick={() => toggle(c.id)}>
                {isOpen ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
                <span className={cx('truncate', c.problem && 'text-bad')} title={c.problem}>
                  {c.name}
                </span>
              </button>
              {!c.problem && (
                <NodeMenu
                  onNewRequest={() => onNewRequest(c)}
                  onRun={onRun && (() => onRun(c))}
                  runLabel="Run collection"
                  onNewFolder={async () => {
                    const name = await promptText('New folder', { message: 'Folder name', okLabel: 'Create' });
                    if (name) onChange({ ...c, items: [...c.items, { kind: 'folder', id: uid('fld-'), name, items: [] }] });
                  }}
                />
              )}
            </div>
            {isOpen && renderNodes(c, c.items, 1)}
            {isOpen && !c.items.length && <div className="pl-8 py-1 text-xs text-muted">Empty collection</div>}
          </div>
        );
      })}
      {!collections.some((c) => c.items.some(matches)) && (
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
  onToggleFavorite,
  favorite,
  onRun,
  runLabel = 'Run',
}: {
  onEdit?(): void;
  onRename?(): void;
  onDelete?(): void;
  onNewRequest?(): void;
  onNewFolder?(): void;
  onDuplicate?(): void;
  onToggleFavorite?(): void;
  favorite?: boolean;
  onRun?(): void;
  runLabel?: string;
}) {
  const items: MenuItem[] = [];
  const add = (label: string, icon: React.ReactNode, fn?: () => void, extra: Partial<MenuItem> = {}) => fn && items.push({ label, icon, onSelect: fn, ...extra });
  add(runLabel, <Play size={14} />, onRun);
  add('Edit folder (scripts, variables, auth)', <FolderCog size={14} />, onEdit, { separator: !!onRun });
  add('New request', <FilePlus2 size={14} />, onNewRequest, { separator: !!onRun });
  add('New folder', <FolderPlus size={14} />, onNewFolder);
  add('Rename', <Pencil size={14} />, onRename, { separator: !!(onNewRequest || onNewFolder) });
  add('Duplicate', <Copy size={14} />, onDuplicate);
  add(favorite ? 'Remove from favorites' : 'Add to favorites', <Star size={14} />, onToggleFavorite);
  add('Delete', <Trash2 size={14} />, onDelete, { danger: true, separator: true });
  return (
    <Menu
      items={items}
      trigger={
        <button aria-label="More actions" className="p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-panel2 hover:text-fg focus:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-panel2 transition-opacity">
          <MoreHorizontal size={15} />
        </button>
      }
    />
  );
}
