import { ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Collection, CollectionFolder, CollectionNode } from '../types';
import { cx } from './ui';
import { promptText } from '../store';
import { uid } from '../lib/format';

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
}: {
  collections: Collection[];
  activeRequestId?: string;
  onOpen(c: Collection, node: CollectionNode): void;
  onChange(c: Collection): void;
  onNewRequest(c: Collection, folderId?: string): void;
  /** Open the Collection Runner for a collection or one of its folders. */
  onRun?(c: Collection, folderId?: string): void;
  filter?: string;
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
  const f = filter?.toLowerCase();
  const matches = (n: CollectionNode): boolean =>
    !f || n.name.toLowerCase().includes(f) || (n.kind === 'http' && n.request.url.toLowerCase().includes(f)) || (n.kind === 'folder' && n.items.some(matches));

  const renderNodes = (c: Collection, nodes: CollectionNode[], depth: number): React.ReactNode =>
    nodes.filter(matches).map((n) => {
      const pad = { paddingLeft: 8 + depth * 12 };
      if (n.kind === 'folder') {
        const isOpen = open[n.id] ?? !!f;
        return (
          <div key={n.id}>
            <div className="group flex items-center h-7 text-sm hover:bg-hover pr-1" style={pad}>
              <button className="flex items-center gap-1 flex-1 min-w-0 text-left" onClick={() => toggle(n.id)}>
                {isOpen ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
                <Folder size={13} className="text-muted shrink-0" />
                <span className="truncate">{n.name}</span>
              </button>
              <NodeMenu
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
      return (
        <div key={n.id} className={cx('group flex items-center h-7 text-sm pr-1 hover:bg-hover', activeRequestId === n.id && 'bg-accent/10')} style={pad}>
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
          />
        </div>
      );
    });

  return (
    <div className="text-sm">
      {collections.map((c) => {
        const isOpen = open[c.id] ?? true;
        return (
          <div key={c.id}>
            <div className="group flex items-center h-7 hover:bg-hover pr-1 pl-1.5">
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
    </div>
  );
}

function NodeMenu({
  onRename,
  onDelete,
  onNewRequest,
  onNewFolder,
  onDuplicate,
  onRun,
  runLabel = 'Run',
}: {
  onRename?(): void;
  onDelete?(): void;
  onNewRequest?(): void;
  onNewFolder?(): void;
  onDuplicate?(): void;
  onRun?(): void;
  runLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const items: Array<[string, React.ReactNode, (() => void) | undefined]> = [
    [runLabel, <Play size={13} />, onRun],
    ['New request', <FilePlus2 size={13} />, onNewRequest],
    ['New folder', <FolderPlus size={13} />, onNewFolder],
    ['Rename', <Pencil size={13} />, onRename],
    ['Duplicate', <FilePlus2 size={13} />, onDuplicate],
    ['Delete', <Trash2 size={13} />, onDelete],
  ];
  return (
    <div className="relative">
      <button aria-label="More actions" className="p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:bg-panel2 focus:opacity-100" onClick={() => setOpen(!open)}>
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-40 w-40 rounded-md border border-line bg-bg shadow-lg p-1">
            {items
              .filter(([, , fn]) => fn)
              .map(([label, icon, fn]) => (
                <button
                  key={label}
                  className={cx('w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-hover', label === 'Delete' && 'text-bad')}
                  onClick={() => {
                    setOpen(false);
                    fn!();
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
