import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { call } from '../api';
import { useApp } from '../store';
import type { AppSettings, PriceEntry, ProviderConfig } from '../types';
import { checkForUpdates } from '../updates';
import { Badge, Button, Field, IconButton, Input, Select, Tabs, Toggle } from '../components/ui';

type Tab = 'appearance' | 'requests' | 'proxy' | 'privacy' | 'pricing' | 'load' | 'assistant' | 'about';

export function SettingsView() {
  const settings = useApp((s) => s.settings);
  const info = useApp((s) => s.info);
  const ws = useApp((s) => s.workspace);
  const [s, setS] = useState<AppSettings | undefined>(settings);
  const [tab, setTab] = useState<Tab>('appearance');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  useEffect(() => setS(settings), [settings]);
  useEffect(() => {
    void call<ProviderConfig[]>('ai.providers').then(setProviders);
  }, []);
  if (!s) return null;
  const set = (p: Partial<AppSettings>) => setS({ ...s, ...p });
  const save = () => useApp.getState().saveSettings(s).then(() => useApp.getState().toast('Settings saved', 'success'));
  const setPrice = (i: number, p: Partial<PriceEntry>) => set({ pricing: s.pricing.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <div className="h-full flex flex-col">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'appearance', label: 'Appearance' },
          { id: 'requests', label: 'Requests' },
          { id: 'proxy', label: 'Proxy' },
          { id: 'privacy', label: 'Privacy & security' },
          { id: 'pricing', label: 'Model pricing' },
          { id: 'load', label: 'Load testing' },
          { id: 'assistant', label: 'AI assistant' },
          { id: 'about', label: 'About' },
        ]}
        right={
          <Button size="sm" variant="primary" icon={<Save size={12} />} onClick={save}>
            Save settings
          </Button>
        }
      />
      <div className="flex-1 overflow-auto p-5">
        <div className="max-w-3xl flex flex-col gap-4">
          {tab === 'appearance' && (
            <>
              <Field label="Theme">
                <Select value={s.theme} onChange={(e) => set({ theme: e.target.value as AppSettings['theme'] })}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Field>
              <Field label={`Font size (${s.fontSize}px)`}>
                <input type="range" min={11} max={20} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
              </Field>
              <Toggle checked={s.reducedMotion} onChange={(reducedMotion) => set({ reducedMotion })} label="Reduce motion" />
              <p className="text-xs text-muted">
                Keyboard: Ctrl/Cmd+K commands · Ctrl/Cmd+Shift+F search · Ctrl/Cmd+Enter send/run · Ctrl/Cmd+S save · Ctrl/Cmd+Alt+1…9 switch views · Ctrl/Cmd+, settings.
              </p>
            </>
          )}
          {tab === 'requests' && (
            <>
              <Field label="Default timeout (ms)">
                <Input type="number" value={s.defaultTimeoutMs} onChange={(e) => set({ defaultTimeoutMs: Number(e.target.value) })} />
              </Field>
              <Field label="Maximum response preview (MB)" hint="Larger bodies are streamed to disk and truncated in the viewer; use “Save response” for the full payload.">
                <Input type="number" step="0.5" value={s.maxPreviewBytes / 1024 / 1024} onChange={(e) => set({ maxPreviewBytes: Math.max(0.1, Number(e.target.value)) * 1024 * 1024 })} />
              </Field>
              <Field label="Log level" hint="Secrets are redacted at every level, so DEBUG/TRACE are safe to enable.">
                <Select value={s.logLevel} onChange={(e) => set({ logLevel: e.target.value as AppSettings['logLevel'] })}>
                  {['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          {tab === 'proxy' && <ProxySettings value={s.proxy ?? { mode: 'env' }} onChange={(proxy) => set({ proxy })} />}
          {tab === 'privacy' && (
            <>
              <Field label="Always-redacted field names" hint="Matched case-insensitively (and as suffixes, e.g. accessToken) in logs, traces, history, reports and exports.">
                <textarea className="field mono min-h-28" value={s.redactFields.join('\n')} onChange={(e) => set({ redactFields: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
              </Field>
              <div className="rounded-md border border-line p-3 text-sm flex flex-col gap-1">
                <div className="font-medium">Telemetry</div>
                <p className="text-muted">
                  Telemetry is <b>disabled</b> and not implemented in this build. TestPion never transmits request bodies, prompts, responses or credentials anywhere except to the endpoints and providers you
                  explicitly call.
                </p>
              </div>
              <div className="rounded-md border border-line p-3 text-sm flex flex-col gap-1">
                <div className="font-medium">Secret storage</div>
                <p className="text-muted">
                  Secrets are stored using <b>{info?.secretBackend}</b>. Workspace files only contain references, so workspaces are safe to commit to git.
                </p>
              </div>
              <div className="rounded-md border border-line p-3 text-sm flex flex-col gap-1">
                <div className="font-medium">Script sandbox</div>
                <p className="text-muted">Pre-request and test scripts run in an isolated QuickJS (WebAssembly) interpreter with time and memory limits and no filesystem, network or process access.</p>
              </div>
            </>
          )}
          {tab === 'pricing' && (
            <>
              <p className="text-sm text-muted">
                Estimated cost = input tokens × input price + output tokens × output price. Prices change — enter the current prices from your provider and bump the version when they change. Reports record which price
                version was used. No prices are built in.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1">Provider (kind/id or *)</th>
                    <th>Model (glob)</th>
                    <th>Input $/1M</th>
                    <th>Output $/1M</th>
                    <th>Version</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.pricing.map((p, i) => (
                    <tr key={i}>
                      <td className="pr-1 py-0.5">
                        <Input className="w-full" value={p.provider} onChange={(e) => setPrice(i, { provider: e.target.value })} />
                      </td>
                      <td className="pr-1">
                        <Input className="w-full mono" value={p.model} onChange={(e) => setPrice(i, { model: e.target.value })} />
                      </td>
                      <td className="pr-1">
                        <Input className="w-24" type="number" step="0.01" value={p.inputPerMillion} onChange={(e) => setPrice(i, { inputPerMillion: Number(e.target.value) })} />
                      </td>
                      <td className="pr-1">
                        <Input className="w-24" type="number" step="0.01" value={p.outputPerMillion} onChange={(e) => setPrice(i, { outputPerMillion: Number(e.target.value) })} />
                      </td>
                      <td className="pr-1">
                        <Input className="w-28" value={p.version} onChange={(e) => setPrice(i, { version: e.target.value })} />
                      </td>
                      <td>
                        <IconButton label="Remove" onClick={() => set({ pricing: s.pricing.filter((_, j) => j !== i) })}>
                          <Trash2 size={13} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <Button size="sm" icon={<Plus size={12} />} onClick={() => set({ pricing: [...s.pricing, { provider: '*', model: '*', inputPerMillion: 0, outputPerMillion: 0, version: new Date().toISOString().slice(0, 10) }] })}>
                  Add price
                </Button>
              </div>
            </>
          )}
          {tab === 'load' && (
            <>
              <Toggle checked={s.loadTesting.allowRemoteHosts} onChange={(allowRemoteHosts) => set({ loadTesting: { ...s.loadTesting, allowRemoteHosts } })} label="Allow load tests against remote (non-local) hosts by default" />
              <Field label="Maximum virtual users">
                <Input type="number" value={s.loadTesting.maxVirtualUsers} onChange={(e) => set({ loadTesting: { ...s.loadTesting, maxVirtualUsers: Number(e.target.value) } })} />
              </Field>
              <p className="text-xs text-muted">Environments marked as production always require an explicit per-run opt-in.</p>
            </>
          )}
          {tab === 'assistant' && (
            <>
              <p className="text-sm text-muted">The assistant helps generate requests, queries, MCP arguments, assertions and tests, and explains errors. Its output is always labelled as an AI suggestion and is never treated as a test result.</p>
              <Field label="Provider">
                <Select value={s.assistantProvider ?? ''} onChange={(e) => set({ assistantProvider: e.target.value || undefined, assistantModel: providers.find((p) => p.id === e.target.value)?.defaultModel })}>
                  <option value="">Disabled</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Model">
                <Input className="mono" value={s.assistantModel ?? ''} onChange={(e) => set({ assistantModel: e.target.value || undefined })} />
              </Field>
            </>
          )}
          {tab === 'about' && (
            <div className="text-sm flex flex-col gap-2">
              <div className="text-lg font-semibold">TestPion {info?.appVersion}</div>
              <div className="flex items-center gap-3 flex-wrap">
                <Toggle checked={s.checkForUpdates !== false} onChange={(checkForUpdates) => set({ checkForUpdates })} label="Check for updates when the app starts" />
                <Button size="sm" onClick={() => void checkForUpdates({ manual: true })}>
                  Check now
                </Button>
              </div>
              <p className="text-xs text-muted">
                {info?.canUpdateInPlace
                  ? 'Updates are downloaded from GitHub, verified and installed in place; the app restarts.'
                  : 'New versions are announced at startup and link to the download page (in-place updates need the Windows installer or the Linux AppImage).'}{' '}
                Remember to save settings after changing the toggle.
              </p>
              <div>
                Engine <Badge>{info?.version}</Badge> {info?.electron && <Badge>Electron {info.electron}</Badge>} {info?.node && <Badge>Node {info.node}</Badge>}
              </div>
              <div>Workspace: <span className="mono">{ws?.path}</span></div>
              <div>Metadata store: {info?.metaBackend}</div>
              <div>Secret storage: {info?.secretBackend}</div>
              {!!ws?.migrations.length && <div>Migrations applied on open: {ws.migrations.join(', ')}</div>}
              <div className="text-muted">Available check types: {info?.checkTypes.join(', ')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProxyInfo {
  passwordSet: boolean;
  env: { HTTP_PROXY?: string; HTTPS_PROXY?: string; NO_PROXY?: string };
}

/** Outbound proxy: the environment variables (default), a custom proxy, or none. The password goes to the secret store. */
function ProxySettings({ value, onChange }: { value: NonNullable<AppSettings['proxy']>; onChange(v: NonNullable<AppSettings['proxy']>): void }) {
  const [info, setInfo] = useState<ProxyInfo>();
  const [password, setPassword] = useState('');
  const load = () => void call<ProxyInfo>('settings.proxyInfo').then(setInfo);
  useEffect(load, []);
  const savePassword = async (pw: string) => {
    await call('settings.setProxyPassword', { password: pw });
    setPassword('');
    load();
    useApp.getState().toast(pw ? 'Proxy password saved in the secret store' : 'Proxy password removed', 'success');
  };
  const env = info?.env ?? {};
  const envSet = !!(env.HTTP_PROXY || env.HTTPS_PROXY);
  const option = (mode: typeof value.mode, title: string, text: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="radio" className="mt-1" checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} />
      <span>
        <span className="font-medium">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
    </label>
  );
  return (
    <>
      <div className="flex flex-col gap-3">
        {option('env', 'Use the environment variables', envSet ? `HTTP_PROXY / HTTPS_PROXY are set on this computer: ${env.HTTPS_PROXY ?? env.HTTP_PROXY}${env.NO_PROXY ? `, except ${env.NO_PROXY}` : ''}.` : 'HTTP_PROXY, HTTPS_PROXY and NO_PROXY, like curl. None are set on this computer, so requests go direct.')}
        {option('custom', 'Use this proxy', 'For requests, OAuth token calls, AI providers, MCP over HTTP, WebSocket and datasets.')}
        {option('off', "Don't use a proxy", 'Connect directly, even when the environment variables are set.')}
      </div>
      {value.mode === 'custom' && (
        <div className="flex flex-col gap-3 pl-6">
          <Field label="Proxy URL">
            <Input className="mono" placeholder="http://proxy.example.com:8080" value={value.url ?? ''} onChange={(e) => onChange({ ...value, url: e.target.value })} />
          </Field>
          <Field label="Bypass the proxy for" hint="Comma separated, like NO_PROXY: host names (subdomains included), .domain suffixes, host:port, IP addresses, or * for everything.">
            <Input className="mono" placeholder="localhost, 127.0.0.1, .internal.example.com" value={value.bypass ?? ''} onChange={(e) => onChange({ ...value, bypass: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="User name (optional)">
              <Input value={value.username ?? ''} autoComplete="off" onChange={(e) => onChange({ ...value, username: e.target.value || undefined })} />
            </Field>
            <Field label="Password" hint={info?.passwordSet ? 'A password is saved in the secret store.' : 'Saved in the OS secret store, never in settings.'}>
              <div className="flex gap-2">
                <Input type="password" autoComplete="new-password" value={password} placeholder={info?.passwordSet ? '••••••••' : ''} onChange={(e) => setPassword(e.target.value)} />
                <Button disabled={!password} onClick={() => void savePassword(password)}>
                  Save
                </Button>
                {info?.passwordSet && (
                  <Button variant="ghost" onClick={() => void savePassword('')}>
                    Remove
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">A request's own proxy (request Settings) wins over this. WebSocket and Socket.IO connections use it too; gRPC reads the environment variables itself. The CLI always uses the environment variables (set TESTPION_NO_PROXY=1 to turn that off).</p>
    </>
  );
}

