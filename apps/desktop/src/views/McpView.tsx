import { ArrowDownLeft, ArrowUpRight, Braces, CircleDot, Copy, Download, FileText, MessageSquare, MoreHorizontal, Pencil, Play, Plug, Plus, Radio, Save, Sparkles, Trash2, Unplug, Wrench, Bookmark, History, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asError, call, on, type NormalizedError } from '../api';
import { confirmAction, persisted, promptText, useApp } from '../store';
import { useDoc, useDocs } from '../lib/docs';
import { useIntent, useSendShortcut, useSaveShortcut } from '../hooks';
import type { CheckConfig, CheckResult, McpServerConfig } from '../types';
import { formatMs, uid, plural } from '../lib/format';
import { AssertionEditor } from '../components/AssertionEditor';
import { CodeEditor } from '../components/CodeEditor';
import { JsonSchemaForm } from '../components/JsonSchemaForm';
import { JsonTree, RawView } from '../components/JsonView';
import { Markdown } from '../components/Markdown';
import { useSticky } from '../lib/sticky';
import { downloadContent } from '../lib/files';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { CheckList, ErrorPanel } from '../components/Results';
import { FolderList, type FolderListOps } from '../components/FolderList';
import { SidebarShell } from '../components/SidebarShell';
import { closeTabsFor, useSingleEditorTab } from '../components/EditorTabs';
import { EnvironmentsPane, HistoryPane } from '../components/SidebarPanes';
import { Badge, Button, cx, Empty, Field, IconButton, Input, Menu, SectionTitle, Select, Split, Tabs, VirtualList } from '../components/ui';

interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}
interface Discovery {
  serverInfo?: { name: string; version: string };
  capabilities?: Record<string, unknown>;
  instructions?: string;
  tools: Tool[];
  resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  resourceTemplates: Array<{ uriTemplate: string; name: string; description?: string }>;
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>;
}
interface McpEvent {
  id: string;
  timestamp: number;
  direction: 'outgoing' | 'incoming' | 'local';
  method: string;
  kind: string;
  rpcId?: string | number;
  request?: unknown;
  response?: unknown;
  error?: unknown;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

type Tab = 'tools' | 'resources' | 'prompts' | 'trace' | 'info' | 'settings';

/** Merge event lists by id — the connect snapshot and the live stream overlap. */
function mergeEvents(a: McpEvent[], b: McpEvent[]): McpEvent[] {
  const seen = new Set(a.map((e) => e.id));
  const out = [...a];
  for (const e of b) if (!seen.has(e.id)) (seen.add(e.id), out.push(e));
  return out.sort((x, y) => x.timestamp - y.timestamp).slice(-5000);
}

/** Which server each MCP tab shows (each tab is its own document). */
const tabServer = persisted<{ serverId?: string }>('mcp', {});

export function McpView() {
  const { docId, active } = useDoc();
  const docState = useMemo(() => tabServer.forDoc(docId), [docId]);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [selected, setSelected] = useState<string | undefined>(() => docState.load().serverId);
  useEffect(() => docState.save({ serverId: selected }), [selected, docState]);
  // a server being added: edited inline like any request, saved with Save (or on Connect)
  const [draft, setDraft] = useState<McpServerConfig | null>(null);
  const [discovery, setDiscovery] = useState<Record<string, Discovery>>({});
  const [events, setEvents] = useState<Record<string, McpEvent[]>>({});
  const [connecting, setConnecting] = useState<string>();
  const [connError, setConnError] = useState<NormalizedError>();
  const [tab, setTab] = useSticky<Tab>(`mcp:tab:${docId ?? 'main'}`, 'tools');
  const env = useApp((s) => s.environment);
  const load = useCallback(async () => {
    const s = await call<McpServerConfig[]>('mcp.servers');
    setServers(s);
    setSelected((cur) => cur ?? s[0]?.id);
    useApp.getState().set({ mcpConnected: s.filter((x) => x.connected).length });
  }, []);
  useEffect(() => {
    void load();
    return on<Array<{ serverId: string; event: McpEvent }>>('mcp.events', (items) =>
      setEvents((ev) => {
        const next = { ...ev };
        for (const it of items) next[it.serverId] = mergeEvents(next[it.serverId] ?? [], [it.event]);
        return next;
      }),
    );
  }, [load]);
  const addServer = (folder?: string) => {
    setDraft({ id: uid('mcp-'), name: 'New server', transport: 'stdio', command: 'node', args: [], ...(folder ? { folder } : {}) });
    setTab('settings');
  };
  const selectServer = (id: string) => {
    setDraft(null);
    setSelected(id);
  };
  useIntent('mcp', (p) => {
    if (p?.serverId) selectServer(p.serverId);
    if (p?.addServer) addServer();
  });

  const server = servers.find((s) => s.id === selected);
  const disc = !draft && selected ? discovery[selected] : undefined;
  // the server on screen: the one being added, or the selected one; `form` holds its edits until saved
  const current = draft ?? server;
  const savedJson = !draft && server ? JSON.stringify(configOf(server)) : '';
  const [form, setForm] = useState<McpServerConfig | undefined>(current && configOf(current));
  useEffect(() => {
    setForm(current ? configOf(current) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, savedJson]);
  const dirty = !!draft || (!!form && JSON.stringify(form) !== savedJson);

  const connect = async (id: string) => {
    setConnecting(id);
    setConnError(undefined);
    setEvents((e) => ({ ...e, [id]: [] }));
    try {
      const r = await call<{ discovery: Discovery; events: McpEvent[] }>('mcp.connect', { serverId: id, environment: env });
      setDiscovery((d) => ({ ...d, [id]: r.discovery }));
      setEvents((e) => ({ ...e, [id]: mergeEvents(e[id] ?? [], r.events) }));
      setTab('tools');
    } catch (e) {
      setConnError(asError(e));
      setTab('trace');
    } finally {
      setConnecting(undefined);
      void load();
    }
  };
  const disconnect = async (id: string) => {
    await call('mcp.disconnect', { serverId: id });
    setDiscovery((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    void load();
  };
  /** Record the connected server (tools, resources, prompts and the calls made so far) as a mock server. */
  const saveMock = async (id: string) => {
    try {
      const r = await call<{ path: string; tools: number; calls: number; resources: number }>('mcp.mock.save', { serverId: id, addServer: true });
      useApp.getState().toast(`Saved ${r.path}: ${plural(r.tools, 'tool')}, ${plural(r.calls, 'recorded call')}. Added as a mock server.`, 'success');
      await load();
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  // folders of the server list (empty folders included) live in the workspace library "mcp"
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    void call<{ folders: string[] }>('lib.get', { kind: 'mcp' }).then((l) => setFolders(l.folders), () => undefined);
  }, []);
  const saveFolders = async (next: string[]) => {
    setFolders(next);
    await call('lib.save', { kind: 'mcp', library: { folders: next, items: [] } });
  };
  const serverOps: FolderListOps = {
    renameItem: (id, name) => saveServers(servers.map((s) => (s.id === id ? { ...s, name } : s))),
    moveItem: (id, folder) => saveServers(servers.map((s) => (s.id === id ? { ...s, folder } : s))),
    deleteItem: async (id) => {
      closeTabsFor([id]);
      if (servers.find((s) => s.id === id)?.connected) await disconnect(id);
      await saveServers(servers.filter((s) => s.id !== id));
    },
    duplicateItem: (id) => {
      const s = servers.find((x) => x.id === id);
      if (s) return saveServers([...servers, { ...s, id: uid('mcp-'), name: `${s.name} copy` }]);
    },
    setFolders: saveFolders,
    renameFolder: async (from, to) => {
      await saveFolders(folders.map((f) => (f === from ? to : f)));
      await saveServers(servers.map((s) => (s.folder === from ? { ...s, folder: to } : s)));
    },
    deleteFolder: async (name) => {
      await saveFolders(folders.filter((f) => f !== name));
      await saveServers(servers.map((s) => (s.folder === name ? { ...s, folder: undefined } : s)));
    },
  };
  const saveServers = async (list: McpServerConfig[]) => {
    await call('mcp.saveServers', { servers: list.map(({ connected: _c, ...s }) => s) });
    await load();
  };
  /** Save the server on screen (new or edited); returns its id. */
  const saveForm = async (quiet = false): Promise<string | undefined> => {
    if (!form) return undefined;
    if (!form.name.trim()) {
      useApp.getState().toast('Give the server a name first', 'error');
      setTab('settings');
      return undefined;
    }
    try {
      const exists = servers.some((x) => x.id === form.id);
      await saveServers(exists ? servers.map((x) => (x.id === form.id ? form : x)) : [...servers, form]);
      setDraft(null);
      setSelected(form.id);
      if (!quiet) useApp.getState().toast(`Saved "${form.name}"`, 'success');
      return form.id;
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
      return undefined;
    }
  };
  /** Connect the server on screen, saving it first when it's new or changed. */
  const connectCurrent = async () => {
    const id = dirty ? await saveForm(true) : current?.id;
    if (id) await connect(id);
  };
  const removeCurrent = async () => {
    if (!current) return;
    // discarding a new server closes its tab
    if (draft) return docId ? useDocs.getState().close('mcp', docId) : setDraft(null);
    if (!(await confirmAction({ title: 'Remove MCP server', message: `Remove the MCP server "${current.name}"?`, detail: 'Saved tests that call it will fail until you add it again.', confirmLabel: 'Remove server', danger: true }))) return;
    if (server?.connected) await disconnect(current.id);
    closeTabsFor([current.id]);
    await saveServers(servers.filter((s) => s.id !== current.id));
    setSelected(undefined);
  };
  useSaveShortcut('mcp', () => void saveForm());

  // this editor's tab in the shared tab strip (while a server is selected)
  useSingleEditorTab(
    'mcp',
    current && form
      ? {
          title: form.name || 'MCP server',
          badge: 'MCP',
          badgeClass: 'text-accent',
          dirty,
          item: draft ? undefined : current.id,
          onRename: async () => {
            const name = (await promptText('Rename server', { message: 'Name', value: form.name, okLabel: 'Rename' }))?.trim();
            if (!name) return;
            if (draft) setForm({ ...form, name });
            else await serverOps.renameItem(current.id, name);
          },
          onDuplicate: draft ? undefined : () => void serverOps.duplicateItem?.(current.id),
        }
      : undefined,
  );
  return (
    <>
    <Split id="mcp-servers" sidebar collapsed initial={20} min={14}>
      <SidebarShell
        id="mcp"
        panes={[
          {
            id: 'saved',
            label: 'Servers',
            icon: <Plug size={13} />,
            render: () => (
              <FolderList
                id="mcp-servers"
                title="MCP servers"
                itemNoun="server"
                addLabel="Add MCP server"
                folders={folders}
                selected={draft ? undefined : selected}
                onSelect={selectServer}
                onAdd={(folder) => addServer(folder)}
                items={servers.map((s) => ({
                  id: s.id,
                  name: s.name,
                  folder: s.folder,
                  icon: <CircleDot size={10} className={s.connected ? 'text-ok' : 'text-muted'} />,
                  subtitle: serverSummary(s),
                }))}
                itemMenu={(id) => {
                  const s = servers.find((x) => x.id === id)!;
                  return [
                    { label: 'Settings', icon: <Pencil size={14} />, onSelect: () => (selectServer(id), setTab('settings')) },
                    s.connected ? { label: 'Disconnect', icon: <Unplug size={14} />, onSelect: () => void disconnect(id) } : { label: 'Connect', icon: <Plug size={14} />, onSelect: () => (selectServer(id), void connect(id)) },
                  ];
                }}
                ops={serverOps}
                empty={
                  <Empty title="No MCP servers">
                    Add a server using stdio (a local command), Streamable HTTP, legacy SSE or a mock definition.
                  </Empty>
                }
              />
            ),
          },
          { id: 'environments', label: 'Environments', icon: <KeyRound size={13} />, render: () => <EnvironmentsPane /> },
          { id: 'history', label: 'History', icon: <History size={13} />, render: () => <HistoryPane kind="mcp" noun="MCP tool calls you make" /> },
        ]}
      />
      <div className="h-full flex flex-col min-w-0">
        {current && form ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line shrink-0">
              <Select className="w-44 shrink-0" aria-label="Transport" value={form.transport} onChange={(e) => setForm(withTransport(form, e.target.value as McpServerConfig['transport']))}>
                {TRANSPORTS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
              <TargetInput s={form} onChange={setForm} />
              {server?.connected && !draft ? (
                <Button variant="primary" icon={<Unplug size={14} />} onClick={() => disconnect(current.id)}>
                  Disconnect
                </Button>
              ) : (
                <Button variant="primary" icon={<Plug size={14} />} loading={connecting === current.id} onClick={() => void connectCurrent()} title={dirty ? 'Save and connect' : 'Connect'}>
                  Connect
                </Button>
              )}
              <Button icon={<Save size={14} />} onClick={() => void saveForm()} title="Save (Ctrl+S)">
                Save
              </Button>
              <Menu
                width={230}
                trigger={
                  <IconButton label="More server actions">
                    <MoreHorizontal size={15} />
                  </IconButton>
                }
                items={[
                  { label: 'Ping', icon: <Radio size={14} />, disabled: !server?.connected || !!draft, onSelect: () => void call<number>('mcp.ping', { serverId: current.id }).then((ms) => useApp.getState().toast(`Ping ${ms} ms`)) },
                  { label: 'Save as mock', icon: <Copy size={14} />, disabled: !server?.connected || !!draft || form.transport === 'mock', onSelect: () => void saveMock(current.id) },
                  { label: draft ? 'Discard' : 'Remove server…', icon: <Trash2 size={14} />, danger: true, separator: true, onSelect: () => void removeCurrent() },
                ]}
              />
            </div>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'tools', label: 'Tools', badge: disc?.tools.length },
                { id: 'resources', label: 'Resources', badge: disc ? disc.resources.length + disc.resourceTemplates.length : undefined },
                { id: 'prompts', label: 'Prompts', badge: disc?.prompts.length },
                { id: 'trace', label: 'Protocol trace', badge: draft ? undefined : events[current.id]?.length },
                { id: 'info', label: 'Server info' },
                { id: 'settings', label: 'Settings' },
              ]}
            />
            <div className="flex-1 min-h-0">
              {connError && tab !== 'trace' && tab !== 'settings' && <ErrorPanel error={connError} context={{ server }} />}
              {tab === 'settings' ? (
                <ServerSettings s={form} onChange={setForm} folders={folders} />
              ) : tab === 'trace' ? (
                <McpTrace events={draft ? [] : events[current.id] ?? []} error={connError} />
              ) : !disc ? (
                !connError && (
                  <Empty icon={<Plug size={26} />} title="Not connected">
                    Connect to discover tools, resources and prompts. Every JSON-RPC message is captured in the protocol trace.
                  </Empty>
                )
              ) : tab === 'tools' ? (
                <ToolsPanel serverId={current.id} tools={disc.tools} />
              ) : tab === 'resources' ? (
                <ResourcesPanel serverId={current.id} disc={disc} />
              ) : tab === 'prompts' ? (
                <PromptsPanel serverId={current.id} prompts={disc.prompts} />
              ) : (
                <div className="h-full">
                  <JsonTree data={{ serverInfo: disc.serverInfo, capabilities: disc.capabilities, instructions: disc.instructions }} />
                </div>
              )}
            </div>
          </>
        ) : (
          <Empty
            icon={<Plug size={28} />}
            title="Select or add an MCP server"
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => addServer()}>
                Add server
              </Button>
            }
          >
            A local command (stdio), Streamable HTTP, legacy SSE or a mock definition.
          </Empty>
        )}
      </div>
    </Split>
    </>
  );
}

