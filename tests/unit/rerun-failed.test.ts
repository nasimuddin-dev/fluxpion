import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, streamTests } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'rerun-'));
const store = WorkspaceStore.create(dir, 'r');
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('re-run failed tests', () => {
  it('reads the failed and errored ids of a run and filters tests by id', async () => {
    const runDir = store.runDir('run-1');
    mkdirSync(runDir, { recursive: true });
    const lines = [
      { id: 'a:ok', status: 'passed' },
      { id: 'a:bad', status: 'failed' },
      { id: 'a:boom', status: 'error' },
      { id: 'a:skip', status: 'skipped' },
    ];
    writeFileSync(join(runDir, 'results.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"partial');
    expect(store.failedTestIds('run-1')).toEqual({ runId: 'run-1', ids: ['a:bad', 'a:boom'] });
    expect(() => store.failedTestIds('run-missing')).toThrow(/No results/);
    writeFileSync(join(dir, 'tests', 'a.yaml'), 'tests:\n  - { name: ok, type: http, request: { url: "http://x" } }\n  - { name: bad, type: http, request: { url: "http://x" } }\n  - { name: boom, type: http, request: { url: "http://x" } }\n');
    const names: string[] = [];
    for await (const t of streamTests(['.'], join(dir, 'tests'), { ids: ['a:bad', 'a:boom'] })) names.push(t.name);
    expect(names).toEqual(['bad', 'boom']);
  });
});
