import { Check, History, KeyRound, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import { promptText, useApp } from '../store';
import type { HttpRequestSpec } from '../types';
import { groupByDay, uid } from '../lib/format';
import { Badge, cx, Empty, IconButton, Input, statusTone } from './ui';

/** Sidebar pane: the workspace's environments; click one to make it active (Postman's Environments sidebar). */
export function EnvironmentsPane() {
  const ws = useApp((s) => s.workspace);
  const env = useApp((s) => s.environment);
  const [filter, setFilter] = useState('');
  const envs = (ws?.environments ?? []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));
  const create = async () => {
    const name = (await promptText('New environment', { placeholder: 'Staging', okLabel: 'Create' }))?.trim();
    if (!name) return;
    const id = uid('env-');
    await call('env.save', { env: { id, name, variables: [{ key: 'baseUrl', value: '' }] } });
    await useApp.getState().refreshWorkspace();
    useApp.getState().openIntent('environments', { environmentId: id });
  };
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 pb-2">
        <Input className="flex-1 h-7 min-h-7 text-sm" placeholder="Filter environments" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <IconButton label="New environment" onClick={() => void create()}>
          <Plus size={14} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-auto">
        <button className={cx('w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left', !env ? 'bg-accent/10 text-accent' : 'hover:bg-hover text-muted')} onClick={() => useApp.getState().setEnvironment(undefined)}>
          <span className="w-2 h-2 rounded-full bg-[var(--line-strong)] shrink-0" />
          <span className="flex-1">No environment</span>
          {!env && <Check size={13} />}
        </button>
        {envs.map((e) => (
          <div key={e.id} className={cx('group flex items-center gap-2 px-3 py-1.5 text-sm', e.name === env ? 'bg-accent/10 text-accent' : 'hover:bg-hover')}>
            <button className="flex-1 flex items-center gap-2 text-left min-w-0" onClick={() => useApp.getState().setEnvironment(e.name)} title="Make this the active environment">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color ?? (e.isProduction ? 'var(--bad)' : 'var(--ok)') }} />
              <span className="truncate">{e.name}</span>
              {e.isProduction && <Badge tone="bad">prod</Badge>}
              {e.name === env && <Check size={13} className="ml-auto shrink-0" />}
            </button>
            <button className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-fg shrink-0" onClick={() => useApp.getState().openIntent('environments', { environmentId: e.id })}>
              Edit
            </button>
          </div>
        ))}
        {!ws?.environments.length && (
          <Empty icon={<KeyRound size={22} />} title="No environments">
            Environments hold variables such as <span className="mono">baseUrl</span> and tokens.
          </Empty>
        )}
      </div>
    </div>
  );
}

interface HistoryItem {
  id: string;
  timestamp: string;
  kind: string;
  name: string;
  method?: string;
  url?: string;
  status?: number | string;
  request?: unknown;
}

/** Sidebar pane: recent HTTP requests grouped by day; click to open one in a new tab. */
export function HistoryPane({ onOpen }: { onOpen(request: HttpRequestSpec, name: string): void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const load = () => void call<{ items: HistoryItem[] }>('history.list', { kind: 'http', query: filter || undefined, limit: 100 }).then((r) => setItems(r.items));
    const t = setTimeout(load, 150);
    const off = useApp.subscribe((s, p) => s.activity !== p.activity && Object.keys(s.activity).length < Object.keys(p.activity).length && load());
    return () => (clearTimeout(t), off());
  }, [filter]);
  const rows = useMemo(() => groupByDay(items, (h) => h.timestamp), [items]);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-2 pb-2">
        <Input className="w-full h-7 min-h-7 text-sm" placeholder="Filter history" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="flex-1 overflow-auto">
        {rows.map((r, i) =>
          'header' in r ? (
            <div key={`h-${i}`} className="px-3 pt-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
              {r.header}
            </div>
          ) : (
            <button
              key={r.item.id}
              className="w-full flex items-center gap-2 px-3 py-1 text-sm text-left hover:bg-hover"
              title={r.item.url}
              onClick={() => r.item.request && onOpen(r.item.request as HttpRequestSpec, r.item.name)}
            >
              <span className={cx('mono text-[0.66rem] font-bold w-11 shrink-0', r.item.method && `method-${r.item.method}`)}>{r.item.method}</span>
              <span className="truncate flex-1">{r.item.url ?? r.item.name}</span>
              {r.item.status !== undefined && <Badge tone={statusTone(r.item.status)}>{r.item.status}</Badge>}
            </button>
          ),
        )}
        {!items.length && (
          <Empty icon={<History size={22} />} title={filter ? 'No matches' : 'No history yet'}>
            {filter ? 'Try another filter.' : 'Requests you send appear here, grouped by day.'}
          </Empty>
        )}
      </div>
    </div>
  );
}