function serverSummary(s: McpServerConfig): string {
  if (s.transport === 'stdio') return `${s.command} ${(s.args ?? []).join(' ')}`;
  if (s.transport === 'mock') return `mock · ${s.mockFile}`;
  return s.url;
}

/** A server's saved configuration (without its live connection state). */
function configOf(s: McpServerConfig & { connected?: boolean }): McpServerConfig {
  const { connected: _c, ...config } = s;
  return config as McpServerConfig;
}

const TRANSPORTS: Array<[McpServerConfig['transport'], string]> = [
  ['stdio', 'stdio (local)'],
  ['streamable-http', 'Streamable HTTP'],
  ['sse', 'SSE (legacy)'],
  ['mock', 'Mock'],
];

/** Switch transport, keeping the name and folder. */
function withTransport(s: McpServerConfig, t: McpServerConfig['transport']): McpServerConfig {
  if (t === s.transport) return s;
  const base = { id: s.id, name: s.name, folder: s.folder };
  return t === 'stdio' ? { ...base, transport: 'stdio', command: 'node', args: [] } : t === 'mock' ? { ...base, transport: 'mock', mockFile: 'mocks/server.mcp-mock.yaml' } : { ...base, transport: t, url: 'http://127.0.0.1:3000/mcp', headers: [] };
}

