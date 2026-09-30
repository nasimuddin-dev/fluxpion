import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager } from '../../packages/core/src/index.js';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('settings', () => {
  it('forgets workspaces that were in the temp folder and are gone, but keeps other missing ones', () => {
    dir = mkdtempSync(join(tmpdir(), 'tp-settings-'));
    const existing = mkdtempSync(join(tmpdir(), 'tp-live-ws-'));
    const goneTemp = join(tmpdir(), 'tp-import-gone', 'shop');
    const offline = 'Z:\\work\\api-tests';
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ workspacePaths: [goneTemp, existing, offline] }));
    try {
      expect(new WorkspaceManager(dir).loadSettings().workspacePaths).toEqual([existing, offline]);
    } finally {
      rmSync(existing, { recursive: true, force: true });
    }
  });
});
