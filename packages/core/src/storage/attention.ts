/**
 * What needs attention in a workspace, most severe first: failing monitors, certificates that expire soon, flaky
 * tests, saved requests whose latest response failed, and the latest run if it failed. Names and counts only.
 */
import type { WorkspaceStore } from './workspace.js';
import { listCertificates } from './certificates.js';
import { listMonitors, lastMonitorResult } from '../runner/monitors.js';
import { flakyTests } from '../runner/test-history.js';
import { collectionRequests } from '../runner/collection-run.js';

export interface AttentionItem {
  kind: 'monitor' | 'certificate' | 'flaky' | 'request' | 'run';
  severity: 'high' | 'medium' | 'low';
  /** One line for people. */
  message: string;
  /** What it is about: a monitor id, a host, a test id, a collection id + request id, a run id. */
  ref: { monitorId?: string; host?: string; testId?: string; collectionId?: string; requestId?: string; runId?: string };
}

export async function workspaceAttention(store: WorkspaceStore, opts: { certDays?: number; flakyRuns?: number } = {}): Promise<AttentionItem[]> {
  const out: AttentionItem[] = [];
  for (const m of listMonitors(store)) {
    if (!m.enabled) continue;
    const r = lastMonitorResult(store, m.id);
    if (!r || r.status === 'passed') continue;
    const why = r.status === 'error' ? `could not run: ${r.error ?? 'error'}` : r.reason && !(r.failed + r.errors) ? r.reason : `${r.failed + r.errors} of ${r.total} requests failed`;
    out.push({ kind: 'monitor', severity: 'high', message: `Monitor "${m.name}" is failing: ${why}`, ref: { monitorId: m.id, runId: r.runId } });
  }
  const certDays = opts.certDays ?? 30;
  for (const c of listCertificates(store)) {
    if (c.daysLeft === undefined || c.daysLeft >= certDays) continue;
    out.push({
      kind: 'certificate',
      severity: c.daysLeft < 7 ? 'high' : 'medium',
      message: c.daysLeft < 0 ? `The certificate of ${c.host} has expired` : `The certificate of ${c.host} expires in ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'}`,
      ref: { host: c.host },
    });
  }
  const latest = store.meta.listRuns({ limit: 1 }).items[0];
  if (latest && latest.failed + latest.errors > 0)
    out.push({
      kind: 'run',
      severity: 'medium',
      message: `The latest run "${latest.name}" has ${latest.failed + latest.errors} failing test${latest.failed + latest.errors === 1 ? '' : 's'}`,
      ref: { runId: latest.id },
    });
  for (const c of store.listCollections()) {
    if ((c as { problem?: string }).problem) continue;
    const names = new Map(collectionRequests(c).map((r) => [r.id, [...r.path, r.name].join(' / ')]));
    const failing = store.meta.requestStats(c.id).filter((s) => !s.lastOk && names.has(s.requestId));
    for (const s of failing.slice(0, 5))
      out.push({
        kind: 'request',
        severity: 'low',
        message: `${c.name} › ${names.get(s.requestId)}: the latest response was ${s.lastStatus ?? 'an error'}`,
        ref: { collectionId: c.id, requestId: s.requestId },
      });
  }
  for (const t of (await flakyTests(store, { runs: opts.flakyRuns ?? 30 })).slice(0, 5))
    out.push({
      kind: 'flaky',
      severity: 'low',
      message: `"${t.name}" is flaky: its result changed ${t.flips} times in ${t.runs} runs${t.retried ? `, ${t.retried} passed after a retry` : ''}`,
      ref: { testId: t.id },
    });
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
