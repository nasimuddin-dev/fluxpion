import { describe, expect, it } from 'vitest';
import { MemorySecretStore, environmentMatrix, secretKeys, type Environment } from '../../packages/core/src/index.js';

describe('environment matrix', () => {
  it('shows each variable as set, empty, missing or off per environment, incomplete first, never values', () => {
    const dev: Environment = {
      id: 'dev',
      name: 'Dev',
      variables: [
        { key: 'baseUrl', value: 'http://localhost', enabled: true },
        { key: 'token', value: '', enabled: true, secret: true },
        { key: 'debug', value: '1', enabled: true },
      ],
    } as Environment;
    const prod: Environment = {
      id: 'prod',
      name: 'Prod',
      variables: [
        { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
        { key: 'token', value: '', enabled: true, secret: true },
        { key: 'debug', value: '', enabled: true },
        { key: 'region', value: 'eu', enabled: false },
      ],
    } as Environment;
    const secrets = new MemorySecretStore();
    secrets.set(secretKeys.envVar('prod', 'token'), 's3cret');
    const m = environmentMatrix([dev, prod], { secrets });
    expect(m.environments).toEqual(['Dev', 'Prod']);
    expect(m.rows.map((r) => [r.key, r.cells.map((c) => c.state + (c.secret ? '*' : '')).join(','), r.incompleteIn.join('|'), r.differs])).toEqual([
      ['region', 'missing,disabled', 'Dev|Prod', false],
      ['debug', 'set,empty', 'Prod', false],
      ['token', 'empty*,set*', 'Dev', false],
      ['baseUrl', 'set,set', '', true],
    ]);
    expect(m.incomplete).toBe(3);
    expect(JSON.stringify(m)).not.toContain('s3cret');
    expect(JSON.stringify(m)).not.toContain('api.example.com');
  });
});
