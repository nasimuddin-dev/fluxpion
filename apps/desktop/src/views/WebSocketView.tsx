import { ArrowDownLeft, ArrowUpRight, Info, Plug, Send, Trash2, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { asError, call, on } from '../api';
import { persisted, useApp } from '../store';
import type { KeyValue } from '../types';
import { CodeEditor } from '../components/CodeEditor';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { JsonTree } from '../components/JsonView';
import { VarInput } from '../components/VarInput';
import { Badge, Button, cx, Empty, Input, Split, Tabs, VirtualList } from '../components/ui';

interface WsMessage {
  id: string;
  time: number;
  direction: 'sent' | 'received' | 'system';
  data: string;
  size: number;
  binary?: boolean;
}

const drafts = persisted('websocket', { url: '{{wsUrl}}', protocols: '', headers: [] as KeyValue[], message: '{\n  "type": "ping"\n}' });

export function WebSocketView() {
  const [d, setD] = useState(drafts.load);
  const [session, setSession] = useState<string>();
  const [status, setStatus] = useState<'closed' | 'connecting' | 'open'>('closed');
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [selected, setSelected] = useState<WsMessage>();
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'message' | 'headers'>('message');
  const env = useApp((s) => s.environment);
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
      const r = await call<{ id: string }>('wsock.connect', { url: d.url, protocols: d.protocols ? d.protocols.split(',').map((s) => s.trim()) : undefined, headers: d.headers, environment: env });
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
  const disconnect = () => session && call('wsock.close', { id: session }).then(() => setStatus('closed'));
  const send = () => session && call('wsock.send', { id: session, data: d.message }).catch((e) => useApp.getState().toast(asError(e).message, 'error'));
  const shown = filter ? messages.filter((m) => m.data.toLowerCase().includes(filter.toLowerCase())) : messages;
  let parsed: unknown;
  try {
    parsed = selected ? JSON.parse(selected.data) : undefined;
  } catch {
    parsed = undefined;
  }
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-line">
        <Badge tone={status === 'open' ? 'ok' : status === 'connecting' ? 'warn' : 'default'}>{status}</Badge>
        <VarInput ariaLabel="WebSocket URL" className="flex-1 h-8" value={d.url} onChange={(url) => setD({ ...d, url })} placeholder="wss://example.com/socket" />
        <Input className="w-48" placeholder="Subprotocols" title="Subprotocols, comma separated (e.g. graphql-ws, mqtt)" value={d.protocols} onChange={(e) => setD({ ...d, protocols: e.target.value })} />
        {status === 'open' ? (
          <Button icon={<Unplug size={13} />} onClick={disconnect}>
            Disconnect
          </Button>
        ) : (
          <Button variant="primary" icon={<Plug size={13} />} onClick={connect} loading={status === 'connecting'}>
            Connect
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <Split id="ws-main" initial={40}>
          <div className="h-full flex flex-col">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'message', label: 'Message' },
                { id: 'headers', label: 'Handshake headers', badge: d.headers.length },
              ]}
            />
            {tab === 'message' ? (
              <>
                <div className="flex-1 min-h-0">
                  <CodeEditor language="json" value={d.message} onChange={(message) => setD({ ...d, message })} />
                </div>
                <div className="p-2 border-t border-line flex justify-end">
                  <Button variant="primary" icon={<Send size={13} />} disabled={status !== 'open'} onClick={send}>
                    Send
                  </Button>
                </div>
              </>
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
  );
}
