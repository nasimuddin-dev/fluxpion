import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { extname } from 'node:path';
import { ApsError } from '../errors.js';
import { queryAll } from '../util/jsonpath.js';

export type DatasetRecord = Record<string, unknown>;

export interface DatasetSource {
  /** Local file (.jsonl, .ndjson, .json, .csv, .md). */
  path?: string;
  /** Remote JSON / JSONL (API response dataset). */
  url?: string;
  /** JSONPath to the array of records inside a JSON document. */
  recordsPath?: string;
  /** Inline records. */
  records?: DatasetRecord[];
  format?: 'jsonl' | 'json' | 'csv' | 'markdown';
  limit?: number;
  offset?: number;
}

/**
 * Stream dataset records without loading large files fully into memory.
 * JSONL and CSV are read line by line; JSON/Markdown are parsed whole (use JSONL for very large datasets).
 */
export async function* readDataset(src: DatasetSource): AsyncGenerator<DatasetRecord> {
  const limit = src.limit ?? Infinity;
  const offset = src.offset ?? 0;
  let i = 0;
  let emitted = 0;
  for await (const r of rawRecords(src)) {
    if (i++ < offset) continue;
    if (emitted >= limit) return;
    emitted++;
    yield r;
  }
}

function formatOf(src: DatasetSource): NonNullable<DatasetSource['format']> {
  if (src.format) return src.format;
  const ext = extname(src.path ?? new URL(src.url ?? 'http://x/a.json').pathname).toLowerCase();
  if (ext === '.jsonl' || ext === '.ndjson') return 'jsonl';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return 'json';
}

async function* rawRecords(src: DatasetSource): AsyncGenerator<DatasetRecord> {
  if (src.records) {
    yield* src.records;
    return;
  }
  const fmt = formatOf(src);
  if (src.url) {
    const res = await fetch(src.url);
    if (!res.ok) throw new ApsError('NetworkError', `Dataset URL returned HTTP ${res.status}`);
    const text = await res.text();
    yield* parseText(text, fmt, src.recordsPath);
    return;
  }
  if (!src.path) throw new ApsError('ConfigurationError', 'Dataset needs `path`, `url` or `records`');
  if (fmt === 'jsonl') {
    const rl = createInterface({ input: createReadStream(src.path, 'utf8'), crlfDelay: Infinity });
    let line = 0;
    for await (const l of rl) {
      line++;
      const t = l.trim();
      if (!t || t.startsWith('//')) continue;
      try {
        yield toRecord(JSON.parse(t));
      } catch (e) {
        throw new ApsError('ValidationError', `Invalid JSON on line ${line} of ${src.path}: ${(e as Error).message}`);
      }
    }
    return;
  }
  if (fmt === 'csv') {
    const rl = createInterface({ input: createReadStream(src.path, 'utf8'), crlfDelay: Infinity });
    const delim = src.path.endsWith('.tsv') ? '\t' : ',';
    let header: string[] | undefined;
    let pending = '';
    for await (const l of rl) {
      pending = pending ? `${pending}\n${l}` : l;
      // a record continues while quotes are unbalanced
      if ((pending.match(/"/g)?.length ?? 0) % 2 === 1) continue;
      const cells = parseCsvLine(pending, delim);
      pending = '';
      if (!header) {
        header = cells.map((c) => c.trim());
        continue;
      }
      if (cells.length === 1 && cells[0] === '') continue;
      const rec: DatasetRecord = {};
      header.forEach((h, idx) => (rec[h] = coerce(cells[idx] ?? '')));
      yield rec;
    }
    return;
  }
  const text = await readFile(src.path, 'utf8');
  yield* parseText(text, fmt, src.recordsPath);
}

function* parseText(text: string, fmt: string, recordsPath?: string): Generator<DatasetRecord> {
  if (fmt === 'jsonl') {
    for (const l of text.split(/\r?\n/)) if (l.trim()) yield toRecord(JSON.parse(l));
    return;
  }
  if (fmt === 'markdown') {
    yield* parseMarkdownTable(text);
    return;
  }
  if (fmt === 'csv') {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = parseCsvLine(lines[0] ?? '', ',');
    for (const l of lines.slice(1)) {
      const cells = parseCsvLine(l, ',');
      const rec: DatasetRecord = {};
      header.forEach((h, i) => (rec[h.trim()] = coerce(cells[i] ?? '')));
      yield rec;
    }
    return;
  }
  const data = JSON.parse(text);
  const arr = recordsPath ? queryAll(data, recordsPath).flat() : Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : Array.isArray(data?.data) ? data.data : [data];
  for (const r of arr) yield toRecord(r);
}

function toRecord(v: unknown): DatasetRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as DatasetRecord) : { input: v };
}

export function parseCsvLine(line: string, delim = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function coerce(s: string): unknown {
  const t = s.trim();
  if (t === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (/^[[{]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      /* keep string */
    }
  }
  return s;
}

function* parseMarkdownTable(md: string): Generator<DatasetRecord> {
  const rows = md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  if (rows.length < 2) return;
  const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const header = cells(rows[0]!);
  for (const r of rows.slice(1)) {
    if (/^\|?\s*:?-{2,}/.test(r)) continue;
    const c = cells(r);
    const rec: DatasetRecord = {};
    header.forEach((h, i) => (rec[h] = coerce(c[i] ?? '')));
    yield rec;
  }
}
