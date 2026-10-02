import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, findCommittableSecrets, installPreCommitHook, type Collection } from '@testpion/core';

// GIT-104: secrets typed into a workspace are found before a commit would publish them.
const root = mkdtempSync(join(tmpdir(), 'tp-guard-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('secret guard', () => {
  it('finds typed-in secrets, and not secret variables or {{references}}', () => {
    const store = WorkspaceStore.create(join(root, 'ws'), 'Guard');
    store.saveCollection({
      schemaVersion: '1.0',
      id: 'api',
      name: 'API',
      version: 0,
      updatedAt: '',
      variables: [{ key: 'apiKey', value: 'k-123', enabled: true }],
      items: [
        { kind: 'http', id: 'r1', name: 'Typed', request: { method: 'GET', url: 'https://x', headers: [{ key: 'Authorization', value: 'Bearer abc', enabled: true }] } },
        { kind: 'http', id: 'r2', name: 'Referenced', request: { method: 'GET', url: 'https://x', headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] } },
      ],
    } as Collection);
    store.saveEnvironment({ id: 'dev', name: 'Dev', variables: [{ key: 'password', value: 'p', enabled: true }, { key: 'token', value: '', enabled: true, secret: true }, { key: 'baseUrl', value: 'https://x', enabled: true }] });
    const found = findCommittableSecrets(store);
    const where = found.map((f) => f.where);
    expect(where.some((w) => w.includes('Typed'))).toBe(true);
    expect(where.some((w) => w.includes('Referenced'))).toBe(false);
    expect(where).toContain('collection API, variable apiKey');
    expect(where).toContain('environment Dev, variable password');
    expect(where.some((w) => /token|baseUrl/.test(w))).toBe(false);
    store.close();
  });

  it('installs a pre-commit hook, never over someone else’s', () => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    const ws = join(repo, 'api-tests');
    mkdirSync(ws);
    expect(installPreCommitHook(join(root, 'no-repo'))).toMatchObject({ installed: false });
    const r = installPreCommitHook(ws, '"node" "/x/testpion.js"');
    expect(r.installed).toBe(true);
    const hook = readFileSync(join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook).toMatch(/testpion-secret-guard/);
    expect(hook).toMatch(/git check -w 'api-tests'/);
    expect(hook).toMatch(/"node" "\/x\/testpion\.js"/);
    // again: TestPion's own hook is updated
    expect(installPreCommitHook(ws).installed).toBe(true);
    // someone else's hook is left alone
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nnpm test\n');
    const other = installPreCommitHook(ws);
    expect(other.installed).toBe(false);
    expect(other.message).toMatch(/already exists/);
    expect(readFileSync(join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe('#!/bin/sh\nnpm test\n');
    expect(existsSync(join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true);
  });
});