/** "node server.js --flag" ⇄ command + arguments (quotes keep spaces). */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | undefined;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
export function joinCommandLine(parts: string[]): string {
  return parts.map((p) => (p === '' || /[\s"']/.test(p) ? `"${p.replace(/"/g, "'")}"` : p)).join(' ');
}

/** The request bar's target: the command line (stdio), the URL (HTTP, SSE) or the mock file. */
function TargetInput({ s, onChange }: { s: McpServerConfig; onChange(s: McpServerConfig): void }) {
  const cmd = s.transport === 'stdio' ? [s.command, ...(s.args ?? [])] : [];
  const [text, setText] = useState(() => joinCommandLine(cmd));
  // edits made elsewhere (Settings, another server) replace the text; typing keeps it as typed
  const key = JSON.stringify(cmd);
  useEffect(() => {
    if (JSON.stringify(splitCommandLine(text)) !== key) setText(joinCommandLine(cmd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const cls = 'mono flex-1 min-w-0';
  if (s.transport === 'stdio')
    return (
      <Input
        className={cls}
        aria-label="Command"
        placeholder="npx -y @modelcontextprotocol/server-everything"
        title="The command and its arguments. On Windows use npx.cmd or the full path to node.exe; {{variables}} are resolved."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const [command = '', ...args] = splitCommandLine(e.target.value);
          onChange({ ...s, command, args });
        }}
      />
    );
  if (s.transport === 'mock') return <Input className={cls} aria-label="Mock definition file" placeholder="mocks/server.mcp-mock.yaml" value={s.mockFile} onChange={(e) => onChange({ ...s, mockFile: e.target.value })} />;
  return <Input className={cls} aria-label="Server URL" placeholder="https://example.com/mcp" value={s.url} onChange={(e) => onChange({ ...s, url: e.target.value })} />;
}

/** The Settings tab: every field of the server, or its JSON. */
function ServerSettings({ s, onChange, folders = [] }: { s: McpServerConfig; onChange(s: McpServerConfig): void; folders?: string[] }) {
  const [json, setJson] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const envRows = s.transport === 'stdio' ? Object.entries(s.env ?? {}).map(([key, value]) => ({ key, value })) : [];
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <SectionTitle>Server settings</SectionTitle>
          <Button
            size="sm"
            className="ml-auto"
            icon={<Braces size={12} />}
            onClick={() => {
              if (!json) {
                setJsonText(JSON.stringify(s, null, 2));
                return setJson(true);
              }
              try {
                onChange({ ...(JSON.parse(jsonText) as McpServerConfig), id: s.id });
                setJson(false);
              } catch (e) {
                useApp.getState().toast(`Invalid JSON: ${(e as Error).message}`, 'error');
              }
            }}
          >
            {json ? 'Apply JSON' : 'Edit JSON'}
          </Button>
        </div>
        {json ? (
          <div className="h-80 border border-line rounded-lg overflow-hidden">
            <CodeEditor language="json" value={jsonText} onChange={setJsonText} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value })} />
              </Field>
              <Field label="Folder" hint="Optional: groups servers in the list.">
                <Input list="mcp-folders" value={s.folder ?? ''} placeholder="(top level)" onChange={(e) => onChange({ ...s, folder: e.target.value.trim() ? e.target.value : undefined })} />
                <datalist id="mcp-folders">
                  {folders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </Field>
            </div>
            {s.transport === 'stdio' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Command" hint="On Windows use npx.cmd or the full path to node.exe. Variables like {{workspaceDir}} are resolved.">
                    <Input className="mono" value={s.command} onChange={(e) => onChange({ ...s, command: e.target.value })} />
                  </Field>
                  <Field label="Working directory">
                    <Input className="mono" value={s.cwd ?? ''} onChange={(e) => onChange({ ...s, cwd: e.target.value || undefined })} />
                  </Field>
                </div>
                <Field label="Arguments (one per line)">
                  <textarea className="field mono min-h-20" value={(s.args ?? []).join('\n')} onChange={(e) => onChange({ ...s, args: e.target.value.split('\n').filter((x) => x !== '') })} />
                </Field>
                <Field label="Environment variables" hint="Use {{variables}} to reference secrets instead of pasting them here.">
                  <KeyValueEditor rows={envRows} onChange={(rows) => onChange({ ...s, env: Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.value])) })} />
                </Field>
              </>
            ) : s.transport === 'mock' ? (
              <Field label="Mock definition" hint="A *.mcp-mock.yaml file in this workspace, with tools and their canned responses, resources and prompts. Connect to a real server and use Save as mock to record one.">
                <Input className="mono" value={s.mockFile} onChange={(e) => onChange({ ...s, mockFile: e.target.value })} />
              </Field>
            ) : (
              <>
                <Field label="URL">
                  <Input className="mono" value={s.url} onChange={(e) => onChange({ ...s, url: e.target.value })} />
                </Field>
                <Field label="Headers" hint="Use {{variables}} for tokens and keys.">
                  <KeyValueEditor rows={s.headers ?? []} onChange={(headers) => onChange({ ...s, headers })} />
                </Field>
              </>
            )}
          </>
        )}
        <p className="text-xs text-muted">Save with Ctrl+S; Connect saves first. Servers are kept in the workspace (mcp-servers.json).</p>
      </div>
    </div>
  );
}

