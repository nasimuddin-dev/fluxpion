import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, llmUsage } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-llmuse-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('LLM usage', () => {
  it('adds up tokens, cost and time per provider and model, most tokens first', () => {
    const store = WorkspaceStore.create(join(dir, 'ws'), 'AI');
    let n = 0;
    const run = (name: string, inputTokens: number, outputTokens: number, ms: number, costUsd?: number, firstTokenMs?: number) =>
      store.meta.addHistory({
        id: `h${++n}`,
        timestamp: `2026-10-01T00:00:0${n}.000Z`,
        kind: 'llm',
        name,
        status: 'ok',
        durationMs: ms,
        responseMeta: { usage: { inputTokens, outputTokens }, costUsd, firstTokenMs },
      });
    run('Claude · claude-sonnet-5-5', 100, 50, 900, 0.0012, 300);
    run('Claude · claude-sonnet-5-5', 200, 80, 1100, 0.002, 500);
    run('Ollama · llama3', 30, 20, 400);
    store.meta.addHistory({ id: 'old', timestamp: '2026-09-01T00:00:00.000Z', kind: 'llm', name: 'Ollama · llama3', status: 'ok', durationMs: 600 });
    expect(llmUsage(store)).toEqual([
      { provider: 'Claude', model: 'claude-sonnet-5-5', calls: 2, inputTokens: 300, outputTokens: 130, costUsd: 0.0032, medianMs: 900, medianFirstTokenMs: 300, lastAt: '2026-10-01T00:00:02.000Z' },
      { provider: 'Ollama', model: 'llama3', calls: 2, inputTokens: 30, outputTokens: 20, costUsd: undefined, medianMs: 400, medianFirstTokenMs: undefined, lastAt: '2026-10-01T00:00:03.000Z' },
    ]);
    store.close();
  });
});
