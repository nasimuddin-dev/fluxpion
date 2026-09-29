/** RPC handlers: App info, settings, logs and the Postman-style console. */
import {
  ApsError,
  checkTypes,
  ENGINE_VERSION,
  type AppSettings,
  defaultSettings,
} from '@testpion/core';
import type { Backend, Handlers } from '../backend.js';

export function appHandlers(be: Backend): Handlers {
  return {
    'app.info': () => ({
      version: ENGINE_VERSION,
      /** Native open/save dialogs (desktop). Without them (browser bridge, cloud) the UI uploads and downloads. */
      nativeDialogs: !!be.host.saveDialog && !!be.host.openDialog,
      platform: process.platform,
      appDir: be.host.appDir,
      secretBackend: be.secrets.kind,
      metaBackend: be.store?.meta.backend,
      checkTypes: checkTypes(),
      node: process.versions.node,
      electron: process.versions.electron,
    }),
    'settings.get': () => be.settings,
    'settings.save': (s: AppSettings) => {
      be.settings = be.manager.saveSettings({ ...defaultSettings(), ...s, telemetry: false });
      be.logger.setLevel(be.settings.logLevel);
      be.logger.redactor.setFields(be.settings.redactFields);
      return be.settings;
    },
    'logs.recent': () => be.logBuffer,
    'console.recent': () => be.consoleBuffer,
    'console.clear': () => {
      be.consoleBuffer = [];
    },
    'app.openExternal': ({ url }: { url: string }) => {
      if (!/^https?:\/\//.test(url)) throw new ApsError('ValidationError', 'Only http(s) URLs can be opened');
      return be.host.openExternal?.(url);
    },
    'app.openPath': ({ path }: { path: string }) => be.host.openPath?.(path),
  };
}
