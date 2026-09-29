import { describe, it, expect } from 'vitest';
import { Redactor, diffResponses, redactDiff } from '../../packages/core/src/index.js';

const json = (v: unknown) => JSON.stringify(v);

describe('response history: comparing two responses', () => {
  it('lists JSON changes by path, and flags status and real header changes', () => {
    const before = { status: 200, durationMs: 120, headers: [['content-type', 'application/json'], ['date', 'Mon'], ['x-version', '1']] as Array<[string, string]>, body: json({ total: 2, items: [{ id: 1, name: 'Rex' }, { id: 2, name: 'Tom' }], meta: { page: 1 } }) };
    const after = { status: 201, durationMs: 90, headers: [['content-type', 'application/json'], ['date', 'Tue'], ['x-version', '2'], ['x-new', 'y']] as Array<[string, string]>, body: json({ total: 3, items: [{ id: 1, name: 'Rex!' }, { id: 2, name: 'Tom' }, { id: 3, name: 'Kit' }], meta: {}, extra: true }) };
    const d = diffResponses(before, after);
    expect(d.different).toBe(true);
    expect(d.status).toEqual({ before: 200, after: 201, changed: true });
    expect(d.durationMs.deltaMs).toBe(-30);
    expect(d.body.format).toBe('json');
    expect(d.body.changes).toEqual([
      { path: '$.total', kind: 'changed', before: 2, after: 3 },
      { path: '$.items[0].name', kind: 'changed', before: 'Rex', after: 'Rex!' },
      { path: '$.items[2]', kind: 'added', after: { id: 3, name: 'Kit' } },
      { path: '$.meta.page', kind: 'removed', before: 1 },
      { path: '$.extra', kind: 'added', after: true },
    ]);
    expect(d.headers.map((h) => `${h.name}:${h.kind}:${h.volatile}`)).toEqual(['date:changed:true', 'x-new:added:false', 'x-version:changed:false']);
    expect(d.summary).toBe('status 200 → 201, 5 body changes, 2 header changes');
  });

  it('treats responses that differ only in volatile headers as identical', () => {
    const a = { status: 200, headers: [['date', 'Mon']] as Array<[string, string]>, body: json({ ok: true }) };
    const b = { status: 200, headers: [['date', 'Tue']] as Array<[string, string]>, body: json({ ok: true }) };
    const d = diffResponses(a, b);
    expect(d.different).toBe(false);
    expect(d.body.identical).toBe(true);
    expect(d.summary).toMatch(/Identical/);
  });

  it('diffs text bodies by line, reports type changes, and caps large diffs', () => {
    const t = diffResponses({ status: 200, body: 'a\nb\nc' }, { status: 200, body: 'a\nB\nc\nd' });
    expect(t.body.format).toBe('text');
    expect(t.body.lines).toEqual([{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'B' }, { op: ' ', text: 'c' }, { op: '+', text: 'd' }]);
    expect(diffResponses({ body: json({ v: '1' }) }, { body: json({ v: 1 }) }).body.changes).toEqual([{ path: '$.v', kind: 'type', before: '1', after: 1 }]);
    const many = diffResponses({ body: json(Array.from({ length: 50 }, (_, i) => i)) }, { body: json(Array.from({ length: 50 }, (_, i) => i + 1)) }, { maxChanges: 10 });
    expect(many.body.changes).toHaveLength(10);
    expect(many.body.truncated).toBe(true);
    expect(diffResponses({ body: json({ 'a-b': 1 }) }, { body: json({ 'a-b': 2 }) }).body.changes[0]!.path).toBe('$["a-b"]');
  });

  it('masks sensitive values for agents and CLI output', () => {
    const d = diffResponses(
      { status: 200, headers: [['authorization', 'Bearer a1']], body: JSON.stringify({ user: { token: 'tok-A', name: 'Ann' }, list: [{ password: 'p1' }] }) },
      { status: 200, headers: [['authorization', 'Bearer b2']], body: JSON.stringify({ user: { token: 'tok-B', name: 'Bob' }, list: [{ password: 'p2' }], added: { apiKey: 'k-1' } }) },
    );
    const r = redactDiff({ diff: d }, new Redactor());
    const text = JSON.stringify(r);
    for (const secret of ['tok-A', 'tok-B', 'p1', 'p2', 'k-1', 'a1', 'b2']) expect(text).not.toContain(secret);
    expect(r.diff.body.changes.find((c) => c.path === '$.user.name')).toMatchObject({ before: 'Ann', after: 'Bob' });
  });
});
