import { describe, expect, it } from 'vitest';
import { compareSnapshot, runChecks } from '@testpion/core';

const snap = { id: 7, name: 'Rex', tags: ['a'], owner: { email: 'a@b.c', phone: null }, items: [{ sku: 'x', price: 1.5, updatedAt: '2026-01-01' }] };

describe('snapshot comparison', () => {
  it('shape: values may change, fields and types may not', () => {
    expect(compareSnapshot(snap, { ...snap, id: 9, name: 'Max', items: [{ sku: 'y', price: 2, updatedAt: 'now' }, { sku: 'z', price: 3, updatedAt: 'now' }] })).toEqual([]);
    expect(compareSnapshot(snap, { ...snap, id: '9', owner: { phone: '1' }, items: [{ sku: 'y', price: 2 }] })).toEqual([
      { path: '$.id', kind: 'type', expected: 'number', actual: 'string' },
      { path: '$.owner.email', kind: 'missing', expected: 'a@b.c' },
      { path: '$.items[0].updatedAt', kind: 'missing', expected: '2026-01-01' },
    ]);
  });

  it('values: the same values and array lengths too', () => {
    expect(compareSnapshot(snap, snap, { mode: 'values' })).toEqual([]);
    expect(compareSnapshot(snap, { ...snap, name: 'Max', tags: ['a', 'b'] }, { mode: 'values' })).toEqual([
      { path: '$.name', kind: 'value', expected: 'Rex', actual: 'Max' },
      { path: '$.tags', kind: 'length', expected: 1, actual: 2 },
    ]);
  });

  it('ignores paths, with [*], * and .. wildcards; strict reports new fields', () => {
    const changed = { ...snap, id: 8, items: [{ sku: 'x', price: 1.5, updatedAt: 'later' }], extra: true };
    expect(compareSnapshot(snap, changed, { mode: 'values', ignore: ['$.id', '$.items[*].updatedAt'] })).toEqual([]);
    expect(compareSnapshot(snap, changed, { mode: 'values', ignore: ['$.id', '$..updatedAt'] })).toEqual([]);
    expect(compareSnapshot(snap, changed, { mode: 'values', ignore: ['$.*'] })).toEqual([]);
    expect(compareSnapshot(snap, changed, { strict: true })).toEqual([{ path: '$.extra', kind: 'extra', actual: true }]);
  });
});

describe('snapshot check', () => {
  it('passes or lists the differences', async () => {
    const ctx = { testType: 'http' as const, status: 200, body: { ...snap, id: 'x' }, text: '' };
    const [bad] = await runChecks([{ type: 'snapshot', expected: snap }], ctx);
    expect(bad!.passed).toBe(false);
    expect(bad!.message).toBe('1 difference from the snapshot: $.id is string, was number');
    const [ok] = await runChecks([{ type: 'snapshot', expected: snap, ignore: ['$.id'] }], ctx);
    expect(ok!.passed).toBe(true);
    const [none] = await runChecks([{ type: 'snapshot' }], ctx);
    expect(none!.message).toMatch(/no snapshot stored/);
  });
});
