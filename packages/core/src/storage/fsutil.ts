import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ApsError } from '../errors.js';

/**
 * End a write stream and wait until its file descriptor is closed. `end(cb)` only waits for 'finish'; the
 * fd is closed afterwards on the thread pool, and exiting the process in between aborts Node on Windows
 * ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)").
 */
export function endAndClose(stream: NodeJS.WritableStream & { closed?: boolean; once(ev: 'close' | 'error', fn: (...a: unknown[]) => void): unknown }): Promise<void> {
  return new Promise<void>((resolve) => {
    if (stream.closed) return resolve();
    stream.once('close', () => resolve());
    stream.once('error', () => resolve());
    stream.end();
  });
}

/** Atomic write: write a temp file, fsync, then rename over the target. A crash never leaves a half-written file. */
/**
 * Files this process wrote, and when (absolute path → ms): a folder watcher tells its own saves from changes made
 * outside the app (git pull, another editor) with `writtenByUs`.
 */
const recentWrites = new Map<string, number>();
export function writtenByUs(path: string, withinMs = 2000): boolean {
  const at = recentWrites.get(resolve(path));
  return at !== undefined && Date.now() - at < withinMs;
}

export function atomicWrite(path: string, data: string | Buffer): void {
  recentWrites.set(resolve(path), Date.now());
  if (recentWrites.size > 2000) for (const [k, t] of recentWrites) if (Date.now() - t > 10_000) recentWrites.delete(k);
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
  } finally {
    forgetText(path);
  }
}

/*
 * The text of JSON files already read, reused while a file's modification time and size are unchanged.
 * Workspace files (environments, collections, servers) are read again for every request sent and every
 * list shown; opening a file is the slow part (milliseconds each on Windows), checking it is not.
 * Only the text is kept: every read still parses, so callers get objects of their own to change.
 */
const textCache = new Map<string, { mtimeMs: number; size: number; text: string }>();
const TEXT_CACHE_MAX_BYTES = 64 * 1024 * 1024;
let textCacheBytes = 0;

function forgetText(path: string): void {
  const hit = textCache.get(path);
  if (!hit) return;
  textCache.delete(path);
  textCacheBytes -= hit.text.length;
}

function cachedText(path: string, mtimeMs: number, size: number): string {
  const hit = textCache.get(path);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.text;
  const text = readFileSync(path, 'utf8');
  forgetText(path);
  textCache.set(path, { mtimeMs, size, text });
  textCacheBytes += text.length;
  // oldest first (insertion order) until it fits again
  for (const [k, v] of textCache) {
    if (textCacheBytes <= TEXT_CACHE_MAX_BYTES || k === path) break;
    textCache.delete(k);
    textCacheBytes -= v.text.length;
  }
  return text;
}

export function writeJson(path: string, value: unknown): void {
  atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
}

/**
 * Read a JSON file. A file that fails to parse is treated as corrupted: it is preserved
 * as `<file>.corrupt-<timestamp>` for recovery and a descriptive error is thrown.
 */
export function readJson<T>(path: string, fallback?: T): T {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) {
    forgetText(path);
    if (fallback !== undefined) return fallback;
    throw new ApsError('ConfigurationError', `File not found: ${path}`);
  }
  const text = cachedText(path, stat.mtimeMs, stat.size);
  try {
    return JSON.parse(text.replace(/^﻿/, '')) as T;
  } catch (e) {
    forgetText(path);
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
