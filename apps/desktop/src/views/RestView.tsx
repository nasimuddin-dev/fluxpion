import { BookmarkPlus, Code2, Cookie, Copy, FolderPlus, FolderTree, History, KeyRound, Pin, PinOff, Plus, Save, Send, Square, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asError, call, on, type NormalizedError } from '../api';
import { promptText, useApp, persisted } from '../store';
import { useIntent, useSendShortcut } from '../hooks';
import type { BodyConfig, CheckConfig, CheckResult, Collection, CollectionNode, HttpRequestSpec, HttpResponseData, KeyValue, SavedExample, SavedHttpRequest } from '../types';
import { fromEngineRequest, paramsFromUrl, syncPathVariables, toEngineRequest, urlFromParams } from '../lib/url';
import { CodeModal } from '../components/CodeModal';
import { CookiesModal, hostOf } from '../components/CookiesModal';
import { ExamplesPanel } from '../components/ExamplesPanel';
import { Markdown } from '../components/Markdown';
import { EnvironmentsPane, HistoryPane } from '../components/SidebarPanes';
import { ScriptsPanel } from '../components/ScriptsPanel';
import { uid } from '../lib/format';

const isCurl = (t: string) => /^\s*curl(\.exe)?\s/i.test(t);
import { AssertionEditor } from '../components/AssertionEditor';
import { AuthEditor } from '../components/AuthEditor';
import { CodeEditor } from '../components/CodeEditor';
import { addToFolder, CollectionTree, findNode, mapNodes } from '../components/CollectionTree';
import { COMMON_HEADERS, KeyValueEditor } from '../components/KeyValueEditor';
import { ResponseViewer } from '../components/ResponseViewer';
import { ErrorPanel } from '../components/Results';
import { VarInput } from '../components/VarInput';
import { Button, cx, Empty, Field, IconButton, Input, Menu, Modal, Select, Split, Tabs, Toggle, Tooltip, type MenuItem } from '../components/ui';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

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
    return d.tabs.length ? d.tabs.map((t) => (t.request.url.includes('?') ? t : { ...t, request: fromEngineRequest(t.request) })) : [blankRequest()];
  });
  const [active, setActive] = useState<string>(() => drafts.load().active ?? tabs[0]!.id);
  const [results, setResults] = useState<Record<string, SendResult>>({});
  const [sending, setSending] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [filter, setFilter] = useState('');
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
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const streams = useRef<Record<string, string>>({});

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

  const update = (patch: Partial<RestTab>) => setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, ...patch, dirty: true } : t)));
  const setReq = (patch: Partial<HttpRequestSpec>) => update({ request: { ...tab.request, ...patch } });
  const setExamples = (examples: SavedExample[]) => setTabs((ts) => ts.map((t) => (t.requestId && t.requestId === tab.requestId ? { ...t, examples } : t)));
  /** URL bar edits update the Params table and path variables (Postman behaviour). */
  const setUrl = (url: string) => setReq({ url, params: paramsFromUrl(url, tab.request.params), pathVariables: syncPathVariables(url, tab.request.pathVariables) });
  /** Params table edits rebuild the URL's query string. */
  const setParams = (params: KeyValue[]) => setReq({ params, url: urlFromParams(tab.request.url, params) });
  /** Pasting a cURL command into the URL bar imports it. */
  const importCurl = async (text: string) => {
    try {
      const r = await call<HttpRequestSpec>('http.parseCurl', { text });
      update({ request: fromEngineRequest(r) });
      useApp.getState().toast('Imported cURL command', 'success');
    } catch (e) {
      useApp.getState().toast(`Couldn't import cURL: ${asError(e).message}`, 'error');
    }
  };

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
      useApp.getState().setActivity(id);
      setSending((s) => {
        const n = { ...s };
        delete n[tabId];
        return n;
      });
    }
  };
  const cancel = () => sending[tab.id] && call('http.cancel', { id: sending[tab.id] });
  useSendShortcut('rest', () => (sending[tab.id] ? undefined : void send()));

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

  const quickSave = () => (tab.collectionId && tab.requestId ? saveTab(tab.collectionId, tab.name) : setSaving(true));
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
  /** Close several tabs, asking once when any has unsaved changes. */
  const closeTabs = (ids: string[]) => {
    const closing = tabs.filter((x) => ids.includes(x.id));
    if (!closing.length) return;
    const dirty = closing.filter((x) => x.dirty);
    if (dirty.length && !confirm(dirty.length === 1 ? `Discard unsaved changes to "${dirty[0]!.name}"?` : `Discard unsaved changes in ${dirty.length} tabs?`)) return;
    const rest = tabs.filter((x) => !ids.includes(x.id));
    const next = rest.length ? rest : [blankRequest()];
    setTabs(next);
    if (ids.includes(active)) {
      const i = ordered.findIndex((x) => x.id === active);
      const after = ordered.slice(i + 1).find((x) => !ids.includes(x.id)) ?? [...ordered.slice(0, i)].reverse().find((x) => !ids.includes(x.id));
      setActive(after?.id ?? next[0]!.id);
    }
  };
  const closeTab = (id: string) => closeTabs([id]);
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
      { label: 'Close other tabs', disabled: !others.length, onSelect: () => closeTabs(others) },
      { label: 'Close tabs to the right', disabled: !right.length, onSelect: () => closeTabs(right) },
      { label: 'Close all tabs', disabled: !unpinned.length, onSelect: () => closeTabs(unpinned) },
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

  const suggest = result?.response
    ? () =>
        useApp.getState().set({
          assistant: { task: 'generate-assertions', title: 'Suggested assertions', context: { request: { method: tab.request.method, url: tab.request.url }, status: result.response!.status, headers: result.response!.headers.slice(0, 20), body: result.response!.bodyPreview.slice(0, 6000) } },
        })
    : undefined;

  return (
    <>
    <Split id="rest-sidebar" initial={20} min={12}>
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
        <div className="flex items-end h-9 border-b border-line bg-panel/40 overflow-x-auto shrink-0" role="tablist">
          {ordered.map((t) => (
            <RequestTabItem key={t.id} tab={t} active={t.id === tab.id} menu={tabMenu(t)} onSelect={() => setActive(t.id)} onClose={() => closeTab(t.id)} />
          ))}
          <IconButton
            label="New request tab"
            className="mx-1 mb-1"
            onClick={() => {
              const t = blankRequest();
              setTabs((ts) => [...ts, t]);
              setActive(t.id);
            }}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        <div className="flex items-center gap-2 p-2 border-b border-line shrink-0">
          <Select aria-label="Method" className={cx('mono font-bold w-28', `method-${tab.request.method}`)} value={METHODS.includes(tab.request.method) ? tab.request.method : 'CUSTOM'} onChange={async (e) => {
            if (e.target.value !== 'CUSTOM') return setReq({ method: e.target.value });
            const m = await promptText('Custom HTTP method', { value: 'PROPFIND', okLabel: 'Use' });
            if (m) setReq({ method: m.toUpperCase() });
          }}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
            {!METHODS.includes(tab.request.method) && <option value="CUSTOM">{tab.request.method}</option>}
            <option value="CUSTOM">Custom…</option>
          </Select>
          <VarInput
            ariaLabel="Request URL"
            className="flex-1 h-8"
            value={tab.request.url}
            onChange={setUrl}
            onPasteText={(text) => (isCurl(text) ? (void importCurl(text), true) : false)}
            placeholder="Enter a URL, paste a cURL command, or use {{baseUrl}}/path"
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
            {sending[tab.id] ? (
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
              <ResponseViewer response={result.response} checks={result.checks} traceId={result.traceId} curl={result.curl} stream={result.stream} scriptLogs={result.scriptLogs} onSuggestAssertions={suggest} onSaveExample={() => void saveExample()} />
            ) : (
              <Empty icon={<Send size={28} />} title="Send a request to see the response">
                Press <b>Ctrl+Enter</b> to send. Variables like <span className="var-token mono">{'{{baseUrl}}'}</span> resolve from the active environment.
              </Empty>
            )}
          </div>
        </Split>
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
  const run = async (fn: () => Promise<{ format: string; collection?: string; environment?: string } | null>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) {
        useApp.getState().toast(`Imported ${r.format}${r.collection ? `: ${r.collection}` : ''}${r.environment ? ` (environment ${r.environment})` : ''}`, 'success');
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
          <Button onClick={() => run(() => call('col.importFile'))}>Choose file…</Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => run(() => call('col.import', { text }))}>
            Import pasted content
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted mb-2">OpenAPI 3 / Swagger 2 (JSON or YAML), Postman v2.1 collections and environments, HAR files, or Protolens collections.</p>
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
      className={cx('group relative flex items-center gap-1.5 h-9 px-3 border-r border-line text-sm cursor-pointer max-w-56 shrink-0', active ? 'bg-bg' : 'text-muted hover:bg-hover', t.pinned && 'pr-2')}
    >
      {t.pinned && <Pin size={11} className="shrink-0 text-muted" aria-label="Pinned" />}
      <span className={cx('mono text-[0.68rem] font-bold', `method-${t.request.method}`)}>{t.request.method}</span>
      <span className={cx('truncate', t.pinned && 'max-w-24')}>{t.name}</span>
      {t.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unsaved changes" />}
      {!t.pinned && (
        <button aria-label="Close tab" className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-fg" onClick={(e) => (e.stopPropagation(), onClose())}>
          <X size={12} />
        </button>
      )}
      <Menu open={menuOpen} onOpenChange={setMenuOpen} align="start" width={210} items={menu} trigger={<span aria-hidden className="absolute left-2 bottom-0 w-0 h-0" />} />
    </div>
  );
}
