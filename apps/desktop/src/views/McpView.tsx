import { ArrowDownLeft, ArrowUpRight, Braces, CircleDot, FileText, MessageSquare, Pencil, Play, Plug, Plus, Save, Sparkles, Trash2, Unplug, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asError, call, on, type NormalizedError } from '../api';
import { promptText, useApp } from '../store';
import { useIntent, useSendShortcut } from '../hooks';
import type { CheckConfig, CheckResult, McpServerConfig } from '../types';
import { formatMs, uid } from '../lib/format';
import { AssertionEditor } from '../components/AssertionEditor';
import { CodeEditor } from '../components/CodeEditor';
import { JsonSchemaForm } from '../components/JsonSchemaForm';
import { JsonTree } from '../components/JsonView';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { CheckList, ErrorPanel } from '../components/Results';
import { Badge, Button, cx, Empty, Field, IconButton, Input, Modal, SectionTitle, Select, Split, Tabs, VirtualList } from '../components/ui';

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

type Tab = 'tools' | 'resources' | 'prompts' | 'trace' | 'info';

/** Merge event lists by id — the connect snapshot and the live stream overlap. */
function mergeEvents(a: McpEvent[], b: McpEvent[]): McpEvent[] {
  const seen = new Set(a.map((e) => e.id));
  const out = [...a];
  for (const e of b) if (!seen.has(e.id)) (seen.add(e.id), out.push(e));
  return out.sort((x, y) => x.timestamp - y.timestamp).slice(-5000);
}

