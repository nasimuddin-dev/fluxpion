import { useEffect, useRef } from 'react';
import { useApp, type ViewId } from './store';

/** Intents already handled by keyed consumers (so a component that remounts doesn't handle one again). */
const handled = new Map<string, number>();

/**
 * Handle navigation intents for a view. Give `key` when the component can unmount and mount again
 * (e.g. inside a tab): the intent it already handled isn't handled a second time.
 */
export function useIntent(view: ViewId, handler: (payload: any) => void, key?: string): void {
  const intent = useApp((s) => s.intent);
  const last = useRef(0);
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (!intent || intent.view !== view) return;
    const seen = key ? handled.get(key) : last.current;
    if (intent.nonce === seen) return;
    last.current = intent.nonce;
    if (key) handled.set(key, intent.nonce);
    h.current(intent.payload);
  }, [intent, view, key]);
}

/** Run `fn` on Ctrl/Cmd+Enter while this view is active. */
export function useSendShortcut(view: ViewId, fn: () => void): void {
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && useApp.getState().view === view) {
        e.preventDefault();
        f.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view]);
}
