import { AlarmClock, Folder, KeyRound, Pause, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { SidebarShell } from '../components/SidebarShell';
import { EnvironmentsPane } from '../components/SidebarPanes';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { asError, call, on } from '../api';
import type { MonitorResult } from '../lib/monitor-alerts';
import { useIntent } from '../hooks';
import { confirmAction, useApp } from '../store';
import type { Collection, CollectionNode } from '../types';
import { formatMs, timeAgo } from '../lib/format';
import { Badge, Button, cx, Empty, Field, IconButton, Input, Metric, MetricGrid, Modal, Select, Split, Toggle, Tooltip } from '../components/ui';

interface MonitorDraft {
  id?: string;
  name: string;
  collectionId: string;
  selection?: string[];
  environment?: string;
  everyMinutes: number;
  enabled: boolean;
  iterations?: number;
  bail?: boolean;
  webhook?: string;
}

interface MonitorRow extends MonitorDraft {
  id: string;
  schedule: string;
  lastResult?: MonitorResult;
  nextRunAt?: string;
  due: boolean;
  running: boolean;
}

const UNITS = [
  { id: 'm', label: 'minutes', f: 1 },
  { id: 'h', label: 'hours', f: 60 },
  { id: 'd', label: 'days', f: 1440 },
] as const;

const tone = (s?: MonitorResult['status']) => (s === 'passed' ? 'ok' : s ? 'bad' : 'default');
const statusLabel = (r?: MonitorResult) => (!r ? 'Never ran' : r.status === 'passed' ? 'Passed' : r.status === 'failed' ? 'Failed' : 'Could not run');

export function MonitorsView() {
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [filter, setFilter] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<string>();
  const [results, setResults] = useState<MonitorResult[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [editing, setEditing] = useState<MonitorDraft>();
  const [busy, setBusy] = useState<string>();
  const toast = useApp((s) => s.toast);

  const load = useCallback(async () => {
    const [list, cols] = await Promise.all([call<MonitorRow[]>('monitor.list'), call<Collection[]>('col.list')]);
    setRows(list);
    setCollections(cols);
    setLoaded(true);
    setSel((s) => (s && list.some((m) => m.id === s) ? s : list[0]?.id));
  }, []);
  const loadResults = useCallback(async (id?: string) => setResults(id ? await call<MonitorResult[]>('monitor.results', { id, limit: 100 }) : []), []);

  useEffect(() => void load(), [load]);
  useEffect(() => void loadResults(sel), [sel, loadResults]);
  // scheduled runs finish in the background: refresh the list and the open monitor
  useEffect(() => {
    const offResult = on<{ result: MonitorResult }>('monitor.result', ({ result }) => {
      void load();
      if (result.monitorId === sel) void loadResults(sel);
    });
    const offStart = on('monitor.started', () => void load());
    return () => (offResult(), offStart());
  }, [load, loadResults, sel]);
  // "next run in …" stays current
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useIntent(
    'monitors',
    (p?: { create?: { collectionId: string; selection?: string[] } }) => {
      if (p?.create) setEditing({ name: '', collectionId: p.create.collectionId, selection: p.create.selection, everyMinutes: 15, enabled: true, environment: useApp.getState().environment });
    },
    'monitors',
  );

  const current = rows.find((m) => m.id === sel);
  const colName = (id: string) => collections.find((c) => c.id === id)?.name ?? 'missing collection';

  const run = async (m: MonitorRow) => {
    setBusy(m.id);
    try {
      const r = await call<MonitorResult>('monitor.run', { id: m.id });
      toast(`${m.name}: ${statusLabel(r).toLowerCase()} (${r.passed}/${r.total})`, r.status === 'passed' ? 'success' : 'error');
    } catch (e) {
      toast(asError(e).message, 'error');
    } finally {
      setBusy(undefined);
      await load();
      await loadResults(m.id);
    }
  };
  const save = async (d: MonitorDraft) => {
    const saved = await call<MonitorRow>('monitor.save', { monitor: d });
    setEditing(undefined);
    await load();
    setSel(saved.id);
  };
  const toggle = async (m: MonitorRow) => {
    try {
      await call('monitor.save', { monitor: { ...m, enabled: !m.enabled } });
    } catch (e) {
      toast(asError(e).message, 'error');
    }
    await load();
  };
  const remove = async (m: MonitorRow) => {
    if (!(await confirmAction({ title: 'Delete monitor', message: `Delete "${m.name}"?`, detail: 'Its past runs stay in the Tests view.', confirmLabel: 'Delete', danger: true }))) return;
    await call('monitor.delete', { id: m.id });
    await load();
  };

  const shown = filter ? rows.filter((m) => `${m.name} ${colName(m.collectionId)}`.toLowerCase().includes(filter.toLowerCase())) : rows;
  return (
    <Split id="monitors" sidebar initial={20} min={12}>
      <SidebarShell
        id="monitors"
        panes={[
          {
            id: 'monitors',
            label: 'Monitors',
            icon: <AlarmClock size={13} />,
            render: () => (
              <>
                <div className="flex items-center gap-1 px-3 h-8 shrink-0">
                  <span className="text-[11px] font-semibold tracking-wider uppercase text-muted flex-1 truncate">Monitors</span>
                  <IconButton label="Refresh" className="h-6 w-6" onClick={() => void load()}>
                    <RefreshCw size={13} />
                  </IconButton>
                  <IconButton
                    label={collections.length ? 'New monitor' : 'Create a collection first'}
                    className="h-6 w-6"
                    disabled={!collections.length}
                    onClick={() => setEditing({ name: '', collectionId: collections[0]?.id ?? '', everyMinutes: 15, enabled: true, environment: useApp.getState().environment })}
                  >
                    <Plus size={14} />
                  </IconButton>
                </div>
                {rows.length > 0 && (
                  <div className="px-2 pb-2">
                    <Input className="w-full h-7 min-h-7 text-sm" placeholder="Filter monitors" aria-label="Filter monitors" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-auto px-1 flex flex-col">
                  {shown.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSel(m.id)}
                      className={cx('w-full text-left px-2 py-1.5 rounded-md flex flex-col gap-0.5 transition-colors', sel === m.id ? 'bg-accent-soft' : 'hover:bg-hover')}
                    >
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <span className={cx('w-2 h-2 rounded-full shrink-0', m.running ? 'bg-accent animate-pulse' : !m.lastResult ? 'bg-muted/50' : m.lastResult.status === 'passed' ? 'bg-ok' : 'bg-bad')} />
                        <span className="truncate font-medium">{m.name}</span>
                        {!m.enabled && <Badge>paused</Badge>}
                      </div>
                      <div className="text-xs text-muted pl-4 truncate">
                        {colName(m.collectionId)} · {m.schedule}
                        {m.lastResult && ` · ${timeAgo(m.lastResult.startedAt)}`}
                      </div>
                    </button>
                  ))}
                  {rows.length > 0 && !shown.length && <p className="px-3 py-4 text-sm text-muted text-center">No monitors match this filter.</p>}
                  {loaded && !rows.length && (
                    <Empty icon={<AlarmClock size={24} />} title="No monitors yet" action={collections.length ? undefined : <span className="text-xs text-muted">Create a collection first.</span>}>
                      A monitor runs a collection (or some of its folders) on a schedule and tells you when it starts failing.
                    </Empty>
                  )}
                </div>
              </>
            ),
          },
          { id: 'environments', label: 'Environments', icon: <KeyRound size={13} />, render: () => <EnvironmentsPane /> },
        ]}
      />
      <div className="h-full min-h-0 overflow-auto">
        {current ? (
          <MonitorDetail
            m={current}
            results={results}
            collectionName={colName(current.collectionId)}
            folderNames={names(collections.find((c) => c.id === current.collectionId), current.selection)}
            busy={busy === current.id || current.running}
            onRun={() => void run(current)}
            onEdit={() => setEditing(current)}
            onToggle={() => void toggle(current)}
            onDelete={() => void remove(current)}
          />
        ) : (
          loaded &&
          (rows.length > 0 ? (
            <Empty title="Select a monitor" />
          ) : (
            <Empty
              icon={<AlarmClock size={24} />}
              title="Run collections on a schedule"
              action={
                <Button variant="primary" icon={<Plus size={13} />} disabled={!collections.length} onClick={() => setEditing({ name: '', collectionId: collections[0]?.id ?? '', everyMinutes: 15, enabled: true, environment: useApp.getState().environment })}>
                  New monitor
                </Button>
              }
            >
              {collections.length ? 'A monitor runs a collection, or some of its folders, every few minutes while TestPion is open, and tells you when it starts failing. From the terminal: testpion monitor.' : 'Create a collection first: a monitor runs a collection on a schedule.'}
            </Empty>
          ))
        )}
        {editing && <MonitorEditor draft={editing} collections={collections} onCancel={() => setEditing(undefined)} onSave={save} />}
      </div>
    </Split>
  );
}

/** Names of selected folders / requests (for the header). */
function names(c: Collection | undefined, ids?: string[]): string[] {
  if (!c || !ids?.length) return [];
  const all: CollectionNode[] = [];
  const walk = (nodes: CollectionNode[]) => nodes.forEach((n) => (all.push(n), n.kind === 'folder' && walk(n.items)));
  walk(c.items);
  return ids.map((id) => all.find((n) => n.id === id)?.name ?? id);
}

function MonitorDetail(p: {
  m: MonitorRow;
  results: MonitorResult[];
  collectionName: string;
  folderNames: string[];
  busy: boolean;
  onRun(): void;
  onEdit(): void;
  onToggle(): void;
  onDelete(): void;
}) {
  const { m, results } = p;
  const last = results[0];
  const stats = useMemo(() => {
    const done = results.filter((r) => r.status !== 'error' || r.total === 0);
    const passed = results.filter((r) => r.status === 'passed').length;
    const ms = results.map((r) => r.durationMs).sort((a, b) => a - b);
    return { uptime: results.length ? Math.round((passed / results.length) * 1000) / 10 : undefined, median: ms[Math.max(0, Math.ceil(ms.length / 2) - 1)], count: done.length };
  }, [results]);
  const next = m.enabled && m.nextRunAt ? Date.parse(m.nextRunAt) - Date.now() : undefined;
  return (
    <div className="p-4 flex flex-col gap-4 max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold truncate">{m.name}</h2>
          <div className="text-sm text-muted">
            {p.collectionName}
            {p.folderNames.length > 0 && ` › ${p.folderNames.join(', ')}`}
            {m.environment && ` · ${m.environment}`} · {m.schedule}
          </div>
        </div>
        <Button size="sm" variant="primary" icon={<Play size={14} />} loading={p.busy} onClick={p.onRun}>
          Run now
        </Button>
        <Tooltip content={m.enabled ? 'Pause the schedule' : 'Resume the schedule'}>
          <Button size="sm" icon={m.enabled ? <Pause size={14} /> : <AlarmClock size={14} />} onClick={p.onToggle}>
            {m.enabled ? 'Pause' : 'Resume'}
          </Button>
        </Tooltip>
        <IconButton label="Edit" onClick={p.onEdit}>
          <Pencil size={14} />
        </IconButton>
        <IconButton label="Delete" onClick={p.onDelete}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <MetricGrid compact>
        <Metric label="Last result" value={statusLabel(last)} tone={last ? (last.status === 'passed' ? 'ok' : 'bad') : undefined} sub={last ? timeAgo(last.startedAt) : undefined} />
        <Metric label="Success rate" value={stats.uptime === undefined ? '—' : `${stats.uptime}%`} tone={stats.uptime === undefined ? undefined : stats.uptime === 100 ? 'ok' : stats.uptime >= 90 ? 'warn' : 'bad'} sub={`last ${results.length} runs`} />
        <Metric label="Median run time" value={stats.median === undefined ? '—' : formatMs(stats.median)} />
        <Metric label="Next run" value={!m.enabled ? 'Paused' : next === undefined ? '—' : next <= 0 ? 'Due now' : `in ${formatWait(next)}`} sub={m.enabled ? 'while TestPion is open' : undefined} />
      </MetricGrid>

      {results.length > 0 && <ResultStrip results={results} />}

      <div>
        <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Runs</div>
        {results.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="font-normal py-1">When</th>
                <th className="font-normal">Result</th>
                <th className="font-normal text-right">Requests</th>
                <th className="font-normal text-right">Time</th>
                <th className="font-normal pl-4">Started by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.runId} className="border-t border-line/60">
                  <td className="py-1.5 whitespace-nowrap" title={new Date(r.startedAt).toLocaleString()}>
                    {timeAgo(r.startedAt)}
                  </td>
                  <td>
                    <Badge tone={tone(r.status)}>{statusLabel(r)}</Badge>
                    {r.error && <span className="text-xs text-bad ml-2">{r.error}</span>}
                  </td>
                  <td className="text-right tabular-nums">{r.total ? `${r.passed}/${r.total}` : '—'}</td>
                  <td className="text-right tabular-nums">{formatMs(r.durationMs)}</td>
                  <td className="pl-4 text-muted">{r.trigger === 'schedule' ? 'schedule' : 'you'}</td>
                  <td className="text-right">
                    {r.total > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => useApp.getState().openIntent('tests', { runId: r.runId })}>
                        Open run
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-sm text-muted">No runs yet. {m.enabled ? 'It runs when it is due while TestPion is open, or click Run now.' : 'Resume it, or click Run now.'}</div>
        )}
      </div>
      <p className="text-xs text-muted">
        Monitors run while the app is open. To run them on a server or in CI, use <code>testpion monitor start</code> or <code>testpion monitor run --due</code> from cron.
      </p>
    </div>
  );
}

