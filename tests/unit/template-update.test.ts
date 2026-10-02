import { describe, it, expect, afterAll } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addTemplateAdditions, markTemplateInstalled, WorkspaceManager } from '@testpion/core';

// The examples workspace is copied once; a later version of the app adds what its examples gained, and never changes,
// overwrites or brings back anything in the user's copy.
const root = mkdtempSync(join(tmpdir(), 'tp-template-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (dir: string, rel: string, v: unknown) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const read = (dir: string, rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

function template(version: 1 | 2) {
  const t = join(root, `template-v${version}`);
  write(t, 'workspace.json', { schemaVersion: '1.0', id: 'ws-ex', name: 'Examples', updatedAt: '' });
  const items: unknown[] = [{ kind: 'folder', id: 'f1', name: 'Basics', items: [{ kind: 'http', id: 'r1', name: 'Get', request: { method: 'GET', url: 'https://a' } }] }];
  if (version === 2) {
    (items[0] as { items: unknown[] }).items.push({ kind: 'http', id: 'r2', name: 'Post', request: { method: 'POST', url: 'https://a' } });
    items.push({ kind: 'folder', id: 'f2', name: 'More', items: [{ kind: 'http', id: 'r3', name: 'Put', request: { method: 'PUT', url: 'https://a' } }] });
  }
  write(t, 'collections/basics.json', { schemaVersion: '1.0', id: 'basics', name: 'Basics', version: 1, variables: [], updatedAt: '', items });
  write(t, 'environments/public.json', { id: 'public', name: 'Public', variables: [{ key: 'a', value: '1', enabled: true }, ...(version === 2 ? [{ key: 'b', value: '2', enabled: true }] : [])] });
  write(t, 'mcp-servers.json', { schemaVersion: '1.0', servers: [{ id: 's1', name: 'One', transport: 'mock', mockFile: 'x' }, ...(version === 2 ? [{ id: 's2', name: 'Two', transport: 'streamable-http', url: 'https://b' }] : [])] });
  write(t, 'library/grpc.json', { schemaVersion: '1.0', folders: ['A'], items: [{ id: 'g1', name: 'G1', folder: 'A', data: {} }, ...(version === 2 ? [{ id: 'g2', name: 'G2', folder: 'B', data: {} }] : [])] });
  write(t, 'tests/all.suite.yaml', version === 1 ? 'name: All\ntests: [a.yaml]\n' : 'name: All\ntests: [a.yaml, b.yaml]\n');
  if (version === 2) {
    write(t, 'collections/new.json', { schemaVersion: '1.0', id: 'new', name: 'Brand new', version: 1, variables: [], updatedAt: '', items: [] });
    write(t, 'tests/b.yaml', 'tests: []\n');
  }
  return t;
}

describe('workspace template additions', () => {
  it('adds only what a newer template gained, keeps the user’s changes and deletions', () => {
    const appDir = join(root, 'app');
    const manager = new WorkspaceManager(appDir);
    const v1 = template(1);
    const info = manager.installTemplate(v1);
    expect(existsSync(join(info.path, '.template-offered.json'))).toBe(true);
    // the user edits, renames, adds and deletes
    const col = read(info.path, 'collections/basics.json');
    col.items[0].items[0].name = 'My renamed request';
    col.items.push({ kind: 'http', id: 'mine', name: 'Mine', request: { method: 'GET', url: 'https://me' } });
    write(info.path, 'collections/basics.json', col);
    const env = read(info.path, 'environments/public.json');
    env.variables[0].value = 'changed';
    write(info.path, 'environments/public.json', env);
    write(info.path, 'mcp-servers.json', { schemaVersion: '1.0', servers: [] }); // deleted server One
    write(info.path, 'tests/all.suite.yaml', 'name: All (mine)\n');

    // nothing new: nothing changes
    expect(addTemplateAdditions(v1, info.path)).toEqual([]);

    const added = addTemplateAdditions(template(2), info.path);
    expect(added).toEqual(
      expect.arrayContaining(['request "Post" in "Basics"', 'folder "More" in "Basics"', 'collection "Brand new"', 'variable {{b}} in "Public"', 'MCP server "Two"', '"G2"', 'tests/b.yaml']),
    );
    const after = read(info.path, 'collections/basics.json');
    expect(after.items.map((x: { id: string }) => x.id)).toEqual(['f1', 'mine', 'f2']);
    expect(after.items[0].items.map((x: { name: string }) => x.name)).toEqual(['My renamed request', 'Post']);
    expect(read(info.path, 'environments/public.json').variables).toEqual([
      { key: 'a', value: 'changed', enabled: true },
      { key: 'b', value: '2', enabled: true },
    ]);
    // the deleted server stays deleted; the new one comes in
    expect(read(info.path, 'mcp-servers.json').servers.map((s: { id: string }) => s.id)).toEqual(['s2']);
    const lib = read(info.path, 'library/grpc.json');
    expect(lib.folders).toEqual(['A', 'B']);
    expect(readFileSync(join(info.path, 'tests/all.suite.yaml'), 'utf8')).toBe('name: All (mine)\n');
    expect(existsSync(join(info.path, 'collections/new.json'))).toBe(true);

    // once offered, a deleted addition is not brought back
    rmSync(join(info.path, 'collections/new.json'));
    expect(addTemplateAdditions(template(2), info.path)).toEqual([]);
    expect(existsSync(join(info.path, 'collections/new.json'))).toBe(false);
  });

  it('a copy from before the ledger existed gets what it lacks', () => {
    const copy = join(root, 'legacy');
    cpSync(template(1), copy, { recursive: true });
    const added = addTemplateAdditions(template(2), copy);
    expect(added).toContain('collection "Brand new"');
    expect(added).toContain('MCP server "Two"');
    // and marks a fresh copy as fully offered
    const fresh = join(root, 'fresh');
    cpSync(template(2), fresh, { recursive: true });
    markTemplateInstalled(template(2), fresh);
    expect(addTemplateAdditions(template(2), fresh)).toEqual([]);
  });

  it('the bundled examples are complete for a fresh install', () => {
    const t = join(__dirname, '..', '..', 'examples', 'public-workspace');
    const appDir = join(root, 'app-real');
    const info = new WorkspaceManager(appDir).installTemplate(t);
    expect(addTemplateAdditions(t, info.path)).toEqual([]);
  });
});
