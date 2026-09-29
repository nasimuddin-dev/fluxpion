import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { call } from '../api';
import { useApp } from '../store';
import type { AppSettings, PriceEntry, ProviderConfig } from '../types';
import { checkForUpdates } from '../updates';
import { Badge, Button, Field, IconButton, Input, Select, Tabs, Toggle } from '../components/ui';

type Tab = 'appearance' | 'requests' | 'privacy' | 'pricing' | 'load' | 'assistant' | 'about';

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
