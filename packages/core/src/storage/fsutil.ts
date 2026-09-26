import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ApsError } from '../errors.js';

/** Atomic write: write a temp file, fsync, then rename over the target. A crash never leaves a half-written file. */
export function atomicWrite(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function writeJson(path: string, value: unknown): void {
  atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
}

/**
 * Read a JSON file. A file that fails to parse is treated as corrupted: it is preserved
 * as `<file>.corrupt-<timestamp>` for recovery and a descriptive error is thrown.
 */
export function readJson<T>(path: string, fallback?: T): T {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new ApsError('ConfigurationError', `File not found: ${path}`);
  }
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text.replace(/^﻿/, '')) as T;
  } catch (e) {
    const backup = `${path}.corrupt-${Date.now()}`;
    try {
      renameSync(path, backup);
    } catch {
      /* ignore */
    }
    throw new ApsError('ValidationError', `Corrupted data detected in ${path}`, {
      why: `The file is not valid JSON (${(e as Error).message}).`,
      suggestions: [`The original was preserved at ${backup}.`, 'Restore it from version control or fix the JSON by hand.'],
    });
  }
}
