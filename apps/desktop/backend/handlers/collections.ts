/** RPC handlers: Collections (requests, folders, examples, import/export) and their mock servers. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  ApsError,
  fetchImportText,
  importIntoWorkspace,
  diffOpenApi,
  startRecorder,
  recordingToCollection,
  type RecordedExchange,
  collectionToOpenApiText,
  exampleFromResponse,
  startMockServer,
  collectionMarkdown,
  collectionHtml,
  exportPostmanCollection,
  withRequestExamples,
  type SavedExample,
  convertCollectionScripts,
  importRequestSnippet,
  isRequestSnippet,
  type Collection,
} from '@testpion/core';
import type { Backend, Handlers, CollectionRunParams } from '../backend.js';

export function collectionsHandlers(be: Backend): Handlers {
  return {
    'col.list': () => be.ws.listCollections(),
    'col.save': (c: Collection) => {
      const r = be.ws.saveCollection(c);
      be.refreshMock(c.id);
      return r;
    },

    'mock.start': async ({ collectionId, port, delayMs, fallbackUrl }: { collectionId: string; port?: number; delayMs?: number; fallbackUrl?: string }) => {
      await be.mocks.get(collectionId)?.close();
      be.mocks.delete(collectionId);
      const c = be.ws.getCollection(collectionId);
      if (fallbackUrl && !/^https?:\/\/.+/i.test(fallbackUrl.trim())) throw new ApsError('ValidationError', 'The fallback must be an http(s) URL');
      const m = await startMockServer(c, { port: port ?? 0, delayMs, fallbackUrl: fallbackUrl?.trim() || undefined, onRequest: (e) => be.host.emit('mock.request', { collectionId, ...e, time: new Date().toISOString() }) });
      be.mocks.set(collectionId, m);
      be.logger.info(`Mock server for ${c.name} listening on ${m.url}`, { routes: m.routes.length });
      return be.mockInfo(collectionId);
    },
    'mock.stop': async ({ collectionId }: { collectionId: string }) => {
      await be.mocks.get(collectionId)?.close();
      be.mocks.delete(collectionId);
    },
    'mock.status': ({ collectionId }: { collectionId: string }) => be.mockInfo(collectionId),
    'col.delete': ({ id }: { id: string }) => {
      void be.mocks.get(id)?.close();
      be.mocks.delete(id);
      return be.ws.deleteCollection(id);
    },
    /** Save a response as an example of a saved request (sensitive headers and values are masked). */
    'col.addExample': (p: { collectionId: string; requestId: string; name: string; environment?: string; response: Parameters<typeof exampleFromResponse>[0]; request?: SavedExample['request'] }) => {
      const ctx = be.context({ environment: p.environment, collectionId: p.collectionId });
      const example = exampleFromResponse(p.response, { name: p.name, redactor: ctx.redactor, request: p.request });
      const c = withRequestExamples(be.ws.getCollection(p.collectionId), p.requestId, (list) => [...list, example]);
      be.ws.saveCollection(c);
      be.refreshMock(p.collectionId);
      return example;
    },
    /** Markdown documentation of a collection (the given draft, or the saved one), with secrets masked. */
    'col.docs': ({ id, collection, environment }: { id?: string; collection?: Collection; environment?: string }) => {
      const c = collection ?? be.ws.getCollection(id!);
      const ctx = be.context({ environment, collectionId: collection ? undefined : c.id });
      try {
        return collectionMarkdown(c, { redactor: ctx.redactor });
      } finally {
        void ctx.dispose();
      }
    },
    /** The documentation as a self-contained HTML page, saved through the host (or downloaded in a browser). */
    'col.exportDocsHtml': async ({ id, collection, environment }: { id?: string; collection?: Collection; environment?: string }) => {
      const c = collection ?? be.ws.getCollection(id!);
      const ctx = be.context({ environment, collectionId: collection ? undefined : c.id });
      try {
        const html = collectionHtml(c, { redactor: ctx.redactor });
        const name = `${c.name.replace(/[\\/:*?"<>|]+/g, '-')}.html`;
        return await be.saveOrDownload(name, [{ name: 'HTML', extensions: ['html'] }], (dest) => writeFileSync(dest, html), () => Buffer.from(html));
      } finally {
        await ctx.dispose();
      }
    },
    /** Replace a saved request's examples (rename, edit, delete). */
    'col.setExamples': (p: { collectionId: string; requestId: string; examples: SavedExample[] }) => {
      be.ws.saveCollection(withRequestExamples(be.ws.getCollection(p.collectionId), p.requestId, () => p.examples));
      be.refreshMock(p.collectionId);
      return p.examples;
    },
    /** Rewrite a collection's scripts between tp.* and pm.*; `dryRun` only counts. */
    'col.convertScripts': ({ collectionId, to, dryRun }: { collectionId: string; to: 'tp' | 'pm'; dryRun?: boolean }) => {
      const c = be.ws.getCollection(collectionId);
      const r = convertCollectionScripts(c, to === 'tp' ? 'pm' : 'tp', to);
      if (!dryRun && r.changed) be.ws.saveCollection(r.collection);
      return { changed: r.changed, replacements: r.replacements, skipped: r.skipped, collection: dryRun ? r.collection : undefined };
    },
    'col.import': ({ text, fileName }: { text: string; fileName?: string }) => {
      // ".env.staging" / "staging.env" → "staging"; a bare ".env" keeps the default name
      const envName = fileName ? fileName.replace(/^\.env\.?/, '').replace(/\.env$/, '') || undefined : undefined;
      if (isRequestSnippet(text)) {
        // a copied cURL / fetch / PowerShell request goes into the "Imported" collection; secrets become {{variables}}
        const r = importRequestSnippet(be.ws.listCollections().filter((c) => !c.problem), text, be.logger.redactor);
        const saved = be.ws.saveCollection(r.collection);
        return { format: r.format, collection: saved.name, collectionId: saved.id, request: r.node.name, placeholders: r.placeholders };
      }
      // an OpenAPI document is kept in specs/ and its requests get an openapi contract check
      // .env imports: secret-looking values go to the OS secret store, never into workspace files
      const r = importIntoWorkspace(be.ws, text, { name: envName, secrets: be.secrets });
      return { format: r.format, collection: r.collection?.name, environment: r.environments?.map((e) => e.name).join(', ') || r.environment?.name, specPath: r.specPath, contractChecks: r.contractChecks, scriptWarnings: r.scriptWarnings };
    },
    /** Record traffic: a reverse proxy on 127.0.0.1 in front of `target`; every exchange is sent as a `record.exchange` event. */
    'record.start': async ({ target, port }: { target: string; port?: number }) => {
      await be.recorder?.close();
      const summary = (e: RecordedExchange) => ({ id: e.id, time: e.time, method: e.method, path: be.logger.redactor.redactUrl(`http://x${e.path}`).slice(8), status: e.status, durationMs: e.durationMs, error: e.error });
      be.recorder = await startRecorder({ target, port, onExchange: (e) => be.host.emit('record.exchange', summary(e)) });
      return { url: be.recorder.url, target: be.recorder.target };
    },
    'record.stop': async () => {
      await be.recorder?.close();
      const n = be.recorder?.exchanges.length ?? 0;
      return { exchanges: n };
    },
    'record.status': () => (be.recorder ? { url: be.recorder.url, target: be.recorder.target, exchanges: be.recorder.exchanges.length } : null),
    /** Save what was recorded as a collection (secrets become {{variables}}; responses become examples). */
    'record.save': ({ name }: { name: string }) => {
      if (!be.recorder?.exchanges.length) throw new ApsError('ValidationError', 'Nothing recorded yet');
      const r = recordingToCollection(be.recorder.exchanges, { name: name.trim() || 'Recorded', target: be.recorder.target, redactor: be.logger.redactor });
      const saved = be.ws.saveCollection(r.collection);
      return { collectionId: saved.id, name: saved.name, requests: r.requests, placeholders: r.placeholders.map((p) => p.variable) };
    },
    'record.clear': () => void be.recorder?.exchanges.splice(0),
    /** OpenAPI documents kept in the workspace (specs/), for comparing versions. */
    'openapi.specs': () => {
      const dir = be.ws.path('specs');
      return existsSync(dir) ? readdirSync(dir).filter((f) => /\.(json|ya?ml)$/i.test(f)).map((f) => `specs/${f}`) : [];
    },
    /** Breaking and other changes between two OpenAPI versions; each side is a workspace path, a link or the text. */
    'openapi.diff': async ({ old, new: next }: { old: { path?: string; url?: string; text?: string }; new: { path?: string; url?: string; text?: string } }) => {
      const read = async (s: { path?: string; url?: string; text?: string }) =>
        s.text ?? (s.url ? (await fetchImportText(s.url)).text : s.path ? readFileSync(be.ws.safePath(s.path), 'utf8') : '');
      return diffOpenApi(await read(old), await read(next));
    },
    /** Import from a link: an OpenAPI URL, a raw GitHub file, a Postman API link … (downloaded, then imported as text). */
    'col.importUrl': async ({ url }: { url: string }) => {
      const f = await fetchImportText(url);
      return { ...((await be.handlers['col.import']!({ text: f.text, fileName: f.fileName })) as object), url: f.url };
    },
    'col.importFile': async () => {
      const f = await be.host.openDialog?.({ filters: [{ name: 'API definitions, collections and .env files', extensions: ['json', 'yaml', 'yml', 'har', 'env'] }, { name: 'All files', extensions: ['*'] }] });
      if (!f) return null;
      return be.handlers['col.import']!({ text: readFileSync(f, 'utf8'), fileName: basename(f) });
    },
    'col.run': (p: CollectionRunParams) => be.startCollectionRun(p),
    /**
     * A data file uploaded from the browser (no native file picker): it is stored in the workspace's
     * datasets/uploads folder and previewed like a picked file.
     */
    'col.uploadDataFile': async ({ name, text }: { name: string; text: string }) => {
      if (text.length > 50 * 1024 * 1024) throw new ApsError('ValidationError', 'The data file is larger than 50 MB');
      const safe = basename(name).replace(/[^\w.-]+/g, '_').slice(0, 120) || 'data.csv';
      if (!/\.(csv|json|jsonl)$/i.test(safe)) throw new ApsError('ValidationError', 'Use a .csv, .json or .jsonl file');
      const dir = be.ws.path('datasets', 'uploads');
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, safe);
      writeFileSync(dest, text);
      return be.handlers['col.previewDataFile']!({ path: dest });
    },
    /** Pick a CSV/JSON data file for a collection run; returns a preview of its rows. */
    'col.pickDataFile': async () => {
      const f = await be.host.openDialog?.({ filters: [{ name: 'Data files', extensions: ['csv', 'json', 'jsonl'] }] });
      return f ? be.handlers['col.previewDataFile']!({ path: f }) : null;
    },
    'col.previewDataFile': async ({ path }: { path: string }) => {
      const rows = await be.readRunData(path);
      const columns = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))];
      return { path, name: basename(path), count: rows.length, columns, preview: rows.slice(0, 20) };
    },
    /** Export a collection as TestPion JSON or a Postman v2.1 collection (`notes` lists what Postman can't hold). */
    'col.export': async ({ id, format = 'testpion' }: { id: string; format?: 'testpion' | 'postman' | 'openapi' }) => {
      const c = be.ws.getCollection(id);
      if (format === 'openapi') {
        // an OpenAPI 3.1 description of the collection's HTTP requests (YAML)
        const text = collectionToOpenApiText(c);
        const name = `${c.name}.openapi.yaml`;
        const dest = await be.host.saveDialog?.({ defaultPath: name, filters: [{ name: 'OpenAPI', extensions: ['yaml', 'yml'] }] });
        if (dest) writeFileSync(dest, text);
        return { path: dest, text: dest ? undefined : text, name, notes: [] as string[] };
      }
      const { collection, notes } = format === 'postman' ? exportPostmanCollection(c) : { collection: c as unknown as Record<string, unknown>, notes: [] as string[] };
      const name = format === 'postman' ? `${c.name}.postman_collection.json` : `${c.name}.collection.json`;
      const dest = await be.host.saveDialog?.({ defaultPath: name, filters: [{ name: 'Collection', extensions: ['json'] }] });
      if (dest) writeFileSync(dest, JSON.stringify(collection, null, 2));
      return { path: dest, collection: dest ? undefined : collection, name, notes };
    },
  };
}
