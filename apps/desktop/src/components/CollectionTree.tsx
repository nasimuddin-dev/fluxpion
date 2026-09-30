import { AlarmClock, Workflow, Braces, ChevronDown, Undo2, Wand2, ChevronRight, Code2, CopyPlus, ExternalLink, FilePlus2, Folder, FolderCog, FolderPlus, Link2, MoreHorizontal, Pencil, Play, SquareTerminal, Star, Terminal, TerminalSquare, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Collection, CollectionFolder, CollectionNode, SavedHttpRequest } from '../types';
import { asError, call } from '../api';
import { cx, Menu, type MenuItem } from './ui';
import { confirmAction, promptText, useApp } from '../store';
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
  const [menuFor, setMenuFor] = useState<string>();
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
                onDelete={async () => (await confirmAction({ title: 'Delete folder', message: `Delete the folder "${n.name}" and all requests in it?`, detail: 'This cannot be undone.', confirmLabel: 'Delete folder', danger: true })) && onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? null : x)) })}
                onNewRequest={() => onNewRequest(c, n.id)}
                onRun={onRun && (() => onRun(c, n.id))}
                runLabel="Run folder"
                onMonitor={() => useApp.getState().openIntent('monitors', { create: { collectionId: c.id, selection: [n.id] } })}
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
        <div
          className={cx('group flex items-center h-8 text-sm pr-1 rounded-md mx-1 transition-colors', activeRequestId === n.id ? 'bg-accent-soft text-fg' : 'hover:bg-hover', menuFor === n.id && 'bg-hover')}
          style={pad}
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
          <button className="flex items-center gap-2 flex-1 min-w-0 text-left pl-4" onClick={() => onOpen(c, n)}>
            <span className={cx('mono method-badge text-[0.64rem] font-bold w-10 shrink-0', n.kind === 'http' ? `method-${method}` : 'text-[#e535ab]')}>{method.slice(0, 5)}</span>
            <span className="truncate">{n.name}</span>
          </button>
          <NodeMenu
            open={menuFor === n.id}
            onOpenChange={(o) => setMenuFor(o ? n.id : undefined)}
            onOpen={() => onOpen(c, n)}
            copyItems={n.kind === 'http' ? copyMenu(c, n) : undefined}
            onRename={async () => {
              const name = await promptText('Rename request', { value: n.name, okLabel: 'Rename' });
              if (name) onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? { ...x, name } : x)) });
            }}
            onDelete={async () => (await confirmAction({ title: 'Delete request', message: `Delete the request "${n.name}"?`, detail: 'Its saved examples are deleted too. This cannot be undone.', confirmLabel: 'Delete request', danger: true })) && onChange({ ...c, items: mapNodes(c.items, (x) => (x.id === n.id ? null : x)) })}
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
            <div
              className={cx('group flex items-center h-8 rounded-md mx-1 hover:bg-hover pr-1 pl-1.5 transition-colors', menuFor === c.id && 'bg-hover')}
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
                  extraItems={[
                    { label: 'Run in CI…', icon: <Workflow size={14} />, onSelect: () => useApp.getState().set({ ci: { collection: c.id } }) },
                    { label: 'Convert scripts to tp.*', icon: <Wand2 size={14} />, onSelect: () => void convertScripts(c, 'tp') },
                    { label: 'Convert scripts to pm.*', icon: <Undo2 size={14} />, onSelect: () => void convertScripts(c, 'pm') },
                  ]}
                  onNewRequest={() => onNewRequest(c)}
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
  onMonitor,
  onOpen,
  copyItems,
  extraItems,
  open,
  onOpenChange,
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
  add('New request', <FilePlus2 size={14} />, onNewRequest, { separator: !!onRun });
  add('New folder', <FolderPlus size={14} />, onNewFolder);
  add('Rename', <Pencil size={14} />, onRename, { separator: !!(onNewRequest || onNewFolder) });
  add('Duplicate', <CopyPlus size={14} />, onDuplicate);
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
