import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, nativeTheme } from 'electron';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Backend } from '../backend/backend.js';
import { defaultAppDir } from '@aps/core';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win: BrowserWindow | null = null;
let backend: Backend | null = null;

// Documentation screenshot mode (scripts/capture.cjs): isolated profile, fixed size, dark theme.
const capture = process.env.APS_CAPTURE_SCRIPT;
if (capture) {
  app.setPath('userData', join(process.env.APS_HOME!, 'electron-profile'));
  nativeTheme.themeSource = 'dark';
}

// Single instance — a second launch focuses the existing window.
if (!capture && !app.requestSingleInstanceLock()) app.quit();

function osBackendName(): string {
  if (process.platform === 'win32') return 'Windows DPAPI';
  if (process.platform === 'darwin') return 'macOS Keychain';
  const b = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
  return b ? `Linux ${b}` : 'Linux Secret Service';
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    // capture mode renders at an exact size even on small screens
    enableLargerThanScreen: !!capture,
    useContentSize: !!capture,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'AI Protocol Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => !capture && win?.show());
  win.webContents.on('did-finish-load', () => console.log('[aps] renderer loaded'));
  win.webContents.on('render-process-gone', (_e, d) => console.error(`[aps] renderer gone: ${d.reason} (exit ${d.exitCode})`));
  win.webContents.on('console-message', (e) => {
    const level = (e as unknown as { level?: string }).level;
    if (level === 'error' || level === 'warning') console.error(`[renderer ${level}] ${(e as unknown as { message: string }).message}`);
  });
  // never let the renderer navigate away or open windows; external links go to the OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isDev || !url.startsWith(process.env.VITE_DEV_SERVER_URL!)) e.preventDefault();
  });
  if (isDev) void win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else void win.loadFile(join(__dirname, '../dist/index.html'));
  if (capture) {
    const w = win;
    w.webContents.once('did-finish-load', () => {
      // runtime require of the capture steps (not bundled); only used when building docs screenshots
      const run = createRequire(__filename)(capture) as (win: BrowserWindow) => Promise<void>;
      run(w).then(
        () => app.quit(),
        (e: Error) => {
          console.error('[capture] failed:', e);
          app.exit(1);
        },
      );
    });
  }
}

function emit(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send('aps:event', channel, payload);
}

app.whenReady().then(() => {
  try {
    start();
  } catch (e) {
    // never fail silently with no window: show what went wrong
    dialog.showErrorBox('AI Protocol Studio failed to start', `${(e as Error).message}

Data directory: ${process.env.APS_HOME || defaultAppDir()}`);
    app.quit();
  }
});

function start(): void {
  const t0 = Date.now();
  backend = new Backend({
    appDir: process.env.APS_HOME || defaultAppDir(),
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
      backend: osBackendName(),
    },
    emit,
    openExternal: (url) => shell.openExternal(url),
    openPath: (p) => shell.openPath(p),
    saveDialog: async (opts) => (win ? (await dialog.showSaveDialog(win, opts)).filePath || undefined : undefined),
    openDialog: async (opts) => {
      if (!win) return undefined;
      const r = await dialog.showOpenDialog(win, { properties: [opts.directory ? 'openDirectory' : 'openFile'], filters: opts.filters });
      return r.canceled ? undefined : r.filePaths[0];
    },
  });

  ipcMain.handle('aps:rpc', async (_e, method: string, params: unknown) => {
    try {
      return { ok: true, data: await backend!.invoke(method, params) };
    } catch (err) {
      return { ok: false, error: err };
    }
  });
  ipcMain.handle('aps:startup', () => ({ backendMs: Date.now() - t0 }));

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      { role: 'windowMenu' },
      { role: 'help', submenu: [{ label: 'Documentation', click: () => void shell.openExternal('https://github.com/nasimuddin-dev/protolens#readme') }] },
    ]),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void backend?.dispose();
});
