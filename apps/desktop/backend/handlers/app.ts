/** RPC handlers: App info, settings, logs and the Postman-style console. */
import {
  ApsError,
  checkTypes,
  ENGINE_VERSION,
  type AppSettings,
  defaultSettings,
  getProxySettings,
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
      be.applyProxy();
      return be.settings;
    },
    /** The proxy password lives in the secret store, never in settings.json. */
    'settings.setProxyPassword': async ({ password }: { password: string }) => {
      if (password) await be.secrets.set('proxy.password', password);
      else await be.secrets.delete('proxy.password');
      be.applyProxy();
      return { saved: !!password };
    },
    'settings.proxyInfo': () => {
      // proxy URLs from the environment can carry credentials: never send those to the UI
      const clean = (v?: string) => v?.replace(/\/\/[^/@]*@/, '//•••@');
      const e = process.env;
      return { ...getProxySettings(), passwordSet: !!be.secrets.get('proxy.password'), env: { HTTP_PROXY: clean(e.HTTP_PROXY ?? e.http_proxy), HTTPS_PROXY: clean(e.HTTPS_PROXY ?? e.https_proxy), NO_PROXY: e.NO_PROXY ?? e.no_proxy } };
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
