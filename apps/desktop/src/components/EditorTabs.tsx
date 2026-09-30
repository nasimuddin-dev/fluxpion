import { ArrowRightToLine, ChevronDown, Copy, FileCheck2, ListX, Pencil, Pin, PinOff, Plug, Plus, Radio, SquareX, Waypoints, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useApp, type ViewId } from '../store';
import { docKey, isDocView, useDoc, useDocs } from '../lib/docs';
import { cx, Menu, type MenuItem } from './ui';

/**
 * One tab strip for every request editor (Postman-style): REST's tabs and a tab for each other editor that
 * holds a document (GraphQL, gRPC, WebSocket, MCP). Each editor publishes its own tabs with what selecting,
 * closing and the right-click menu do, so no editor's drafts are touched by the strip.
 */
export interface EditorTab {
  /** Unique across editors, e.g. `rest:tab-123` or `graphql:main`. */
  key: string;
  view: ViewId;
  title: string;
  /** Method or protocol shown before the title (GET, GQL, gRPC, WS, MCP). */
  badge: string;
  badgeClass?: string;
  dirty?: boolean;
  pinned?: boolean;
  /** The saved request (or gRPC call, connection) the tab shows, highlighted in the sidebar. */
  item?: string;
  onSelect?(): void;
  onClose(): void;
  /** Close several of this editor's tabs at once (one question about unsaved changes); by keys. */
  closeMany?(keys: string[]): void;
  onRename?(): void;
  /** Open a copy of this tab (not saved yet). */
  onDuplicate?(): void;
  /** Save what the tab holds as a YAML test file. */
  onSaveAsTest?(): void;
  /** Pin or unpin the tab (pinned tabs come first and stay open on "close other / all"). */
  onTogglePin?(): void;
}

interface EditorTabsState {
  /** Tabs by publisher: an editor (`rest`, `mcp`) or one document of a multi-document editor (`graphql:<docId>`). */
  byView: Record<string, EditorTab[]>;
  /** The tab that's active inside each publisher (REST has several). */
  activeByView: Record<string, string | undefined>;
  publish(group: string, tabs: EditorTab[], active?: string): void;
  /** Editors that have a tab open: they stay mounted (and come back after a restart). REST always does. */
  openViews: ViewId[];
  setOpen(view: ViewId, open: boolean): void;
  /** Pinned tabs of the single- and multi-document editors, by tab key (REST keeps its own). */
  pinned: Record<string, boolean>;
  togglePin(key: string): void;
}

