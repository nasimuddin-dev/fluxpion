import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSqliteDataset, readDataset, type DatasetRecord } from '@testpion/core';

const sqlite = (process as unknown as { getBuiltinModule?: (id: string) => { DatabaseSync: new (p: string) => { exec(s: string): void; close(): void } } | undefined }).getBuiltinModule?.('node:sqlite');

const all = async (src: Parameters<typeof readDataset>[0]) => {
  const out: DatasetRecord[] = [];
  for await (const r of readDataset(src)) out.push(r);
  return out;
};

describe.skipIf(!sqlite)('SQLite datasets', () => {
  let dir: string;
  let db: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tp-sqlite-'));
    db = join(dir, 'app.db');
    const d = new sqlite!.DatabaseSync(db);
    d.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, active INTEGER); INSERT INTO users (name, active) VALUES ('Ada', 1), ('Linus', 0), ('Grace', 1);");
    d.close();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the rows of a query, one record per row', async () => {
    expect(await all({ path: db, query: 'SELECT name, active FROM users ORDER BY id' })).toEqual([
      { name: 'Ada', active: 1 },
      { name: 'Linus', active: 0 },
      { name: 'Grace', active: 1 },
    ]);
    expect(isSqliteDataset(db)).toBe(true);
    expect(isSqliteDataset(join(dir, 'a.csv'))).toBe(false);
  });

  it('binds parameters and honours limit and offset', async () => {
    expect(await all({ path: db, query: 'SELECT name FROM users WHERE active = ? ORDER BY id', params: [1] })).toEqual([{ name: 'Ada' }, { name: 'Grace' }]);
    expect(await all({ path: db, query: 'SELECT name FROM users WHERE name = :n', params: { n: 'Linus' } })).toEqual([{ name: 'Linus' }]);
    expect(await all({ path: db, query: 'SELECT id FROM users ORDER BY id', offset: 1, limit: 1 })).toEqual([{ id: 2 }]);
  });

  it('only reads: writes and several statements are refused, and the database is read-only', async () => {
    await expect(all({ path: db, query: 'DELETE FROM users' })).rejects.toThrow(/one SELECT, WITH or VALUES/);
    await expect(all({ path: db, query: 'SELECT 1; DROP TABLE users' })).rejects.toThrow(/one SELECT/);
    await expect(all({ path: db, query: 'WITH x AS (SELECT 1) DELETE FROM users' })).rejects.toThrow(/readonly|read-only|query failed/i);
    expect(await all({ path: db, query: 'SELECT count(*) AS n FROM users' })).toEqual([{ n: 3 }]);
  });

  it('explains a missing query and a bad one', async () => {
    await expect(all({ path: db })).rejects.toThrow(/add a query/);
    await expect(all({ path: db, query: 'SELECT nope FROM users' })).rejects.toThrow(/query failed/);
  });
});

describe('CSV records', () => {
  it('keeps quoted line breaks, commas and quotes inside one record', async () => {
    const { csvRecords } = await import('@testpion/core');
    expect(csvRecords('id,body\r\n1,"line one\nline two, with ""quotes"""\r\n\r\n2,plain\n')).toEqual([
      ['id', 'body'],
      ['1', 'line one\nline two, with "quotes"'],
      ['2', 'plain'],
    ]);
  });
});
