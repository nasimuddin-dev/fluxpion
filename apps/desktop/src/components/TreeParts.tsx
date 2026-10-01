import { ChevronDown, ChevronRight, Folder, FolderInput, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { confirmAction, promptText } from '../store';
import { cx, IconButton, Menu, rowActionClass, type MenuItem } from './ui';

/*
 * The parts every sidebar tree is made of (the explorer, monitors, load tests, saved prompts …), so they all look
 * and behave the same: a header with + and ⋯, folder rows, the ⋯ and + buttons of a row, and the folder menus.
 */

/** The ⋯ button of a row: opens its menu (a right-click on the row opens the same one). */
export function RowMenu({ label, items, open, onOpenChange, header }: { label: string; items: MenuItem[]; open?: boolean; onOpenChange?(open: boolean): void; header?: boolean }) {
  return (
    <Menu
      width={230}
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      trigger={
        <button aria-label={`More actions for ${label}`} className={rowActionClass(header)} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal size={14} />
        </button>
      }
    />
  );
}

/** The + button of a row (new item in it). */
export function RowAdd({ label, onClick, header }: { label: string; onClick(): void; header?: boolean }) {
  return (
    <IconButton
      label={label}
      className={rowActionClass(header)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Plus size={14} />
    </IconButton>
  );
}

/** A count beside a title or folder name. */
export function CountPill({ n }: { n: number }) {
  return <span className="text-[0.7rem] px-1.5 rounded-full bg-panel2 text-muted tabular-nums shrink-0">{n}</span>;
}

/** The header of a sidebar list: title, count, + (new) and ⋯ (also on right-click). */
export function TreeHeader({ title, icon, count, addLabel, onAdd, menu = [] }: { title: string; icon?: ReactNode; count?: number; addLabel?: string; onAdd?(): void; menu?: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const items: MenuItem[] = [...(onAdd ? [{ label: addLabel ?? 'New', icon: <Plus size={14} />, onSelect: onAdd }] : []), ...menu];
  return (
    <div
      className={cx('group flex items-center gap-0.5 h-9 pl-3 pr-1 shrink-0', open && 'bg-hover')}
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      {icon && <span className="text-muted shrink-0 mr-1">{icon}</span>}
      <span className="text-[0.82rem] font-semibold truncate">{title}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-1.5">
          <CountPill n={count} />
        </span>
      )}
      <span className="flex-1" />
      {onAdd && <RowAdd label={addLabel ?? 'New'} onClick={onAdd} header />}
      {items.length > 0 && <RowMenu label={title} items={items} open={open} onOpenChange={setOpen} header />}
    </div>
  );
}

/** A folder row: chevron, folder icon, name, count and ⋯ (also on right-click); drop props make it a drop target. */
export function TreeFolderRow({
  name,
  count,
  open,
  onToggle,
  menu,
  dropTarget,
  className,
  ...rest
}: { name: string; count: number; open: boolean; onToggle(): void; menu: MenuItem[]; dropTarget?: boolean } & Omit<HTMLAttributes<HTMLDivElement>, 'onToggle'>) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      {...rest}
      className={cx(
        'group flex items-center h-8 text-sm rounded-md mx-1 pr-1 transition-colors',
        dropTarget ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-hover',
        menuOpen && 'bg-hover',
        className ?? 'pl-2',
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button className="flex items-center gap-1 flex-1 min-w-0 text-left" onClick={onToggle} aria-expanded={open} data-tree-row>
        {open ? <ChevronDown size={13} className="text-muted shrink-0" /> : <ChevronRight size={13} className="text-muted shrink-0" />}
        <Folder size={13} className="text-muted shrink-0" />
        <span className="truncate flex-1">{name}</span>
        <CountPill n={count} />
      </button>
      <RowMenu label={`folder ${name}`} items={menu} open={menuOpen} onOpenChange={setMenuOpen} />
    </div>
  );
}

/** A folder's menu, the same in every tree: new item here, rename, delete (its items move to the top level). */
export function folderMenuItems({
  name,
  itemNoun = 'item',
  addLabel,
  onAdd,
  rename,
  remove,
}: {
  name: string;
  itemNoun?: string;
  addLabel?: string;
  onAdd?(): void;
  rename(to: string): unknown;
  remove(): unknown;
}): MenuItem[] {
  return [
    ...(onAdd ? [{ label: `${addLabel ?? 'New'} here`, icon: <Plus size={14} />, onSelect: onAdd }] : []),
    {
      label: 'Rename folder',
      icon: <Pencil size={14} />,
      onSelect: async () => {
        const to = (await promptText('Rename folder', { message: 'Folder name', value: name, okLabel: 'Rename' }))?.trim();
        if (to && to !== name) await rename(to);
      },
    },
    {
      label: 'Delete folder',
      icon: <Trash2 size={14} />,
      danger: true,
      separator: true,
      onSelect: async () => {
        if (
          await confirmAction({
            title: 'Delete folder',
            message: `Delete the folder "${name}"?`,
            detail: `Its ${itemNoun}s are kept and move to the top level.`,
            confirmLabel: 'Delete folder',
            danger: true,
          })
        )
          await remove();
      },
    },
  ];
}

/** Ask for a new folder's name. */
export const askFolderName = async () => (await promptText('New folder', { message: 'Folder name', okLabel: 'Create' }))?.trim() || undefined;

/** "Move to folder" in an item's menu: each folder, a new one, or the top level. */
export function moveToFolderItem({ folders, current, move }: { folders: string[]; current?: string; move(folder: string | undefined): unknown }): MenuItem {
  const others = folders.filter((f) => f !== current);
  return {
    label: 'Move to folder',
    icon: <FolderInput size={14} />,
    onSelect: () => undefined,
    items: [
      ...others.map((f) => ({ label: f, icon: <Folder size={14} />, onSelect: () => void move(f) })),
      {
        label: 'New folder…',
        icon: <FolderPlus size={14} />,
        separator: others.length > 0,
        onSelect: async () => {
          const name = await askFolderName();
          if (name) await move(name);
        },
      },
      ...(current ? [{ label: 'Move to top level', icon: <FolderOpen size={14} />, onSelect: () => void move(undefined) }] : []),
    ],
  };
}
