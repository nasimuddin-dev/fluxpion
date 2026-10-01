import { ArrowDownLeft, ArrowUpRight, BookmarkPlus, Info, Plug, Plus, Radio, Save, Send, Trash2, Unplug, X, FileCheck2, Bookmark, History, KeyRound } from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { asError, call, on } from '../api';
import { persisted, promptText, useApp } from '../store';
import { FolderList } from '../components/FolderList';
import { SidebarShell } from '../components/SidebarShell';
import { NEW_TAB_TITLE, useSingleEditorTab } from '../components/EditorTabs';
import { RequestBreadcrumb } from '../components/RequestBreadcrumb';
import { EnvironmentsPane, HistoryPane } from '../components/SidebarPanes';
import { useLibrary } from '../lib/library';
import { useSticky } from '../lib/sticky';
import { useDoc } from '../lib/docs';
import { useIntent, useSaveShortcut } from '../hooks';
import type { KeyValue } from '../types';
import { CodeEditor } from '../components/CodeEditor';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { JsonTree } from '../components/JsonView';
import { VarInput } from '../components/VarInput';
import { Badge, Button, cx, Empty, Input, Select, Split, Tabs, VirtualList } from '../components/ui';
import { MessageRate } from '../components/MessageRate';
import { saveAsTestFile } from '../lib/save-test';

interface WsMessage {
  id: string;
  time: number;
  direction: 'sent' | 'received' | 'system';
  data: string;
  size: number;
  binary?: boolean;
  /** Socket.IO: the event name, and whether this is an acknowledgement. */
  event?: string;
  ack?: boolean;
  /** MQTT: the topic, QoS and retained flag. */
  topic?: string;
  qos?: number;
  retain?: boolean;
}

type Qos = 0 | 1 | 2;

type Draft = {
  url: string;
  protocols: string;
  headers: KeyValue[];
  message: string;
  /** Plain WebSocket, a Socket.IO server (events with JSON arguments, acknowledgements), or an MQTT broker. */
  mode?: 'websocket' | 'socketio' | 'mqtt';
  event?: string;
  ack?: boolean;
  /** Socket.IO endpoint path (default /socket.io) and handshake auth payload (JSON). */
  path?: string;
  auth?: string;
  /** Messages kept with the connection, to send again (Socket.IO: with their event; MQTT: with their topic). */
  savedMessages?: Array<{ name: string; message: string; event?: string; topic?: string }>;
  /** MQTT: topic to publish to, QoS, retained flag, topic filters subscribed on connect, and login. */
  topic?: string;
  qos?: Qos;
  retain?: boolean;
  subscriptions?: Array<{ topic: string; qos: Qos }>;
  clientId?: string;
  username?: string;
  /** Only a {{variable}} reference is kept; a typed password lives in memory until the app closes. */
  password?: string;
  mqttVersion?: 4 | 5;
};
const hostOf = (url: string) => url.replace(/^(wss?|https?|mqtts?):\/\//, '').split(/[/?#]/)[0] || 'Connection';
/** What is written to drafts and saved connections: never a typed-in MQTT password. */
const persistable = (d: Draft): Draft => (d.password && !/^\s*\{\{[^}]+\}\}\s*$/.test(d.password) ? { ...d, password: undefined } : d);
const MODES = [
  { id: 'websocket', label: 'WebSocket' },
  { id: 'socketio', label: 'Socket.IO' },
  { id: 'mqtt', label: 'MQTT' },
] as const;

const drafts = persisted<Draft>('websocket', { url: '{{wsUrl}}', protocols: '', headers: [] as KeyValue[], message: '{\n  "type": "ping"\n}' });

