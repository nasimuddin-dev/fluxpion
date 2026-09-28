import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnvSecretStore, WorkspaceManager, detectFormat, envNameForSecret } from '../../packages/core/src/index.js';

/** ProtoPion was called Protolens (and AI Protocol Studio before that): old names must keep working. */
describe('names from before the ProtoPion rename', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('reads secrets from PROTOPION_, PROTOLENS_ and APS_ variables, new name first', () => {
    expect(envNameForSecret('provider.openai.apiKey')).toBe('PROTOPION_SECRET_PROVIDER_OPENAI_APIKEY');
    expect(new EnvSecretStore({ PROTOLENS_SECRET_PROVIDER_OPENAI_APIKEY: 'old' }).get('provider.openai.apiKey')).toBe('old');
    expect(new EnvSecretStore({ APS_SECRET_PROVIDER_OPENAI_APIKEY: 'older' }).get('provider.openai.apiKey')).toBe('older');
    expect(new EnvSecretStore({ PROTOPION_SECRET_PROVIDER_OPENAI_APIKEY: 'new', PROTOLENS_SECRET_PROVIDER_OPENAI_APIKEY: 'old' }).get('provider.openai.apiKey')).toBe('new');
  });

  it('imports workspace exports made by Protolens', () => {
    const home = mkdtempSync(join(tmpdir(), 'pp-compat-'));
    dirs.push(home);
    const mgr = new WorkspaceManager(home);
    const s = mgr.create('Old');
    const bundle = s.exportBundle();
    s.close();
    const old = { ...bundle, format: 'protolens-workspace' as const };
    expect(detectFormat(JSON.stringify(old))).toBe('aps-workspace');
    const imported = mgr.importBundle(old, 'From Protolens');
    expect(imported.workspace.name).toBe('From Protolens');
    imported.close();
  });
});
