import { describe, expect, it } from 'vitest';
import { agentsMarkdown, upsertAgentsMarkdown } from '../../packages/core/src/index.js';

describe('AGENTS.md', () => {
  const block = agentsMarkdown({ workspace: 'Pets', checkTypes: ['status', 'equals'] });

  it('describes the workspace, how to connect and the check types, with no machine paths', () => {
    expect(block).toMatch(/testpion mcp-server -w \./);
    expect(block).toMatch(/`status`, `equals`/);
    expect(block).toMatch(/^<!-- testpion:start/);
    expect(block.trimEnd()).toMatch(/<!-- testpion:end -->$/);
  });

  it('keeps what the user wrote and replaces only its own part', () => {
    expect(upsertAgentsMarkdown(undefined, block)).toBe(block);
    const mine = '# My project\n\nUse pnpm.\n';
    const first = upsertAgentsMarkdown(mine, block);
    expect(first.startsWith(mine.trimEnd())).toBe(true);
    const newer = agentsMarkdown({ workspace: 'Pets v2', checkTypes: ['status'] });
    const second = upsertAgentsMarkdown(`${first}\n## Notes\nkeep me\n`, newer);
    expect(second).toContain('Use pnpm.');
    expect(second).toContain('keep me');
    expect(second).toContain('Pets v2');
    expect(second).not.toContain('**Pets**');
    expect(second.match(/testpion:start/g)).toHaveLength(1);
  });
});
