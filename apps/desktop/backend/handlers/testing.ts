/** RPC handlers: Tests, suites, evaluations, runs, baselines, traces and load tests. */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApsError,
  compareToBaseline,
  createBaseline,
  loadSuite,
  loadTestsFromFile,
  isSuiteFile,
  ciConfig,
  type CiConfigOptions,
  type LoadTestConfig,
  exportOtlp,
} from '@testpion/core';
import type { Backend, Handlers, EvalRunParams } from '../backend.js';

export function testingHandlers(be: Backend): Handlers {
  return {
    'tests.tree': () => be.ws.testTree(),
    'tests.read': ({ path }: { path: string }) => be.ws.readTestFile(path),
    'tests.write': ({ path, content }: { path: string; content: string }) => be.ws.writeTestFile(path, content),
    'tests.delete': ({ path }: { path: string }) => be.ws.deleteTestFile(path),
    'tests.preview': async ({ path }: { path: string }) => {
      const out: Array<{ id?: string; name: string; type: string; tags?: string[] }> = [];
      const abs = join(be.ws.path('tests'), path);
      if (isSuiteFile(abs)) return { suite: await loadSuite(abs), tests: [] };
      for await (const t of loadTestsFromFile(abs)) {
        out.push({ id: t.id, name: t.name, type: t.type, tags: t.tags });
        if (out.length >= 500) break;
      }
      return { tests: out };
    },
    /** A CI pipeline (GitHub Actions, GitLab CI, Azure Pipelines, Jenkins) for a suite, collection or test files. */
    'ci.config': (o: CiConfigOptions) => ciConfig(be.ws, o),
    'ci.save': (o: CiConfigOptions) => {
      const c = ciConfig(be.ws, o);
      const name = c.path.split('/').pop()!;
      return be.saveOrDownload(name, undefined, (dest) => writeFileSync(dest, c.content), () => Buffer.from(c.content));
    },
    'tests.run': (p: { paths: string[]; environment?: string; concurrency?: number; retries?: number; name?: string; grep?: string; tags?: string[] }) => be.startTestRun(p),
    'eval.run': (p: EvalRunParams) => be.startEvalRun(p),
    'runs.cancel': ({ runId }: { runId: string }) => be.runs.get(runId)?.ctrl.abort(),
    'runs.list': (q: { query?: string; limit?: number; offset?: number }) => be.ws.meta.listRuns(q),
    'runs.summary': ({ runId }: { runId: string }) => {
      const f = join(be.ws.runDir(runId), 'summary.json');
      return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    },
    'runs.results': (q: { runId: string; offset?: number; limit?: number; status?: string; query?: string }) => be.pageResults(q),
    'runs.openReport': ({ runId, format }: { runId: string; format: 'html' | 'markdown' | 'junit' | 'json' }) => {
      const file = { html: 'report.html', markdown: 'report.md', junit: 'junit.xml', json: 'report.json' }[format];
      const p = join(be.ws.runDir(runId), file);
      if (!existsSync(p)) throw new ApsError('ConfigurationError', 'Report not found');
      if (be.host.openPath) {
        void be.host.openPath(p);
        return { path: p };
      }
      // no desktop shell (browser, cloud): the UI shows the report itself
      return { path: p, view: { name: file, content: readFileSync(p).toString('base64'), encoding: 'base64', type: format === 'html' ? 'text/html' : 'text/plain' } };
    },
    'runs.exportReport': async ({ runId, format }: { runId: string; format: 'html' | 'markdown' | 'junit' | 'json' }) => {
      const file = { html: 'report.html', markdown: 'report.md', junit: 'junit.xml', json: 'report.json' }[format];
      const src = join(be.ws.runDir(runId), file);
      return be.saveOrDownload(file, undefined, (dest) => copyFileSync(src, dest), () => readFileSync(src));
    },
    'baselines.list': () => be.ws.listBaselines(),
    'baselines.save': async ({ runId, name }: { runId: string; name: string }) => {
      const summary = await be.handlers['runs.summary']!({ runId });
      const b = await createBaseline(name, summary as never, be.results(runId));
      be.ws.saveBaseline(b);
      return { name, tests: Object.keys(b.tests).length };
    },
    'baselines.compare': async ({ runId, name, thresholds }: { runId: string; name: string; thresholds?: { latencyPct: number; tokensPct: number; scoreDrop: number } }) => {
      const summary = await be.handlers['runs.summary']!({ runId });
      return compareToBaseline(be.ws.getBaseline(name), summary as never, be.results(runId), thresholds);
    },

    'traces.list': (q: { query?: string; kind?: string; limit?: number; offset?: number }) => be.ws.meta.listTraces(q),
    'traces.get': ({ id }: { id: string }) => be.ws.loadTrace(id),
    /** Send traces to an OpenTelemetry collector (OTLP/HTTP JSON). Header values may use {{variables}} (e.g. a secret API key). */
    'traces.exportOtlp': async ({ ids, endpoint, headers, environment }: { ids: string[]; endpoint: string; headers?: Array<{ key: string; value: string; enabled?: boolean }>; environment?: string }) => {
      if (!ids?.length) throw new ApsError('ValidationError', 'No traces to send');
      const ctx = be.context({ environment });
      try {
        const traces = ids.slice(0, 2000).map((id) => be.ws.loadTrace(id)).filter((t): t is NonNullable<typeof t> => !!t);
        const h = Object.fromEntries(ctx.vars.resolveDeep(headers ?? []).filter((x) => x.key && x.enabled !== false).map((x) => [x.key, x.value]));
        return await exportOtlp(traces, { endpoint: ctx.vars.resolve(endpoint), headers: h }, { redactor: ctx.redactor, resource: { 'testpion.workspace': be.ws.workspace.name } });
      } finally {
        await ctx.dispose();
      }
    },

    'load.start': (p: { config: LoadTestConfig; environment?: string; collection?: { collectionId: string; selection?: string[]; warmUp?: boolean } }) => be.startLoad(p),
    'load.stop': ({ id }: { id: string }) => be.controllers.get(id)?.abort(),
  };
}
