/** RPC handlers: Tests, suites, evaluations, runs, baselines, traces and load tests. */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApsError,
  compareToBaseline,
  createBaseline,
  loadSuite,
  loadTestsFromFile,
  isSuiteFile,
  type LoadTestConfig,
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

    'load.start': (p: { config: LoadTestConfig; environment?: string }) => be.startLoad(p),
    'load.stop': ({ id }: { id: string }) => be.controllers.get(id)?.abort(),
  };
}
