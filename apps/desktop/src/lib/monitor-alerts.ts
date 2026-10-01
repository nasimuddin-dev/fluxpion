import { call, on } from '../api';
import { useApp } from '../store';

/** Mirrors core's Monitor / MonitorResult (runner/monitors.ts). */
export interface MonitorResult {
  monitorId: string;
  runId: string;
  startedAt: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'error';
  total: number;
  passed: number;
  failed: number;
  errors: number;
  p50Ms?: number;
  p95Ms?: number;
  certDaysLeft?: number;
  /** Why a run whose checks passed still failed (too slow). */
  reason?: string;
  error?: string;
  trigger: 'schedule' | 'manual';
}

/**
 * Toasts when a monitor starts failing or recovers (and a system notification when the window is in the
 * background). Watched for the whole app, so it works whichever view is open; returns the unsubscribe.
 */
/**
 * Once a day, when the app starts: a toast (and a system notification if allowed) for each recorded TLS certificate
 * that expires within 7 days, so it is renewed in time.
 */
export function remindExpiringCertificates(): void {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem('tp:certReminder') === today) return;
  } catch {
    /* no storage: remind every start */
  }
  void call<Array<{ host: string; daysLeft?: number }>>('certificates.list').then(
    (list) => {
      const soon = list.filter((c) => c.daysLeft !== undefined && c.daysLeft < 7);
      if (!soon.length) return;
      const text = soon.length === 1 ? `The certificate of ${soon[0]!.host} ${soon[0]!.daysLeft! < 0 ? 'has expired' : `expires in ${soon[0]!.daysLeft} days`}` : `${soon.length} certificates expire within 7 days: ${soon.map((c) => c.host).join(', ')}`;
      useApp.getState().toast(text, 'error');
      if ('Notification' in window && Notification.permission === 'granted') new Notification('TestPion certificates', { body: text });
      try {
        localStorage.setItem('tp:certReminder', today);
      } catch {
        /* no storage */
      }
    },
    () => undefined,
  );
}

export function watchMonitorAlerts(): () => void {
  return on<{ monitor: { name: string }; result: MonitorResult; previous?: MonitorResult }>('monitor.result', ({ monitor, result, previous }) => {
    const bad = result.status !== 'passed';
    const wasBad = previous ? previous.status !== 'passed' : false;
    if (bad === wasBad) return;
    const text = bad
      ? `Monitor "${monitor.name}" ${result.status === 'error' ? `could not run: ${result.error}` : result.reason && !(result.failed + result.errors) ? (result.reason.startsWith('p95') ? `is too slow: ${result.reason}` : `needs attention: ${result.reason}`) : `failed: ${result.failed + result.errors} of ${result.total} requests`}`
      : `Monitor "${monitor.name}" passes again`;
    useApp.getState().toast(text, bad ? 'error' : 'success');
    if (bad && document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('TestPion monitor', { body: text });
  });
}
