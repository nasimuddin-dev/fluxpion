import { ArrowRightToLine, BookmarkPlus, ChevronDown, Code2, ListX, MoreHorizontal, Pencil, SquareX, Cookie, Copy, FolderPlus, FolderTree, History, KeyRound, Pin, PinOff, Sparkles, Plus, Save, Send, Square, Star, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asError, call, on, type NormalizedError } from '../api';
import { confirmAction, promptText, useApp, persisted } from '../store';
import { useIntent, useSendShortcut } from '../hooks';
import type { BodyConfig, CheckConfig, CheckResult, Collection, CollectionNode, HttpRequestSpec, HttpResponseData, KeyValue, SavedExample, SavedHttpRequest, SseEvent } from '../types';
import { fromEngineRequest, paramsFromUrl, syncPathVariables, toEngineRequest, urlFromParams } from '../lib/url';
import { CodeModal } from '../components/CodeModal';
import { CookiesModal, hostOf } from '../components/CookiesModal';
import { ExamplesPanel } from '../components/ExamplesPanel';
import { Markdown } from '../components/Markdown';
import { EnvironmentsPane, HistoryPane } from '../components/SidebarPanes';
import { ScriptsPanel } from '../components/ScriptsPanel';
import { uid } from '../lib/format';

/** Browser devtools "Copy as cURL (bash/cmd) / fetch / fetch (Node.js) / PowerShell" output. */
const isRequestSnippet = (t: string) =>
  /^\s*(?:curl(?:\.exe)?\s|(?:(?:const|let|var)\s+\w+\s*=\s*)?(?:await\s+)?fetch\s*\(|(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\s)/i.test(t) ||
  (/^\s*\$\w+\s*=/.test(t) && /\b(?:Invoke-WebRequest|Invoke-RestMethod)\b/i.test(t));
const SNIPPET_LABEL: Record<string, string> = { curl: 'cURL command', fetch: 'fetch call', powershell: 'PowerShell command' };
/** A tab name like "POST /v1/pets" for a pasted request. */
const snippetName = (r: HttpRequestSpec) => {
  let path = r.url;
  try {
    path = new URL(r.url).pathname;
  } catch {
    /* keep the raw URL */
  }
  return `${r.method} ${path}`.slice(0, 60);
};
const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.closest('.cm-editor'));
import { AssertionEditor } from '../components/AssertionEditor';
import { AuthEditor } from '../components/AuthEditor';
import { CodeEditor } from '../components/CodeEditor';
import { addToFolder, CollectionTree, findNode, mapNodes } from '../components/CollectionTree';
import { COMMON_HEADERS, KeyValueEditor } from '../components/KeyValueEditor';
import { ResponseViewer } from '../components/ResponseViewer';
import { SseEvents } from '../components/SseEvents';
import { ErrorPanel } from '../components/Results';
import { VarInput } from '../components/VarInput';
import { pickTextFile } from '../lib/files';
import { Button, cx, Empty, Field, IconButton, Input, Menu, Modal, Select, Split, Tabs, Toggle, Tooltip, type MenuItem } from '../components/ui';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
/** Request tab widths; tabs that don't fit go into the "+N" overflow dropdown. */
const TAB_WIDTH = 180;
const PINNED_TAB_WIDTH = 150;
/** Room kept for the new-tab, tab-actions and overflow buttons. */
const TAB_STRIP_RESERVED = 140;

interface RestTab {
  id: string;
  name: string;
  request: HttpRequestSpec;
  preRequestScript?: string;
  testScript?: string;
  assertions: CheckConfig[];
  collectionId?: string;
  requestId?: string;
  /** Markdown documentation, saved with the request. */
  description?: string;
  /** Saved responses; persisted straight to the collection, so changing them does not make the tab dirty. */
  examples?: SavedExample[];
  dirty?: boolean;
  /** Pinned tabs stay first and are not closed by "close others / all". */
  pinned?: boolean;
}

interface SendResult {
  response?: HttpResponseData;
  error?: NormalizedError;
  checks?: CheckResult[];
  traceId?: string;
  scriptLogs?: string[];
  visualizer?: { html?: string; error?: string; vizId?: string };
  historyId?: string;
  unresolved?: string[];
  curl?: string;
  stream?: string;
}

const blankRequest = (): RestTab => ({
  id: uid('tab-'),
  name: 'Untitled request',
  request: { method: 'GET', url: '{{baseUrl}}/', params: [], headers: [], auth: { type: 'inherit' }, body: { type: 'none' } },
  assertions: [{ type: 'status', expected: 200 }],
});

const drafts = persisted<{ tabs: RestTab[]; active?: string }>('rest', { tabs: [] });

export function RestView() {
  const [tabs, setTabs] = useState<RestTab[]>(() => {
    const d = drafts.load();
    // drafts from before the URL/params sync kept the query only in the Params table
    if (d.tabs.length) return d.tabs.map((t) => (t.request.url.includes('?') ? t : { ...t, request: fromEngineRequest(t.request) }));
    // first launch gets a blank request; if the user closed every tab (active saved as ''), keep it that way
    return d.active === '' ? [] : [blankRequest()];
  });
  const [active, setActive] = useState<string>(() => drafts.load().active ?? tabs[0]?.id ?? '');
  const [results, setResults] = useState<Record<string, SendResult>>({});
  const [sending, setSending] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [filter, setFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(() => localStorage.getItem('aps.rest.favoritesOnly') === 'true');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [side, setSideState] = useState<'collections' | 'environments' | 'history'>(() => {
    try {
      return (localStorage.getItem('aps.rest.sidebar') as 'collections') || 'collections';
    } catch {
      return 'collections';
    }
  });
  const setSide = (v: typeof side) => {
    setSideState(v);
    try {
      localStorage.setItem('aps.rest.sidebar', v);
    } catch {
      /* ignore */
    }
  };
  const env = useApp((s) => s.environment);
  // with every tab closed, a stable placeholder keeps the hooks below simple; the editor shows an empty state
  const placeholder = useMemo(() => blankRequest(), []);
  const noTabs = tabs.length === 0;
  const tab = tabs.find((t) => t.id === active) ?? tabs[0] ?? placeholder;
  const newTab = () => {
    const t = blankRequest();
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
  };
  const streams = useRef<Record<string, string>>({});
  /** Server-Sent Events arriving for requests still being sent, by send id (shown live). */
  const [liveEvents, setLiveEvents] = useState<Record<string, SseEvent[]>>({});

  useEffect(() => drafts.save({ tabs, active }), [tabs, active]);
  const loadCollections = useCallback(() => call<Collection[]>('col.list').then(setCollections), []);
  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);
  useEffect(
    () =>
      on<Array<{ id: string; chunk: string }>>('http.chunks', (items) => {
        for (const it of items) streams.current[it.id] = (streams.current[it.id] ?? '') + it.chunk;
      }),
    [],
  );
  useEffect(
    () =>
      on<Array<{ id: string; event: SseEvent }>>('http.sse', (items) =>
        setLiveEvents((cur) => {
          const next = { ...cur };
          for (const it of items) next[it.id] = [...(next[it.id] ?? []), it.event];
          return next;
        }),
      ),
    [],
  );

  const update = (patch: Partial<RestTab>) => setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, ...patch, dirty: true } : t)));
  const setReq = (patch: Partial<HttpRequestSpec>) => update({ request: { ...tab.request, ...patch } });
  const setExamples = (examples: SavedExample[]) => setTabs((ts) => ts.map((t) => (t.requestId && t.requestId === tab.requestId ? { ...t, examples } : t)));
  /** URL bar edits update the Params table and path variables (Postman behaviour). */
  const setUrl = (url: string) => setReq({ url, params: paramsFromUrl(url, tab.request.params), pathVariables: syncPathVariables(url, tab.request.pathVariables) });
  /** Params table edits rebuild the URL's query string. */
  const setParams = (params: KeyValue[]) => setReq({ params, url: urlFromParams(tab.request.url, params) });
  /**
   * Pasting a cURL / fetch / PowerShell snippet imports it. From the URL bar it fills the current
   * tab; pasted anywhere else in the view it fills a pristine tab or opens a new one.
   */
  const importSnippet = async (text: string, into: 'current' | 'auto' = 'current') => {
    try {
      const { format, request } = await call<{ format?: string; request: HttpRequestSpec }>('http.parseSnippet', { text });
      const req = fromEngineRequest(request);
      const name = snippetName(request);
      const target = tabs.find((t) => t.id === active);
      const reuse = into === 'current' ? !!target : !!target && !target.dirty && !target.requestId;
      if (reuse && target) setTabs((ts) => ts.map((t) => (t.id === target.id ? { ...t, request: req, name: t.requestId ? t.name : name, dirty: true } : t)));
      else {
        const t: RestTab = { ...blankRequest(), name, request: req, dirty: true };
        setTabs((ts) => [...ts, t]);
        setActive(t.id);
      }
      useApp.getState().toast(`Imported ${SNIPPET_LABEL[format ?? 'curl'] ?? 'request'}`, 'success');
    } catch (e) {
      useApp.getState().toast(`Couldn't import the pasted request: ${asError(e).message}`, 'error');
    }
  };
  const importSnippetRef = useRef(importSnippet);
  importSnippetRef.current = importSnippet;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // views stay mounted in the background; only the visible REST view handles the paste
      if (useApp.getState().view !== 'rest' || isEditable(e.target) || isEditable(document.activeElement)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!isRequestSnippet(text)) return;
      e.preventDefault();
      void importSnippetRef.current(text, 'auto');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const openRequest = (c: Collection, n: CollectionNode) => {
    if (n.kind === 'graphql') return useApp.getState().openIntent('graphql', { collectionId: c.id, requestId: n.id });
    if (n.kind !== 'http') return;
    const existing = tabs.find((t) => t.requestId === n.id);
    if (existing) return setActive(existing.id);
    const t: RestTab = { id: uid('tab-'), name: n.name, request: fromEngineRequest(structuredClone(n.request)), preRequestScript: n.preRequestScript, testScript: n.testScript, assertions: n.assertions ?? [], collectionId: c.id, requestId: n.id, examples: n.examples, description: n.description };
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
  };

  useIntent('rest', async (p) => {
    if (p?.tabCommand) return runTabCommand(p.tabCommand);
    if (p?.newTab) {
      const t = blankRequest();
      setTabs((ts) => [...ts, t]);
      setActive(t.id);
    } else if (p?.collectionId) {
      const cols = await call<Collection[]>('col.list');
      setCollections(cols);
      const c = cols.find((x) => x.id === p.collectionId);
      const n = c && findNode(c.items, p.requestId);
      if (c && n) openRequest(c, n);
      // "More code snippets…" in the collection tree
      if (c && n && p.showCode) setShowCode(true);
    } else if (p?.request) {
      const t: RestTab = { ...blankRequest(), name: p.name ?? 'From history', request: fromEngineRequest(p.request) };
      setTabs((ts) => [...ts, t]);
      setActive(t.id);
    }
  });

  const send = async () => {
    const id = uid('send-');
    const tabId = tab.id;
    setSending((s) => ({ ...s, [tabId]: id }));
    streams.current[id] = '';
    useApp.getState().setActivity(id, `Sending ${tab.request.method} ${tab.name}`);
    try {
      const r = await call<SendResult & { id: string }>('http.send', {
        id,
        name: tab.name,
        request: toEngineRequest(tab.request),
        environment: env,
        collectionId: tab.collectionId,
        requestId: tab.requestId,
        preRequestScript: tab.preRequestScript,
        testScript: tab.testScript,
        assertions: tab.assertions,
        stream: tab.request.headers?.some((h) => /accept/i.test(h.key) && /event-stream/.test(h.value)),
      });
      const curl = await call<string>('http.code', { request: toEngineRequest(tab.request), environment: env, collectionId: tab.collectionId, requestId: tab.requestId, language: 'curl' }).catch(() => undefined);
      setResults((rs) => ({ ...rs, [tabId]: { ...r, curl, stream: streams.current[id] || undefined } }));
      if (r.unresolved?.length) useApp.getState().toast(`Unresolved variables: ${r.unresolved.join(', ')}`, 'error');
    } catch (e) {
      setResults((rs) => ({ ...rs, [tabId]: { error: asError(e) } }));
    } finally {
      delete streams.current[id];
      setLiveEvents((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
      useApp.getState().setActivity(id);
      setSending((s) => {
        const n = { ...s };
        delete n[tabId];
        return n;
      });
    }
  };
  const cancel = () => sending[tab.id] && call('http.cancel', { id: sending[tab.id] });
  useSendShortcut('rest', () => (noTabs || sending[tab.id] ? undefined : void send()));

  const saveCollection = async (c: Collection) => {
    await call('col.save', c);
    await loadCollections();
  };

  const saveTab = async (collectionId: string, name: string, folderId?: string) => {
    const cols = await call<Collection[]>('col.list');
    const c = cols.find((x) => x.id === collectionId);
    if (!c) return useApp.getState().toast('That collection no longer exists — pick another one', 'error');
    const exists = tab.requestId ? findNode(c.items, tab.requestId) : undefined;
    // examples are saved on their own, so keep what is on disk
    const examples = exists?.kind === 'http' ? exists.examples : undefined;
    const node: SavedHttpRequest = {
      kind: 'http',
      id: tab.requestId ?? uid('req-'),
      name,
      request: toEngineRequest(tab.request),
      description: tab.description?.trim() ? tab.description : undefined,
      preRequestScript: tab.preRequestScript,
      testScript: tab.testScript,
      assertions: tab.assertions,
      examples,
    };
    const items = exists ? mapNodes(c.items, (n) => (n.id === node.id ? node : n)) : addToFolder(c.items, folderId, node);
    await saveCollection({ ...c, items });
    setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, name, collectionId, requestId: node.id, dirty: false } : t)));
    useApp.getState().toast('Saved', 'success');
  };

  const quickSave = () => (noTabs ? undefined : tab.collectionId && tab.requestId ? saveTab(tab.collectionId, tab.name) : setSaving(true));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && useApp.getState().view === 'rest') {
        e.preventDefault();
        void quickSave();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // pinned tabs first, in their own order
  const ordered = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
  /*
   * Tab overflow (like Postman / VS Code): no horizontal scrolling. Pinned tabs and the most recently
   * used tabs that fit are shown; the rest are listed in the "+N" dropdown. Picking one from the
   * dropdown makes it recent, so it moves into the strip and the least recent tab moves out.
   */
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (active) setRecent((r) => (r[0] === active ? r : [active, ...r.filter((id) => id !== active)]));
  }, [active]);
  const [stripWidth, setStripWidth] = useState(0);
  // a callback ref: the strip mounts after the first render, so an effect would miss it
  const stripObserver = useRef<ResizeObserver>(undefined);
  const stripRef = useCallback((el: HTMLDivElement | null) => {
    stripObserver.current?.disconnect();
    if (!el) return;
    stripObserver.current = new ResizeObserver(() => setStripWidth(el.clientWidth));
    stripObserver.current.observe(el);
    setStripWidth(el.clientWidth);
  }, []);
  const { shown, hidden } = useMemo(() => {
    const pinned = ordered.filter((t) => t.pinned);
    const rest = ordered.filter((t) => !t.pinned);
    const room = stripWidth - TAB_STRIP_RESERVED - pinned.length * PINNED_TAB_WIDTH;
    const slots = Math.max(1, Math.floor(room / TAB_WIDTH));
    if (rest.length <= slots) return { shown: ordered, hidden: [] as RestTab[] };
    const rank = (t: RestTab) => {
      const i = recent.indexOf(t.id);
      return i < 0 ? recent.length + rest.indexOf(t) : i;
    };
    const keep = new Set([...rest].sort((a, b) => rank(a) - rank(b)).slice(0, slots).map((t) => t.id));
    return { shown: [...pinned, ...rest.filter((t) => keep.has(t.id))], hidden: rest.filter((t) => !keep.has(t.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, recent, stripWidth]);
  /** Close several tabs, asking once when any has unsaved changes. */
  const closeTabs = async (ids: string[]) => {
    const closing = tabs.filter((x) => ids.includes(x.id));
    if (!closing.length) return;
    const dirty = closing.filter((x) => x.dirty);
    if (
      dirty.length &&
      !(await confirmAction({
        title: 'Unsaved changes',
        message: dirty.length === 1 ? `"${dirty[0]!.name}" has unsaved changes.` : `${dirty.length} of the tabs you are closing have unsaved changes.`,
        detail: 'Close anyway and discard them? Save with Ctrl+S to keep them.',
        confirmLabel: 'Discard changes',
        danger: true,
      }))
    )
      return;
    // closing the last tab leaves none (Postman-style), not a new blank request
    const rest = tabs.filter((x) => !ids.includes(x.id));
    setTabs(rest);
    if (ids.includes(active)) {
      const i = ordered.findIndex((x) => x.id === active);
      const after = ordered.slice(i + 1).find((x) => !ids.includes(x.id)) ?? [...ordered.slice(0, i)].reverse().find((x) => !ids.includes(x.id));
      setActive(after?.id ?? rest[0]?.id ?? '');
    }
  };
  const closeTab = (id: string) => closeTabs([id]);
  /** File menu / command palette / tab bar ⋯: pinned tabs are kept by the bulk commands. */
  const runTabCommand = (command: string) => {
    const unpinned = ordered.filter((x) => !x.pinned).map((x) => x.id);
    if (command === 'close') {
      const cur = tabs.find((x) => x.id === active);
      if (cur && !cur.pinned) closeTab(cur.id);
    } else if (command === 'closeOthers') closeTabs(unpinned.filter((id) => id !== active));
    else if (command === 'closeAll') closeTabs(unpinned);
  };
  const duplicateTab = (t: RestTab) => {
    const copy: RestTab = { ...structuredClone(t), id: uid('tab-'), name: `${t.name} copy`, collectionId: undefined, requestId: undefined, examples: undefined, pinned: false, dirty: true };
    setTabs((ts) => {
      const i = ts.findIndex((x) => x.id === t.id);
      return [...ts.slice(0, i + 1), copy, ...ts.slice(i + 1)];
    });
    setActive(copy.id);
  };
  const tabMenu = (t: RestTab) => {
    const i = ordered.findIndex((x) => x.id === t.id);
    const others = ordered.filter((x) => x.id !== t.id && !x.pinned).map((x) => x.id);
    const right = ordered.slice(i + 1).filter((x) => !x.pinned).map((x) => x.id);
    const unpinned = ordered.filter((x) => !x.pinned).map((x) => x.id);
    return [
      { label: t.pinned ? 'Unpin tab' : 'Pin tab', icon: t.pinned ? <PinOff size={13} /> : <Pin size={13} />, onSelect: () => setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, pinned: !x.pinned } : x))) },
      { label: 'Duplicate tab', icon: <Copy size={13} />, onSelect: () => duplicateTab(t) },
      { label: 'Close tab', icon: <X size={13} />, separator: true, onSelect: () => closeTab(t.id), shortcut: 'Middle-click' },
      { label: 'Close other tabs', icon: <SquareX size={13} />, disabled: !others.length, onSelect: () => closeTabs(others) },
      { label: 'Close tabs to the right', icon: <ArrowRightToLine size={13} />, disabled: !right.length, onSelect: () => closeTabs(right) },
      { label: 'Close all tabs', icon: <ListX size={13} />, disabled: !unpinned.length, onSelect: () => closeTabs(unpinned) },
    ];
  };

  const result = results[tab.id];
  const saveExample = async () => {
    const res = result?.response;
    if (!res) return;
    if (!tab.collectionId || !tab.requestId) {
      useApp.getState().toast('Save the request to a collection first, then save responses as examples', 'error');
      return setSaving(true);
    }
    const name = await promptText('Save as example', { value: `${res.status} ${res.statusText}`.trim(), okLabel: 'Save', message: 'Sensitive headers and values are masked before the example is saved to the collection.' });
    if (!name?.trim()) return;
    try {
      const body = tab.request.body && 'content' in tab.request.body ? tab.request.body.content : undefined;
      const ex = await call<SavedExample>('col.addExample', {
        collectionId: tab.collectionId,
        requestId: tab.requestId,
        name,
        environment: env,
        response: { status: res.status, statusText: res.statusText, headers: res.headers, bodyPreview: res.bodyPreview, truncated: res.truncated, json: res.json },
        request: { method: tab.request.method, url: tab.request.url, headers: tab.request.headers?.filter((h) => h.enabled !== false && h.key), body },
      });
      setExamples([...(tab.examples ?? []), ex]);
      useApp.getState().toast(`Saved example "${ex.name}"`, 'success');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };

  /** Natural language → a new request tab (nothing is sent until the user clicks Send). */
  const describeRequest = async () => {
    const description = await promptText('Describe a request', {
      message: 'Describe the request in plain words. The AI assistant fills in method, URL, headers and body; you review it before sending.',
      placeholder: 'Create a patient named Biscuit, a dog, owned by customer 123',
      okLabel: 'Generate',
    });
    if (!description?.trim()) return;
    const actId = uid('ai-');
    useApp.getState().setActivity(actId, 'Generating a request with AI');
    try {
      const r = await call<{ name?: string; request: HttpRequestSpec; model: string }>('ai.generateRequest', { description, environment: env });
      const t: RestTab = { ...blankRequest(), name: r.name ?? 'AI request', request: fromEngineRequest(r.request), dirty: true };
      setTabs((ts) => [...ts, t]);
      setActive(t.id);
      useApp.getState().toast(`Request drafted by ${r.model}: review it before sending`, 'info');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    } finally {
      useApp.getState().setActivity(actId);
    }
  };
  const generateTests = result?.response
    ? async () => {
        const res = result.response!;
        const actId = uid('ai-');
        useApp.getState().setActivity(actId, 'Generating tests with AI');
        try {
          const r = await call<{ script: string; model: string }>('ai.generateTests', {
            environment: env,
            request: { method: tab.request.method, url: tab.request.url },
            response: { status: res.status, headers: res.headers.slice(0, 20), body: res.bodyPreview.slice(0, 6000), timeMs: res.durationMs },
          });
          update({ testScript: tab.testScript?.trim() ? `${tab.testScript.trimEnd()}\n\n${r.script}` : r.script });
          useApp.getState().toast(`Added tests by ${r.model} to the Post-response script (Scripts tab). Send again to run them.`, 'success');
        } catch (e) {
          useApp.getState().toast(asError(e).message, 'error');
        } finally {
          useApp.getState().setActivity(actId);
        }
      }
    : undefined;
  const explain = result?.response
    ? () =>
        useApp.getState().set({
          assistant: { task: 'explain-response', title: 'Explain this response', context: { request: { method: tab.request.method, url: tab.request.url }, status: result.response!.status, headers: result.response!.headers.slice(0, 20), body: result.response!.bodyPreview.slice(0, 6000) } },
        })
    : undefined;

  const suggest = result?.response
    ? () =>
        useApp.getState().set({
          assistant: { task: 'generate-assertions', title: 'Suggested assertions', context: { request: { method: tab.request.method, url: tab.request.url }, status: result.response!.status, headers: result.response!.headers.slice(0, 20), body: result.response!.bodyPreview.slice(0, 6000) } },
        })
    : undefined;

  return (
    <>
    <Split id="rest-sidebar" sidebar initial={20} min={12}>
      <div className="h-full flex flex-col bg-panel/50 border-r border-line">
        <div role="tablist" aria-label="Sidebar" className="flex items-center gap-0.5 px-2 pt-2 pb-2">
          {(
            [
              ['collections', 'Collections', <FolderTree key="c" size={13} />],
              ['environments', 'Environments', <KeyRound key="e" size={13} />],
              ['history', 'History', <History key="h" size={13} />],
            ] as const
          ).map(([id, label, icon]) => (
            <Tooltip key={id} content={label}>
              <button
                role="tab"
                aria-selected={side === id}
                aria-label={label}
                onClick={() => setSide(id)}
                className={cx('flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-7 rounded-md text-xs font-medium transition-colors', side === id ? 'bg-bg shadow-sm border border-line text-fg' : 'text-muted hover:text-fg hover:bg-hover')}
              >
                {icon}
                <span className="truncate hidden xl:inline">{label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
        {side === 'collections' && (
          <>
            <div className="flex items-center gap-1 px-2 pb-2">
              <Input className="flex-1 h-7 min-h-7 text-sm" placeholder="Filter requests" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <IconButton
                label={favoritesOnly ? 'Show all requests' : 'Show favorites only'}
                active={favoritesOnly}
                onClick={() => setFavoritesOnly((current) => {
                  localStorage.setItem('aps.rest.favoritesOnly', String(!current));
                  return !current;
                })}
              >
                <Star size={14} fill={favoritesOnly ? 'currentColor' : 'none'} />
              </IconButton>
              <IconButton label="Import OpenAPI / Postman / HAR" onClick={() => setImporting(true)}>
                <Upload size={14} />
              </IconButton>
              <IconButton
                label="New collection"
                onClick={async () => {
                  const name = await promptText('New collection', { message: 'Collection name', placeholder: 'My API', okLabel: 'Create' });
                  if (name) await saveCollection({ schemaVersion: '1.0', id: uid('col-'), name, version: 0, variables: [], items: [], updatedAt: '' });
                }}
              >
                <FolderPlus size={14} />
              </IconButton>
            </div>
            <div className="flex-1 overflow-auto">
              {collections.length ? (
                <CollectionTree
                  collections={collections}
                  filter={filter}
                  favoritesOnly={favoritesOnly}
                  activeRequestId={tab.requestId}
                  onOpen={openRequest}
                  onChange={saveCollection}
                  onRun={(c, folderId) => useApp.getState().openIntent('collections', { collectionId: c.id, run: true, folderId })}
                  onNewRequest={async (c, folderId) => {
                    const t = blankRequest();
                    const node: SavedHttpRequest = { kind: 'http', id: uid('req-'), name: 'New request', request: t.request, assertions: t.assertions };
                    await saveCollection({ ...c, items: addToFolder(c.items, folderId, node) });
                    openRequest(c, node);
                  }}
                />
              ) : (
                <Empty
                  icon={<FolderTree size={22} />}
                  title="No collections yet"
                  action={
                    <Button size="sm" icon={<Upload size={12} />} onClick={() => setImporting(true)}>
                      Import
                    </Button>
                  }
                >
                  Save a request with Ctrl+S, create a collection, or import OpenAPI, Postman or HAR.
                </Empty>
              )}
            </div>
          </>
        )}
        {side === 'environments' && <EnvironmentsPane />}
        {side === 'history' && (
          <HistoryPane
            onOpen={(request, name) => {
              const t: RestTab = { ...blankRequest(), name, request: fromEngineRequest(request) };
              setTabs((ts) => [...ts, t]);
              setActive(t.id);
            }}
          />
        )}
      </div>
      <div className="h-full flex flex-col min-w-0">
        <div ref={stripRef} className="flex items-end h-9 border-b border-line bg-panel/40 overflow-hidden shrink-0" role="tablist">
          {shown.map((t) => (
            <RequestTabItem key={t.id} tab={t} active={!noTabs && t.id === tab.id} menu={tabMenu(t)} onSelect={() => setActive(t.id)} onClose={() => closeTab(t.id)} />
          ))}
          <IconButton label="New request tab" className="mx-1 mb-0.5 shrink-0" onClick={newTab}>
            <Plus size={14} />
          </IconButton>
          <Menu
            align="end"
            width={230}
            items={[
              { label: 'New request tab', icon: <Plus size={13} />, shortcut: 'Ctrl+T', onSelect: newTab },
              { label: 'Close tab', icon: <X size={13} />, shortcut: 'Ctrl+W', separator: true, disabled: noTabs || !!tabs.find((x) => x.id === active)?.pinned, onSelect: () => runTabCommand('close') },
              { label: 'Close other tabs', icon: <SquareX size={13} />, disabled: ordered.filter((x) => !x.pinned && x.id !== active).length === 0, onSelect: () => runTabCommand('closeOthers') },
              { label: 'Close all tabs', icon: <ListX size={13} />, shortcut: 'Ctrl+Shift+W', disabled: !ordered.some((x) => !x.pinned), onSelect: () => runTabCommand('closeAll') },
            ]}
            trigger={
              <button aria-label="Tab actions" title="Tab actions: close tab, close other tabs, close all tabs" className={cx('ml-auto mb-1 shrink-0 grid place-items-center h-7 w-7 rounded-md text-muted hover:text-fg hover:bg-hover data-[state=open]:bg-hover', hidden.length ? 'mr-1' : 'mr-1.5')}>
                <MoreHorizontal size={15} />
              </button>
            }
          />
          {hidden.length > 0 && (
            <Menu
              align="end"
              width={300}
              items={[
                ...hidden.map((t) => ({
                  label: `${t.name}${t.dirty ? ' •' : ''}`,
                  icon: <span className={cx('mono method-badge text-[0.6rem] font-bold w-11', `method-${t.request.method}`)}>{t.request.method.slice(0, 6)}</span>,
                  onSelect: () => setActive(t.id),
                })),
                { label: `Close ${hidden.length} hidden tab${hidden.length === 1 ? '' : 's'}`, icon: <ListX size={13} />, separator: true, onSelect: () => closeTabs(hidden.map((t) => t.id)) },
              ]}
              trigger={
                <button
                  aria-label={`${hidden.length} more tabs`}
                  title={`${hidden.length} more tab${hidden.length === 1 ? '' : 's'}`}
                  className="mr-1.5 mb-1 shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted border border-line bg-bg hover:text-fg hover:bg-hover data-[state=open]:text-fg data-[state=open]:bg-hover"
                >
                  +{hidden.length}
                  <ChevronDown size={13} />
                </button>
              }
            />
          )}
        </div>
        {noTabs ? (
          <Empty
            icon={<Send size={28} />}
            title="No open requests"
            action={
              <div className="flex gap-2">
                <Button variant="primary" icon={<Plus size={13} />} onClick={newTab}>
                  New request
                </Button>
                <Button icon={<Sparkles size={13} />} onClick={() => void describeRequest()}>
                  Describe with AI
                </Button>
              </div>
            }
          >
            Open a request from the sidebar, or start a new one.
          </Empty>
        ) : (
        <>
        <div className="flex items-center gap-2 p-2 border-b border-line shrink-0">
          {/* the app's own menu instead of a native <select>: the desktop app's native popup didn't let people pick a method */}
          <Menu
            align="start"
            width={150}
            items={[
              ...[...METHODS, ...(METHODS.includes(tab.request.method) ? [] : [tab.request.method])].map((m) => ({
                label: m,
                icon: <span aria-hidden className={cx('block w-2 h-2 rounded-full bg-current', `method-${m}`)} />,
                onSelect: () => setReq({ method: m }),
              })),
              {
                label: 'Custom…',
                icon: <Pencil size={13} />,
                separator: true,
                onSelect: async () => {
                  const m = await promptText('Custom HTTP method', { message: 'Any method name, e.g. PROPFIND, PURGE or LINK.', value: 'PROPFIND', okLabel: 'Use' });
                  if (m) setReq({ method: m.toUpperCase() });
                },
              },
            ]}
            trigger={
              <button
                aria-label="Method"
                aria-haspopup="menu"
                className={cx('field mono font-bold w-28 inline-flex items-center justify-between gap-1 text-left', `method-${tab.request.method}`)}
              >
                <span className="truncate">{tab.request.method}</span>
                <ChevronDown size={13} className="shrink-0 text-muted" />
              </button>
            }
          />
          <VarInput
            ariaLabel="Request URL"
            className="flex-1 h-8"
            value={tab.request.url}
            onChange={setUrl}
            onPasteText={(text) => (isRequestSnippet(text) ? (void importSnippet(text), true) : false)}
            placeholder="Enter a URL, paste cURL / fetch / PowerShell, or use {{baseUrl}}/path"
            onEnter={send}
            collectionId={tab.collectionId}
          />
          {sending[tab.id] ? (
            <Button variant="danger" icon={<Square size={12} />} onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" icon={<Send size={13} />} onClick={send} title="Send (Ctrl+Enter)">
              Send
            </Button>
          )}
          <IconButton label="Code snippet" onClick={() => setShowCode(true)}>
            <Code2 size={16} />
          </IconButton>
          <IconButton label="Describe a request with AI" onClick={() => void describeRequest()}>
            <Sparkles size={16} />
          </IconButton>
          <IconButton label="Cookies" onClick={() => setShowCookies(true)}>
            <Cookie size={16} />
          </IconButton>
          <Button icon={<Save size={13} />} onClick={quickSave} title="Save (Ctrl+S)">
            Save
          </Button>
        </div>
        <Split id="rest-req-res" direction="vertical" initial={45}>
          <RequestEditor tab={tab} update={update} setReq={setReq} setParams={setParams} setExamples={setExamples} />
          <div className="h-full min-h-0 flex flex-col">
            {sending[tab.id] && liveEvents[sending[tab.id]!] ? (
              <SseEvents events={liveEvents[sending[tab.id]!]!} live onStop={cancel} />
            ) : sending[tab.id] ? (
              <div className="h-full grid place-items-center text-muted text-sm">
                <div className="flex flex-col items-center gap-2">
                  <div className="relative w-40 h-1 bg-panel2 overflow-hidden rounded indeterminate" />
                  Sending request… <span className="text-xs">Ctrl+Enter again is disabled while sending</span>
                </div>
              </div>
            ) : result?.error ? (
              <div className="overflow-auto">
                <ErrorPanel error={result.error} context={{ request: { method: tab.request.method, url: tab.request.url } }} />
              </div>
            ) : result?.response ? (
              <ResponseViewer response={result.response} checks={result.checks} traceId={result.traceId} curl={result.curl} stream={result.stream} scriptLogs={result.scriptLogs} visualizer={result.visualizer} requestId={tab.requestId} historyId={result.historyId} onSuggestAssertions={suggest} onSaveExample={() => void saveExample()} onGenerateTests={generateTests && (() => void generateTests())} onExplain={explain} />
            ) : (
              <Empty icon={<Send size={28} />} title="Send a request to see the response">
                Press <b>Ctrl+Enter</b> to send. Variables like <span className="var-token mono">{'{{baseUrl}}'}</span> resolve from the active environment.
              </Empty>
            )}
          </div>
        </Split>
        </>
        )}
      </div>
    </Split>
      {saving && <SaveModal collections={collections} defaultName={tab.name} onClose={() => setSaving(false)} onSave={(cid, name, folder) => (setSaving(false), void saveTab(cid, name, folder))} onCreate={saveCollection} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={loadCollections} />}
      {showCookies && <CookiesModal initialDomain={hostOf(tab.request.url) || undefined} onClose={() => setShowCookies(false)} />}
      {showCode && <CodeModal request={toEngineRequest(tab.request)} collectionId={tab.collectionId} requestId={tab.requestId} onClose={() => setShowCode(false)} />}
    </>
  );
}

function RequestEditor({
  tab,
  update,
  setReq,
  setParams,
  setExamples,
}: {
  tab: RestTab;
  update(p: Partial<RestTab>): void;
  setReq(p: Partial<HttpRequestSpec>): void;
  setParams(p: KeyValue[]): void;
  setExamples(e: SavedExample[]): void;
}) {
  const [sub, setSub] = useState<'params' | 'auth' | 'headers' | 'body' | 'cookies' | 'scripts' | 'tests' | 'examples' | 'docs' | 'settings'>('params');
  const r = tab.request;
  const count = (a?: Array<{ enabled?: boolean }>) => a?.filter((x) => x.enabled !== false).length || undefined;
  return (
    <div className="h-full flex flex-col min-h-0">
      <Tabs
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'params', label: 'Params', badge: count(r.params) },
          { id: 'auth', label: 'Authorization' },
          { id: 'headers', label: 'Headers', badge: count(r.headers) },
          { id: 'body', label: 'Body', badge: r.body && r.body.type !== 'none' ? r.body.type : undefined },
          { id: 'cookies', label: 'Cookies', badge: count(r.cookies) },
          { id: 'scripts', label: 'Scripts', badge: (tab.preRequestScript ? 1 : 0) + (tab.testScript ? 1 : 0) || undefined },
          { id: 'tests', label: 'Tests', badge: tab.assertions.length || undefined },
          { id: 'examples', label: 'Examples', badge: tab.examples?.length || undefined },
          { id: 'docs', label: 'Docs', badge: tab.description?.trim() ? '•' : undefined },
          { id: 'settings', label: 'Settings' },
        ]}
        right={
          <input
            aria-label="Request name"
            className="bg-transparent text-sm text-muted text-right outline-none focus:text-fg w-48"
            value={tab.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        }
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {sub === 'params' && (
          <div className="p-2">
            <div className="text-xs font-semibold text-muted px-1 pb-1">Query Params</div>
            <KeyValueEditor rows={r.params ?? []} onChange={setParams} keyPlaceholder="Key" bulkEdit />
            {!!r.pathVariables?.length && (
              <>
                <div className="text-xs font-semibold text-muted px-1 pt-4 pb-1">Path Variables</div>
                <KeyValueEditor rows={r.pathVariables} onChange={(pathVariables) => setReq({ pathVariables: pathVariables.filter((v) => r.pathVariables!.some((x) => x.key === v.key)) })} keyPlaceholder="Key" fixedKeys />
              </>
            )}
            <p className="text-xs text-muted px-2 pt-3">
              The query string in the URL bar and this table stay in sync. Use <span className="mono">/:name</span> in the path for path variables. Values may use {'{{variables}}'}.
            </p>
          </div>
        )}
        {sub === 'auth' && <AuthEditor auth={r.auth} onChange={(auth) => setReq({ auth })} />}
        {sub === 'headers' && (
          <div className="p-2">
            <KeyValueEditor rows={r.headers ?? []} onChange={(headers) => setReq({ headers })} keyPlaceholder="Header" suggestions={COMMON_HEADERS} />
          </div>
        )}
        {sub === 'body' && <BodyEditor body={r.body ?? { type: 'none' }} onChange={(body) => setReq({ body })} />}
        {sub === 'cookies' && (
          <div className="p-2">
            <KeyValueEditor rows={r.cookies ?? []} onChange={(cookies) => setReq({ cookies })} keyPlaceholder="Cookie" />
            <p className="text-xs text-muted px-1 pt-2">
              Matching cookies from the workspace cookie jar are added automatically; cookies here win when the name is the same. Use the cookie button next to Send to see or edit the jar.
            </p>
          </div>
        )}
        {sub === 'scripts' && <ScriptsPanel pre={tab.preRequestScript ?? ''} post={tab.testScript ?? ''} onPre={(v) => update({ preRequestScript: v })} onPost={(v) => update({ testScript: v })} />}
        {sub === 'docs' && <DocsEditor value={tab.description ?? ''} onChange={(description) => update({ description })} />}
        {sub === 'examples' && <ExamplesPanel key={tab.id} collectionId={tab.collectionId} requestId={tab.requestId} examples={tab.examples ?? []} onChange={setExamples} />}
        {sub === 'tests' && <AssertionEditor checks={tab.assertions} onChange={(assertions) => update({ assertions })} groups={['Response', 'Body']} />}
        {sub === 'settings' && (
          <div className="p-4 grid grid-cols-2 gap-4 max-w-2xl text-sm">
            <Field label="Timeout (ms)">
              <Input type="number" value={r.settings?.timeoutMs ?? ''} placeholder="default from Settings" onChange={(e) => setReq({ settings: { ...r.settings, timeoutMs: e.target.value ? Number(e.target.value) : undefined } })} />
            </Field>
            <Field label="Proxy URL">
              <Input value={r.settings?.proxy ?? ''} placeholder="http://proxy:8080" onChange={(e) => setReq({ settings: { ...r.settings, proxy: e.target.value || undefined } })} />
            </Field>
            <Toggle checked={r.settings?.followRedirects !== false} onChange={(v) => setReq({ settings: { ...r.settings, followRedirects: v } })} label="Follow redirects" />
            <Toggle checked={!!r.settings?.insecure} onChange={(v) => setReq({ settings: { ...r.settings, insecure: v } })} label="Disable TLS verification (development only)" />
            <div className="col-span-2 font-medium pt-2">Client certificate (mTLS)</div>
            <Field label="Certificate path (PEM)">
              <Input className="mono" value={r.settings?.clientCert?.certPath ?? ''} onChange={(e) => setReq({ settings: { ...r.settings, clientCert: e.target.value ? { certPath: e.target.value, keyPath: r.settings?.clientCert?.keyPath ?? '' } : undefined } })} />
            </Field>
            <Field label="Key path (PEM)">
              <Input className="mono" value={r.settings?.clientCert?.keyPath ?? ''} onChange={(e) => setReq({ settings: { ...r.settings, clientCert: { certPath: r.settings?.clientCert?.certPath ?? '', keyPath: e.target.value } } })} />
            </Field>
            <Field label="CA path (optional)">
              <Input className="mono" value={r.settings?.clientCert?.caPath ?? ''} onChange={(e) => setReq({ settings: { ...r.settings, clientCert: { certPath: r.settings?.clientCert?.certPath ?? '', keyPath: r.settings?.clientCert?.keyPath ?? '', caPath: e.target.value } } })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pretty-print JSON (keeping {{variables}} intact) or indent XML. */
function beautify(text: string, type: string): string {
  if (type === 'json') {
    // protect unquoted {{vars}} so the JSON parses, then restore them
    const vars: string[] = [];
    const safe = text.replace(/\{\{[^{}]+\}\}/g, (m) => `"__VAR${vars.push(m) - 1}__"`);
    try {
      return JSON.stringify(JSON.parse(safe), null, 2).replace(/"__VAR(\d+)__"/g, (_, i) => vars[Number(i)]!);
    } catch {
      useApp.getState().toast('The body is not valid JSON', 'error');
      return text;
    }
  }
  let depth = 0;
  return text
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => {
      const l = line.trim();
      if (/^<\//.test(l)) depth = Math.max(0, depth - 1);
      const out = '  '.repeat(depth) + l;
      if (/^<[^!?/][^>]*[^/]>$/.test(l) && !/<\/[^>]+>$/.test(l)) depth++;
      return out;
    })
    .join('\n');
}

export function BodyEditor({ body, onChange }: { body: BodyConfig; onChange(b: BodyConfig): void }) {
  const types: Array<[BodyConfig['type'], string]> = [
    ['none', 'None'],
    ['json', 'JSON'],
    ['xml', 'XML'],
    ['text', 'Text'],
    ['html', 'HTML'],
    ['form-urlencoded', 'Form URL-encoded'],
    ['multipart', 'Multipart form'],
    ['binary', 'Binary file'],
  ];
  const setType = (t: BodyConfig['type']) => {
    if (t === 'none') return onChange({ type: 'none' });
    if (t === 'form-urlencoded' || t === 'multipart') return onChange({ type: t, fields: 'fields' in body ? body.fields : [] });
    if (t === 'binary') return onChange({ type: 'binary', filePath: '' });
    onChange({ type: t, content: 'content' in body ? body.content : t === 'json' ? '{\n  \n}' : '' });
  };
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex gap-3 px-3 py-1.5 text-sm flex-wrap items-center border-b border-line">
        {(body.type === 'json' || body.type === 'xml') && (
          <button className="order-last ml-auto text-xs text-accent hover:underline" onClick={() => onChange({ ...body, content: beautify(body.content, body.type) })}>
            Beautify
          </button>
        )}
        {types.map(([t, label]) => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="body-type" checked={body.type === t} onChange={() => setType(t)} />
            {label}
          </label>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {body.type === 'none' && <div className="p-4 text-sm text-muted">This request has no body.</div>}
        {'content' in body && <CodeEditor language={body.type === 'json' ? 'json' : body.type === 'xml' ? 'xml' : body.type === 'html' ? 'html' : 'plaintext'} value={body.content} onChange={(content) => onChange({ ...body, content })} />}
        {(body.type === 'form-urlencoded' || body.type === 'multipart') && (
          <div className="p-2 overflow-auto h-full">
            <KeyValueEditor rows={body.fields} onChange={(fields) => onChange({ ...body, fields })} keyPlaceholder="Field" allowFile={body.type === 'multipart'} />
          </div>
        )}
        {body.type === 'binary' && (
          <div className="p-4 flex flex-col gap-3 max-w-xl">
            <Field label="File path" hint="The file is streamed from disk when the request is sent.">
              <Input className="mono" value={body.filePath} onChange={(e) => onChange({ ...body, filePath: e.target.value })} />
            </Field>
            <Field label="Content-Type">
              <Input value={body.contentType ?? ''} placeholder="application/octet-stream" onChange={(e) => onChange({ ...body, contentType: e.target.value || undefined })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function SaveModal({ collections, defaultName, onClose, onSave, onCreate }: { collections: Collection[]; defaultName: string; onClose(): void; onSave(collectionId: string, name: string, folderId?: string): void; onCreate(c: Collection): Promise<void> }) {
  const [name, setName] = useState(defaultName);
  const [cid, setCid] = useState(collections[0]?.id ?? '');
  const [folder, setFolder] = useState('');
  // a name here means "create this collection and save into it" (the default when there are none yet)
  const [newCollection, setNewCollection] = useState<string | null>(collections.length ? null : 'My collection');
  const [busy, setBusy] = useState(false);
  const creating = newCollection !== null;
  const canSave = !!name.trim() && (creating ? !!newCollection.trim() : !!cid);
  const submit = async () => {
    if (!canSave || busy) return;
    if (!creating) return onSave(cid, name.trim(), folder || undefined);
    setBusy(true);
    try {
      const id = uid('col-');
      await onCreate({ schemaVersion: '1.0', id, name: newCollection.trim(), version: 0, variables: [], items: [], updatedAt: '' });
      onSave(id, name.trim());
    } finally {
      setBusy(false);
    }
  };
  const c = collections.find((x) => x.id === cid);
  const folders = useMemo(() => {
    const out: Array<{ id: string; name: string }> = [];
    const walk = (nodes: CollectionNode[], prefix: string) => {
      for (const n of nodes) if (n.kind === 'folder') (out.push({ id: n.id, name: prefix + n.name }), walk(n.items, `${prefix}${n.name} / `));
    };
    if (c) walk(c.items, '');
    return out;
  }, [c]);
  return (
    <Modal
      title="Save request"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSave} loading={busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        </Field>
        <Field label={creating ? 'New collection' : 'Collection'} hint={creating && !collections.length ? 'You have no collections yet — this one will be created.' : undefined}>
          <div className="flex gap-2">
            {creating ? (
              <Input className="flex-1" value={newCollection} placeholder="Collection name" onChange={(e) => setNewCollection(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
            ) : (
              <Select className="flex-1" value={cid} onChange={(e) => (setCid(e.target.value), setFolder(''))}>
                {collections.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
            {creating ? (
              collections.length > 0 && <Button onClick={() => setNewCollection(null)}>Choose existing</Button>
            ) : (
              <Button onClick={() => setNewCollection('')}>New</Button>
            )}
          </div>
        </Field>
        {!creating && folders.length > 0 && (
          <Field label="Folder">
            <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">(collection root)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function ImportModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ format: string; collection?: string; environment?: string; request?: string; placeholders?: Array<{ variable: string }> } | null>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) {
        if (r.request)
          useApp.getState().toast(
            `Imported ${r.format} request "${r.request}" into "${r.collection}"${r.placeholders?.length ? `. Secrets were replaced by variables: set ${r.placeholders.map((p) => p.variable).join(', ')} as secret environment variables` : ''}`,
            'success',
          );
        else useApp.getState().toast(`Imported ${r.format}${r.collection ? `: ${r.collection}` : ''}${r.environment ? ` (environment ${r.environment})` : ''}`, 'success');
        onDone();
        await useApp.getState().refreshWorkspace();
        onClose();
      }
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Import"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button
            icon={<Upload size={13} />}
            onClick={() =>
              run(async () => {
                // the browser picker works in the desktop app and in the browser / cloud alike
                const f = await pickTextFile('.json,.yaml,.yml,.har,.txt,.sh,.ps1');
                return f ? call('col.import', { text: f.text }) : null;
              })
            }
          >
            Choose file…
          </Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => run(() => call('col.import', { text }))}>
            Import pasted content
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted mb-2">OpenAPI 3 / Swagger 2 (JSON or YAML), Postman v2.1 collections and environments, HAR files, TestPion collections, or a request copied as cURL, fetch or PowerShell (saved to the <b>Imported</b> collection, with secrets replaced by variables).</p>
      <textarea className="field mono w-full h-64 text-xs" placeholder="Paste a document here…" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

/** Request documentation: Markdown source and a live preview side by side. */
function DocsEditor({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <div className="h-full grid grid-cols-2 gap-3 p-2 min-h-0">
      <textarea
        className="field h-full resize-none mono text-sm"
        placeholder={'Document this request in Markdown: what it does, required parameters, error cases…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Request documentation (Markdown)"
      />
      <div className="overflow-auto border border-line rounded-md p-3">
        {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted">The preview appears here. The collection’s Docs tab shows the documentation of every request.</p>}
      </div>
    </div>
  );
}

/** One tab of the request tab strip: right-click (or ⋯) for pin, duplicate and close actions. */
function RequestTabItem({ tab: t, active, menu, onSelect, onClose }: { tab: RestTab; active: boolean; menu: MenuItem[]; onSelect(): void; onClose(): void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      role="tab"
      aria-selected={active}
      title={t.dirty ? `${t.name} (unsaved changes)` : t.name}
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && !t.pinned && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      style={{ width: t.pinned ? PINNED_TAB_WIDTH : TAB_WIDTH }}
      className={cx(
        'group relative flex items-center gap-1.5 h-9 px-3 border-r border-line text-sm cursor-pointer shrink-0',
        active ? 'bg-bg text-fg after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-[image:var(--brand-gradient)]' : 'text-muted hover:bg-hover hover:text-fg',
        t.pinned && 'pr-2',
      )}
    >
      {t.pinned && <Pin size={11} className="shrink-0 text-muted" aria-label="Pinned" />}
      <span className={cx('mono method-badge text-[0.62rem] font-bold', `method-${t.request.method}`)}>{t.request.method}</span>
      <span className="truncate flex-1 min-w-0">{t.name}</span>
      {t.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unsaved changes" />}
      {!t.pinned && (
        <button aria-label="Close tab" className={cx('shrink-0 rounded p-0.5 hover:text-fg hover:bg-hover focus:opacity-100', active ? 'opacity-60' : 'opacity-0 group-hover:opacity-100')} onClick={(e) => (e.stopPropagation(), onClose())}>
          <X size={12} />
        </button>
      )}
      <Menu open={menuOpen} onOpenChange={setMenuOpen} align="start" width={210} items={menu} trigger={<span aria-hidden className="absolute left-2 bottom-0 w-0 h-0" />} />
    </div>
  );
}