function ToolsPanel({ serverId, tools }: { serverId: string; tools: Tool[] }) {
  // kept while the app runs: switching tabs, servers or views doesn't lose arguments or results
  const k = `mcp:${serverId}:`;
  const [sel, setSel] = useSticky<string | undefined>(`${k}tool`, tools[0]?.name);
  const [filter, setFilter] = useState('');
  const [args, setArgs] = useSticky<Record<string, Record<string, unknown>>>(`${k}args`, {});
  const [raw, setRaw] = useSticky(`${k}raw`, false);
  // raw JSON arguments and assertions belong to each tool (switching tools shows that tool's own)
  const [rawText, setRawText] = useSticky(`${k}rawText:${sel ?? ''}`, () => JSON.stringify((sel && args[sel]) || {}, null, 2));
  const [assertions, setAssertions] = useSticky<CheckConfig[]>(`${k}assertions:${sel ?? ''}`, [{ type: 'status', expected: 'success' }]);
  const [results, setResults] = useSticky<Record<string, ToolRun>>(`${k}results`, {});
  const result = sel ? results[sel] : undefined;
  const setResult = (r: ToolRun | undefined) => sel && setResults((all) => ({ ...all, [sel]: r! }));
  const [running, setRunning] = useState(false);
  const [sub, setSub] = useSticky<'form' | 'schema' | 'tests'>(`${k}sub`, 'form');
  const tool = tools.find((t) => t.name === sel);
  const value = (sel && args[sel]) || {};
  const exec = async () => {
    if (!tool) return;
    let a = value;
    if (raw) {
      try {
        a = JSON.parse(rawText || '{}');
      } catch (e) {
        return useApp.getState().toast(`Invalid JSON: ${(e as Error).message}`, 'error');
      }
    }
    // required arguments left empty: say which (sending them anyway is useful to test the server's validation)
    const required = ((tool.inputSchema as { required?: string[] } | undefined)?.required ?? []).filter((k) => a[k] === undefined || a[k] === '');
    if (
      required.length &&
      !(await confirmAction({
        title: 'Required arguments are empty',
        message: `${required.join(', ')} ${required.length > 1 ? 'are' : 'is'} required by ${tool.name}.`,
        detail: 'The server will most likely reject the call. Execute anyway to test its validation.',
        confirmLabel: 'Execute anyway',
        tone: 'warning',
      }))
    )
      return;
    setRunning(true);
    try {
      setResult(await call('mcp.call', { serverId, tool: tool.name, args: a, assertions }));
    } catch (e) {
      setResult({ error: asError(e) });
    } finally {
      setRunning(false);
    }
  };
  useSendShortcut('mcp', () => !running && void exec());
  const saveTest = async () => {
    if (!tool) return;
    const name = await promptText('Save as test', { message: 'Test name', value: `${tool.name} works`, okLabel: 'Save' });
    if (!name) return;
    const rel = await call<string>('mcp.saveTest', { serverId, tool: tool.name, args: raw ? JSON.parse(rawText || '{}') : value, assertions, name });
    useApp.getState().toast(`Saved test tests/${rel}`, 'success');
  };
  const destructive = tool?.annotations?.destructiveHint === true;
  return (
    <Split id="mcp-tools" initial={28}>
      <div className="h-full flex flex-col">
        <div className="p-2">
          <Input className="w-full h-7 min-h-7 text-sm" placeholder="Filter tools" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="flex-1 overflow-auto">
          {tools
            .filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()))
            .map((t) => (
              <button key={t.name} onClick={() => setSel(t.name)} className={cx('w-full text-left px-3 py-2 border-b border-line/60', sel === t.name ? 'bg-accent/10' : 'hover:bg-hover')}>
                <div className="flex items-center gap-1.5 text-sm font-medium mono">
                  <Wrench size={12} className="text-muted" />
                  {t.name}
                  {t.annotations?.destructiveHint === true && <Badge tone="bad">destructive</Badge>}
                </div>
                {t.description && <div className="text-xs text-muted line-clamp-2">{t.description}</div>}
              </button>
            ))}
        </div>
      </div>
      {tool ? (
        <Split id="mcp-tool-run" direction="vertical" initial={55}>
          <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
              <span className="font-semibold mono">{tool.name}</span>
              {destructive && <Badge tone="bad">destructive hint</Badge>}
              <label className="ml-auto text-xs flex items-center gap-1 text-muted">
                <input type="checkbox" checked={raw} onChange={(e) => (setRaw(e.target.checked), e.target.checked && setRawText(JSON.stringify(value, null, 2)))} /> Raw JSON
              </label>
              <Button size="sm" variant="ghost" icon={<Sparkles size={12} />} onClick={() => useApp.getState().set({ assistant: { task: 'generate-args', title: `Arguments for ${tool.name}`, context: { tool: tool.name, description: tool.description, inputSchema: tool.inputSchema } } })}>
                Generate args
              </Button>
              <Button size="sm" icon={<Save size={12} />} onClick={saveTest}>
                Save as test
              </Button>
              <Button size="sm" variant="primary" icon={<Play size={12} />} loading={running} onClick={async () => (destructive && !(await confirmAction({ title: 'Run a destructive tool', message: 'This tool is marked destructive by the server.', detail: 'It may change or delete data. Run it only if you mean to.', confirmLabel: 'Execute anyway', tone: 'warning' })) ? undefined : exec())}>
                Execute
              </Button>
            </div>
            <Tabs
              value={sub}
              onChange={setSub}
              tabs={[
                { id: 'form', label: 'Arguments' },
                { id: 'schema', label: 'Input schema' },
                { id: 'tests', label: 'Assertions', badge: assertions.length },
              ]}
            />
            <div className="flex-1 min-h-0 overflow-auto">
              {sub === 'form' &&
                (raw ? (
                  <CodeEditor value={rawText} onChange={setRawText} path={`mcp-args/${serverId}/${tool.name}.json`} jsonSchema={tool.inputSchema} />
                ) : (
                  <>
                    {tool.description && <p className="px-3 pt-3 text-sm text-muted">{tool.description}</p>}
                    <JsonSchemaForm schema={tool.inputSchema as never} value={value} onChange={(v) => setArgs({ ...args, [tool.name]: v })} />
                  </>
                ))}
              {sub === 'schema' && <JsonTree data={{ inputSchema: tool.inputSchema, ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}), ...(tool.annotations ? { annotations: tool.annotations } : {}) }} />}
              {sub === 'tests' && <AssertionEditor checks={assertions} onChange={setAssertions} groups={['Response', 'Body']} />}
            </div>
          </div>
          <div className="h-full min-h-0">{result ? 'error' in result ? <ErrorPanel error={result.error} context={{ tool: tool.name }} /> : <ToolResult r={result} name={tool.name} /> : <Empty title="Execute the tool to see its result" />}</div>
        </Split>
      ) : (
        <Empty title="This server exposes no tools" />
      )}
    </Split>
  );
}

type ToolRun = { isError: boolean; content: unknown[]; structuredContent?: unknown; durationMs: number; checks: CheckResult[]; body: unknown } | { error: NormalizedError };
type ContentItem = { type: string; text?: string; data?: string; mimeType?: string };
type ViewMode = 'pretty' | 'raw' | 'markdown';

const jsonOf = (text: string | undefined): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

