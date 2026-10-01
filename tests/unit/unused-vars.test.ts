import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { WorkspaceStore, referencedVariableNames } from '@testpion/core';

const dir = mkdtempSync(join(tmpdir(), 'tp-unused-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('referenced variables', () => {
  it('collects {{names}} and script reads from collections, libraries, variables and test files', () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'Vars');
    store.saveCollection({ schemaVersion: '1.0', id: 'c', name: 'C', version: 0, variables: [], updatedAt: '', items: [{ kind: 'http', id: 'r', name: 'R', request: { method: 'GET', url: '{{baseUrl}}/x' }, testScript: "pm.environment.get('token')" }] } as never);
    store.saveLibrary('grpc', { folders: [], items: [{ id: 'g', name: 'G', data: { target: '{{grpcHost}}' }, updatedAt: '' }] });
    store.saveEnvironment({ id: 'e', name: 'E', variables: [{ key: 'api', value: '{{host}}/api', enabled: true }] });
    store.writeTestFile('a.yaml', 'tests:\n  - name: t\n    type: http\n    request: { url: "{{fromTest}}" }\n');
    const used = referencedVariableNames(store);
    for (const n of ['baseUrl', 'token', 'grpcHost', 'host', 'fromTest']) expect(used.has(n)).toBe(true);
    expect(used.has('api')).toBe(false);
    store.close();
  });
});
