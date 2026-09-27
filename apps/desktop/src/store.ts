import { toast as sonner } from 'sonner';
import { create } from 'zustand';
import type { AppSettings, WorkspaceCurrent } from './types';
import { call } from './api';

export type ViewId =
  | 'rest'
  | 'graphql'
  | 'websocket'
  | 'mcp'
  | 'ai'
  | 'evaluations'
  | 'tests'
  | 'load'
  | 'traces'
  | 'collections'
  | 'history'
  | 'environments'
  | 'settings';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface AssistantRequest {
  task: string;
  title: string;
  context: unknown;
  question?: string;
}

export interface DialogButton {
  id: string;
  label: string;
  variant?: 'primary' | 'default' | 'danger';
}

export interface DialogRequest {
  title: string;
  message: string;
  detail?: string;
  buttons: DialogButton[];
  cancelId: string;
  /** Show a text field; its value is passed to resolve. */
  input?: { value: string; placeholder?: string; multiline?: boolean };
  resolve(id: string, value?: string): void;
}

export interface ProgressState {
  title: string;
  message: string;
  /** 0..1, or null for indeterminate. */
  fraction: number | null;
}

/** Cross-view "open this thing" requests (e.g. history → REST tab, search → test file). */
export interface Intent {
  view: ViewId;
  payload: any;
  nonce: number;
}

interface AppState {
  view: ViewId;
  setView(v: ViewId): void;
  workspace?: WorkspaceCurrent;
  environment?: string;
  settings?: AppSettings;
  info?: { version: string; appVersion?: string; packaged?: boolean; canUpdateInPlace?: boolean; secretBackend: string; metaBackend?: string; platform: string; checkTypes: string[]; electron?: string; node?: string };
  paletteOpen: boolean;
  searchOpen: boolean;
  logsOpen: boolean;
  /** Which tab of the bottom panel is shown. */
  bottomTab: 'console' | 'logs';
  assistant?: AssistantRequest;
  toasts: Toast[];
  activity: Record<string, string>;
  intent?: Intent;
  mcpConnected: number;
  dialog?: DialogRequest;
  progress?: ProgressState | null;
  set(p: Partial<AppState>): void;
  toast(text: string, kind?: Toast['kind']): void;
  setActivity(key: string, label?: string): void;
  openIntent(view: ViewId, payload: any): void;
  refreshWorkspace(): Promise<void>;
  saveSettings(s: AppSettings): Promise<void>;
  setEnvironment(name?: string): void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  view: (localStorage.getItem('aps.view') as ViewId) || 'rest',
  setView: (view) => {
    localStorage.setItem('aps.view', view);
    set({ view });
  },
  paletteOpen: false,
  searchOpen: false,
  logsOpen: false,
  bottomTab: 'console',
  toasts: [],
  activity: {},
  mcpConnected: 0,
  set: (p) => set(p),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 7000 : 3500);
    (kind === 'error' ? sonner.error : kind === 'success' ? sonner.success : sonner)(text, { duration: kind === 'error' ? 7000 : 3500 });
  },
  setActivity: (key, label) => {
    const a = { ...get().activity };
    if (label) a[key] = label;
    else delete a[key];
    set({ activity: a });
  },
  openIntent: (view, payload) => {
    get().setView(view);
    set({ intent: { view, payload, nonce: Date.now() } });
  },
  refreshWorkspace: async () => {
    const ws = await call<WorkspaceCurrent>('ws.current');
    const stored = ws ? localStorage.getItem(`aps.env.${ws.id}`) : null;
    const env = ws?.environments.find((e) => e.name === (get().environment ?? stored)) ?? ws?.environments[0];
    set({ workspace: ws, environment: env?.name });
  },
  saveSettings: async (s) => {
    const saved = await call<AppSettings>('settings.save', s);
    set({ settings: saved });
  },
  setEnvironment: (name) => {
    const ws = get().workspace;
    if (ws && name) localStorage.setItem(`aps.env.${ws.id}`, name);
    set({ environment: name });
  },
}));

/** Persist per-view drafts in localStorage (UI state only — never secrets or responses). */
export function persisted<T>(key: string, fallback: T): { load(): T; save(v: T): void } {
  return {
    load() {
      try {
        const s = localStorage.getItem(`aps.draft.${key}`);
        return s ? (JSON.parse(s) as T) : fallback;
      } catch {
        return fallback;
      }
    },
    save(v: T) {
      try {
        localStorage.setItem(`aps.draft.${key}`, JSON.stringify(v));
      } catch {
        /* quota */
      }
    },
  };
}

/** Modal question with custom buttons; resolves with the chosen button id (or cancelId on Escape). */
export function ask(req: Omit<DialogRequest, 'resolve'>): Promise<string> {
  return new Promise((resolve) =>
    useApp.getState().set({
      dialog: {
        ...req,
        resolve: (id) => {
          useApp.getState().set({ dialog: undefined });
          resolve(id);
        },
      },
    }),
  );
}

/**
 * Ask for a line of text. Replaces window.prompt(), which Electron does not support (it returns null
 * without showing anything). Resolves with the trimmed text, or null when cancelled or left empty.
 */
export function promptText(title: string, opts: { message?: string; value?: string; placeholder?: string; okLabel?: string; detail?: string } = {}): Promise<string | null> {
  return new Promise((resolve) =>
    useApp.getState().set({
      dialog: {
        title,
        message: opts.message ?? '',
        detail: opts.detail,
        input: { value: opts.value ?? '', placeholder: opts.placeholder },
        buttons: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'ok', label: opts.okLabel ?? 'OK', variant: 'primary' },
        ],
        cancelId: 'cancel',
        resolve: (id, value) => {
          useApp.getState().set({ dialog: undefined });
          resolve(id === 'ok' && value?.trim() ? value.trim() : null);
        },
      },
    }),
  );
}