function ToolResult({ r, name }: { r: Extract<ToolRun, { content: unknown[] }>; name: string }) {
  const [tab, setTab] = useState<'content' | 'structured' | 'tests'>(r.checks.some((c) => !c.passed) ? 'tests' : 'content');
  const items = r.content as ContentItem[];
  const text = items.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n\n');
  const looksMarkdown = /(^|\n)(#{1,6} |[-*] |\d+\. |```)|\[[^\]]+\]\([^)]+\)/.test(text) && jsonOf(text) === undefined;
  // display options, like the REST response: Pretty (JSON as a tree), Raw, Markdown (rendered)
  const [mode, setMode] = useSticky<ViewMode>('mcp:resultMode', 'pretty');
  const effective: ViewMode = mode === 'markdown' && !text ? 'pretty' : mode;
  const copy = () => void navigator.clipboard.writeText(text || JSON.stringify(r.content, null, 2)).then(() => useApp.getState().toast('Copied the result'));
  const save = () => downloadContent(`${name}-result.${jsonOf(text) !== undefined ? 'json' : looksMarkdown ? 'md' : 'txt'}`, text || JSON.stringify(r.content, null, 2));
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line text-sm">
        <Badge tone={r.isError ? 'bad' : 'ok'}>{r.isError ? 'isError' : 'success'}</Badge>
        <span className="text-muted">{formatMs(r.durationMs)}</span>
        {text && <span className="text-muted">{text.length.toLocaleString()} chars</span>}
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-md border border-line overflow-hidden text-xs" role="group" aria-label="Display">
            {(['pretty', 'raw', 'markdown'] as const).map((m) => (
              <button key={m} type="button" className={cx('px-2 py-0.5 capitalize', effective === m ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg', m === 'markdown' && !text && 'opacity-40 pointer-events-none')} onClick={() => (setMode(m), setTab('content'))}>
                {m}
              </button>
            ))}
          </div>
          <IconButton label="Copy result" onClick={copy}>
            <Copy size={13} />
          </IconButton>
          <IconButton label="Save result" onClick={save}>
            <Download size={13} />
          </IconButton>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'content', label: 'Content', badge: r.content.length },
          ...(r.structuredContent !== undefined ? [{ id: 'structured' as const, label: 'Structured' }] : []),
          { id: 'tests', label: 'Assertions', badge: r.checks.length },
        ]}
      />
      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        {tab === 'content' && effective === 'raw' && <RawView text={text || JSON.stringify(r.content, null, 2)} />}
        {tab === 'content' && effective === 'markdown' && <Markdown className="p-4" source={text} />}
        {tab === 'content' &&
          effective === 'pretty' &&
          items.map((c, i) => {
            let parsed: unknown;
            if (c.type === 'text' && c.text) {
              try {
                parsed = JSON.parse(c.text);
              } catch {
                parsed = undefined;
              }
            }
            // a single content block (the usual case) fills the panel
            const single = items.length === 1;
            return (
              <div key={i} className={cx('border-b border-line', single && 'flex-1 min-h-0 flex flex-col')}>
                <div className="px-3 py-1 text-xs text-muted">
                  {c.type}
                  {c.mimeType ? ` · ${c.mimeType}` : ''}
                </div>
                {c.type === 'image' && c.data ? (
                  <img alt="tool output" className="max-w-full p-3" src={`data:${c.mimeType};base64,${c.data}`} />
                ) : parsed !== undefined ? (
                  <div className={single ? 'flex-1 min-h-0' : 'h-64'}>
                    <JsonTree data={parsed} />
                  </div>
                ) : (
                  <pre className="px-3 pb-3 mono text-xs whitespace-pre-wrap">{c.text ?? JSON.stringify(c, null, 2)}</pre>
                )}
              </div>
            );
          })}
        {tab === 'structured' && <JsonTree data={r.structuredContent} />}
        {tab === 'tests' && <CheckList checks={r.checks} />}
      </div>
    </div>
  );
}

/**
 * A text field with the server's suggestions (completion/complete) for a prompt argument or a resource
 * template parameter, fetched as you type.
 */
