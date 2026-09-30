import { ChevronDown, ChevronRight, Copy, Folder, FolderInput, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { confirmAction, promptText } from '../store';
import { cx, IconButton, Menu, type MenuItem } from './ui';

export interface FolderListItem {
  id: string;
  name: string;
  folder?: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

/** What a list can do with its items and folders; each view stores them its own way. */
export interface FolderListOps {
  renameItem(id: string, name: string): void | Promise<void>;
  moveItem(id: string, folder: string | undefined): void | Promise<void>;
  deleteItem(id: string): void | Promise<void>;
  duplicateItem?(id: string): void | Promise<void>;
  setFolders(folders: string[]): void | Promise<void>;
  renameFolder(from: string, to: string): void | Promise<void>;
  /** Remove a folder; its items move to the top level. */
  deleteFolder(name: string): void | Promise<void>;
}

const collapsedKey = (id: string) => `aps.folders.${id}`;

/**
 * Sidebar list with folders, like the REST collections: collapsible folders, New folder, rename, move to
 * folder (menu or drag and drop), duplicate, delete, and a right-click menu on every row.
 */
export function FolderList({
  id,
  title,
  items,
  folders,
  selected,
  onSelect,
  onAdd,
  addLabel,
  ops,
  itemMenu,
  itemNoun = 'item',
  empty,
}: {
  /** Stable id (remembers which folders are collapsed). */
  id: string;
  title: string;
  items: FolderListItem[];
  folders: string[];
  selected?: string;
  onSelect(id: string): void;
  /** Add an item (inside a folder when given). */
  onAdd(folder?: string): void;
  addLabel: string;
  ops: FolderListOps;
  /** Extra menu entries for an item (shown before the standard ones). */
  itemMenu?(id: string): MenuItem[];
  itemNoun?: string;
  empty?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(collapsedKey(id)) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [menuFor, setMenuFor] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string | null>();
  const toggle = (f: string) =>
    setCollapsed((c) => {
      const next = { ...c, [f]: !c[f] };
      try {
        localStorage.setItem(collapsedKey(id), JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  const allFolders = [...new Set([...folders, ...items.map((i) => i.folder).filter((f): f is string => !!f)])].sort((a, b) => a.localeCompare(b));

  const newFolder = async () => {
    const name = (await promptText('New folder', { message: 'Folder name', value: '', okLabel: 'Create' }))?.trim();
    if (name && !allFolders.includes(name)) await ops.setFolders([...allFolders, name]);
  };
  const moveTo = async (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    const name = await promptText(`Move ${item?.name ?? itemNoun}`, {
      message: allFolders.length ? `Folder name: an existing one (${allFolders.join(', ')}) or a new one.` : 'Folder name (a new folder is created).',
      value: item?.folder ?? allFolders[0] ?? '',
      okLabel: 'Move',
    });
    if (!name) return;
    const folder = name.trim();
    if (folder && !allFolders.includes(folder)) await ops.setFolders([...allFolders, folder]);
    await ops.moveItem(itemId, folder);
  };
  const standardMenu = (it: FolderListItem): MenuItem[] => [
    ...(itemMenu?.(it.id) ?? []),
    { label: 'Rename…', icon: <Pencil size={14} />, separator: !!itemMenu, onSelect: () => void promptText(`Rename ${itemNoun}`, { message: 'Name', value: it.name, okLabel: 'Rename' }).then((n) => n?.trim() && ops.renameItem(it.id, n.trim())) },
    { label: 'Move to folder…', icon: <FolderInput size={14} />, onSelect: () => void moveTo(it.id) },
    ...(it.folder ? [{ label: 'Move to top level', icon: <FolderOpen size={14} />, onSelect: () => void ops.moveItem(it.id, undefined) }] : []),
    ...(ops.duplicateItem ? [{ label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => void ops.duplicateItem!(it.id) }] : []),
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      danger: true,
      separator: true,
      onSelect: () => void confirmAction({ title: `Delete ${itemNoun}`, message: `Delete "${it.name}"?`, confirmLabel: 'Delete', danger: true }).then((ok) => ok && ops.deleteItem(it.id)),
    },
  ];
  const folderMenu = (f: string): MenuItem[] => [
    { label: `${addLabel} here`, icon: <Plus size={14} />, onSelect: () => onAdd(f) },
    { label: 'Rename folder…', icon: <Pencil size={14} />, onSelect: () => void promptText('Rename folder', { message: 'Folder name', value: f, okLabel: 'Rename' }).then((n) => n?.trim() && n.trim() !== f && ops.renameFolder(f, n.trim())) },
    {
      label: 'Delete folder',
      icon: <Trash2 size={14} />,
      danger: true,
      separator: true,
      onSelect: () =>
        void confirmAction({ title: 'Delete folder', message: `Delete the folder "${f}"?`, detail: `Its ${itemNoun}s are kept and move to the top level.`, confirmLabel: 'Delete folder', danger: true }).then((ok) => ok && ops.deleteFolder(f)),
    },
  ];

  // drag an item onto a folder (or the top level) to move it
  const dropProps = (folder: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-testpion-item')) return;
      e.preventDefault();
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget(undefined),
    onDrop: (e: React.DragEvent) => {
      const itemId = e.dataTransfer.getData('application/x-testpion-item');
      setDropTarget(undefined);
      if (itemId) void ops.moveItem(itemId, folder ?? undefined);
    },
  });

  const row = (it: FolderListItem, nested: boolean) => (
    <div
      key={it.id}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-testpion-item', it.id)}
      onContextMenu={(e) => (e.preventDefault(), setMenuFor(it.id))}
      className={cx('group flex items-start gap-1 pr-1 border-l-2 cursor-pointer', nested ? 'pl-5' : 'pl-2', selected === it.id ? 'bg-accent-soft border-accent' : 'border-transparent hover:bg-hover', menuFor === it.id && 'bg-hover')}
      onClick={() => onSelect(it.id)}
    >
      <div className="flex-1 min-w-0 py-1.5">
        <div className="flex items-center gap-2 text-sm">
          {it.icon}
          <span className="font-medium truncate">{it.name}</span>
          {it.badge}
        </div>
        {it.subtitle && <div className="text-xs text-muted truncate mono pl-4">{it.subtitle}</div>}
      </div>
      <Menu
        open={menuFor === it.id}
        onOpenChange={(o) => setMenuFor(o ? it.id : undefined)}
        width={210}
        items={standardMenu(it)}
        trigger={
          <IconButton label={`Actions for ${it.name}`} className={cx('mt-1 h-6 w-6 shrink-0', menuFor === it.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal size={14} />
          </IconButton>
        }
      />
    </div>
  );

  const top = items.filter((i) => !i.folder);
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 pl-3 pr-1 h-9 shrink-0">
        <span className="text-[11px] font-semibold tracking-wider uppercase text-muted flex-1 truncate">{title}</span>
        <IconButton label="New folder" onClick={() => void newFolder()}>
          <FolderPlus size={14} />
        </IconButton>
        <IconButton label={addLabel} onClick={() => onAdd()}>
          <Plus size={14} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-auto pb-2">
        {allFolders.map((f) => {
          const inFolder = items.filter((i) => i.folder === f);
          const open = !collapsed[f];
          return (
            <div key={`folder:${f}`}>
              <div
                {...dropProps(f)}
                onContextMenu={(e) => (e.preventDefault(), setMenuFor(`folder:${f}`))}
                className={cx('group flex items-center gap-1.5 px-2 h-8 text-sm cursor-pointer select-none', dropTarget === f ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-hover', menuFor === `folder:${f}` && 'bg-hover')}
                onClick={() => toggle(f)}
              >
                {open ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
                {open ? <FolderOpen size={14} className="text-muted" /> : <Folder size={14} className="text-muted" />}
                <span className="truncate flex-1">{f}</span>
                <span className="text-xs text-muted">{inFolder.length}</span>
                <Menu
                  open={menuFor === `folder:${f}`}
                  onOpenChange={(o) => setMenuFor(o ? `folder:${f}` : undefined)}
                  width={210}
                  items={folderMenu(f)}
                  trigger={
                    <IconButton label={`Actions for folder ${f}`} className={cx('h-6 w-6', menuFor === `folder:${f}` ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')} onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal size={14} />
                    </IconButton>
                  }
                />
              </div>
              {open && inFolder.map((it) => row(it, true))}
              {open && !inFolder.length && <div className="pl-9 py-1 text-xs text-muted">Empty: drag a {itemNoun} here or use Move to folder.</div>}
            </div>
          );
        })}
        <div {...dropProps(null)} className={cx(dropTarget === null && 'bg-accent-soft/60')}>
          {top.map((it) => row(it, false))}
          {!items.length && !allFolders.length && empty}
          {allFolders.length > 0 && <div className="h-6" aria-hidden />}
        </div>
      </div>
    </div>
  );
}

/** FolderListOps for a Library (lib.get / lib.save) held in state: every change is saved. */
export function libraryOps<T>(lib: { folders: string[]; items: Array<{ id: string; name: string; folder?: string; data: T }> }, save: (next: typeof lib) => void | Promise<void>, newId: () => string): FolderListOps {
  const items = lib.items;
  return {
    renameItem: (id, name) => save({ ...lib, items: items.map((i) => (i.id === id ? { ...i, name } : i)) }),
    moveItem: (id, folder) => save({ ...lib, items: items.map((i) => (i.id === id ? { ...i, folder } : i)) }),
    deleteItem: (id) => save({ ...lib, items: items.filter((i) => i.id !== id) }),
    duplicateItem: (id) => {
      const it = items.find((i) => i.id === id);
      if (it) return save({ ...lib, items: [...items, { ...it, id: newId(), name: `${it.name} copy` }] });
    },
    setFolders: (folders) => save({ ...lib, folders }),
    renameFolder: (from, to) => save({ folders: lib.folders.map((f) => (f === from ? to : f)), items: items.map((i) => (i.folder === from ? { ...i, folder: to } : i)) }),
    deleteFolder: (name) => save({ folders: lib.folders.filter((f) => f !== name), items: items.map((i) => (i.folder === name ? { ...i, folder: undefined } : i)) }),
  };
}
