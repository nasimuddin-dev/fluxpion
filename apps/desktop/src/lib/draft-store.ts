/**
 * Editor drafts in localStorage (`aps.draft.<key>`), written a moment after the last change instead of
 * on every keystroke: serialising every open tab (bodies, scripts) and writing it synchronously on each
 * key press made typing slower as tabs grew. Pending drafts are written when the window is hidden or
 * closed, so nothing typed is lost.
 */
const PREFIX = 'aps.draft.';
const DELAY_MS = 400;
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or storage unavailable */
  }
}

/** Write every pending draft now. */
export function flushDrafts(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const [key, value] of pending) write(key, value);
  pending.clear();
}

export function saveDraft(key: string, value: unknown): void {
  pending.set(key, value);
  timer ??= setTimeout(flushDrafts, DELAY_MS);
}

/** The draft as last saved (a pending one included), or undefined. */
export function loadDraft<T>(key: string): T | undefined {
  if (pending.has(key)) return pending.get(key) as T;
  try {
    const s = localStorage.getItem(PREFIX + key);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Forget a draft (a closed tab, a reset editor): a pending write must not bring it back. */
export function dropDraft(key: string): void {
  pending.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDrafts);
  window.addEventListener('beforeunload', flushDrafts);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushDrafts());
}