function CompletingInput({ serverId, completionRef, name, value, context, onChange, className, placeholder }: { serverId: string; completionRef: { type: 'ref/prompt'; name: string } | { type: 'ref/resource'; uri: string }; name: string; value: string; context?: Record<string, string>; onChange(v: string): void; className?: string; placeholder?: string }) {
  const [values, setValues] = useState<string[]>([]);
  const listId = useMemo(() => `mcp-complete-${Math.random().toString(36).slice(2)}`, []);
  const key = JSON.stringify([completionRef, name, value, context]);
  useEffect(() => {
    const t = setTimeout(() => {
      void call<{ values: string[] }>('mcp.complete', { serverId, ref: completionRef, argument: { name, value }, context }).then(
        (r) => setValues(r.values),
        () => setValues([]),
      );
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, key]);
  return (
    <>
      <Input className={className} list={listId} value={value} placeholder={placeholder ?? (values.length ? `e.g. ${values.slice(0, 3).join(', ')}` : undefined)} onChange={(e) => onChange(e.target.value)} aria-label={name} />
      <datalist id={listId}>
        {values.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  );
}

/** Parameters of a URI template (RFC 6570 names, operators left out): patient://{id} → ["id"]. */
const templateParams = (t: string) => [...t.matchAll(/\{[+#./;?&]?([^}]+)\}/g)].flatMap((m) => m[1]!.split(',').map((x) => x.replace(/\*$|:\d+$/, '')));
const fillTemplate = (t: string, v: Record<string, string>) => t.replace(/\{[+#./;?&]?([^}]+)\}/g, (_, names: string) => names.split(',').map((n) => encodeURIComponent(v[n.replace(/\*$|:\d+$/, '')] ?? '')).join(','));

function ResourcesPanel({ serverId, disc }: { serverId: string; disc: Discovery }) {
  const [uri, setUri] = useSticky(`mcp:${serverId}:resource`, disc.resources[0]?.uri ?? '');
  const [template, setTemplate] = useState<string>();
  const [params, setParams] = useState<Record<string, string>>({});
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const [updatedAt, setUpdatedAt] = useState<string>();
  const canSubscribe = !!(disc.capabilities as { resources?: { subscribe?: boolean } } | undefined)?.resources?.subscribe;
  const uriRef = useRef(uri);
  uriRef.current = uri;
  useEffect(
    () =>
      on<{ serverId: string; uri: string }>('mcp.resourceUpdated', (e) => {
        if (e.serverId !== serverId || e.uri !== uriRef.current) return;
        setUpdatedAt(new Date().toLocaleTimeString());
        void read(e.uri);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverId],
  );
  const toggleSubscribe = async () => {
    const on_ = subscribed.has(uri);
    try {
      await call(on_ ? 'mcp.unsubscribe' : 'mcp.subscribe', { serverId, uri });
      const next = new Set(subscribed);
      if (on_) next.delete(uri);
      else next.add(uri);
      setSubscribed(next);
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  const [content, setContent] = useSticky<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>; durationMs: number } | { error: NormalizedError } | undefined>(`mcp:${serverId}:resourceContent`, undefined);
  const [loading, setLoading] = useState(false);
  const read = async (u = uri) => {
    setLoading(true);
    try {
      setContent(await call('mcp.read', { serverId, uri: u }));
    } catch (e) {
      setContent({ error: asError(e) });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Split id="mcp-res" initial={30}>
      <div className="h-full overflow-auto">
        <SectionTitle>Resources</SectionTitle>
        {disc.resources.map((r) => (
          <button key={r.uri} className={cx('w-full text-left px-3 py-1.5 hover:bg-hover', uri === r.uri && 'bg-accent/10')} onClick={() => (setTemplate(undefined), setUri(r.uri), void read(r.uri))}>
            <div className="text-sm flex items-center gap-1.5">
              <FileText size={12} className="text-muted" /> {r.name}
            </div>
            <div className="text-xs text-muted mono truncate">{r.uri}</div>
          </button>
        ))}
        <SectionTitle>Templates</SectionTitle>
        {disc.resourceTemplates.map((r) => (
          <button key={r.uriTemplate} className={cx('w-full text-left px-3 py-1.5 hover:bg-hover', template === r.uriTemplate && 'bg-accent/10')} onClick={() => (setTemplate(r.uriTemplate), setParams({}), setUri(fillTemplate(r.uriTemplate, {})))}>
            <div className="text-sm flex items-center gap-1.5">
              <Braces size={12} className="text-muted" /> {r.name}
            </div>
            <div className="text-xs text-muted mono truncate">{r.uriTemplate}</div>
          </button>
        ))}
      </div>
      <div className="h-full flex flex-col">
        {template && templateParams(template).length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pt-2 items-center">
            <span className="text-xs text-muted mono">{template}</span>
            {templateParams(template).map((p) => (
              <CompletingInput
                key={p}
                className="w-40 h-7 min-h-7 mono text-xs"
                serverId={serverId}
                completionRef={{ type: 'ref/resource', uri: template }}
                name={p}
                placeholder={p}
                value={params[p] ?? ''}
                context={params}
                onChange={(v) => {
                  const next = { ...params, [p]: v };
                  setParams(next);
                  setUri(fillTemplate(template, next));
                }}
              />
            ))}
          </div>
        )}
        <div className="flex gap-2 p-2 border-b border-line">
          <Input className="flex-1 mono" value={uri} onChange={(e) => (setUri(e.target.value), setTemplate(undefined))} placeholder="resource URI (fill template parameters, e.g. customer://123)" />
          {canSubscribe && (
            <Button
              variant={subscribed.has(uri) ? 'soft' : 'default'}
              title={subscribed.has(uri) ? 'Stop getting updates for this resource' : 'Get told (and re-read) when the server says this resource changed'}
              disabled={!uri}
              onClick={() => void toggleSubscribe()}
            >
              {subscribed.has(uri) ? 'Subscribed' : 'Subscribe'}
            </Button>
          )}
          <Button variant="primary" loading={loading} onClick={() => read()}>
            Read
          </Button>
        </div>
        {subscribed.has(uri) && updatedAt && <div className="px-3 py-1 text-xs text-accent border-b border-line">Updated by the server at {updatedAt}; read again automatically.</div>}
        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
          {content &&
            ('error' in content ? (
              <ErrorPanel error={content.error} />
            ) : (
              content.contents.map((c, i) => {
                let parsed: unknown;
                try {
                  parsed = c.text ? JSON.parse(c.text) : undefined;
                } catch {
                  parsed = undefined;
                }
                // one content item (the usual case) fills the panel; several get a fixed height each
                const single = content.contents.length === 1;
                return (
                  <div key={i} className={cx('border-b border-line', single && 'flex-1 min-h-0 flex flex-col')}>
                    <div className="px-3 py-1 text-xs text-muted">
                      {[c.uri, c.mimeType, formatMs(content.durationMs)].filter(Boolean).join(' · ')}
                    </div>
                    {parsed !== undefined ? (
                      <div className={single ? 'flex-1 min-h-0' : 'h-80'}>
                        <JsonTree data={parsed} />
                      </div>
                    ) : (
                      <pre className="px-3 pb-3 mono text-xs whitespace-pre-wrap">{c.text ?? `<binary ${c.blob?.length ?? 0} base64 chars>`}</pre>
                    )}
                  </div>
                );
              })
            ))}
        </div>
      </div>
    </Split>
  );
}

function PromptsPanel({ serverId, prompts }: { serverId: string; prompts: Discovery['prompts'] }) {
  const [sel, setSel] = useSticky(`mcp:${serverId}:prompt`, prompts[0]?.name);
  const [args, setArgs] = useSticky<Record<string, string>>(`mcp:${serverId}:promptArgs`, {});
  const [out, setOut] = useSticky<{ messages: unknown[]; description?: string } | { error: NormalizedError } | undefined>(`mcp:${serverId}:promptOut`, undefined);
  const p = prompts.find((x) => x.name === sel);
  return (
    <Split id="mcp-prompts" initial={30}>
      <div className="h-full overflow-auto">
        {prompts.map((x) => (
          <button key={x.name} className={cx('w-full text-left px-3 py-2 border-b border-line/60', sel === x.name ? 'bg-accent/10' : 'hover:bg-hover')} onClick={() => (setSel(x.name), setOut(undefined))}>
            <div className="text-sm font-medium flex items-center gap-1.5">
              <MessageSquare size={12} className="text-muted" /> {x.name}
            </div>
            {x.description && <div className="text-xs text-muted">{x.description}</div>}
          </button>
        ))}
        {!prompts.length && <Empty title="No prompts" />}
      </div>
      <div className="h-full flex flex-col">
        {p && (
          <div className="p-3 border-b border-line flex flex-col gap-2">
            {(p.arguments ?? []).map((a) => (
              <Field key={a.name} label={`${a.name}${a.required ? ' *' : ''}`} hint={a.description}>
                <CompletingInput serverId={serverId} completionRef={{ type: 'ref/prompt', name: p.name }} name={a.name} value={args[a.name] ?? ''} context={args} onChange={(v) => setArgs({ ...args, [a.name]: v })} />
              </Field>
            ))}
            <div>
              <Button variant="primary" onClick={() => call('mcp.prompt', { serverId, name: p.name, args }).then(setOut, (e) => setOut({ error: asError(e) }))}>
                Get prompt
              </Button>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          {!out ? (
            <Empty icon={<MessageSquare size={24} />} title="Get the prompt to see its messages">
              The server fills its template with the arguments above and returns the messages an AI client would send to the model.
            </Empty>
          ) : 'error' in out ? (
            <ErrorPanel error={out.error} />
          ) : (
            <PromptMessages out={out} />
          )}
        </div>
      </div>
    </Split>
  );
}

/** Timeline of every JSON-RPC message with direction, method, latency and payloads (spec §12.4). */
function McpTrace({ events, error }: { events: McpEvent[]; error?: NormalizedError }) {
  const [sel, setSel] = useState<McpEvent>();
  const [filter, setFilter] = useState('');
  const endRef = useRef(0);
  const shown = useMemo(() => (filter ? events.filter((e) => e.method.includes(filter) || e.kind.includes(filter)) : events), [events, filter]);
  const t0 = events[0]?.timestamp ?? 0;
  endRef.current = shown.length - 1;
  return (
    <Split id="mcp-trace" initial={55}>
      <div className="h-full flex flex-col">
        {error && <ErrorPanel error={error} />}
        <div className="flex items-center gap-2 px-2 h-9 border-b border-line text-xs">
          <Input className="h-6 min-h-6 w-48 text-xs" placeholder="Filter method (e.g. tools/call)" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="text-muted">{plural(shown.length, 'event')}</span>
        </div>
        <div className="grid grid-cols-[70px_22px_1fr_80px_70px] text-[0.72rem] text-muted px-2 py-1 border-b border-line">
          <span>+time</span>
          <span />
          <span>method</span>
          <span>kind</span>
          <span className="text-right">latency</span>
        </div>
        <VirtualList
          className="flex-1"
          items={shown}
          rowHeight={26}
          render={(e) => (
            <button onClick={() => setSel(e)} className={cx('w-full h-full grid grid-cols-[70px_22px_1fr_80px_70px] items-center px-2 text-xs border-b border-line/50 text-left hover:bg-hover', sel?.id === e.id && 'bg-accent/10')}>
              <span className="tabular-nums text-muted">{((e.timestamp - t0) / 1000).toFixed(3)}s</span>
              {e.direction === 'outgoing' ? <ArrowUpRight size={12} className="text-accent" /> : e.direction === 'incoming' ? <ArrowDownLeft size={12} className="text-ok" /> : <CircleDot size={10} className="text-muted" />}
              <span className={cx('mono truncate', e.kind === 'error' && 'text-bad')}>{e.method}</span>
              <span className={cx(e.kind === 'error' ? 'text-bad' : 'text-muted')}>{e.kind}</span>
              <span className="text-right tabular-nums">{e.durationMs !== undefined ? formatMs(e.durationMs) : ''}</span>
            </button>
          )}
        />
      </div>
      <div className="h-full">
        {sel ? (
          <JsonTree
            data={JSON.parse(JSON.stringify({ timestamp: new Date(sel.timestamp).toISOString(), direction: sel.direction, method: sel.method, kind: sel.kind, rpcId: sel.rpcId, durationMs: sel.durationMs, request: sel.request, response: sel.response, error: sel.error, metadata: sel.metadata }))}
          />
        ) : (
          <Empty title="Select an event" />
        )}
      </div>
    </Split>
  );
}

/** A prompt's messages as a conversation (role and text), with the raw JSON one click away. */
function PromptMessages({ out }: { out: { messages: unknown[]; description?: string } }) {
  const [json, setJson] = useState(false);
  const messages = out.messages as Array<{ role: string; content: { type: string; text?: string; resource?: { uri: string; text?: string } } }>;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line text-sm">
        <span className="text-muted">{plural(messages.length, 'message')}</span>
        {out.description && <span className="text-muted truncate">· {out.description}</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setJson(!json)}>
          {json ? 'Messages' : 'JSON'}
        </Button>
      </div>
      {json ? (
        <div className="h-96">
          <JsonTree data={out} />
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-2">
          {messages.map((m, i) => (
            <div key={i} className={cx('rounded-lg border border-line p-3', m.role === 'assistant' ? 'bg-accent-soft/40' : 'bg-panel')}>
              <Badge tone={m.role === 'assistant' ? 'accent' : 'default'}>{m.role}</Badge>
              <pre className="mt-2 text-sm whitespace-pre-wrap font-sans">{m.content?.text ?? m.content?.resource?.text ?? JSON.stringify(m.content, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
