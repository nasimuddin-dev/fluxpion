import { ArrowDownLeft, ArrowUpRight, BookmarkPlus, Info, Plug, Radio, Save, Send, Trash2, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { asError, call, on } from '../api';
import { persisted, promptText, useApp } from '../store';
import { FolderList } from '../components/FolderList';
import { useLibrary } from '../lib/library';
import { useSticky } from '../lib/sticky';
import { useIntent } from '../hooks';
import type { KeyValue } from '../types';
import { CodeEditor } from '../components/CodeEditor';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { JsonTree } from '../components/JsonView';
import { VarInput } from '../components/VarInput';
import { Badge, Button, cx, Empty, Input, Select, Split, Tabs, VirtualList } from '../components/ui';

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
}

type Draft = {
  url: string;
  protocols: string;
  headers: KeyValue[];
  message: string;
  /** Plain WebSocket, or a Socket.IO server (events with JSON arguments, acknowledgements). */
  mode?: 'websocket' | 'socketio';
  event?: string;
  ack?: boolean;
  /** Socket.IO endpoint path (default /socket.io) and handshake auth payload (JSON). */
  path?: string;
  auth?: string;
  /** Messages kept with the connection, to send again (Socket.IO: with their event). */
  savedMessages?: Array<{ name: string; message: string; event?: string }>;
};
const hostOf = (url: string) => url.replace(/^wss?:\/\//, '').split(/[/?#]/)[0] || 'Connection';

const drafts = persisted<Draft>('websocket', { url: '{{wsUrl}}', protocols: '', headers: [] as KeyValue[], message: '{\n  "type": "ping"\n}' });

export function WebSocketView() {
  const [d, setD] = useState(drafts.load);
  const [session, setSession] = useState<string>();
  const [status, setStatus] = useState<'closed' | 'connecting' | 'open'>('closed');
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [selected, setSelected] = useState<WsMessage>();
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'message' | 'headers' | 'auth'>('message');
  const sio = d.mode === 'socketio';
  const env = useApp((s) => s.environment);
  // saved connections (URL, subprotocols, handshake headers, message) with folders
  const saved = useLibrary<Draft>('websocket');
  const [savedId, setSavedId] = useSticky<string | undefined>('ws:saved', undefined);
  const current = saved.lib.items.find((i) => i.id === savedId);
  const dirty = !!current && JSON.stringify(current.data) !== JSON.stringify(d);
  const open = async (id: string) => {
    const it = await saved.find(id);
    if (!it) return;
    setSavedId(id);
    setD({ ...drafts.load(), ...it.data });
  };
  // global search → open a saved connection
  useIntent('websocket', (p) => p?.savedId && open(p.savedId));
  const save = async (asNew = false, folder?: string) => {
    if (current && !asNew) {
      await saved.put({ ...current, data: d });
      useApp.getState().toast(`Saved "${current.name}"`, 'success');
      return;
    }
    const name = await promptText('Save connection', { message: 'Name', value: hostOf(d.url), okLabel: 'Save' });
    if (!name) return;
    setSavedId(await saved.put({ name, folder, data: d }));
  };
  const sessionRef = useRef<string | undefined>(undefined);
  sessionRef.current = session;
  useEffect(() => drafts.save(d), [d]);
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
      const r = sio
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
    const name = (await promptText('Save message', { message: 'Name', value: pickedMessage || (sio ? d.event : '') || 'Message', okLabel: 'Save' }))?.trim();
    if (!name) return;
    const others = (d.savedMessages ?? []).filter((m) => m.name !== name);
    setD({ ...d, savedMessages: [...others, { name, message: d.message, ...(sio ? { event: d.event } : {}) }] });
    setPickedMessage(name);
    useApp.getState().toast(current ? `Saved message "${name}". Save the connection to keep it.` : `Saved message "${name}" (kept with this draft; save the connection to keep it with the connection)`, 'success');
  };
  const pickMessage = (name: string) => {
    setPickedMessage(name);
    const m = d.savedMessages?.find((x) => x.name === name);
    if (m) setD({ ...d, message: m.message, ...(m.event !== undefined ? { event: m.event } : {}) });
  };
  const deleteMessage = () => {
    if (!pickedMessage) return;
    setD({ ...d, savedMessages: (d.savedMessages ?? []).filter((m) => m.name !== pickedMessage) });
    setPickedMessage('');
  };
  const disconnect = () => session && call(sio ? 'sio.close' : 'wsock.close', { id: session }).then(() => setStatus('closed'));
  const send = () =>
    session &&
    (sio ? call('sio.emit', { id: session, event: d.event ?? '', args: d.message, ack: !!d.ack, environment: env }) : call('wsock.send', { id: session, data: d.message, environment: env })).catch((e) => useApp.getState().toast(asError(e).message, 'error'));
  const shown = filter ? messages.filter((m) => m.data.toLowerCase().includes(filter.toLowerCase())) : messages;
  let parsed: unknown;
  try {
    parsed = selected ? JSON.parse(selected.data) : undefined;
  } catch {
    parsed = undefined;
  }
  return (
    <Split id="ws-saved" sidebar initial={18} min={12}>
    <div className="h-full bg-panel/50">
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
    </div>
    <div className="h-full flex flex-col min-w-0">
      <div className="flex items-center gap-2 p-2 border-b border-line">
        <Badge tone={status === 'open' ? 'ok' : status === 'connecting' ? 'warn' : 'default'}>{status}</Badge>
        <div className="flex rounded-md border border-line overflow-hidden text-xs shrink-0" role="group" aria-label="Protocol">
          {(['websocket', 'socketio'] as const).map((m) => (
            <button key={m} type="button" disabled={status !== 'closed'} className={cx('px-2 py-1', (d.mode ?? 'websocket') === m ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg')} onClick={() => setD({ ...d, mode: m })}>
              {m === 'websocket' ? 'WebSocket' : 'Socket.IO'}
            </button>
          ))}
        </div>
        <VarInput ariaLabel="WebSocket URL" className="flex-1 h-8" value={d.url} onChange={(url) => setD({ ...d, url })} placeholder={sio ? 'http://localhost:3000/namespace' : 'wss://example.com/socket'} />
        {sio ? (
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
                { id: 'message', label: sio ? 'Emit' : 'Message' },
                { id: 'headers', label: 'Handshake headers', badge: d.headers.length },
                ...(sio ? [{ id: 'auth' as const, label: 'Auth' }] : []),
              ]}
            />
            {tab === 'message' ? (
              <>
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
                        {m.event ? `${m.name} · ${m.event}` : m.name}
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
                  <Button variant="primary" icon={<Send size={13} />} disabled={status !== 'open' || (sio && !d.event?.trim())} onClick={send}>
                    {sio ? 'Emit' : 'Send'}
                  </Button>
                </div>
              </>
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
                <span className="text-xs text-muted">{messages.length}</span>
                <Input className="ml-auto h-6 min-h-6 text-xs w-48" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
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
