import { Copy, Download, KeyRound, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { asError, call } from '../api';
import { confirmAction, promptText, useApp } from '../store';
import { useIntent } from '../hooks';
import type { Environment, KeyValue } from '../types';
import { download, uid } from '../lib/format';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { Badge, Button, cx, Empty, Field, Input, SectionTitle, Split, Tabs, Toggle } from '../components/ui';

export function EnvironmentsView() {
  const ws = useApp((s) => s.workspace);
  const settings = useApp((s) => s.settings);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [sel, setSel] = useState<string>();
  const [draft, setDraft] = useState<Environment>();
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<'environment' | 'workspace' | 'global'>('environment');
  const [wsVars, setWsVars] = useState<KeyValue[]>(ws?.variables ?? []);
  const [globals, setGlobals] = useState<KeyValue[]>(settings?.globalVariables ?? []);
  const load = async () => {
    const e = await call<Environment[]>('env.list');
    setEnvs(e);
    setSel((s) => s ?? e[0]?.id);
  };
  useEffect(() => {
    void load();
  }, []);
  const [dragId, setDragId] = useState<string>();
  const [dropAt, setDropAt] = useState<number>();
  /** Move an environment to position `to`; the order is saved and used by every environment picker. */
  const move = async (id: string, to: number) => {
    setDragId(undefined);
    setDropAt(undefined);
    const from = envs.findIndex((e) => e.id === id);
    if (from < 0 || to < 0 || to >= envs.length || to === from) return;
    const next = [...envs];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m!);
    try {
      const saved = await call<Environment[]>('env.reorder', { ids: next.map((e) => e.id) });
      reordering.current = true;
      setEnvs(saved);
      await useApp.getState().refreshWorkspace();
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
      await load();
    }
  };
  useEffect(() => setWsVars(ws?.variables ?? []), [ws]);
  useEffect(() => setGlobals(settings?.globalVariables ?? []), [settings]);
  // a reorder only changes positions: keep the open environment's unsaved edits
  const reordering = useRef(false);
  useEffect(() => {
    const e = envs.find((x) => x.id === sel);
    if (reordering.current) {
      reordering.current = false;
      if (e) setDraft((d) => (d?.id === e.id ? { ...d, order: e.order } : e));
      return;
    }
    setDraft(e);
    setSecretValues({});
    if (e) void call('env.secretStatus', { envId: e.id, keys: e.variables.filter((v) => v.secret).map((v) => v.key) }).then(setSecretStatus);
  }, [sel, envs]);
  useIntent('environments', (p) => {
    if (p?.environmentId) (setScope('environment'), setSel(p.environmentId));
    else if (p?.tab === 'globals') setScope('global');
  });

  const rows: KeyValue[] = (draft?.variables ?? []).map((v) => ({ ...v, value: v.secret ? secretValues[v.key] ?? '' : v.value }));
  const save = async () => {
    if (!draft) return;
    try {
      // secret values go to the OS credential store; only the key is written to the workspace file
      const variables = rows.map((r) => ({ key: r.key, value: r.secret ? '' : r.value, secret: r.secret, enabled: r.enabled }));
      const secrets = Object.fromEntries(rows.filter((r) => r.secret && r.value).map((r) => [r.key, r.value]));
      // a variable switched to secret keeps its previous plain value as the secret
      for (const r of rows) {
        const prev = envs.find((e) => e.id === draft.id)?.variables.find((v) => v.key === r.key);
        if (r.secret && !r.value && prev && !prev.secret && prev.value) secrets[r.key] = prev.value;
      }
      await call('env.save', { env: { ...draft, variables }, secrets });
      await load();
      await useApp.getState().refreshWorkspace();
      useApp.getState().toast('Environment saved', 'success');
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  return (
    <div className="h-full flex flex-col">
      <Tabs
        value={scope}
        onChange={setScope}
        tabs={[
          { id: 'environment', label: 'Environments', badge: envs.length },
          { id: 'workspace', label: 'Workspace variables', badge: wsVars.length },
          { id: 'global', label: 'Global variables', badge: globals.length },
        ]}
        right={<span className="text-xs text-muted pr-2">Precedence: Global → Workspace → Environment → Collection → Request → Runtime</span>}
      />
      <div className="flex-1 min-h-0">
        {scope === 'environment' && (
          <Split id="envs" sidebar initial={22}>
            <div className="h-full flex flex-col bg-panel/50">
              <SectionTitle
                right={
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus size={12} />}
                    onClick={async () => {
                      const name = await promptText('New environment', { message: 'Environment name', value: 'Staging', okLabel: 'Create' });
                      if (!name) return;
                      const env: Environment = { id: uid('env-'), name, variables: [{ key: 'baseUrl', value: '', enabled: true }] };
                      await call('env.save', { env });
                      await load();
                      setSel(env.id);
                      await useApp.getState().refreshWorkspace();
                    }}
                  >
                    New
                  </Button>
                }
              >
                Environments
              </SectionTitle>
              {envs.map((e, i) => (
                <button
                  key={e.id}
                  draggable
                  title="Drag (or Alt+↑/↓) to reorder"
                  onClick={() => setSel(e.id)}
                  onDragStart={(ev) => {
                    setDragId(e.id);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(ev) => {
                    if (!dragId || dragId === e.id) return;
                    ev.preventDefault();
                    setDropAt(i);
                  }}
                  onDragLeave={() => setDropAt((d) => (d === i ? undefined : d))}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    if (dragId) void move(dragId, i);
                  }}
                  onDragEnd={() => (setDragId(undefined), setDropAt(undefined))}
                  onKeyDown={(ev) => {
                    if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
                    ev.preventDefault();
                    void move(e.id, ev.key === 'ArrowUp' ? i - 1 : i + 1);
                  }}
                  className={cx(
                    'text-left px-3 py-2 border-b border-line/60 flex items-center gap-2 cursor-grab active:cursor-grabbing',
                    sel === e.id ? 'bg-accent/10' : 'hover:bg-hover',
                    dragId === e.id && 'opacity-50',
                    dropAt === i && 'shadow-[inset_0_2px_0_var(--accent)]',
                  )}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: e.color ?? (e.isProduction ? 'var(--bad)' : 'var(--ok)') }} />
                  <span className="text-sm">{e.name}</span>
                  {e.isProduction && <Badge tone="bad">prod</Badge>}
                  <span className="ml-auto text-xs text-muted">{e.variables.length}</span>
                </button>
              ))}
            </div>
            {draft ? (
              <div className="h-full overflow-auto p-3 flex flex-col gap-3">
                <div className="flex items-end gap-3 flex-wrap">
                  <Field label="Name">
                    <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </Field>
                  <Field label="Color">
                    <input type="color" aria-label="Environment color" className="field h-8 w-14 p-1 cursor-pointer" value={draft.color ?? '#1a7f37'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                  </Field>
                  <Toggle checked={!!draft.isProduction} onChange={(isProduction) => setDraft({ ...draft, isProduction })} label="Production (blocks load tests, shows a warning)" />
                  <div className="ml-auto flex gap-2">
                    <Button
                      icon={<Copy size={13} />}
                      onClick={async () => {
                        const env = { ...draft, id: uid('env-'), name: `${draft.name} copy`, isProduction: false, variables: draft.variables.map((v) => (v.secret ? { ...v, value: '' } : v)) };
                        await call('env.save', { env });
                        await load();
                        setSel(env.id);
                        await useApp.getState().refreshWorkspace();
                      }}
                    >
                      Duplicate
                    </Button>
                    <Button
                      icon={<Download size={13} />}
                      title="Export in Postman's environment format (secret values are left out)"
                      onClick={async () => {
                        try {
                          const r = await call<{ path?: string; environment?: unknown; name: string }>('env.export', { id: draft.id });
                          if (r.environment) download(r.name, JSON.stringify(r.environment, null, 2));
                          else if (r.path) useApp.getState().toast(`Exported to ${r.path}`, 'success');
                        } catch (e) {
                          useApp.getState().toast(asError(e).message, 'error');
                        }
                      }}
                    >
                      Export
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-bad"
                      icon={<Trash2 size={13} />}
                      onClick={async () => {
                        if (!(await confirmAction({ title: 'Delete environment', message: `Delete the environment "${draft.name}"?`, detail: 'Its variables and saved secret values are removed.', confirmLabel: 'Delete environment', danger: true }))) return;
                        await call('env.delete', { id: draft.id });
                        setSel(undefined);
                        await load();
                        await useApp.getState().refreshWorkspace();
                      }}
                    >
                      Delete
                    </Button>
                    <Button variant="primary" icon={<Save size={13} />} onClick={save}>
                      Save
                    </Button>
                  </div>
                </div>
                <KeyValueEditor
                  rows={rows}
                  allowSecret
                  secretStatus={secretStatus}
                  keyPlaceholder="Variable"
                  onChange={(next) => {
                    setSecretValues(Object.fromEntries(next.filter((r) => r.secret).map((r) => [r.key, r.value])));
                    setDraft({ ...draft, variables: next.map((r) => ({ key: r.key, value: r.secret ? '' : r.value, secret: r.secret, enabled: r.enabled })) });
                  }}
                />
                <CurrentValues envName={draft.name} />
                <div className="text-xs text-muted flex items-start gap-2 bg-panel rounded-md p-2">
                  <KeyRound size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Secret variables are encrypted with the OS credential store and are never written to workspace files, exports, logs, traces or reports. In CI, provide them as environment variables named <span className="mono">TESTPION_SECRET_ENV_{'<ENV_ID>'}_{'<KEY>'}</span> or reference{' '}
                    <span className="mono">{'{{$env.NAME}}'}</span>.
                  </span>
                </div>
              </div>
            ) : (
              <Empty title="Select an environment" />
            )}
          </Split>
        )}
        {scope === 'workspace' && (
          <div className="p-3 flex flex-col gap-3 overflow-auto h-full">
            <KeyValueEditor rows={wsVars} onChange={setWsVars} keyPlaceholder="Variable" allowSecret />
            <div>
              <Button
                variant="primary"
                onClick={async () => {
                  await call('ws.update', { variables: wsVars });
                  await useApp.getState().refreshWorkspace();
                  useApp.getState().toast('Workspace variables saved', 'success');
                }}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted">Built-in: {'{{workspaceDir}}'}, {'{{$uuid}}'}, {'{{$timestamp}}'}, {'{{$isoTimestamp}}'}, {'{{$randomInt}}'}, {'{{$randomEmail}}'}, {'{{$env.NAME}}'}, {'{{$secret.NAME}}'}.</p>
          </div>
        )}
        {scope === 'global' && (
          <div className="p-3 flex flex-col gap-3 overflow-auto h-full">
            <KeyValueEditor rows={globals} onChange={setGlobals} keyPlaceholder="Variable" />
            <div>
              <Button variant="primary" onClick={() => settings && useApp.getState().saveSettings({ ...settings, globalVariables: globals }).then(() => useApp.getState().toast('Global variables saved', 'success'))}>
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Values set by scripts (pm.environment.set) for this environment — local to this machine, like Postman's current values. */
function CurrentValues({ envName }: { envName: string }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const load = () => void call<Record<string, unknown>>('currentValues.get', { scope: 'environment', owner: envName }).then(setValues);
  useEffect(load, [envName]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = Object.keys(values);
  return (
    <div className="rounded-md border border-line">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-sm">
        <span className="font-medium">Current values</span>
        <span className="text-xs text-muted">set by scripts on this machine; they override the values above and are never saved to workspace files</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load}>
          Refresh
        </Button>
        <Button
          size="sm"
          disabled={!keys.length}
          onClick={async () => {
            await call('currentValues.reset', { scope: 'environment', owner: envName });
            load();
            useApp.getState().toast('Current values reset', 'success');
          }}
        >
          Reset all
        </Button>
      </div>
      {keys.length ? (
        <table className="w-full text-sm">
          <tbody>
            {keys.map((k) => (
              <tr key={k} className="border-t border-line first:border-0">
                <td className="px-3 py-1 mono w-1/3">{k}</td>
                <td className="px-3 py-1 mono text-muted truncate">{typeof values[k] === 'object' ? JSON.stringify(values[k]) : String(values[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-3 py-2 text-xs text-muted">None yet. Scripts can set them with pm.environment.set("key", value).</div>
      )}
    </div>
  );
}
