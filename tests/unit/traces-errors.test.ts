import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMetaStore } from '../../packages/core/src/index.js';

describe('traces: errors only', () => {
  it('lists only the traces that ended in an error, with the other filters still applied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-traces-'));
    try {
      const m = openMetaStore(dir);
      const add = (id: string, kind: string, status: string) => m.addTrace({ id, name: `t${id}`, kind, status, startTime: Number(id), durationMs: 1, spanCount: 1, path: `${id}.json` });
      add('1', 'http', 'ok');
      add('2', 'http', 'error');
      add('3', 'test', 'error');
      add('4', 'test', 'ok');
      expect(m.listTraces({ failed: true }).items.map((t) => t.id)).toEqual(['3', '2']);
      expect(m.listTraces({ failed: true, kind: 'http' }).items.map((t) => t.id)).toEqual(['2']);
      expect(m.listTraces({}).total).toBe(4);
      m.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
