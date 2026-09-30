import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { MAX_IMPORT_BYTES, WorkspaceStore, fetchImportText, importIntoWorkspace, rawImportUrl } from '../../packages/core/src/index.js';

const OPENAPI = 'openapi: 3.0.0\ninfo: { title: Pets, version: "1" }\npaths:\n  /pets:\n    get: { responses: { "200": { description: ok } } }\n';
const COLLECTION = { info: { name: 'Shared', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'Ping', request: { method: 'GET', url: 'https://example.test/ping' } }] };

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/specs/openapi.yaml') return res.writeHead(200, { 'content-type': 'application/yaml' }).end(OPENAPI);
    if (req.url === '/moved') return res.writeHead(302, { location: '/specs/openapi.yaml' }).end();
    if (req.url === '/api/collections/1') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ collection: COLLECTION }));
    if (req.url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!DOCTYPE html><html><body>hi</body></html>');
    if (req.url === '/huge') {
      // no content-length: the limit applies while reading
      res.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = Buffer.alloc(1024 * 1024, 'a');
      for (let i = 0; i <= MAX_IMPORT_BYTES / chunk.length; i++) res.write(chunk);
      return res.end();
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe('import from a link', () => {
  it('turns GitHub / GitLab / Bitbucket file pages into raw links', () => {
    expect(rawImportUrl('https://github.com/acme/api/blob/main/spec/openapi.yaml')).toBe('https://raw.githubusercontent.com/acme/api/main/spec/openapi.yaml');
    expect(rawImportUrl('https://gitlab.com/acme/api/-/blob/main/openapi.json')).toBe('https://gitlab.com/acme/api/-/raw/main/openapi.json');
    expect(rawImportUrl('https://bitbucket.org/acme/api/src/main/openapi.json')).toBe('https://bitbucket.org/acme/api/raw/main/openapi.json');
    expect(rawImportUrl('https://petstore3.swagger.io/api/v3/openapi.json')).toBe('https://petstore3.swagger.io/api/v3/openapi.json');
  });

  it('downloads (following redirects) and imports like a file', async () => {
    const f = await fetchImportText(`${base}/moved`);
    expect(f).toMatchObject({ text: OPENAPI, fileName: 'openapi.yaml', url: `${base}/specs/openapi.yaml` });
    const dir = mkdtempSync(join(tmpdir(), 'tp-importurl-'));
    const store = WorkspaceStore.create(join(dir, 'ws'), 'W');
    try {
      expect(importIntoWorkspace(store, f.text).collection?.name).toBe('Pets');
      // a Postman API link: {"collection": {...}} is unwrapped
      const shared = await fetchImportText(`${base}/api/collections/1`);
      expect(importIntoWorkspace(store, shared.text)).toMatchObject({ format: 'postman', collection: { name: 'Shared' } });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says what went wrong', async () => {
    await expect(fetchImportText('not a link')).rejects.toThrow(/is not a URL/);
    await expect(fetchImportText('file:///etc/passwd')).rejects.toThrow(/Only http and https/);
    await expect(fetchImportText(`${base}/nope`)).rejects.toThrow(/answered HTTP 404/);
    await expect(fetchImportText(`${base}/page`)).rejects.toThrow(/opens a web page/);
    await expect(fetchImportText(`${base}/huge`)).rejects.toThrow(/larger than 20 MB/);
    await expect(fetchImportText('http://127.0.0.1:1/x')).rejects.toThrow(/Couldn't download/);
  });
});
