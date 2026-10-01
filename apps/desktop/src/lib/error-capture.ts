import { call } from '../api';

/**
 * Unexpected errors of the window (an unhandled exception or promise, a view that crashed) go to the app log, so
 * the Logs panel shows them and a problem report can include them. Nothing leaves the machine here. Repeats of
 * one message are kept once a minute; a burst is capped.
 */
const seen = new Map<string, number>();
let sentThisMinute = 0;
let minute = 0;

export function reportClientError(error: unknown, where?: string): void {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error ?? 'Unknown error'));
  const now = Date.now();
  if (Math.floor(now / 60_000) !== minute) {
    minute = Math.floor(now / 60_000);
    sentThisMinute = 0;
  }
  const key = `${where}:${e.message}`;
  if ((seen.get(key) ?? 0) > now - 60_000 || sentThisMinute >= 20) return;
  seen.set(key, now);
  sentThisMinute++;
  void call('app.clientError', { message: e.message, stack: e.stack, where }).catch(() => undefined);
}

let installed = false;
export function installErrorCapture(): void {
  if (installed) return;
  installed = true;
  addEventListener('error', (ev) => {
    // resource load errors (an image) are not program errors
    if (!(ev as ErrorEvent).message) return;
    reportClientError((ev as ErrorEvent).error ?? (ev as ErrorEvent).message, 'window');
  });
  addEventListener('unhandledrejection', (ev) => {
    const r = (ev as PromiseRejectionEvent).reason;
    // a refused RPC (validation, a server that answered with an error) is shown to the user already
    if (r && typeof r === 'object' && 'kind' in r && 'suggestions' in r) return;
    reportClientError(r, 'promise');
  });
}
