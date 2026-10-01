/** RPC handlers: monitors (collections run on a schedule while the app — or any other host — runs). */
import {
  ApsError,
  deleteMonitor,
  executeMonitor,
  findMonitor,
  listMonitors,
  monitorResults,
  monitorStatus,
  notifyMonitorWebhook,
  saveMonitor,
  shortId,
  type Monitor,
  type MonitorResult,
} from '@testpion/core';
import type { Backend, Handlers } from '../backend.js';

/** Run a monitor with the app's secrets and current values; the result is sent to the renderer too. */
export async function runMonitorNow(be: Backend, m: Monitor, trigger: MonitorResult['trigger']): Promise<MonitorResult> {
  const store = be.ws;
  be.runningMonitors.add(m.id);
  be.host.emit('monitor.started', { id: m.id });
  try {
    const r = await executeMonitor({ store, monitor: m, trigger, context: (o) => be.context(o) });
    be.logger[r.status === 'passed' ? 'info' : 'warn'](`Monitor ${m.name}: ${r.status}${r.error ? ` (${r.error})` : ` ${r.passed}/${r.total}`}`, { runId: r.runId });
    return r;
  } finally {
    be.runningMonitors.delete(m.id);
  }
}

export function monitorHandlers(be: Backend): Handlers {
  // `recent`: results of the latest runs, oldest first, for the small strips in lists
  const status = (m: Monitor) => ({ ...monitorStatus(be.ws, m), running: be.runningMonitors.has(m.id), recent: monitorResults(be.ws, m.id, 20).map((r) => r.status).reverse() });
  return {
    'monitor.list': () => listMonitors(be.ws).map(status),
    'monitor.save': ({ monitor }: { monitor: Omit<Monitor, 'id'> & { id?: string } }) => status(saveMonitor(be.ws, { ...monitor, id: monitor.id || shortId('mon-') })),
    'monitor.delete': ({ id }: { id: string }) => deleteMonitor(be.ws, id),
    /** Post a sample "failed" alert to a webhook, to check it before relying on it. */
    'monitor.testWebhook': async ({ webhook, environment, name }: { webhook: string; environment?: string; name?: string }) => {
      const ctx = be.context({ environment });
      try {
        const url = ctx.vars.resolve(webhook);
        const sample: MonitorResult = { monitorId: 'test', runId: 'test', startedAt: new Date().toISOString(), durationMs: 0, status: 'failed', total: 1, passed: 0, failed: 1, errors: 0, trigger: 'manual' };
        const r = await notifyMonitorWebhook(url, { id: 'test', name: `${name || 'Monitor'} (test alert)` }, sample);
        if (!r.ok) throw new ApsError('NetworkError', r.error ? `Couldn't reach the webhook: ${r.error}` : `The webhook answered HTTP ${r.status}`, { suggestions: ['Check the URL (and the variable it uses, if any).'] });
        return { status: r.status };
      } finally {
        void ctx.dispose();
      }
    },
    'monitor.results': ({ id, limit }: { id: string; limit?: number }) => monitorResults(be.ws, id, Math.min(limit ?? 50, 500)),
    'monitor.run': async ({ id }: { id: string }) => {
      if (be.runningMonitors.has(id)) throw new ApsError('ValidationError', 'This monitor is already running', { suggestions: [] });
      const m = findMonitor(be.ws, id);
      const previous = monitorResults(be.ws, id, 1)[0];
      const r = await runMonitorNow(be, m, 'manual');
      be.host.emit('monitor.result', { monitor: m, result: r, previous });
      return r;
    },
  };
}