export function WebSocketView() {
  // this document's draft (each tab of this editor is its own document)
  const { docId } = useDoc();
  const docDrafts = useMemo(() => drafts.forDoc(docId), [docId]);
  const [d, setD] = useState(docDrafts.load);
  const [session, setSession] = useState<string>();
  const [status, setStatus] = useState<'closed' | 'connecting' | 'open'>('closed');
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [selected, setSelected] = useState<WsMessage>();
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'message' | 'headers' | 'auth' | 'subscriptions' | 'connection'>('message');
  const sio = d.mode === 'socketio';
  const mqtt = d.mode === 'mqtt';
  const [newSub, setNewSub] = useState<{ topic: string; qos: Qos }>({ topic: '', qos: 0 });
  const env = useApp((s) => s.environment);
  // saved connections (URL, subprotocols, handshake headers, message) with folders
  const saved = useLibrary<Draft>('websocket');
  const [savedId, setSavedId] = useSticky<string | undefined>(`ws:saved:${docId ?? 'main'}`, undefined);
  const current = saved.lib.items.find((i) => i.id === savedId);
  // New ▸ WebSocket in a collection: the connection is saved into that collection
  const [collectionId, setCollectionId] = useSticky<string | undefined>(`ws:collection:${docId ?? 'main'}`, undefined);
  const dirty = !!current && JSON.stringify(current.data) !== JSON.stringify(persistable(d));
  const open = async (id: string) => {
    const it = await saved.find(id);
    if (!it) return;
    setSavedId(id);
    setD({ ...docDrafts.load(), ...it.data });
  };
  // global search → open a saved connection
  useIntent('websocket', (p) => {
    if (p?.collectionId && !p.savedId) setCollectionId(p.collectionId as string);
    if (p?.savedId) void open(p.savedId);
  });
  const save = async (asNew = false, folder?: string) => {
    if (current && !asNew) {
      await saved.put({ ...current, data: persistable(d) });
      useApp.getState().toast(`Saved "${current.name}"`, 'success');
      return;
    }
    const name = await promptText('Save connection', { message: 'Name', value: tabTitle || hostOf(d.url), okLabel: 'Save' });
    if (!name) return;
    setSavedId(await saved.put({ name, folder, collectionId, data: persistable(d) }));
  };
  // Ctrl+S saves this tab's connection (asks for a name the first time)
  useSaveShortcut('websocket', () => void save());
  const sessionRef = useRef<string | undefined>(undefined);
  sessionRef.current = session;
  useEffect(() => docDrafts.save(persistable(d)), [d, docDrafts]);
  useEffect(() => {
    const a = on<Array<{ id: string; message: WsMessage }>>('wsock.messages', (items) => {
      const mine = items.filter((i) => i.id === sessionRef.current).map((i) => i.message);
      if (mine.length) setMessages((m) => [...m, ...mine].slice(-20000));
    });
    const b = on<{ id: string; status: 'closed' | 'open' | 'connecting' }>('wsock.status', (p) => p.id === sessionRef.current && setStatus(p.status));
    return () => {
      a();
      b();
    };
  }, []);
  const connect = async () => {
    setStatus('connecting');
    try {
      const r = mqtt
        ? await call<{ id: string }>('mqtt.connect', { url: d.url, clientId: d.clientId || undefined, username: d.username || undefined, password: d.password || undefined, protocolVersion: d.mqttVersion ?? 4, subscriptions: d.subscriptions ?? [], environment: env })
        : sio
          ? await call<{ id: string }>('sio.connect', { url: d.url, path: d.path || undefined, headers: d.headers, auth: d.auth, environment: env })
          : await call<{ id: string }>('wsock.connect', { url: d.url, protocols: d.protocols ? d.protocols.split(',').map((s) => s.trim()) : undefined, headers: d.headers, environment: env });
      setSession(r.id);
      setStatus('open');
    } catch (e) {
      setStatus('closed');
      const err = asError(e);
      const text = `Could not connect: ${err.message || 'the connection failed'}${err.suggestions?.length ? `\n${err.suggestions.map((s) => `→ ${s}`).join('\n')}` : ''}`;
      // the reason stays in the message list (a toast disappears)
      const line: WsMessage = { id: `err-${Date.now()}`, time: Date.now(), direction: 'system', data: text, size: text.length };
      setMessages((m) => [...m, line]);
      setSelected(line);
      useApp.getState().toast(`Could not connect: ${err.message || 'the connection failed'}`, 'error');
    }
  };
  // saved messages: pick one into the editor, save the current one under a name, delete one
  const [pickedMessage, setPickedMessage] = useState('');
  const saveMessage = async () => {
    const name = (await promptText('Save message', { message: 'Name', value: pickedMessage || (sio ? d.event : mqtt ? d.topic : '') || 'Message', okLabel: 'Save' }))?.trim();
    if (!name) return;
    const others = (d.savedMessages ?? []).filter((m) => m.name !== name);
    setD({ ...d, savedMessages: [...others, { name, message: d.message, ...(sio ? { event: d.event } : {}), ...(mqtt ? { topic: d.topic } : {}) }] });
    setPickedMessage(name);
    useApp.getState().toast(current ? `Saved message "${name}". Save the connection to keep it.` : `Saved message "${name}" (kept with this draft; save the connection to keep it with the connection)`, 'success');
  };
  const pickMessage = (name: string) => {
    setPickedMessage(name);
    const m = d.savedMessages?.find((x) => x.name === name);
    if (m) setD({ ...d, message: m.message, ...(m.event !== undefined ? { event: m.event } : {}), ...(m.topic !== undefined ? { topic: m.topic } : {}) });
  };
  const deleteMessage = () => {
    if (!pickedMessage) return;
    setD({ ...d, savedMessages: (d.savedMessages ?? []).filter((m) => m.name !== pickedMessage) });
    setPickedMessage('');
  };
  const disconnect = () => session && call(mqtt ? 'mqtt.close' : sio ? 'sio.close' : 'wsock.close', { id: session }).then(() => setStatus('closed'));
  const send = () =>
    session &&
    (mqtt
      ? call('mqtt.publish', { id: session, topic: d.topic ?? '', payload: d.message, qos: d.qos ?? 0, retain: !!d.retain, environment: env })
      : sio
        ? call('sio.emit', { id: session, event: d.event ?? '', args: d.message, ack: !!d.ack, environment: env })
        : call('wsock.send', { id: session, data: d.message, environment: env })
    ).catch((e) => useApp.getState().toast(asError(e).message, 'error'));
  // MQTT subscriptions: kept with the connection and subscribed on connect; changes apply at once while connected
  const addSubscription = async () => {
    const topic = newSub.topic.trim();
    if (!topic) return;
    if (session && status === 'open') {
      try {
        await call('mqtt.subscribe', { id: session, topic, qos: newSub.qos, environment: env });
      } catch (e) {
        useApp.getState().toast(asError(e).message, 'error');
        return;
      }
    }
    setD({ ...d, subscriptions: [...(d.subscriptions ?? []).filter((s) => s.topic !== topic), { topic, qos: newSub.qos }] });
    setNewSub({ topic: '', qos: newSub.qos });
  };
  const removeSubscription = (topic: string) => {
    if (session && status === 'open') void call('mqtt.unsubscribe', { id: session, topic, environment: env }).catch((e) => useApp.getState().toast(asError(e).message, 'error'));
    setD({ ...d, subscriptions: (d.subscriptions ?? []).filter((s) => s.topic !== topic) });
  };
  const [direction, setDirection] = useState<'all' | 'sent' | 'received'>('all');
  const shown = messages.filter((m) => (direction === 'all' || m.direction === direction) && (!filter || `${m.topic ?? ''} ${m.event ?? ''} ${m.data}`.toLowerCase().includes(filter.toLowerCase())));
  let parsed: unknown;
  try {
    parsed = selected ? JSON.parse(selected.data) : undefined;
  } catch {
    parsed = undefined;
  }
  // this editor's tab in the shared tab strip
  const saveTest = () => {
    const parsed = (() => {
      try {
        return JSON.parse(d.message) as unknown;
      } catch {
        return d.message;
      }
    })();
    const send = mqtt ? (d.topic ? [{ topic: d.topic, payload: d.message, qos: d.qos ?? 0 }] : []) : sio ? (d.event ? [{ event: d.event, args: Array.isArray(parsed) ? parsed : [parsed], ack: !!d.ack }] : []) : d.message.trim() ? [d.message] : [];
    void saveAsTestFile(`${hostOf(d.url)} replies`, { kind: 'websocket', mode: d.mode ?? 'websocket', url: d.url, send, subscribe: mqtt ? (d.subscriptions ?? []).map((s) => s.topic) : undefined, headers: mqtt ? undefined : d.headers, username: mqtt ? d.username : undefined, password: mqtt ? d.password : undefined });
  };
  const [tabTitle, setTabTitle] = useSticky<string | undefined>(`ws:title:${docId ?? 'main'}`, undefined);
  // a new tab is "New WebSocket / Socket.IO / MQTT request", not its URL (often a {{variable}})
  const title = current?.name ?? tabTitle ?? NEW_TAB_TITLE[d.mode === 'mqtt' ? 'mqtt' : d.mode === 'socketio' ? 'socketio' : 'websocket'];
  const renameTab = async () => {
    const name = (await promptText('Rename', { message: 'Name', value: title, okLabel: 'Rename' }))?.trim();
    if (!name) return;
    if (current) await saved.put({ ...current, name });
    else setTabTitle(name);
  };
  useSingleEditorTab('websocket', { title, badge: d.mode === 'mqtt' ? 'MQTT' : d.mode === 'socketio' ? 'SIO' : 'WS', badgeClass: 'text-[#d97706]', item: savedId, onRename: () => void renameTab(), onSaveAsTest: saveTest });
  return (
    <Split id="ws-saved" sidebar collapsed initial={18} min={12}>
    <SidebarShell
      id="websocket"
      panes={[
        {
          id: 'saved',
          label: 'Saved',
          icon: <Bookmark size={13} />,
          render: () => (
            <FolderList
              id="ws-saved"
              title="Saved connections"
              itemNoun="connection"
              addLabel="Save current connection"
              folders={saved.lib.folders}
              selected={savedId}
              onSelect={open}
              onAdd={(folder) => void save(true, folder)}
              ops={saved.ops}
              items={saved.lib.items.map((i) => ({ id: i.id, name: i.name, folder: i.folder, subtitle: i.data.url, icon: <Radio size={12} className="text-muted" /> }))}
              empty={
                <Empty title="No saved connections">
                  Save a connection (URL, subprotocols, headers and message) to open it again later, and group them in folders.
                </Empty>
              }
            />
          ),
        },
        { id: 'environments', label: 'Environments', icon: <KeyRound size={13} />, render: () => <EnvironmentsPane /> },
        { id: 'history', label: 'History', icon: <History size={13} />, render: () => <HistoryPane kind="websocket" noun="Connections you open" /> },
      ]}
    />
    <div className="h-full flex flex-col min-w-0">
      <RequestBreadcrumb collectionId={current?.collectionId ?? collectionId} folder={current?.folder} name={title} onSave={() => void save()} />
      <div className="flex items-center gap-2 p-2 border-b border-line">
        <Badge tone={status === 'open' ? 'ok' : status === 'connecting' ? 'warn' : 'default'}>{status}</Badge>
        <div className="flex rounded-md border border-line overflow-hidden text-xs shrink-0" role="group" aria-label="Protocol">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={status !== 'closed'}
              className={cx('px-2 py-1', (d.mode ?? 'websocket') === m.id ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg')}
              onClick={() => {
                setD({ ...d, mode: m.id });
                setTab('message');
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <VarInput ariaLabel={mqtt ? 'Broker URL' : 'WebSocket URL'} className="flex-1 h-8" value={d.url} onChange={(url) => setD({ ...d, url })} placeholder={mqtt ? 'mqtt://localhost:1883 (mqtts://, ws:// and wss:// work too)' : sio ? 'http://localhost:3000/namespace' : 'wss://example.com/socket'} />
        {mqtt ? (
          <Input className="w-44" placeholder="Client ID (random)" title="MQTT client ID (a random one when empty); may use {{variables}}" value={d.clientId ?? ''} onChange={(e) => setD({ ...d, clientId: e.target.value })} />
        ) : sio ? (
          <Input className="w-40" placeholder="/socket.io" title="Socket.IO path on the server (default /socket.io)" value={d.path ?? ''} onChange={(e) => setD({ ...d, path: e.target.value })} />
        ) : (
          <Input className="w-48" placeholder="Subprotocols" title="Subprotocols, comma separated (e.g. graphql-ws, mqtt)" value={d.protocols} onChange={(e) => setD({ ...d, protocols: e.target.value })} />
        )}
        {status === 'open' ? (
          <Button icon={<Unplug size={13} />} onClick={disconnect}>
            Disconnect
          </Button>
        ) : (
          <Button variant="primary" icon={<Plug size={13} />} onClick={connect} loading={status === 'connecting'}>
            Connect
          </Button>
        )}
        <Button
          icon={<FileCheck2 size={13} />}
          title="Save as a YAML test file (tests/websocket): connect, send this message, check that something comes back"
          onClick={saveTest}
        >
          Test
        </Button>
        <Button icon={<Save size={13} />} title={current ? `Save changes to "${current.name}"` : 'Save this connection'} onClick={() => void save()}>
          {current ? (dirty ? 'Save*' : 'Save') : 'Save'}
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <Split id="ws-main" initial={40}>
          <div className="h-full flex flex-col">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'message', label: mqtt ? 'Publish' : sio ? 'Emit' : 'Message' },
                ...(mqtt
                  ? [
                      { id: 'subscriptions' as const, label: 'Subscriptions', badge: d.subscriptions?.length },
                      { id: 'connection' as const, label: 'Connection' },
                    ]
                  : [{ id: 'headers' as const, label: 'Handshake headers', badge: d.headers.length }]),
                ...(sio ? [{ id: 'auth' as const, label: 'Auth' }] : []),
              ]}
            />
            {tab === 'message' ? (
              <>
                {mqtt && (
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
                    <Input className="h-7 min-h-7 mono flex-1" placeholder="Topic, e.g. clinic/7/vitals" aria-label="Topic" value={d.topic ?? ''} onChange={(e) => setD({ ...d, topic: e.target.value })} />
                    <Select className="h-7 min-h-7 text-xs w-20 shrink-0" aria-label="QoS" title="Quality of service: 0 at most once, 1 at least once, 2 exactly once" value={String(d.qos ?? 0)} onChange={(e) => setD({ ...d, qos: Number(e.target.value) as Qos })}>
                      <option value="0">QoS 0</option>
                      <option value="1">QoS 1</option>
                      <option value="2">QoS 2</option>
                    </Select>
                    <label className="text-xs text-muted flex items-center gap-1.5 shrink-0" title="The broker keeps the last retained message of a topic for new subscribers">
                      <input type="checkbox" checked={!!d.retain} onChange={(e) => setD({ ...d, retain: e.target.checked })} /> Retain
                    </label>
                  </div>
                )}
                {sio && (
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
                    <Input className="h-7 min-h-7 mono flex-1" placeholder="Event name, e.g. message" aria-label="Event name" value={d.event ?? ''} onChange={(e) => setD({ ...d, event: e.target.value })} />
                    <label className="text-xs text-muted flex items-center gap-1.5 shrink-0" title="Wait for the server's acknowledgement (callback) and show it">
                      <input type="checkbox" checked={!!d.ack} onChange={(e) => setD({ ...d, ack: e.target.checked })} /> Acknowledgement
                    </label>
                  </div>
                )}
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
                  <Select className="h-7 min-h-7 text-xs flex-1" aria-label="Saved messages" value={pickedMessage} onChange={(e) => pickMessage(e.target.value)}>
                    <option value="">{d.savedMessages?.length ? `Saved messages (${d.savedMessages.length})…` : 'No saved messages'}</option>
                    {(d.savedMessages ?? []).map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.event || m.topic ? `${m.name} · ${m.event || m.topic}` : m.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" icon={<BookmarkPlus size={12} />} title="Keep this message to send again" onClick={() => void saveMessage()}>
                    Save message
                  </Button>
                  {pickedMessage && (
                    <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} title={`Delete "${pickedMessage}"`} aria-label="Delete saved message" onClick={deleteMessage} />
                  )}
                </div>
                {sio && <div className="px-2 pt-1 text-[11px] text-muted">Arguments as JSON; a JSON list sends several arguments.</div>}
                <div className="flex-1 min-h-0">
                  <CodeEditor language="json" value={d.message} onChange={(message) => setD({ ...d, message })} />
                </div>
                <div className="p-2 border-t border-line flex justify-end">
                  <Button variant="primary" icon={<Send size={13} />} disabled={status !== 'open' || (sio && !d.event?.trim()) || (mqtt && !d.topic?.trim())} onClick={send}>
                    {mqtt ? 'Publish' : sio ? 'Emit' : 'Send'}
                  </Button>
                </div>
              </>
            ) : tab === 'subscriptions' ? (
              <div className="h-full flex flex-col">
                <p className="px-2 py-1.5 text-xs text-muted border-b border-line">Topic filters to receive, subscribed when you connect. <span className="mono">+</span> matches one level, <span className="mono">#</span> the rest. While connected, changes apply at once.</p>
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
                  <Input
                    className="h-7 min-h-7 mono flex-1"
                    placeholder="e.g. clinic/+/vitals or alerts/#"
                    aria-label="Topic filter"
                    value={newSub.topic}
                    onChange={(e) => setNewSub({ ...newSub, topic: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && void addSubscription()}
                  />
                  <Select className="h-7 min-h-7 text-xs w-20 shrink-0" aria-label="Subscription QoS" value={String(newSub.qos)} onChange={(e) => setNewSub({ ...newSub, qos: Number(e.target.value) as Qos })}>
                    <option value="0">QoS 0</option>
                    <option value="1">QoS 1</option>
                    <option value="2">QoS 2</option>
                  </Select>
                  <Button size="sm" icon={<Plus size={12} />} disabled={!newSub.topic.trim()} onClick={() => void addSubscription()}>
                    {status === 'open' ? 'Subscribe' : 'Add'}
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  {d.subscriptions?.length ? (
                    d.subscriptions.map((s) => (
                      <div key={s.topic} className="flex items-center gap-2 px-2 h-8 border-b border-line/50 text-sm">
                        <span className="mono text-xs truncate flex-1">{s.topic}</span>
                        <Badge>QoS {s.qos}</Badge>
                        <Button size="sm" variant="ghost" icon={<X size={12} />} aria-label={`Remove ${s.topic}`} title={status === 'open' ? 'Unsubscribe and remove' : 'Remove'} onClick={() => removeSubscription(s.topic)} />
                      </div>
                    ))
                  ) : (
                    <Empty title="No subscriptions">Add a topic filter to receive messages; you can publish without subscribing.</Empty>
                  )}
                </div>
              </div>
            ) : tab === 'connection' ? (
              <div className="p-3 space-y-3 overflow-auto">
                <label className="block text-xs text-muted">
                  Username
                  <VarInput ariaLabel="Username" className="mt-1 h-8" value={d.username ?? ''} onChange={(username) => setD({ ...d, username })} placeholder="optional" />
                </label>
                <label className="block text-xs text-muted">
                  Password
                  {!d.password || d.password.trimStart().startsWith('{') ? (
                    <VarInput ariaLabel="Password" className="mt-1 h-8" value={d.password ?? ''} onChange={(password) => setD({ ...d, password })} placeholder="{{mqttPassword}}" />
                  ) : (
                    // a typed password is masked (a {{variable}} reference is shown as it is)
                    <Input type="password" autoFocus aria-label="Password" className="mt-1 h-8 w-full" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />
                  )}
                  <span className="block mt-1">
                    Use a secret variable such as {'{{mqttPassword}}'}: only a variable reference is saved. A typed password is used until you close the app.
                  </span>
                </label>
                <label className="block text-xs text-muted">
                  Protocol version
                  <Select className="mt-1 h-8 w-48" aria-label="MQTT version" value={String(d.mqttVersion ?? 4)} onChange={(e) => setD({ ...d, mqttVersion: Number(e.target.value) as 4 | 5 })}>
                    <option value="4">MQTT 3.1.1</option>
                    <option value="5">MQTT 5</option>
                  </Select>
                </label>
              </div>
            ) : tab === 'auth' ? (
              <div className="h-full flex flex-col">
                <p className="px-2 py-1.5 text-xs text-muted border-b border-line">The handshake's auth payload (JSON), e.g. {'{ "token": "{{accessToken}}" }'}. Values may use {'{{variables}}'}.</p>
                <div className="flex-1 min-h-0">
                  <CodeEditor language="json" value={d.auth ?? ''} onChange={(auth) => setD({ ...d, auth })} placeholder='{ "token": "{{accessToken}}" }' />
                </div>
              </div>
            ) : (
              <div className="p-2">
                <KeyValueEditor rows={d.headers} onChange={(headers) => setD({ ...d, headers })} keyPlaceholder="Header" />
              </div>
            )}
          </div>
          <Split id="ws-log" direction="vertical" initial={60}>
            <div className="h-full flex flex-col">
              <div className="flex items-center gap-2 px-2 h-9 border-b border-line">
                <span className="text-sm font-medium">Messages</span>
                <MessageRate messages={messages} />
                <Select className="ml-auto h-6 min-h-6 py-0 text-xs w-28" aria-label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                  <option value="all">All</option>
                  <option value="sent">Sent</option>
                  <option value="received">Received</option>
                </Select>
                <Input className="h-6 min-h-6 text-xs w-40" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => setMessages([])}>
                  Clear
                </Button>
              </div>
              {shown.length ? (
                <VirtualList
                  className="flex-1"
                  items={shown}
                  rowHeight={26}
                  render={(m) => (
                    <button onClick={() => setSelected(m)} className={cx('w-full h-full flex items-center gap-2 px-2 text-sm border-b border-line/50 text-left hover:bg-hover', selected?.id === m.id && 'bg-accent/10')}>
                      {m.direction === 'sent' ? <ArrowUpRight size={13} className="text-accent shrink-0" /> : m.direction === 'received' ? <ArrowDownLeft size={13} className="text-ok shrink-0" /> : <Info size={13} className="text-muted shrink-0" />}
                      <span className="text-xs text-muted tabular-nums shrink-0">{new Date(m.time).toLocaleTimeString()}</span>
                      {m.event && <Badge tone={m.ack ? 'ok' : 'accent'}>{m.ack ? `ack ${m.event}` : m.event}</Badge>}
                      {m.topic && <Badge tone="accent">{m.retain ? `${m.topic} · retained` : m.topic}</Badge>}
                      <span className={cx('truncate mono text-xs', m.direction === 'system' && 'text-muted')}>{m.data}</span>
                    </button>
                  )}
                />
              ) : (
                <Empty title="No messages yet" />
              )}
            </div>
            <div className="h-full overflow-auto">{selected ? parsed !== undefined ? <JsonTree data={parsed} /> : <pre className="p-3 mono text-xs whitespace-pre-wrap">{selected.data}</pre> : <Empty title="Select a message" />}</div>
          </Split>
        </Split>
      </div>
    </div>
    </Split>
  );
}
