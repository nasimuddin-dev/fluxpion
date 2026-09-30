import { asError, call } from './api';
import { promptText, useApp } from './store';
import { downloadContent, hasNativeDialogs } from './lib/files';
import { uid } from './lib/format';

/**
 * Commands of the application menu (File ▸ New, Import, Export …) and the command palette. The menu
 * lives in the desktop shell and sends a command name; everything here runs through RPC, so the same
 * commands work in the browser version (from the palette).
 */
export type MenuCommand =
  | 'new-http'
  | 'new-graphql'
  | 'new-grpc'
  | 'new-websocket'
  | 'new-mcp-server'
  | 'new-collection'
  | 'new-monitor'
  | 'new-environment'
  | 'new-workspace'
  | 'open-workspace'
  | 'import'
  | 'export-collection'
  | 'export-environment'
  | 'export-workspace'
  | 'save'
  | 'settings';

const toastError = (e: unknown) => useApp.getState().toast(asError(e).message, 'error');

export async function runMenuCommand(cmd: MenuCommand): Promise<void> {
  const s = useApp.getState();
  try {
    switch (cmd) {
      case 'new-http':
        return s.openIntent('rest', { newTab: true });
      case 'new-graphql':
        return s.setView('graphql');
      case 'new-grpc':
        return s.setView('grpc');
      case 'new-websocket':
        return s.setView('websocket');
      case 'new-mcp-server':
        return s.openIntent('mcp', { addServer: true });
      case 'new-collection': {
        const name = await promptText('New collection', { message: 'Collection name', placeholder: 'My API', okLabel: 'Create' });
        if (!name) return;
        const id = uid('col-');
        await call('col.save', { schemaVersion: '1.0', id, name, version: 0, variables: [], items: [], updatedAt: '' });
        return s.openIntent('collections', { collectionId: id });
      }
      case 'new-monitor':
        return s.openIntent('monitors', { create: { collectionId: '' } });
      case 'new-environment': {
        const name = await promptText('New environment', { message: 'Environment name', value: 'Staging', okLabel: 'Create' });
        if (!name) return;
        const env = { id: uid('env-'), name, variables: [{ key: 'baseUrl', value: '', enabled: true }] };
        await call('env.save', { env });
        await s.refreshWorkspace();
        return s.openIntent('environments', { environmentId: env.id });
      }
      case 'new-workspace': {
        const name = await promptText('New workspace', { message: 'Workspace name', placeholder: 'My API tests', okLabel: 'Create' });
        if (!name) return;
        await call('ws.create', { name });
        await s.refreshWorkspace();
        s.toast(`Created and opened workspace "${name}"`, 'success');
        return s.setView('home');
      }
      case 'open-workspace': {
        if (hasNativeDialogs()) await call('ws.open', {});
        else {
          const path = await promptText('Open workspace folder', { message: 'Path of a folder that contains workspace.json', placeholder: 'e.g. D:/work/api-tests', okLabel: 'Open' });
          if (!path) return;
          await call('ws.open', { ref: path });
        }
        return void (await s.refreshWorkspace());
      }
      case 'import':
        return s.openIntent('collections', { import: true });
      case 'export-collection':
        return s.openIntent('collections', { export: 'postman' });
      case 'export-environment': {
        const env = s.workspace?.environments.find((e) => e.name === s.environment);
        if (!env) return s.toast('Select an environment first (top bar), then export it.', 'error');
        const r = await call<{ path?: string; environment?: unknown; name: string }>('env.export', { id: env.id });
        if (r.environment) downloadContent(r.name, JSON.stringify(r.environment, null, 2), { type: 'application/json' });
        return s.toast(r.path ? `Exported "${env.name}" to ${r.path} (secret values are never exported)` : `Exported "${env.name}" (secret values are never exported)`, 'success');
      }
      case 'export-workspace': {
        const ws = s.workspace;
        if (!ws) return;
        const r = await call<{ path?: string; bundle?: unknown }>('ws.export', { ref: ws.path });
        if (r.bundle) downloadContent(`${ws.name}.apsworkspace.json`, JSON.stringify(r.bundle, null, 2), { type: 'application/json' });
        if (r.bundle || r.path) s.toast('Workspace exported (secret values are never exported)', 'success');
        return;
      }
      case 'save':
        // the active view saves on Ctrl/Cmd+S; the menu accelerator takes the key, so pass it on
        return void window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, metaKey: navigator.platform.startsWith('Mac'), bubbles: true }));
      case 'settings':
        return s.setView('settings');
    }
  } catch (e) {
    toastError(e);
  }
}
