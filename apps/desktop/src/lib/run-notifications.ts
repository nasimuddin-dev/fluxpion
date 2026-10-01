import { on } from '../api';
import { useApp } from '../store';
import { formatMs } from './format';

interface RunFinished {
  runId: string;
  name: string;
  total?: number;
  passed?: number;
  failed?: number;
  errors?: number;
  durationMs: number;
  cancelled?: boolean;
}

/**
 * A desktop notification when a run (tests, a collection, an evaluation) finishes while TestPion isn't in
 * front: long runs can be left to themselves. Clicking it brings the run up. Settings ▸ General turns it off.
 */
export function watchRunNotifications(): () => void {
  return on<RunFinished>('run.finished', (p) => {
    if (useApp.getState().settings?.notifyRunFinished === false) return;
    if (p.cancelled || !p.total || document.hasFocus()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const bad = (p.failed ?? 0) + (p.errors ?? 0);
    const n = new Notification(bad ? `${p.name}: ${bad} of ${p.total} failed` : `${p.name}: all ${p.total} passed`, {
      body: `${p.passed ?? 0} passed${p.failed ? ` · ${p.failed} failed` : ''}${p.errors ? ` · ${p.errors} errors` : ''} · ${formatMs(p.durationMs)}`,
      tag: p.runId,
    });
    n.onclick = () => {
      window.focus();
      useApp.getState().openIntent('tests', { runId: p.runId });
      n.close();
    };
  });
}
