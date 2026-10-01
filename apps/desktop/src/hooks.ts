import { useEffect, useRef } from 'react';
import { useApp, type ViewId } from './store';
import { useDoc } from './lib/docs';

/** Intents already handled by keyed consumers (so a component that remounts doesn't handle one again). */
const handled = new Map<string, number>();

/**
 * Handle navigation intents for a view. Give `key` when the component can unmount and mount again
 * (e.g. inside a tab): the intent it already handled isn't handled a second time.
 */
export function useIntent(view: ViewId, handler: (payload: any) => void, key?: string): void {
  const intent = useApp((s) => s.intent);
  // in a multi-document editor only the targeted document (or the one on screen) handles it
  const doc = useDoc();
  const last = useRef(0);
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    if (!intent || intent.view !== view) return;
    if (doc.docId !== undefined && (intent.docId ? intent.docId !== doc.docId : !doc.active)) return;
    const seen = key ? handled.get(key) : last.current;
    if (intent.nonce === seen) return;
    last.current = intent.nonce;
    if (key) handled.set(key, intent.nonce);
    h.current(intent.payload);
  }, [intent, view, key, doc.docId, doc.active]);
}

/** Run `fn` on Ctrl/Cmd+Enter while this view is active. */
export function useSendShortcut(view: ViewId, fn: () => void): void {
  const f = useRef(fn);
  f.current = fn;
  const doc = useDoc();
  const active = useRef(doc.active);
  active.current = doc.active;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && useApp.getState().view === view && active.current) {
        e.preventDefault();
        f.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view]);
}

/** Save on Ctrl/Cmd+S while this view (and, in a multi-document editor, this tab) is on screen. */
export function useSaveShortcut(view: ViewId, fn: () => void): void {
  const f = useRef(fn);
  f.current = fn;
  const doc = useDoc();
  const active = useRef(doc.active);
  active.current = doc.active;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && useApp.getState().view === view && active.current) {
        e.preventDefault();
        f.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
}
