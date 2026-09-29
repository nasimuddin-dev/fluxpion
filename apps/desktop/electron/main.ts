import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell, nativeTheme } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Backend } from '../backend/backend.js';
import { canInstallInPlace, createUpdater } from './updater.js';
import { defaultAppDir, normalizeError } from '@testpion/core';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// pm.visualizer pages run on their own origin (tpviz://<id>/) with their own security policy, so their
// scripts (charts) never share the app's origin, storage or IPC bridge
protocol.registerSchemesAsPrivileged([{ scheme: 'tpviz', privileges: { standard: true, secure: true } }]);
let win: BrowserWindow | null = null;
let backend: Backend | null = null;

// Documentation screenshot mode (scripts/capture.cjs): isolated profile, fixed size, dark theme.
const capture = process.env.TESTPION_CAPTURE_SCRIPT;
if (capture) {
  app.setPath('userData', join(process.env.TESTPION_HOME!, 'electron-profile'));
  nativeTheme.themeSource = 'dark';
}

// Keep using the Electron profile of installs from before the TestPion name ("FluxPion" 0.5, "ProtoPion" 0.4, "Protolens" 0.2–0.3):
// it holds the safeStorage key that decrypts saved secrets, plus UI state such as open tabs.
if (!capture && !existsSync(join(app.getPath('appData'), 'TestPion'))) {
  const legacy = ['FluxPion', 'ProtoPion', 'Protolens'].map((n) => join(app.getPath('appData'), n)).find((d) => existsSync(d));
  if (legacy) app.setPath('userData', legacy);
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
    title: 'TestPion',
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
    dialog.showErrorBox('TestPion failed to start', `${(e as Error).message}

Data directory: ${process.env.TESTPION_HOME || defaultAppDir()}`);
    app.quit();
  }
});

function start(): void {
  const t0 = Date.now();
  backend = new Backend({
    appDir: process.env.TESTPION_HOME || defaultAppDir(),
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

  // updates live in the Electron process (not the shared backend, which also serves the browser bridge)
  const be = backend;
  const updater = createUpdater(emit, (level, message) => be.appLog(level, message));
  const baseInfo = backend.handlers['app.info']!;
  backend.handlers['app.info'] = async (p) => ({ ...((await baseInfo(p)) as object), appVersion: app.getVersion(), packaged: app.isPackaged, canUpdateInPlace: canInstallInPlace() });
  // every check and failure is logged, so "updates don't work" can be diagnosed from the Logs panel
  backend.handlers['update.check'] = async () => {
    try {
      const r = await updater.check();
      be.appLog('info', `Update check: running ${r.current}, ${r.version ? `${r.version} available` : 'up to date'}${r.installable ? '' : ' (this installation is updated by downloading the new version)'}`);
      return r;
    } catch (e) {
      be.appLog('error', `Update check failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  };
  backend.handlers['update.install'] = async () => {
    try {
      return await updater.install();
    } catch (e) {
      be.appLog('error', `Update install failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  };

  ipcMain.handle('aps:rpc', async (_e, method: string, params: unknown) => {
    try {
      return { ok: true, data: await backend!.invoke(method, params) };
    } catch (err) {
      // a plain object keeps kind and suggestions (IPC would reduce an Error to its message)
      return { ok: false, error: normalizeError(err) };
    }
  });
  ipcMain.handle('aps:startup', () => ({ backendMs: Date.now() - t0 }));

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'New Request Tab', accelerator: 'CmdOrCtrl+T', click: () => emit('tabs.command', { command: 'new' }) },
          { type: 'separator' },
          { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => emit('tabs.command', { command: 'close' }) },
          { label: 'Close Other Tabs', click: () => emit('tabs.command', { command: 'closeOthers' }) },
          { label: 'Close All Tabs', accelerator: 'CmdOrCtrl+Shift+W', click: () => emit('tabs.command', { command: 'closeAll' }) },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Alt+W' } : { role: 'quit', label: 'Exit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          { label: 'Check for Updates…', click: () => emit('update.checkManual', {}) },
          { type: 'separator' },
          { label: 'Documentation', click: () => void shell.openExternal('https://nasimuddin-dev.github.io/testpion/') },
          { label: 'Release Notes', click: () => void shell.openExternal('https://nasimuddin-dev.github.io/testpion/changelog') },
          { label: 'Report an Issue', click: () => void shell.openExternal('https://github.com/nasimuddin-dev/testpion/issues') },
        ],
      },
    ]),
  );
  protocol.handle('tpviz', (req) => {
    const page = be.visualizationPage(new URL(req.url).hostname);
    return new Response(page ?? 'This visualization is no longer available. Send the request again.', {
      status: page ? 200 : 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': Backend.VIZ_CSP, 'x-content-type-options': 'nosniff' },
    });
  });
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