function formatWait(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60 ? `${min % 60} min` : ''}`.trim() : `${Math.round(h / 24)} d`;
}

/** Oldest → newest, one bar per run: height is the run time, colour the result. Hover for details. */
function ResultStrip({ results }: { results: MonitorResult[] }) {
  const runs = [...results].slice(0, 60).reverse();
  const max = Math.max(...runs.map((r) => r.durationMs), 1);
  return (
    <div>
      <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Recent runs</div>
      <div className="flex items-end gap-0.5 h-12" role="img" aria-label={`${runs.filter((r) => r.status === 'passed').length} of the last ${runs.length} runs passed`}>
        {runs.map((r) => (
          <Tooltip key={r.runId} content={`${statusLabel(r)} · ${r.total ? `${r.passed}/${r.total} · ` : ''}${formatMs(r.durationMs)} · ${timeAgo(r.startedAt)}`}>
            <div
              className={cx('flex-1 max-w-3 min-w-1 rounded-t-sm', r.status === 'passed' ? 'bg-ok/70 hover:bg-ok' : 'bg-bad/80 hover:bg-bad')}
              style={{ height: `${Math.max(12, (r.durationMs / max) * 100)}%` }}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function MonitorEditor({ draft, collections, onCancel, onSave }: { draft: MonitorDraft; collections: Collection[]; onCancel(): void; onSave(d: MonitorDraft): Promise<void> }) {
  const environments = useApp((s) => s.workspace?.environments ?? []);
  const unit0 = draft.everyMinutes % 1440 === 0 ? UNITS[2] : draft.everyMinutes % 60 === 0 ? UNITS[1] : UNITS[0];
  const [d, setD] = useState<MonitorDraft>(draft);
  const [every, setEvery] = useState(String(draft.everyMinutes / unit0.f));
  const [unit, setUnit] = useState<string>(unit0.id);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // File ▸ New ▸ Monitor opens the editor before the collections have loaded
  useEffect(() => {
    if (!d.collectionId && collections[0]) setD((x) => ({ ...x, collectionId: collections[0]!.id }));
  }, [collections, d.collectionId]);
  const col = collections.find((c) => c.id === d.collectionId);
  const folders = useMemo(() => {
    const out: Array<{ id: string; label: string; depth: number; folder: boolean }> = [];
    const walk = (nodes: CollectionNode[], depth: number) =>
      nodes.forEach((n) => {
        out.push({ id: n.id, label: n.name, depth, folder: n.kind === 'folder' });
        if (n.kind === 'folder') walk(n.items, depth + 1);
      });
    if (col) walk(col.items, 0);
    return out;
  }, [col]);
  const minutes = Math.round(Number(every) * (UNITS.find((u) => u.id === unit)?.f ?? 1));
  const submit = async () => {
    setError(undefined);
    if (!d.name.trim()) return setError('Give the monitor a name.');
    if (!(minutes >= 1 && minutes <= 10080)) return setError('A monitor runs every 1 minute to 7 days.');
    setSaving(true);
    try {
      await onSave({ ...d, name: d.name.trim(), everyMinutes: minutes, selection: d.selection?.length ? d.selection : undefined, environment: d.environment || undefined });
    } catch (e) {
      setError(asError(e).message);
    } finally {
      setSaving(false);
    }
  };
  const sel = new Set(d.selection ?? []);
  return (
    <Modal
      title={draft.id ? 'Edit monitor' : 'New monitor'}
      onClose={onCancel}
      width={560}
      footer={
        <>
          {error && <span className="text-sm text-bad mr-auto">{error}</span>}
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {draft.id ? 'Save' : 'Create monitor'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input autoFocus value={d.name} placeholder="e.g. API health" onChange={(e) => setD({ ...d, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collection">
            <Select value={d.collectionId} onChange={(e) => setD({ ...d, collectionId: e.target.value, selection: undefined })}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Environment">
            <Select value={d.environment ?? ''} onChange={(e) => setD({ ...d, environment: e.target.value || undefined })}>
              <option value="">No environment</option>
              {environments.map((e) => (
                <option key={e.id} value={e.name}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Run every" hint="From 1 minute to 7 days. The first run starts as soon as it's saved.">
          <div className="flex gap-2">
            <Input type="number" min={1} className="w-24" value={every} onChange={(e) => setEvery(e.target.value)} aria-label="Interval" />
            <Select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
              {UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="What to run" hint={sel.size ? `${sel.size} selected` : 'Nothing selected runs the whole collection.'}>
          <div className="max-h-44 overflow-auto rounded-md border border-line p-1">
            {folders.map((f) => (
              <label key={f.id} className={cx('flex items-center gap-2 pr-2 py-0.5 text-sm hover:bg-hover rounded cursor-pointer', f.folder && 'font-medium')} style={{ paddingLeft: 8 + f.depth * 18 }}>
                <input
                  type="checkbox"
                  checked={sel.has(f.id)}
                  onChange={(e) => {
                    const next = new Set(sel);
                    if (e.target.checked) next.add(f.id);
                    else next.delete(f.id);
                    setD({ ...d, selection: [...next] });
                  }}
                />
                {f.folder && <Folder size={14} className="text-muted shrink-0" />}
                <span className="truncate">{f.label}</span>
              </label>
            ))}
            {!folders.length && <div className="text-sm text-muted p-2">This collection is empty.</div>}
          </div>
        </Field>
        <div className="flex items-center gap-6">
          <Toggle checked={d.enabled} onChange={(v) => setD({ ...d, enabled: v })} label="Enabled" />
          <Toggle checked={!!d.bail} onChange={(v) => setD({ ...d, bail: v || undefined })} label="Stop at the first failure" />
        </div>
        <Field label="Alert webhook (optional)" hint="Posted when the monitor starts failing or passes again: a Slack, Teams or Discord incoming webhook, or any URL. {{variables}} of the environment work, so the URL can be a secret.">
          <div className="flex gap-2">
            <Input className="mono flex-1" placeholder="https://hooks.slack.com/services/…  or  {{alertWebhook}}" value={d.webhook ?? ''} onChange={(e) => setD({ ...d, webhook: e.target.value || undefined })} aria-label="Alert webhook" />
            <Button
              disabled={!d.webhook?.trim()}
              onClick={() =>
                void call('monitor.testWebhook', { webhook: d.webhook, environment: d.environment, name: (d as { name?: string }).name }).then(
                  () => useApp.getState().toast('Test alert sent', 'success'),
                  (e) => useApp.getState().toast(asError(e).message, 'error'),
                )
              }
            >
              Send test alert
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
