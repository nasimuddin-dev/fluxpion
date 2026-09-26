import { bridge, call, on } from './api';
import { ask, useApp } from './store';

const SKIP_KEY = 'aps.update.skip';
const MB = 1024 * 1024;

interface UpdateCheckResult {
  current: string;
  version: string | null;
  notes: string;
  installable: boolean;
  url: string;
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the check simply runs again next time */
  }
}

/** First paragraph or so of the release notes, as plain text. */
export function summarise(notes: string): string {
  const text = notes
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.length > 500 ? text.slice(0, 500).replace(/\s+\S*$/, '') + '…' : text;
}

/** Downloads, verifies and installs the update; the app restarts into the new version. */
async function install(version: string): Promise<void> {
  const { set, toast } = useApp.getState();
  set({ progress: { title: `Updating to ${version}`, message: 'Downloading the update…', fraction: null } });
  const off = on<{ downloaded: number; total: number | null; installing?: boolean }>('update.progress', (p) => {
    const message = p.installing
      ? 'Verifying and installing… Protolens will restart.'
      : `Downloading the update… ${(p.downloaded / MB).toFixed(1)}${p.total ? ` of ${(p.total / MB).toFixed(1)}` : ''} MB`;
    useApp.getState().set({ progress: { title: `Updating to ${version}`, message, fraction: p.total && !p.installing ? p.downloaded / p.total : null } });
  });
  try {
    await call('update.install');
    // the app quits while the installer runs; if it doesn't, keep the dialog up briefly
  } catch (e) {
    toast(`Protolens ${version} couldn't be installed; your current version is unchanged. ${(e as Error).message ?? ''}`.trim(), 'error');
    set({ progress: null });
  } finally {
    setTimeout(off, 60_000);
  }
}

/**
 * Checks GitHub for a newer release and asks the user what to do.
 * `manual` reports "up to date" and errors, and ignores a previously skipped version.
 */
export async function checkForUpdates({ manual }: { manual: boolean }): Promise<'available' | 'current' | 'error' | 'unsupported'> {
  const { toast } = useApp.getState();
  if (bridge.kind !== 'electron') {
    if (manual) toast('Updates are only available in the desktop app.');
    return 'unsupported';
  }
  let found: UpdateCheckResult;
  try {
    found = await call<UpdateCheckResult>('update.check');
  } catch {
    if (manual) toast("Couldn't check for updates. Check your internet connection and try again.", 'error');
    return 'error';
  }
  if (!found.version) {
    if (manual) toast(`You're up to date. Protolens ${found.current} is the latest version.`, 'success');
    return 'current';
  }
  if (!manual && load(SKIP_KEY) === found.version) return 'available';

  const notes = summarise(found.notes);
  const choice = await ask({
    title: 'Update available',
    message: `Protolens ${found.version} is available. You have ${found.current}.`,
    detail:
      (notes ? notes + '\n\n' : '') +
      (found.installable
        ? 'Update now to download and install it. The download is verified, then it replaces your current version; your workspaces, settings and secrets are kept, and the app restarts.'
        : 'Download the new version and install it over this one; your workspaces, settings and secrets are kept.'),
    buttons: [
      { id: 'skip', label: 'Skip This Version' },
      { id: 'later', label: 'Later' },
      { id: 'install', label: found.installable ? 'Update Now' : 'Download', variant: 'primary' },
    ],
    cancelId: 'later',
  });
  if (choice === 'skip') store(SKIP_KEY, found.version);
  if (choice === 'install') {
    if (found.installable) await install(found.version);
    else await call('app.openExternal', { url: found.url }).catch((e: Error) => toast(`Couldn't open the download page: ${e.message}`, 'error'));
  }
  return 'available';
}

/** Checks once each time the desktop app starts (after startup settles), when enabled in Settings. */
export function scheduleUpdateCheck(): void {
  if (bridge.kind !== 'electron') return;
  const s = useApp.getState();
  if (s.settings?.checkForUpdates === false || !s.info?.packaged) return;
  setTimeout(() => void checkForUpdates({ manual: false }), 5000);
}
