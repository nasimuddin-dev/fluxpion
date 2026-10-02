import { useEffect } from 'react';
import { useApp, type ViewId } from '../store';

/** What a view shows, for the AI assistant: a short label for the chip and the data sent with the question. */
export interface ViewContext {
  label: string;
  context: Record<string, unknown>;
}

const providers = new Map<ViewId, () => ViewContext | undefined>();

/**
 * A view offers what is on screen (the open request and its response, …) to "Ask the assistant". The function is
 * called when a conversation starts, so it reads the latest state; the user sees the chip and can leave it out.
 */
export function useAssistantContext(view: ViewId, get: () => ViewContext | undefined, active = true) {
  useEffect(() => {
    // an editor with tabs keeps every tab mounted: only the one on screen speaks for the view
    if (!active) return;
    providers.set(view, get);
    return () => {
      if (providers.get(view) === get) providers.delete(view);
    };
  }, [view, get, active]);
}

/** The context of the view the user is looking at, if it offers one. */
export function currentViewContext(): ViewContext | undefined {
  try {
    return providers.get(useApp.getState().view)?.();
  } catch {
    return undefined;
  }
}
