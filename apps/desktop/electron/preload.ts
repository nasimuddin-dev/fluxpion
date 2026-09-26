import { contextBridge, ipcRenderer } from 'electron';

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

ipcRenderer.on('aps:event', (_e, channel: string, payload: unknown) => {
  for (const l of listeners.get(channel) ?? []) l(payload);
});

/** The only API exposed to the renderer: a narrow RPC + event bridge (no Node access). */
contextBridge.exposeInMainWorld('aps', {
  kind: 'electron',
  platform: process.platform,
  invoke: async (method: string, params?: unknown) => {
    const r = await ipcRenderer.invoke('aps:rpc', method, params);
    if (!r.ok) throw Object.assign(new Error(r.error?.message ?? 'Error'), r.error);
    return r.data;
  },
  on: (channel: string, cb: Listener) => {
    const set = listeners.get(channel) ?? listeners.set(channel, new Set()).get(channel)!;
    set.add(cb);
    return () => set.delete(cb);
  },
  startup: () => ipcRenderer.invoke('aps:startup'),
});
