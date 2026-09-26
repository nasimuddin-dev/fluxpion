#!/usr/bin/env node
/**
 * Performance benchmark (SRS §54).
 *
 *   npm run bench                       # 10,000 HTTP tests, 100 workers
 *   npm run bench -- --tests 50000 --workers 200
 *
 * Reports total duration, tests/sec, p50/p95/p99, failures, peak memory and peak CPU,
 * plus dataset streaming throughput and large-JSON parse time. Everything runs locally.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, createWriteStream } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import {
  runTests,
  readDataset,
  ProviderRegistry,
  VariableScope,
  Redactor,
  McpManager,
  formatBytes,
} from '../packages/core/dist/index.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const TESTS = arg('tests', 10_000);
const WORKERS = arg('workers', 100);
const RECORDS = arg('records', 200_000);

// --- resource sampling -------------------------------------------------------
let peakRss = 0;
let peakCpu = 0;
let lastCpu = process.cpuUsage();
let lastT = performance.now();
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const now = performance.now();
  const c = process.cpuUsage(lastCpu);
  const pct = ((c.user + c.system) / 1000 / (now - lastT)) * 100;
  peakCpu = Math.max(peakCpu, pct);
  lastCpu = process.cpuUsage();
  lastT = now;
}, 100);

// --- target server (in-process, keep-alive) ----------------------------------
const body = JSON.stringify({ ok: true, items: [1, 2, 3] });
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/bench`;

const vars = new VariableScope();
const redactor = new Redactor();
const services = { vars, providers: new ProviderRegistry([], vars, redactor), mcp: new McpManager(() => undefined), mcpServers: [], redactor, pricing: [], defaultTimeoutMs: 30_000 };

async function* tests() {
  for (let i = 0; i < TESTS; i++)
    yield { id: `t${i}`, name: `bench ${i}`, type: 'http', request: { method: 'GET', url }, assertions: [{ type: 'status', expected: 200 }, { type: 'exists', path: '$.items[2]' }] };
}

const dir = mkdtempSync(join(tmpdir(), 'aps-bench-'));
console.log(`AI Protocol Studio benchmark — ${TESTS.toLocaleString()} HTTP tests, ${WORKERS} workers, ${cpus().length} CPUs, Node ${process.version}\n`);
const t0 = performance.now();
const s = await runTests({ name: 'bench', tests: tests(), concurrency: WORKERS, services, resultsFile: join(dir, 'results.jsonl'), traceMode: 'none' });
const dur = performance.now() - t0;

// --- dataset streaming ---------------------------------------------------------
const dsPath = join(dir, 'dataset.jsonl');
await new Promise((resolve) => {
  const w = createWriteStream(dsPath);
  for (let i = 0; i < RECORDS; i++) w.write(JSON.stringify({ id: i, input: `Customer message number ${i} about an appointment`, expected: i % 2 ? 'cancellation' : 'booking' }) + '\n');
  w.end(resolve);
});
const d0 = performance.now();
let n = 0;
for await (const _ of readDataset({ path: dsPath })) n++;
const dsMs = performance.now() - d0;

// --- large JSON --------------------------------------------------------------
const big = JSON.stringify({ items: Array.from({ length: 200_000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'] })) });
const j0 = performance.now();
JSON.parse(big);
const jsonMs = performance.now() - j0;

clearInterval(sampler);
server.close();
rmSync(dir, { recursive: true, force: true });

const rows = [
  ['Total duration', `${(dur / 1000).toFixed(2)} s`],
  ['Tests/sec', (s.total / (dur / 1000)).toFixed(0)],
  ['p50 latency', `${s.latency.p50} ms`],
  ['p95 latency', `${s.latency.p95} ms`],
  ['p99 latency', `${s.latency.p99} ms`],
  ['Failures', String(s.failed + s.errors)],
  ['Peak memory (RSS)', formatBytes(peakRss)],
  ['Peak CPU', `${peakCpu.toFixed(0)}% (of one core)`],
  ['Dataset streaming', `${n.toLocaleString()} records in ${(dsMs / 1000).toFixed(2)} s (${Math.round(n / (dsMs / 1000)).toLocaleString()} rec/s)`],
  ['Large JSON parse', `${formatBytes(big.length)} in ${jsonMs.toFixed(0)} ms`],
];
for (const [k, v] of rows) console.log(`${k.padEnd(20)} ${v}`);
process.exit(s.failed + s.errors ? 1 : 0);
