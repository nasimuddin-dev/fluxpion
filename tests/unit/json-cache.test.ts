import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson } from '../../packages/core/src/storage/fsutil.js';

// readJson keeps a file's text while its modification time and size are unchanged (opening files is the
// slow part of preparing a request). It must never serve stale content or share objects between callers.
const dir = mkdtempSync(join(tmpdir(), 'tp-json-cache-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('readJson cache', () => {
  it('gives every caller its own object', () => {
    const f = join(dir, 'a.json');
    writeJson(f, { list: [1] });
    const a = readJson<{ list: number[] }>(f);
    a.list.push(2);
    expect(readJson<{ list: number[] }>(f)).toEqual({ list: [1] });
  });

  it('sees a write through writeJson straight away, even of the same size', () => {
    const f = join(dir, 'b.json');
    writeJson(f, { v: 'one' });
    expect(readJson(f)).toEqual({ v: 'one' });
    writeJson(f, { v: 'two' });
    expect(readJson(f)).toEqual({ v: 'two' });
  });

  it('sees a file changed by another program (git, an editor)', () => {
    const f = join(dir, 'c.json');
    writeJson(f, { v: 1 });
    expect(readJson(f)).toEqual({ v: 1 });
    writeFileSync(f, '{"v":22}');
    expect(readJson(f)).toEqual({ v: 22 });
    // same size, later modification time
    writeFileSync(f, '{"v":33}');
    const later = new Date(Date.now() + 5000);
    utimesSync(f, later, later);
    expect(readJson(f)).toEqual({ v: 33 });
  });

  it('a deleted file gives the fallback again', () => {
    const f = join(dir, 'd.json');
    writeJson(f, { v: 1 });
    expect(readJson(f, { v: 0 })).toEqual({ v: 1 });
    rmSync(f);
    expect(readJson(f, { v: 0 })).toEqual({ v: 0 });
  });
});
