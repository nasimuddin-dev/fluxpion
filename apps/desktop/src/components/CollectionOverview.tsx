import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import type { Collection, CollectionNode } from '../types';
import { formatMs, plural, timeAgo } from '../lib/format';
import { BarRow, ChartCard, StatTile } from './charts';
import { Badge, cx, statusTone } from './ui';

/** From `stats.requests` (summarizeRequestStats in core). */
interface RequestStat {
  requestId: string;
  count: number;
  failed: number;
  lastStatus?: number | string;
  lastAt: string;
  lastOk: boolean;
  medianMs?: number;
}

type Saved = Exclude<CollectionNode, { kind: 'folder' }>;
interface Row {
  node: Saved;
  path: string[];
  method: string;
  stat?: RequestStat;
}

function walk(nodes: CollectionNode[], path: string[], out: { rows: Row[]; folders: number }) {
  for (const n of nodes) {
    if (n.kind === 'folder') {
      out.folders++;
      walk(n.items, [...path, n.name], out);
    } else out.rows.push({ node: n, path, method: n.kind === 'graphql' ? 'GQL' : n.request.method });
  }
}

const hasChecks = (n: Saved) => !!n.assertions?.length || !!n.testScript?.trim();

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

/**
 * A collection at a glance: how many requests and folders, how many have checks and docs, requests per method,
 * and each request's health from the responses sent in the app (latest status, failures, median time).
 */
export function CollectionOverview({ collection, onOpen }: { collection: Collection; onOpen(node: Saved): void }) {
  const [stats, setStats] = useState<RequestStat[]>([]);
  useEffect(() => {
    void call<RequestStat[]>('stats.requests', { collectionId: collection.id }).then(setStats, () => setStats([]));
  }, [collection.id]);
  const { rows, folders } = useMemo(() => {
    const out = { rows: [] as Row[], folders: 0 };
    walk(collection.items, [], out);
    const byId = new Map(stats.map((s) => [s.requestId, s]));
    for (const r of out.rows) r.stat = byId.get(r.node.id);
    return out;
  }, [collection.items, stats]);
  const withChecks = rows.filter((r) => hasChecks(r.node)).length;
  const documented = rows.filter((r) => r.node.kind === 'http' && r.node.description?.trim()).length;
  const sent = rows.filter((r) => r.stat);
  const failing = sent.filter((r) => !r.stat!.lastOk);
  const methods = Object.entries(rows.reduce<Record<string, number>>((a, r) => ((a[r.method] = (a[r.method] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
  const maxMethod = Math.max(1, ...methods.map((m) => m[1]));
  // failing first, then slowest; requests never sent last (alphabetical)
  const health = [...rows].sort((a, b) => {
    if (!!a.stat !== !!b.stat) return a.stat ? -1 : 1;
    if (a.stat && b.stat) {
      if (a.stat.lastOk !== b.stat.lastOk) return a.stat.lastOk ? 1 : -1;
      return (b.stat.medianMs ?? 0) - (a.stat.medianMs ?? 0);
    }
    return [...a.path, a.node.name].join('/').localeCompare([...b.path, b.node.name].join('/'));
  });
  const maxMs = Math.max(1, ...rows.map((r) => r.stat?.medianMs ?? 0));
  const kinds = rows.reduce((a, r) => ((a[r.node.kind] = (a[r.node.kind] ?? 0) + 1), a), {} as Record<string, number>);

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Requests" value={String(rows.length)} sub={[kinds.http && `${kinds.http} REST`, kinds.graphql && `${kinds.graphql} GraphQL`, plural(folders, 'folder')].filter(Boolean).join(' · ')} />
        <StatTile label="With checks" value={pct(withChecks, rows.length)} sub={`${withChecks} of ${rows.length} have assertions or tests`} tone={!rows.length ? undefined : withChecks === rows.length ? 'ok' : undefined} />
        <StatTile label="Documented" value={pct(documented, kinds.http ?? 0)} sub={`${documented} of ${kinds.http ?? 0} REST requests`} />
        <StatTile label="Failing now" value={sent.length ? String(failing.length) : '—'} sub={sent.length ? `latest response of ${plural(sent.length, 'sent request')}` : 'nothing sent from the app yet'} tone={!sent.length ? undefined : failing.length ? 'bad' : 'ok'} />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_3fr]">
        <ChartCard title="By method">
          <div className="flex flex-col gap-1.5">
            {methods.map(([m, n]) => (
              <BarRow key={m} label={m} labelClass={cx('mono font-bold w-12 text-[0.68rem]', `method-${m}`)} segments={[{ value: n, color: 'var(--accent)' }]} of={maxMethod} right={n} title={plural(n, `${m} request`)} />
            ))}
            {!methods.length && <p className="text-xs text-muted">No requests yet.</p>}
          </div>
        </ChartCard>
        <ChartCard title="Request health" aside="from responses sent in the app">
          {rows.length ? (
            <div className="flex flex-col">
              {health.map((r) => (
                <button key={r.node.id} className="flex items-center gap-2 py-1 px-1 -mx-1 rounded text-xs text-left min-w-0 hover:bg-hover" onClick={() => onOpen(r.node)} title={[...r.path, r.node.name].join(' / ')}>
                  <span className={cx('mono font-bold w-12 shrink-0 text-[0.68rem]', `method-${r.method}`)}>{r.method}</span>
                  <span className="truncate flex-1 min-w-0 text-fg">
                    {r.path.length > 0 && <span className="text-muted">{r.path.join(' / ')} / </span>}
                    {r.node.name}
                  </span>
                  {!hasChecks(r.node) && <span className="text-muted shrink-0" title="No assertions or tests">no checks</span>}
                  {r.stat ? (
                    <>
                      <Badge tone={statusTone(r.stat.lastStatus)}>{String(r.stat.lastStatus ?? '—')}</Badge>
                      <span className="w-24 h-1.5 rounded-full bg-hover/60 overflow-hidden shrink-0 hidden sm:block" title={r.stat.medianMs !== undefined ? `median ${formatMs(r.stat.medianMs)}` : undefined}>
                        {r.stat.medianMs !== undefined && <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (r.stat.medianMs / maxMs) * 100)}%` }} />}
                      </span>
                      <span className="w-14 text-right tabular-nums shrink-0 text-fg">{r.stat.medianMs !== undefined ? formatMs(r.stat.medianMs) : '—'}</span>
                      <span className={cx('w-16 text-right tabular-nums shrink-0', r.stat.failed ? 'text-bad' : 'text-muted')} title={`${r.stat.failed} of ${r.stat.count} responses failed`}>
                        {r.stat.failed}/{r.stat.count}
                      </span>
                      <span className="w-16 text-right text-muted shrink-0">{timeAgo(r.stat.lastAt)}</span>
                    </>
                  ) : (
                    <span className="text-muted shrink-0 w-[19rem] text-right">not sent yet</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">Add requests to see how they are doing.</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
