import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, setEnvironmentVariables, unsetEnvironmentVariables } from '../../packages/core/src/index.js';

describe('editing environment variables (CLI / agents)', () => {
  it('sets and removes plain variables, creates environments on request, refuses secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-envedit-'));
    const store = WorkspaceStore.create(join(dir, 'ws'), 'W');
    try {
      store.saveEnvironment({ id: 'dev', name: 'Dev', variables: [{ key: 'token', value: '', enabled: true, secret: true } as never, { key: 'a', value: '1', enabled: false }] } as never);
      const env = setEnvironmentVariables(store, 'dev', { a: '2', b: 'x' });
      expect(env.variables.map((v) => [v.key, v.value, v.enabled])).toEqual([
        ['token', '', true],
        ['a', '2', true],
        ['b', 'x', true],
      ]);
      expect(() => setEnvironmentVariables(store, 'Dev', { token: 'sk-1' })).toThrow(/secret variable/);
      expect(() => setEnvironmentVariables(store, 'QA', { a: '1' })).toThrow(/No environment "QA"/);
      expect(setEnvironmentVariables(store, 'QA', { a: '1' }, { create: true }).name).toBe('QA');
      expect(() => setEnvironmentVariables(store, 'QA', { 'bad key': '1' })).toThrow(/not a valid variable name/);
      expect(unsetEnvironmentVariables(store, 'Dev', ['b']).variables.map((v) => v.key)).toEqual(['token', 'a']);
      expect(() => unsetEnvironmentVariables(store, 'Dev', ['token'])).toThrow(/secret variable/);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
