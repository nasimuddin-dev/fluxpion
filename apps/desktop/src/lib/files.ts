import { useApp } from '../store';

/**
 * Host-agnostic file handling for the UI (desktop today, browser / cloud later). The UI never gets
 * local paths to read: files are picked in the browser and their content goes over RPC, and saved
 * files are either written by the backend (native dialog) or downloaded here.
 */

/** What backend "save" handlers return (see saveOrDownload in the backend). */
export interface SaveResult {
  path?: string;
  download?: { name: string; content: string; encoding: 'base64' | 'utf8'; type: string };
}

/** Download content in the browser. */
export function downloadContent(name: string, content: string, opts: { encoding?: 'base64' | 'utf8'; type?: string } = {}): void {
  const blob =
    opts.encoding === 'base64'
      ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: opts.type ?? 'application/octet-stream' })
      : new Blob([content], { type: opts.type ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Finish a save: download it when the backend returned content, and tell the user where it went. */
export function finishSave(r: SaveResult | null | undefined, what: string): void {
  if (!r) return;
  if (r.download) {
    downloadContent(r.download.name, r.download.content, { encoding: r.download.encoding, type: r.download.type });
    useApp.getState().toast(`${what} downloaded as ${r.download.name}`, 'success');
  } else if (r.path) useApp.getState().toast(`${what} saved to ${r.path}`, 'success');
}

/** Show HTML or text returned by the backend in a new browser tab (where there is no desktop shell). */
export function viewContent(v: { content: string; encoding: 'base64' | 'utf8'; type: string }): void {
  const bytes = v.encoding === 'base64' ? Uint8Array.from(atob(v.content), (c) => c.charCodeAt(0)) : new TextEncoder().encode(v.content);
  const url = URL.createObjectURL(new Blob([bytes], { type: v.type }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Let the user pick a text file in the browser; resolves with its name and content (null if cancelled). */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Whether this host has native open/save dialogs (desktop app); false in the browser / cloud. */
export function hasNativeDialogs(): boolean {
  return !!(useApp.getState().info as { nativeDialogs?: boolean } | undefined)?.nativeDialogs;
}
