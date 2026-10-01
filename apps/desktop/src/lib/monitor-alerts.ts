import { on } from '../api';
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
  /** Why a run whose checks passed still failed (too slow). */
  reason?: string;
  error?: string;
  trigger: 'schedule' | 'manual';
}

/**
 * Toasts when a monitor starts failing or recovers (and a system notification when the window is in the
 * background). Watched for the whole app, so it works whichever view is open; returns the unsubscribe.
 */
export function watchMonitorAlerts(): () => void {
  return on<{ monitor: { name: string }; result: MonitorResult; previous?: MonitorResult }>('monitor.result', ({ monitor, result, previous }) => {
    const bad = result.status !== 'passed';
    const wasBad = previous ? previous.status !== 'passed' : false;
    if (bad === wasBad) return;
    const text = bad
      ? `Monitor "${monitor.name}" ${result.status === 'error' ? `could not run: ${result.error}` : result.reason && !(result.failed + result.errors) ? `is too slow: ${result.reason}` : `failed: ${result.failed + result.errors} of ${result.total} requests`}`
      : `Monitor "${monitor.name}" passes again`;
    useApp.getState().toast(text, bad ? 'error' : 'success');
    if (bad && document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('TestPion monitor', { body: text });
  });
}