const OPEN_KEY = 'aps.openEditors';
const PIN_KEY = 'aps.pinnedTabs';
function loadPinned(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(PIN_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function loadOpen(): ViewId[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const useEditorTabsStore = create<EditorTabsState>((set, get) => ({
  byView: {},
  activeByView: {},
  openViews: loadOpen(),
  pinned: loadPinned(),
  togglePin: (key) => {
    const next = { ...get().pinned };
    if (next[key]) delete next[key];
    else next[key] = true;
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
    set({ pinned: next });
  },
  setOpen: (view, open) => {
    const cur = get().openViews;
    if (open === cur.includes(view)) return;
    const next = open ? [...cur, view] : cur.filter((v) => v !== view);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
    set({ openViews: next });
  },
  publish: (view, tabs, active) => {
    const prev = get().byView[view];
    // skip identical updates so editors can publish on every render
    const same = prev && prev.length === tabs.length && prev.every((t, i) => sameTab(t, tabs[i]!)) && get().activeByView[view] === active;
    if (same) {
      // keep the handlers fresh without re-rendering the strip
      get().byView[view] = tabs;
      return;
    }
    set({ byView: { ...get().byView, [view]: tabs }, activeByView: { ...get().activeByView, [view]: active } });
  },
}));

const sameTab = (a: EditorTab, b: EditorTab) => a.key === b.key && a.title === b.title && a.badge === b.badge && a.dirty === b.dirty && a.pinned === b.pinned;

/** Publish an editor's tabs (call it on every render; unchanged tabs don't re-render the strip). */
export function useEditorTabs(group: string, tabs: EditorTab[], active?: string) {
  const ref = useRef({ tabs, active });
  ref.current = { tabs, active };
  useEffect(() => {
    useEditorTabsStore.getState().publish(group, ref.current.tabs, ref.current.active);
  });
  useEffect(() => () => useEditorTabsStore.getState().publish(group, []), [group]);
}

/**
 * A single-document editor's tab (GraphQL, gRPC, WebSocket, MCP): shown while it holds something, hidden by
 * its close button until the editor is opened again. The draft itself is kept.
 */
export function useSingleEditorTab(view: ViewId, tab: (Omit<EditorTab, 'key' | 'view' | 'onClose'> & { item?: string }) | undefined) {
  const { docId } = useDoc();
  const item = tab?.item;
  useEffect(() => {
    if (docId) useDocs.getState().setItem(view, docId, item);
  }, [view, docId, item]);
  const current = useApp((s) => s.view);
  const [hidden, setHidden] = useState(false);
  const shown = !!tab && !hidden;
  useEffect(() => useEditorTabsStore.getState().setOpen(view, shown), [view, shown]);
  // opening the editor again shows its tab again
  useEffect(() => {
    if (current === view) setHidden(false);
  }, [current, view]);
  const key = `${view}:${docId ?? 'main'}`;
  const pinned = useEditorTabsStore((s) => !!s.pinned[key]);
  const common = {
    pinned,
    onTogglePin: () => useEditorTabsStore.getState().togglePin(key),
    onDuplicate:
      tab?.onDuplicate ??
      (docId
        ? () => {
            // the copy starts from this document's draft, not linked to the saved item (saving creates a new one)
            try {
              const draft = JSON.parse(localStorage.getItem(`aps.draft.${view}${docKey(docId)}`) ?? 'null') as Record<string, unknown> | null;
              const copy = useDocs.getState().newDoc(view);
              if (draft) {
                delete draft.requestId;
                delete draft.collectionId;
                delete draft.savedId;
                if (typeof draft.name === 'string' && draft.name) draft.name = `${draft.name} copy`;
                localStorage.setItem(`aps.draft.${view}${docKey(copy)}`, JSON.stringify(draft));
              }
              useApp.getState().setView(view);
            } catch {
              /* storage unavailable */
            }
          }
        : undefined),
  };
  useEditorTabs(
    key,
    docId && tab
      ? [
          {
            ...tab,
            ...common,
            key,
            view,
            onSelect: () => useDocs.getState().select(view, docId),
            onClose: () => {
              const docs = useDocs.getState();
              docs.close(view, docId);
              // the last document of this editor: go to another open tab (or REST)
              if (!(docs.docs[view] ?? []).length && useApp.getState().view === view) {
                const others = Object.values(useEditorTabsStore.getState().byView).flat().filter((t) => t && t.view !== view);
                const next = others[others.length - 1];
                useApp.getState().setView(next?.view ?? 'rest');
                next?.onSelect?.();
              }
            },
          },
        ]
      : tab && !hidden
      ? [
          {
            ...tab,
            ...common,
            key,
            view,
            onClose: () => {
              setHidden(true);
              // leave the editor for another open tab (or REST)
              if (useApp.getState().view === view) {
                const others = Object.values(useEditorTabsStore.getState().byView).flat().filter((t) => t && t.view !== view);
                const next = others[others.length - 1];
                useApp.getState().setView(next?.view ?? 'rest');
                next?.onSelect?.();
              }
            },
          },
        ]
      : [],
    tab ? key : undefined,
  );
}

/** "New request" everywhere (tab strip +, empty editor, explorer): every kind of request, the same list. */
export function newRequestItems(): MenuItem[] {
  const s = useApp.getState();
  return [
    { label: 'HTTP request', icon: <Plus size={14} />, shortcut: 'Ctrl+T', onSelect: () => s.openIntent('rest', { newTab: true }) },
    { label: 'GraphQL request', icon: <Plus size={14} />, onSelect: () => s.openIntent('graphql', { newDoc: true, reset: true }) },
    { label: 'gRPC request', icon: <Waypoints size={14} />, onSelect: () => s.openIntent('grpc', { newDoc: true }) },
    { label: 'WebSocket, Socket.IO or MQTT', icon: <Radio size={14} />, onSelect: () => s.openIntent('websocket', { newDoc: true }) },
    { label: 'MCP server', icon: <Plug size={14} />, onSelect: () => s.openIntent('mcp', { addServer: true }) },
  ];
}

/** The right-click menu of every tab: pin, rename, duplicate, save as test, and closing across every tab in the strip. */
function defaultTabMenu(t: EditorTab, all: EditorTab[]): MenuItem[] {
  const i = all.indexOf(t);
  // per editor: one batch close where the editor offers it (REST), else tab by tab
  const close = (list: EditorTab[]) => {
    const open = list.filter((x) => !x.pinned);
    for (const view of new Set(open.map((x) => x.view))) {
      const mine = open.filter((x) => x.view === view);
      if (mine[0]?.closeMany) mine[0].closeMany(mine.map((x) => x.key));
      else mine.forEach((x) => x.onClose());
    }
  };
  const others = all.filter((x) => x !== t && !x.pinned);
  const right = all.slice(i + 1).filter((x) => !x.pinned);
  // one menu for every tab; what an editor can't do is shown disabled, so every menu reads the same
  return [
    { label: t.pinned ? 'Unpin tab' : 'Pin tab', icon: t.pinned ? <PinOff size={13} /> : <Pin size={13} />, disabled: !t.onTogglePin, onSelect: () => t.onTogglePin?.() },
    { label: 'Rename…', icon: <Pencil size={13} />, shortcut: 'Double-click', disabled: !t.onRename, onSelect: () => t.onRename?.() },
    { label: 'Duplicate tab', icon: <Copy size={13} />, disabled: !t.onDuplicate, onSelect: () => t.onDuplicate?.() },
    { label: 'Save as test file…', icon: <FileCheck2 size={13} />, disabled: !t.onSaveAsTest, onSelect: () => t.onSaveAsTest?.() },
    { label: 'Close tab', icon: <X size={13} />, separator: true, shortcut: 'Middle-click', disabled: !!t.pinned, onSelect: () => t.onClose() },
    { label: 'Close other tabs', icon: <SquareX size={13} />, disabled: !others.length, onSelect: () => close(others) },
    { label: 'Close tabs to the right', icon: <ArrowRightToLine size={13} />, disabled: !right.length, onSelect: () => close(right) },
    { label: 'Close all tabs', icon: <ListX size={13} />, disabled: !all.some((x) => !x.pinned), onSelect: () => close(all) },
  ];
}

/** Every tab's menu, the same for every kind of request. */
const tabMenu = defaultTabMenu;

const ORDER: ViewId[] = ['rest', 'graphql', 'grpc', 'websocket', 'mcp'];
const TAB_W = 190;

export function EditorTabStrip() {
  const view = useApp((s) => s.view);
  const byView = useEditorTabsStore((s) => s.byView);
  const activeByView = useEditorTabsStore((s) => s.activeByView);
  const docs = useDocs((s) => s.docs);
  const activeDocs = useDocs((s) => s.active);
  const inOrder = ORDER.flatMap((v) => (isDocView(v) ? (docs[v] ?? []).flatMap((d) => byView[`${v}:${d}`] ?? []) : (byView[v] ?? byView[`${v}:main`] ?? [])));
  const tabs = [...inOrder.filter((t) => t.pinned), ...inOrder.filter((t) => !t.pinned)];
  const activeKey = isDocView(view) ? `${view}:${activeDocs[view]}` : activeByView[view];
  const [menuFor, setMenuFor] = useState<string>();
  const stripRef = useRef<HTMLDivElement>(null);
  // keep the active tab in view (scrolling only the strip: scrollIntoView could shift the whole window)
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !el) return;
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft;
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth;
  }, [activeKey, view]);
  const select = (t: EditorTab) => {
    if (useApp.getState().view !== t.view) useApp.getState().setView(t.view);
    t.onSelect?.();
  };
  return (
    <div className="flex items-end h-9 border-b border-line bg-panel/40 shrink-0 min-w-0">
      <div ref={stripRef} role="tablist" aria-label="Open requests" className="flex items-end min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const active = t.view === view && t.key === activeKey;
          return (
            <div
              key={t.key}
              role="tab"
              aria-selected={active}
              title={t.dirty ? `${t.title} (unsaved changes)` : t.title}
              onClick={() => select(t)}
              onDoubleClick={t.onRename}
              onAuxClick={(e) => e.button === 1 && !t.pinned && t.onClose()}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuFor(t.key);
              }}
              style={{ width: t.pinned ? 120 : TAB_W }}
              className={cx(
                'group relative flex items-center gap-1.5 h-9 px-3 border-r border-line text-sm cursor-pointer shrink-0',
                active ? 'bg-bg text-fg after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-[image:var(--brand-gradient)]' : 'text-muted hover:bg-hover hover:text-fg',
              )}
            >
              {t.pinned && <Pin size={11} className="shrink-0 text-muted" aria-label="Pinned" />}
              <span className={cx('mono method-badge text-[0.62rem] font-bold shrink-0', t.badgeClass)}>{t.badge}</span>
              <span className="truncate flex-1 min-w-0">{t.title}</span>
              {t.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unsaved changes" />}
              {!t.pinned && (
                <button aria-label={`Close ${t.title}`} className={cx('shrink-0 rounded p-0.5 hover:text-fg hover:bg-hover focus:opacity-100', active ? 'opacity-60' : 'opacity-0 group-hover:opacity-100')} onClick={(e) => (e.stopPropagation(), t.onClose())}>
                  <X size={12} />
                </button>
              )}
              {menuFor === t.key && (
                <Menu open onOpenChange={(o) => !o && setMenuFor(undefined)} align="start" width={210} items={tabMenu(t, tabs)} trigger={<span aria-hidden className="absolute left-2 bottom-0 w-0 h-0" />} />
              )}
            </div>
          );
        })}
      </div>
      <Menu
        width={240}
        align="start"
        trigger={
          <button aria-label="New tab" title="New request (HTTP, GraphQL, gRPC, WebSocket, MCP)" className="mx-1 mb-1 shrink-0 grid place-items-center h-7 w-7 rounded-md text-muted hover:text-fg hover:bg-hover data-[state=open]:bg-hover">
            <Plus size={14} />
          </button>
        }
        items={newRequestItems()}
      />
      {tabs.length > 1 && (
        <Menu
          align="end"
          width={300}
          items={tabs.map((t) => ({ label: `${t.title}${t.dirty ? ' •' : ''}`, icon: <span className={cx('mono method-badge text-[0.6rem] font-bold w-11', t.badgeClass)}>{t.badge}</span>, onSelect: () => select(t) }))}
          trigger={
            <button aria-label="All open tabs" title="All open tabs" className="ml-auto mr-1.5 mb-1 shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted border border-line bg-bg hover:text-fg hover:bg-hover data-[state=open]:text-fg data-[state=open]:bg-hover">
              {tabs.length}
              <ChevronDown size={13} />
            </button>
          }
        />
      )}
    </div>
  );
}
