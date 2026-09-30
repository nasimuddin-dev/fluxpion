import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager, WorkspaceStore } from '../../packages/core/src/index.js';

describe('workspace library (saved items with folders)', () => {
  it('saves items and folders per kind, keeps empty folders, and adds folders items refer to', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-lib-'));
    const store = WorkspaceStore.create(dir, 'lib');
    try {
      expect(store.getLibrary('websocket')).toMatchObject({ folders: [], items: [] });
      const saved = store.saveLibrary('websocket', {
        folders: ['Empty folder'],
        items: [
          { id: 'a', name: 'Echo', folder: 'Local', data: { url: 'ws://127.0.0.1:4013' } },
          { id: '', name: '', data: { url: 'wss://x' } },
        ],
      });
      expect(saved.folders).toEqual(['Empty folder', 'Local']);
      expect(saved.items[1]!.id).toMatch(/^lib-/);
      expect(saved.items[1]!.name).toBe('Untitled');
      expect(store.getLibrary('websocket').items.map((i) => i.name)).toEqual(['Echo', 'Untitled']);
      expect(store.getLibrary('ai-prompts').items).toEqual([]);
      expect(() => store.getLibrary('../secrets')).toThrow(/Invalid library kind/);

      // workspace export / import carries the saved items and folders
      const bundle = store.exportBundle();
      expect(Object.keys(bundle.library ?? {})).toEqual(['websocket']);
      const imported = new WorkspaceManager(join(dir, 'app')).importBundle(bundle, 'copy');
      try {
        expect(imported.getLibrary('websocket')).toMatchObject({ folders: ['Empty folder', 'Local'], items: [{ id: 'a', name: 'Echo', folder: 'Local' }, { name: 'Untitled' }] });
      } finally {
        imported.close();
      }
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
