import { useEffect, useRef } from 'react';
import { useApp, type ViewId } from './store';

/** React to cross-view navigation intents addressed to `view`. */
export function useIntent(view: ViewId, handler: (payload: any) => void): void {
  const intent = useApp((s) => s.intent);
  const last = useRef(0);
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (intent && intent.view === view && intent.nonce !== last.current) {
      last.current = intent.nonce;
      h.current(intent.payload);
    }
  }, [intent, view]);
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