export function McpView() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [discovery, setDiscovery] = useState<Record<string, Discovery>>({});
  const [events, setEvents] = useState<Record<string, McpEvent[]>>({});
  const [connecting, setConnecting] = useState<string>();
  const [connError, setConnError] = useState<NormalizedError>();
  const [tab, setTab] = useState<Tab>('tools');
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
  useIntent('mcp', (p) => p?.serverId && setSelected(p.serverId));

  const server = servers.find((s) => s.id === selected);
  const disc = selected ? discovery[selected] : undefined;

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
  const saveServers = async (list: McpServerConfig[]) => {
    await call('mcp.saveServers', { servers: list.map(({ connected: _c, ...s }) => s) });
    await load();
  };

  return (
    <>
    <Split id="mcp-servers" sidebar initial={20} min={14}>
      <div className="h-full flex flex-col bg-panel/50">
        <SectionTitle
          right={
            <IconButton label="Add MCP server" onClick={() => setEditing({ id: uid('mcp-'), name: 'New server', transport: 'stdio', command: 'node', args: [] })}>
              <Plus size={14} />
            </IconButton>
          }
        >
          MCP servers
        </SectionTitle>
        <div className="flex-1 overflow-auto">
          {servers.map((s) => (
            <div key={s.id} className={cx('group px-3 py-2 cursor-pointer border-l-2', selected === s.id ? 'bg-accent/10 border-accent' : 'border-transparent hover:bg-hover')} onClick={() => setSelected(s.id)}>
              <div className="flex items-center gap-2 text-sm">
                <CircleDot size={10} className={s.connected ? 'text-ok' : 'text-muted'} />
                <span className="font-medium truncate">{s.name}</span>
                <IconButton label="Edit server" className="ml-auto h-5 w-5 opacity-0 group-hover:opacity-100" onClick={(e) => (e.stopPropagation(), setEditing(s))}>
                  <Pencil size={12} />
                </IconButton>
              </div>
              <div className="text-xs text-muted truncate mono pl-4">{s.transport === 'stdio' ? `${s.command} ${(s.args ?? []).join(' ')}` : s.url}</div>
            </div>
          ))}
          {!servers.length && (
            <Empty title="No MCP servers">
              Add a server using stdio (a local command), Streamable HTTP or legacy SSE.
              <Button className="mt-2" onClick={() => setEditing({ id: uid('mcp-'), name: 'New server', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] })}>
                Add server
              </Button>
            </Empty>
          )}
        </div>
      </div>
      <div className="h-full flex flex-col min-w-0">
        {server ? (
          <>
            <div className="flex items-center gap-2 px-3 h-11 border-b border-line shrink-0">
              <Plug size={16} className="text-muted" />
              <span className="font-semibold">{server.name}</span>
              <Badge>{server.transport}</Badge>
              {disc?.serverInfo && (
                <span className="text-xs text-muted">
                  {disc.serverInfo.name} v{disc.serverInfo.version}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                {server.connected ? (
                  <>
                    <Button size="sm" onClick={() => call<number>('mcp.ping', { serverId: server.id }).then((ms) => useApp.getState().toast(`Ping ${ms} ms`))}>
                      Ping
                    </Button>
                    <Button size="sm" icon={<Unplug size={12} />} onClick={() => disconnect(server.id)}>
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="primary" icon={<Plug size={12} />} loading={connecting === server.id} onClick={() => connect(server.id)}>
                    Connect
                  </Button>
                )}
              </div>
            </div>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'tools', label: 'Tools', badge: disc?.tools.length },
                { id: 'resources', label: 'Resources', badge: disc ? disc.resources.length + disc.resourceTemplates.length : undefined },
                { id: 'prompts', label: 'Prompts', badge: disc?.prompts.length },
                { id: 'trace', label: 'Protocol trace', badge: events[server.id]?.length },
                { id: 'info', label: 'Server info' },
              ]}
            />
            <div className="flex-1 min-h-0">
              {connError && tab !== 'trace' && <ErrorPanel error={connError} context={{ server }} />}
              {tab === 'trace' ? (
                <McpTrace events={events[server.id] ?? []} error={connError} />
              ) : !disc ? (
                !connError && (
                  <Empty icon={<Plug size={26} />} title="Not connected">
                    Connect to discover tools, resources and prompts. Every JSON-RPC message is captured in the protocol trace.
                  </Empty>
                )
              ) : tab === 'tools' ? (
                <ToolsPanel serverId={server.id} tools={disc.tools} />
              ) : tab === 'resources' ? (
                <ResourcesPanel serverId={server.id} disc={disc} />
              ) : tab === 'prompts' ? (
                <PromptsPanel serverId={server.id} prompts={disc.prompts} />
              ) : (
                <div className="h-full">
                  <JsonTree data={{ serverInfo: disc.serverInfo, capabilities: disc.capabilities, instructions: disc.instructions }} />
                </div>
              )}
            </div>
          </>
        ) : (
          <Empty icon={<Plug size={28} />} title="Select or add an MCP server" />
        )}
      </div>
    </Split>
      {editing && (
        <ServerModal
          server={editing}
          onClose={() => setEditing(null)}
          onDelete={
            servers.some((s) => s.id === editing.id)
              ? () => {
                  if (!confirm(`Remove "${editing.name}"?`)) return;
                  void saveServers(servers.filter((s) => s.id !== editing.id));
                  setEditing(null);
                }
              : undefined
          }
          onSave={(s) => {
            const exists = servers.some((x) => x.id === s.id);
            void saveServers(exists ? servers.map((x) => (x.id === s.id ? s : x)) : [...servers, s]);
            setSelected(s.id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ServerModal({ server, onClose, onSave, onDelete }: { server: McpServerConfig; onClose(): void; onSave(s: McpServerConfig): void; onDelete?(): void }) {
  const [s, setS] = useState<McpServerConfig>(server);
  const [json, setJson] = useState(false);
  const [jsonText, setJsonText] = useState(JSON.stringify(server, null, 2));
  const envRows = s.transport === 'stdio' ? Object.entries(s.env ?? {}).map(([key, value]) => ({ key, value })) : [];
  return (
    <Modal
      title="MCP server"
      onClose={onClose}
      width={620}
      footer={
        <>
          {onDelete && (
            <Button variant="danger" className="mr-auto" icon={<Trash2 size={13} />} onClick={onDelete}>
              Remove
            </Button>
          )}
          <Button onClick={() => setJson(!json)}>{json ? 'Form' : 'Edit JSON'}</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!json) return onSave(s);
              try {
                onSave(JSON.parse(jsonText));
              } catch (e) {
                useApp.getState().toast(`Invalid JSON: ${(e as Error).message}`, 'error');
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {json ? (
        <div className="h-72">
          <CodeEditor value={jsonText} onChange={setJsonText} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
            </Field>
            <Field label="Transport">
              <Select
                value={s.transport}
                onChange={(e) => {
                  const t = e.target.value as McpServerConfig['transport'];
                  setS(t === 'stdio' ? { id: s.id, name: s.name, transport: 'stdio', command: 'node', args: [] } : { id: s.id, name: s.name, transport: t, url: 'http://127.0.0.1:3000/mcp', headers: [] });
                }}
              >
                <option value="stdio">stdio (local process)</option>
                <option value="streamable-http">Streamable HTTP</option>
                <option value="sse">SSE (legacy)</option>
              </Select>
            </Field>
          </div>
          {s.transport === 'stdio' ? (
            <>
              <Field label="Command" hint="On Windows use npx.cmd or the full path to node.exe. Variables like {{workspaceDir}} are resolved.">
                <Input className="mono" value={s.command} onChange={(e) => setS({ ...s, command: e.target.value })} />
              </Field>
              <Field label="Arguments (one per line)">
                <textarea className="field mono min-h-16" value={(s.args ?? []).join('\n')} onChange={(e) => setS({ ...s, args: e.target.value.split('\n').filter((x) => x !== '') })} />
              </Field>
              <Field label="Working directory">
                <Input className="mono" value={s.cwd ?? ''} onChange={(e) => setS({ ...s, cwd: e.target.value || undefined })} />
              </Field>
              <Field label="Environment variables" hint="Use {{variables}} to reference secrets instead of pasting them here.">
                <KeyValueEditor rows={envRows} onChange={(rows) => setS({ ...s, env: Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.value])) })} />
              </Field>
            </>
          ) : (
            <>
              <Field label="URL">
                <Input className="mono" value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })} />
              </Field>
              <Field label="Headers">
                <KeyValueEditor rows={s.headers ?? []} onChange={(headers) => setS({ ...s, headers })} />
              </Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function ToolsPanel({ serverId, tools }: { serverId: string; tools: Tool[] }) {
  const [sel, setSel] = useState(tools[0]?.name);
  const [filter, setFilter] = useState('');
  const [args, setArgs] = useState<Record<string, Record<string, unknown>>>({});
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState('{}');
  const [assertions, setAssertions] = useState<CheckConfig[]>([{ type: 'status', expected: 'success' }]);
  const [result, setResult] = useState<{ isError: boolean; content: unknown[]; structuredContent?: unknown; durationMs: number; checks: CheckResult[]; body: unknown } | { error: NormalizedError }>();
  const [running, setRunning] = useState(false);
  const [sub, setSub] = useState<'form' | 'schema' | 'tests'>('form');
  const tool = tools.find((t) => t.name === sel);
  const value = (sel && args[sel]) || {};
  useEffect(() => setRawText(JSON.stringify(value, null, 2)), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
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
              <button key={t.name} onClick={() => (setSel(t.name), setResult(undefined))} className={cx('w-full text-left px-3 py-2 border-b border-line/60', sel === t.name ? 'bg-accent/10' : 'hover:bg-hover')}>
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
              <Button size="sm" variant="primary" icon={<Play size={12} />} loading={running} onClick={() => (destructive && !confirm('This tool is marked destructive. Execute anyway?') ? undefined : exec())}>
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
                  <CodeEditor value={rawText} onChange={setRawText} />
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
          <div className="h-full min-h-0">{result ? 'error' in result ? <ErrorPanel error={result.error} context={{ tool: tool.name }} /> : <ToolResult r={result} /> : <Empty title="Execute the tool to see its result" />}</div>
        </Split>
      ) : (
        <Empty title="This server exposes no tools" />
      )}
    </Split>
  );
}

function ToolResult({ r }: { r: { isError: boolean; content: unknown[]; structuredContent?: unknown; durationMs: number; checks: CheckResult[] } }) {
  const [tab, setTab] = useState<'content' | 'structured' | 'tests'>(r.checks.some((c) => !c.passed) ? 'tests' : 'content');
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-line text-sm">
        <Badge tone={r.isError ? 'bad' : 'ok'}>{r.isError ? 'isError' : 'success'}</Badge>
        <span className="text-muted">{formatMs(r.durationMs)}</span>
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
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'content' &&
          (r.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>).map((c, i) => {
            let parsed: unknown;
            if (c.type === 'text' && c.text) {
              try {
                parsed = JSON.parse(c.text);
              } catch {
                parsed = undefined;
              }
            }
            return (
              <div key={i} className="border-b border-line">
                <div className="px-3 py-1 text-xs text-muted">
                  {c.type}
                  {c.mimeType ? ` · ${c.mimeType}` : ''}
                </div>
                {c.type === 'image' && c.data ? (
                  <img alt="tool output" className="max-w-full p-3" src={`data:${c.mimeType};base64,${c.data}`} />
                ) : parsed !== undefined ? (
                  <div className="h-64">
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

function ResourcesPanel({ serverId, disc }: { serverId: string; disc: Discovery }) {
  const [uri, setUri] = useState(disc.resources[0]?.uri ?? '');
  const [content, setContent] = useState<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>; durationMs: number } | { error: NormalizedError }>();
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
          <button key={r.uri} className={cx('w-full text-left px-3 py-1.5 hover:bg-hover', uri === r.uri && 'bg-accent/10')} onClick={() => (setUri(r.uri), void read(r.uri))}>
            <div className="text-sm flex items-center gap-1.5">
              <FileText size={12} className="text-muted" /> {r.name}
            </div>
            <div className="text-xs text-muted mono truncate">{r.uri}</div>
          </button>
        ))}
        <SectionTitle>Templates</SectionTitle>
        {disc.resourceTemplates.map((r) => (
          <button key={r.uriTemplate} className="w-full text-left px-3 py-1.5 hover:bg-hover" onClick={() => setUri(r.uriTemplate)}>
            <div className="text-sm flex items-center gap-1.5">
              <Braces size={12} className="text-muted" /> {r.name}
            </div>
            <div className="text-xs text-muted mono truncate">{r.uriTemplate}</div>
          </button>
        ))}
      </div>
      <div className="h-full flex flex-col">
        <div className="flex gap-2 p-2 border-b border-line">
          <Input className="flex-1 mono" value={uri} onChange={(e) => setUri(e.target.value)} placeholder="resource URI (fill template parameters, e.g. customer://123)" />
          <Button variant="primary" loading={loading} onClick={() => read()}>
            Read
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
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
                return (
                  <div key={i} className="border-b border-line">
                    <div className="px-3 py-1 text-xs text-muted">
                      {c.uri} · {c.mimeType} · {formatMs(content.durationMs)}
                    </div>
                    {parsed !== undefined ? (
                      <div className="h-80">
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
  const [sel, setSel] = useState(prompts[0]?.name);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [out, setOut] = useState<{ messages: unknown[]; description?: string } | { error: NormalizedError }>();
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
                <Input value={args[a.name] ?? ''} onChange={(e) => setArgs({ ...args, [a.name]: e.target.value })} />
              </Field>
            ))}
            <div>
              <Button variant="primary" onClick={() => call('mcp.prompt', { serverId, name: p.name, args }).then(setOut, (e) => setOut({ error: asError(e) }))}>
                Get prompt
              </Button>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0">{out && ('error' in out ? <ErrorPanel error={out.error} /> : <JsonTree data={out} />)}</div>
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
          <span className="text-muted">{shown.length} events</span>
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
