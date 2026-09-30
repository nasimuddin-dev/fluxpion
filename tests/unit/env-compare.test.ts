import { describe, expect, it } from 'vitest';
import { MemorySecretStore, compareEnvironments, secretKeys, type Environment } from '../../packages/core/src/index.js';

const staging: Environment = {
  id: 'staging',
  name: 'Staging',
  variables: [
    { key: 'baseUrl', value: 'https://staging.example.com', enabled: true },
    { key: 'timeoutMs', value: '5000', enabled: true },
    { key: 'apiKey', value: '', secret: true, enabled: true },
    { key: 'featureX', value: 'on', enabled: false },
    { key: 'debugToken', value: 'dbg-123', enabled: true },
    { key: 'onlyStaging', value: '1', enabled: true },
  ],
};
const production: Environment = {
  id: 'production',
  name: 'Production',
  variables: [
    { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
    { key: 'timeoutMs', value: '5000', enabled: true },
    { key: 'apiKey', value: '', secret: true, enabled: true },
    { key: 'featureX', value: 'on', enabled: true },
    { key: 'debugToken', value: 'dbg-999', enabled: true },
    { key: 'onlyProd', value: '1', enabled: true },
  ],
};

describe('compareEnvironments', () => {
  it('reports same, different, missing and disabled variables, statuses only by default', () => {
    const d = compareEnvironments(staging, production);
    const by = Object.fromEntries(d.rows.map((r) => [r.key, r]));
    expect(by.baseUrl!.status).toBe('different');
    expect(by.timeoutMs!.status).toBe('same');
    expect(by.featureX).toMatchObject({ status: 'different', disabledLeft: true });
    expect(by.onlyStaging!.status).toBe('only-left');
    expect(by.onlyProd!.status).toBe('only-right');
    expect(d.summary).toEqual({ same: 2, different: 3, onlyLeft: 1, onlyRight: 1 });
    // no values unless asked
    expect(JSON.stringify(d)).not.toContain('example.com');
  });

  it('compares secrets by their stored values without returning them, and masks sensitive keys', () => {
    const secrets = new MemorySecretStore();
    secrets.set(secretKeys.envVar('staging', 'apiKey'), 'sk-STAGING');
    let d = compareEnvironments(staging, production, { values: true, secrets });
    let apiKey = d.rows.find((r) => r.key === 'apiKey')!;
    expect(apiKey).toMatchObject({ status: 'different', secretLeft: true, secretRight: true, secretSetLeft: true, secretSetRight: false });
    secrets.set(secretKeys.envVar('production', 'apiKey'), 'sk-STAGING');
    d = compareEnvironments(staging, production, { values: true, secrets });
    apiKey = d.rows.find((r) => r.key === 'apiKey')!;
    expect(apiKey.status).toBe('same');
    const text = JSON.stringify(d);
    expect(text).not.toContain('sk-STAGING');
    expect(text).not.toContain('dbg-123'); // "debugToken" looks sensitive: masked even though not a secret
    expect(d.rows.find((r) => r.key === 'baseUrl')).toMatchObject({ left: 'https://staging.example.com', right: 'https://api.example.com' });
  });
});
