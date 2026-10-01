import { describe, expect, it } from 'vitest';
import { composeFeedback, maskReportText } from '../../packages/core/src/index.js';

describe('feedback reports', () => {
  it('masks home folders and secret-looking values', () => {
    const t = maskReportText('C:\\Users\\alice\\ws and /home/bob/ws, /Users/carol/x; Authorization: Bearer abcdefghijkl; password=hunter22; api_key: "k-123456"; eyJhbGciOi.eyJzdWIiOiJ4In0x.sig');
    for (const leak of ['alice', 'bob', 'carol', 'abcdefghijkl', 'hunter22', 'k-123456', 'eyJhbGciOi']) expect(t, t).not.toContain(leak);
    expect(t).toContain('~\\ws');
  });

  it('builds a titled Markdown report and a GitHub issue link with the right label', () => {
    const r = composeFeedback({ kind: 'ui', title: 'Load view is cramped', description: 'Hard to read', where: 'load', diagnostics: ['TestPion 1.0'] });
    expect(r.title).toBe('[UI] Load view is cramped');
    expect(r.labels).toEqual(['enhancement']);
    expect(r.body).toContain('**Where:** load');
    expect(r.body).toContain('- TestPion 1.0');
    const u = new URL(r.url);
    expect(u.pathname).toBe('/nasimuddin-dev/testpion/issues/new');
    expect(u.searchParams.get('title')).toBe(r.title);
    expect(u.searchParams.get('body')).toBe(r.body);
    expect(r.shortened).toBe(false);
  });

  it('adds steps for problems only, and shortens a report too long for a link', () => {
    const bug = composeFeedback({ kind: 'bug', title: 'x', description: 'y', steps: '1. open', expected: 'no crash' });
    expect(bug.body).toContain('### Steps');
    expect(composeFeedback({ kind: 'idea', title: 'x', description: 'y', steps: '1. open' }).body).not.toContain('### Steps');
    const long = composeFeedback({ kind: 'bug', title: 'x', description: 'z'.repeat(20000) });
    expect(long.shortened).toBe(true);
    expect(long.url.length).toBeLessThanOrEqual(7500);
    expect(long.body.length).toBeGreaterThan(20000);
  });
});
