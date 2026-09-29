import { existsSync, mkdtempSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { Command, CommanderError, Option } from 'commander';
import {
  ApsError,
  ChainSecretStore,
  EnvSecretStore,
  Logger,
  McpSession,
  WorkspaceManager,
  WorkspaceStore,
  compareToBaseline,
  consoleSink,
  createBaseline,
  createEngineContext,
  formatBytes,
  formatDuration,
  importAny,
  importRequestSnippet,
  isRequestSnippet,
  Redactor,
  CookieJar,
  cookiesFromJson,
  startMockServer,
  collectionMarkdown,
  serveTestPionMcp,
  ENGINE_VERSION,
  exportPostmanCollection,
  exportPostmanEnvironment,
  type MockServer,
  loadSuite,
  normalizeError,
  readResultsFile,
  runLoadTest,
  runTests,
  runCollection,
  readDataset,
  shortId,
  streamTests,
  writeReports,
  loadTestsFromFile,
  isSuiteFile,
  DEFAULT_THRESHOLDS,
  type LoadSnapshot,
  type ReportFormat,
  type RunSummary,
  type Collection,
  type CollectionNode,
  type Environment,
  type DatasetRecord,
  type RunEvent,
  type TestCase,
  type TestResult,
  type McpServerConfig,
} from '@testpion/core';

/** Exit codes (spec §37). */
export const EXIT = { SUCCESS: 0, TEST_FAILURE: 1, CONFIG_ERROR: 2, EXECUTION_ERROR: 3 } as const;

const tty = process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c(32);
const red = c(31);
const yellow = c(33);
const dim = c(2);
const bold = c(1);
const cyan = c(36);

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

function collectVar(v: string, prev: Record<string, string> = {}): Record<string, string> {
  const i = v.indexOf('=');
  if (i <= 0) throw new CliError(`--var expects key=value, got "${v}"`, EXIT.CONFIG_ERROR);
  return { ...prev, [v.slice(0, i)]: v.slice(i + 1) };
}

function findWorkspaceUp(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'workspace.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

function openWorkspace(ref: string | undefined, hintPath: string | undefined, mgr: WorkspaceManager): { store: WorkspaceStore; ephemeral?: string } {
  if (ref) {
    const p = mgr.resolve(ref) ?? (existsSync(join(resolve(ref), 'workspace.json')) ? resolve(ref) : undefined);
    if (!p) throw new CliError(`Workspace "${ref}" not found. Known: ${mgr.list().map((w) => w.name).join(', ') || 'none'}`, EXIT.CONFIG_ERROR);
    return { store: WorkspaceStore.open(p) };
  }
  const found = findWorkspaceUp(hintPath ?? process.cwd());
  if (found) return { store: WorkspaceStore.open(found) };
  // no workspace: run in an ephemeral one (providers resolve from OPENAI_API_KEY / ANTHROPIC_API_KEY / mock)
  const tmp = mkdtempSync(join(tmpdir(), 'aps-ephemeral-'));
  return { store: WorkspaceStore.create(tmp, 'ephemeral'), ephemeral: tmp };
}

function printResult(r: TestResult, verbose: boolean): void {
  const icon = r.status === 'passed' ? green('✓') : r.status === 'skipped' ? yellow('○') : red('✗');
  const meta = [r.latencyMs !== undefined ? `${Math.round(r.latencyMs)}ms` : `${r.durationMs}ms`, r.tokens ? `${r.tokens.totalTokens} tok` : '', r.attempts > 1 ? `${r.attempts} attempts` : ''].filter(Boolean).join(', ');
  console.log(`  ${icon} ${r.name} ${dim(`(${meta})`)}`);
  if (r.status === 'skipped' && r.metadata?.reason) console.log(dim(`      skipped: ${r.metadata.reason}`));
  if (r.error) {
    console.log(red(`      ${r.error.kind}: ${r.error.message}`));
    if (r.error.why && r.error.why !== r.error.message) console.log(dim(`      why: ${r.error.why}`));
    for (const s of r.error.suggestions.slice(0, 3)) console.log(dim(`      → ${s}`));
  }
  for (const ch of r.checks) {
    if (ch.passed && !verbose) continue;
    const tag = ch.source === 'deterministic' ? '' : dim(` [${ch.source}]`);
    console.log(`      ${ch.passed ? green('✓') : red('✗')} ${ch.name}${tag}: ${ch.message}${ch.score !== undefined ? dim(` score=${ch.score}`) : ''}`);
    if (!ch.passed && ch.explanation) console.log(dim(`        ${ch.explanation.slice(0, 300)}`));
  }
}

interface RunCliOptions {
  workspace?: string;
  environment?: string;
  concurrency?: string;
  retries?: string;
  timeout?: string;
  reporter: string[];
  out?: string;
  tags?: string;
  grep?: string;
  bail?: boolean;
  resume?: string;
  var?: Record<string, string>;
  baseline?: string;
  saveBaseline?: string;
  trace: 'all' | 'failures' | 'none';
  verbose?: boolean;
  quiet?: boolean;
  suite?: string;
  failOnRegression?: boolean;
  logLevel?: string;
}

async function executeRun(paths: string[], o: RunCliOptions, label?: string): Promise<number> {
  const mgr = new WorkspaceManager();
  const settings = mgr.loadSettings();
  const firstPath = paths[0] ? resolve(paths[0]) : undefined;
  const { store, ephemeral } = openWorkspace(o.workspace, firstPath && existsSync(firstPath) ? dirname(firstPath) : undefined, mgr);
  const logger = new Logger((o.logLevel?.toUpperCase() as 'INFO') ?? 'WARN');
  if (o.logLevel) logger.addSink(consoleSink());
  const secrets = new ChainSecretStore([new EnvSecretStore()]);

  let suite: Awaited<ReturnType<typeof loadSuite>> | undefined;
  let patterns = paths;
  let cwd = process.cwd();
  if (o.suite) {
    const candidates = [o.suite, join(store.path('tests'), o.suite), join(store.path('tests'), `${o.suite}.suite.yaml`), join(store.path('tests'), `${o.suite}.suite.yml`)];
    const file = candidates.find((p) => existsSync(p) && isSuiteFile(p));
    if (!file) throw new CliError(`Suite "${o.suite}" not found in ${store.path('tests')}`, EXIT.CONFIG_ERROR);
    suite = await loadSuite(file);
    patterns = suite.tests;
    cwd = dirname(file);
  } else if (paths.length === 1 && isSuiteFile(paths[0]!)) {
    suite = await loadSuite(resolve(paths[0]!));
    patterns = suite.tests;
    cwd = dirname(resolve(paths[0]!));
  } else if (!paths.length) {
    patterns = [store.path('tests')];
  }

  const environment = o.environment ?? suite?.environment ?? (store.listEnvironments().length === 1 ? store.listEnvironments()[0]!.name : undefined);
  if (o.environment && !store.getEnvironment(o.environment))
    throw new CliError(`Environment "${o.environment}" not found. Available: ${store.listEnvironments().map((e) => e.name).join(', ')}`, EXIT.CONFIG_ERROR);

  const ctx = createEngineContext({ store, secrets, settings, environment, logger, runtimeVars: o.var });
  const runId = o.resume ?? shortId('run-');
  // outside a workspace the ephemeral one is deleted afterwards, so keep results next to the caller (like Newman's ./newman)
  const outDir = o.out ? resolve(o.out) : ephemeral ? resolve('testpion-results', runId) : store.runDir(runId);
  const resultsFile = join(outDir, 'results.jsonl');
  if (o.resume && !existsSync(resultsFile)) throw new CliError(`Cannot resume: ${resultsFile} does not exist`, EXIT.CONFIG_ERROR);

  const loadList = async (list?: string[]) => {
    const out: TestCase[] = [];
    for (const p of list ?? []) for await (const t of loadTestsFromFile(isAbsolute(p) ? p : resolve(cwd, p))) out.push(t);
    return out;
  };

  const name = label ?? suite?.name ?? (paths.length ? paths.map((p) => relative(process.cwd(), resolve(p)) || '.').join(', ') : store.workspace.name);
  if (!o.quiet) {
    console.log(bold(`TestPion — ${name}`));
    console.log(dim(`workspace: ${ephemeral ? '(ephemeral)' : store.root}${environment ? ` · environment: ${environment}` : ''} · run: ${runId}`));
  }

  const concurrency = Number(o.concurrency ?? suite?.concurrency ?? 4);
  const ctrl = new AbortController();
  let interrupted = 0;
  const onSigint = () => {
    interrupted++;
    if (interrupted > 1) process.exit(EXIT.EXECUTION_ERROR);
    console.error(yellow('\nCancelling… (press Ctrl+C again to force quit). Resume later with --resume ' + runId));
    ctrl.abort();
  };
  process.on('SIGINT', onSigint);

  const onEvent = (e: RunEvent) => {
    if (e.type === 'test-end' && !o.quiet) printResult(e.result, !!o.verbose);
  };
  let summary;
  try {
    summary = await runTests({
      name,
      runId,
      tests: streamTests(patterns, cwd, { tags: o.tags?.split(',').map((t) => t.trim()).filter(Boolean), grep: o.grep }),
      setup: await loadList(suite?.setup),
      teardown: await loadList(suite?.teardown),
      concurrency,
      retries: Number(o.retries ?? suite?.retries ?? 0),
      timeoutMs: o.timeout ? Number(o.timeout) : suite?.timeoutMs,
      services: ctx.services,
      signal: ctrl.signal,
      resultsFile,
      resume: !!o.resume,
      traceMode: o.trace,
      onTrace: (trace) => void store.saveTrace(trace, 'test', runId),
      onEvent,
      environment,
      bail: o.bail,
    });
  } catch (e) {
    cleanupFailedRun({ ephemeral, outDir, explicitOut: !!o.out, store });
    throw e;
  } finally {
    process.off('SIGINT', onSigint);
    await ctx.dispose();
  }

  return finishRun({ store, ephemeral, summary, outDir, resultsFile, o, rerun: `testpion test ${paths.join(' ')} --resume ${runId}` });
}

/** Write reports, compare baselines, print the summary and work out the exit code (shared by test/run/run-collection). */
async function finishRun(a: {
  store: WorkspaceStore;
  ephemeral?: string;
  summary: RunSummary;
  outDir: string;
  resultsFile: string;
  o: Pick<RunCliOptions, 'reporter' | 'baseline' | 'saveBaseline' | 'quiet' | 'failOnRegression'>;
  rerun?: string;
  emptyMessage?: string;
}): Promise<number> {
  const { store, ephemeral, summary, outDir, resultsFile, o } = a;
  const results = () => readResults(resultsFile);
  const formats = o.reporter.filter((r) => r !== 'console') as ReportFormat[];
  const paths2 = formats.length ? await writeReports(outDir, summary, results, formats) : ({} as Record<string, string>);
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  if (!ephemeral) store.meta.addRun(summary, outDir);

  let regressionFailed = false;
  if (o.baseline) {
    const report = await compareToBaseline(store.getBaseline(o.baseline), summary, results(), DEFAULT_THRESHOLDS);
    writeFileSync(join(outDir, 'regression.json'), JSON.stringify(report, null, 2));
    const metricRegressions = report.summary.filter((m) => m.regressed);
    console.log(bold(`\nRegression vs baseline "${o.baseline}": ${report.passed ? green('no regressions') : red(`${report.regressions.length + metricRegressions.length} regression(s)`)}`));
    for (const m of metricRegressions) console.log(red(`  ✗ ${m.metric}: ${m.baseline} → ${m.current} (${m.deltaPct > 0 ? '+' : ''}${m.deltaPct}%)`));
    for (const r of report.regressions.slice(0, 20)) console.log(red(`  ✗ ${r.id}: ${r.message}`));
    for (const r of report.improvements.slice(0, 10)) console.log(green(`  ✓ ${r.id}: ${r.message}`));
    regressionFailed = !report.passed;
  }
  if (o.saveBaseline) {
    store.saveBaseline(await createBaseline(o.saveBaseline, summary, results()));
    console.log(dim(`Saved baseline "${o.saveBaseline}"`));
  }

  if (!o.quiet) {
    const ok = summary.failed + summary.errors === 0;
    console.log(
      `\n${ok ? green(bold('PASSED')) : red(bold('FAILED'))}  ${summary.passed} passed, ${summary.failed} failed, ${summary.errors} errors, ${summary.skipped} skipped · ${formatDuration(summary.durationMs)}`,
    );
    if (summary.latency.count) console.log(dim(`latency p50 ${summary.latency.p50}ms · p95 ${summary.latency.p95}ms · p99 ${summary.latency.p99}ms`));
    if (summary.tokens.totalTokens) console.log(dim(`tokens ${summary.tokens.inputTokens} in / ${summary.tokens.outputTokens} out${summary.costUsd ? ` · est. cost $${summary.costUsd}` : ''}`));
    for (const [k, v] of Object.entries(summary.scores)) console.log(dim(`score ${k}: ${v.mean} (${v.count})`));
    for (const [f, p] of Object.entries(paths2)) console.log(dim(`${f} report: ${p}`));
    if (summary.cancelled && a.rerun) console.log(yellow(`Run cancelled. Resume with: ${a.rerun}`));
  }
  store.close();
  if (ephemeral) rmSync(ephemeral, { recursive: true, force: true });
  if (summary.cancelled) return EXIT.EXECUTION_ERROR;
  if (summary.total === 0) {
    console.error(yellow(a.emptyMessage ?? 'No tests found.'));
    return EXIT.CONFIG_ERROR;
  }
  return summary.failed + summary.errors > 0 || (o.failOnRegression && regressionFailed) ? EXIT.TEST_FAILURE : EXIT.SUCCESS;
}

interface CollectionCliOptions extends Pick<RunCliOptions, 'workspace' | 'environment' | 'bail' | 'timeout' | 'reporter' | 'out' | 'var' | 'baseline' | 'saveBaseline' | 'failOnRegression' | 'trace' | 'verbose' | 'quiet' | 'logLevel'> {
  iterationData?: string;
  iterationCount?: string;
  delayRequest?: string;
  folder?: string[];
  cookieJar?: string;
  exportCookieJar?: string;
}

function readImport<K extends 'collection' | 'environment'>(file: string, want: K): NonNullable<ReturnType<typeof importAny>[K]> {
  let r: ReturnType<typeof importAny>;
  try {
    r = importAny(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CliError(`Could not read ${want} file ${file}: ${(e as Error).message}`, EXIT.CONFIG_ERROR);
  }
  const v = r[want];
  if (!v) throw new CliError(`${file} is not a ${want} file (detected: ${r.format})`, EXIT.CONFIG_ERROR);
  return v;
}

/** Map --folder names/ids to node ids (folders or requests), like Newman's --folder. */
function resolveSelection(collection: Collection, refs: string[] | undefined): string[] | undefined {
  if (!refs?.length) return undefined;
  const all: CollectionNode[] = [];
  const walk = (nodes: CollectionNode[]) => nodes.forEach((n) => (all.push(n), n.kind === 'folder' && walk(n.items)));
  walk(collection.items);
  return refs.map((ref) => {
    const n = all.find((x) => x.id === ref) ?? all.find((x) => x.name === ref) ?? all.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!n) throw new CliError(`No folder or request "${ref}" in collection "${collection.name}"`, EXIT.CONFIG_ERROR);
    return n.id;
  });
}

async function executeCollectionRun(ref: string, o: CollectionCliOptions): Promise<number> {
  const mgr = new WorkspaceManager();
  const settings = mgr.loadSettings();
  const fromFile = existsSync(ref) && statSync(ref).isFile();
  // a collection file never touches the user's workspace: it runs in an ephemeral one unless -w is given
  const { store, ephemeral } = openWorkspace(o.workspace, fromFile && !o.workspace ? tmpdir() : undefined, mgr);
  const logger = new Logger((o.logLevel?.toUpperCase() as 'INFO') ?? 'WARN');
  if (o.logLevel) logger.addSink(consoleSink());
  const secrets = new ChainSecretStore([new EnvSecretStore()]);

  let collection: Collection;
  if (fromFile) collection = readImport(resolve(ref), 'collection');
  else {
    const cols = store.listCollections().filter((c) => !c.problem);
    const found = cols.find((c) => c.id === ref) ?? cols.find((c) => c.name.toLowerCase() === ref.toLowerCase());
    if (!found) throw new CliError(`Collection "${ref}" not found. Available: ${cols.map((c) => c.name).join(', ') || 'none'} (or pass a collection file)`, EXIT.CONFIG_ERROR);
    collection = found;
  }

  let envFile: Environment | undefined;
  let envName: string | undefined;
  if (o.environment && existsSync(o.environment) && statSync(o.environment).isFile()) envFile = readImport(resolve(o.environment), 'environment');
  else if (o.environment) {
    if (!store.getEnvironment(o.environment)) throw new CliError(`Environment "${o.environment}" not found. Available: ${store.listEnvironments().map((e) => e.name).join(', ') || 'none'} (or pass an environment file)`, EXIT.CONFIG_ERROR);
    envName = o.environment;
  } else if (!fromFile && store.listEnvironments().length === 1) envName = store.listEnvironments()[0]!.name;

  const selection = resolveSelection(collection, o.folder);
  let data: DatasetRecord[] | undefined;
  if (o.iterationData) {
    const file = resolve(o.iterationData);
    if (!existsSync(file)) throw new CliError(`Data file ${file} does not exist`, EXIT.CONFIG_ERROR);
    data = [];
    for await (const r of readDataset({ path: file, limit: 100_000 })) data.push(r);
  }
  const iterations = o.iterationCount ? Number(o.iterationCount) : undefined;
  if (iterations !== undefined && !(iterations >= 1)) throw new CliError('--iteration-count must be 1 or more', EXIT.CONFIG_ERROR);

  let cookieJar = new CookieJar();
  if (o.cookieJar) {
    try {
      cookieJar = new CookieJar(cookiesFromJson(JSON.parse(readFileSync(resolve(o.cookieJar), 'utf8'))));
    } catch (e) {
      throw new CliError(`Could not read cookie jar ${o.cookieJar}: ${(e as Error).message}`, EXIT.CONFIG_ERROR);
    }
  }
  const ctx = createEngineContext({ store, secrets, settings, environment: envName, collectionId: fromFile ? undefined : collection.id, logger, runtimeVars: o.var, cookieJar });
  if (fromFile) ctx.vars.setScope('collection', collection.variables);
  if (envFile) ctx.vars.setScope('environment', envFile.variables);
  const environment = envName ?? envFile?.name;
  const runId = shortId('run-');
  // outside a workspace the ephemeral one is deleted afterwards, so keep results next to the caller (like Newman's ./newman)
  const outDir = o.out ? resolve(o.out) : ephemeral ? resolve('testpion-results', runId) : store.runDir(runId);
  const resultsFile = join(outDir, 'results.jsonl');

  if (!o.quiet) {
    console.log(bold(`TestPion — ${collection.name}`));
    const bits = [ephemeral ? '' : `workspace: ${store.root}`, environment ? `environment: ${environment}` : '', data ? `data: ${data.length} rows` : '', `run: ${runId}`];
    console.log(dim(bits.filter(Boolean).join(' · ')));
  }

  const ctrl = new AbortController();
  let interrupted = 0;
  const onSigint = () => {
    if (++interrupted > 1) process.exit(EXIT.EXECUTION_ERROR);
    console.error(yellow('\nCancelling… (press Ctrl+C again to force quit)'));
    ctrl.abort();
  };
  process.on('SIGINT', onSigint);
  let lastIteration = 0;
  let summary: RunSummary;
  try {
    summary = await runCollection({
      name: collection.name,
      runId,
      collection,
      selection,
      data,
      iterations,
      delayMs: o.delayRequest ? Number(o.delayRequest) : undefined,
      timeoutMs: o.timeout ? Number(o.timeout) : undefined,
      bail: o.bail,
      services: ctx.services,
      signal: ctrl.signal,
      resultsFile,
      traceMode: o.trace,
      onTrace: (trace) => void store.saveTrace(trace, 'test', runId),
      environment,
      onEvent: (e: RunEvent) => {
        if (e.type !== 'test-end' || o.quiet) return;
        const it = Number(/@(\d+)/.exec(e.result.id)?.[1] ?? 1);
        if (it !== lastIteration && (iterations ?? data?.length ?? 1) > 1) console.log(cyan(`\nIteration ${it}`));
        lastIteration = it;
        printResult(e.result, !!o.verbose);
      },
    });
  } catch (e) {
    cleanupFailedRun({ ephemeral, outDir, explicitOut: !!o.out, store });
    throw e instanceof ApsError && e.kind === 'ValidationError' ? new CliError(e.message, EXIT.CONFIG_ERROR) : e;
  } finally {
    process.off('SIGINT', onSigint);
    await ctx.dispose();
  }
  if (o.exportCookieJar) {
    const file = resolve(o.exportCookieJar);
    writeFileSync(file, JSON.stringify({ cookies: cookieJar.toJSON() }, null, 2) + '\n', { mode: 0o600 });
    if (!o.quiet) console.log(dim(`Cookie jar written to ${file} (${cookieJar.toJSON().length} cookies; values are in plain text, keep it out of git)`));
  }
  return finishRun({ store, ephemeral, summary, outDir, resultsFile, o, emptyMessage: 'No requests ran.' });
}

/** A collection by name or id from a workspace, or from a TestPion / Postman collection file. */
function loadCollectionRef(ref: string, workspace: string | undefined): Collection {
  if (existsSync(ref) && statSync(ref).isFile()) return readImport(resolve(ref), 'collection');
  const { store, ephemeral } = openWorkspace(workspace, undefined, new WorkspaceManager());
  try {
    const cols = store.listCollections().filter((c) => !c.problem);
    const found = cols.find((c) => c.id === ref) ?? cols.find((c) => c.name.toLowerCase() === ref.toLowerCase());
    if (!found) throw new CliError(`Collection "${ref}" not found. Available: ${cols.map((c) => c.name).join(', ') || 'none'} (or pass a collection file)`, EXIT.CONFIG_ERROR);
    return found;
  } finally {
    store.close();
    if (ephemeral) rmSync(ephemeral, { recursive: true, force: true });
  }
}

/** `testpion mock`: serve saved examples until interrupted. */
async function executeMock(ref: string, o: { workspace?: string; port?: string; delay?: string; quiet?: boolean }): Promise<number> {
  const collection = loadCollectionRef(ref, o.workspace);
  const port = o.port ? Number(o.port) : 0;
  if (!(port >= 0 && port < 65536)) throw new CliError('--port must be between 0 and 65535', EXIT.CONFIG_ERROR);
  let mock: MockServer;
  try {
    mock = await startMockServer(collection, {
      port,
      delayMs: o.delay ? Number(o.delay) : undefined,
      onRequest: (e) => {
        if (o.quiet) return;
        const status = e.status < 400 ? green(String(e.status)) : e.example ? yellow(String(e.status)) : red(String(e.status));
        console.log(`${dim(new Date().toLocaleTimeString())} ${e.method} ${e.path} ${status} ${e.example ? dim(e.example) : red('no matching example')}`);
      },
    });
  } catch (e) {
    throw e instanceof ApsError && e.kind === 'ConfigurationError' ? new CliError(e.message, EXIT.CONFIG_ERROR) : e;
  }
  if (!mock.routes.length) console.log(yellow(`"${collection.name}" has no saved examples yet: every request will get a 404.`));
  console.log(bold(`Mock server for ${collection.name}: ${mock.url}`));
  for (const r of mock.routes) console.log(dim(`  ${r.method.padEnd(7)} ${r.path} → ${r.example.status} ${r.example.name}`));
  console.log(dim('Press Ctrl+C to stop.'));
  await new Promise<void>((done) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      done();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
  await mock.close();
  return EXIT.SUCCESS;
}

/** A run that failed to start leaves nothing behind: drop the default output folder and the ephemeral workspace. */
function cleanupFailedRun(a: { ephemeral?: string; outDir: string; explicitOut: boolean; store: WorkspaceStore }): void {
  if (a.ephemeral && !a.explicitOut) {
    rmSync(a.outDir, { recursive: true, force: true });
    try {
      rmdirSync(dirname(a.outDir)); // ./testpion-results, only when nothing else is in it
    } catch {
      /* not empty */
    }
  }
  if (a.ephemeral) {
    a.store.close();
    rmSync(a.ephemeral, { recursive: true, force: true });
  }
}

async function* readResults(file: string): AsyncGenerator<TestResult> {
  for await (const r of await readResultsFile(file)) yield r;
}

function runOptions(cmd: Command): Command {
  return cmd
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-e, --environment <name>', 'environment to use')
    .option('-c, --concurrency <n>', 'parallel workers')
    .option('--retries <n>', 'retries per failing test')
    .option('--timeout <ms>', 'per-test timeout in ms')
    .addOption(new Option('-r, --reporter <formats...>', 'reporters: console, junit, json, html, markdown').default(['console', 'junit', 'json', 'html', 'markdown']))
    .option('-o, --out <dir>', 'output directory for results and reports')
    .option('-t, --tags <tags>', 'only run tests with these tags (comma separated)')
    .option('-g, --grep <pattern>', 'only run tests whose name/id matches')
    .option('--bail', 'stop after the first failure')
    .option('--resume <runId>', 'resume a cancelled/crashed run')
    .option('--var <key=value>', 'runtime variable (repeatable)', collectVar)
    .option('--baseline <name>', 'compare results against a saved baseline')
    .option('--save-baseline <name>', 'save this run as a baseline')
    .option('--fail-on-regression', 'exit 1 when the baseline comparison finds regressions')
    .addOption(new Option('--trace <mode>', 'persist traces').choices(['all', 'failures', 'none']).default('failures'))
    .option('-v, --verbose', 'show passing checks')
    .option('-q, --quiet', 'only print the summary exit code')
    .option('--log-level <level>', 'ERROR | WARN | INFO | DEBUG | TRACE (secrets are always redacted)');
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('testpion')
    .description('TestPion CLI — run REST, GraphQL, MCP and AI tests locally and in CI/CD.\n\nExit codes: 0 success · 1 test failure · 2 configuration error · 3 execution error')
    .version('0.6.0');

  runOptions(program.command('test').description('run tests from files, directories, globs or a *.suite.yaml').argument('[paths...]', 'test files/dirs/globs')).action(async (paths: string[], o: RunCliOptions) => {
    process.exitCode = await executeRun(paths, o);
  });

  runOptions(program.command('run').description('run a named suite from a workspace').requiredOption('-s, --suite <name>', 'suite name (tests/<name>.suite.yaml)')).action(async (o: RunCliOptions) => {
    process.exitCode = await executeRun([], o);
  });

  program
    .command('run-collection')
    .description(
      'run a collection like Postman\'s Collection Runner / Newman: requests in order, pm.* scripts, iterations and data files\n' +
        '<collection> is a collection name or id in the workspace, or a TestPion / Postman v2.1 collection file',
    )
    .argument('<collection>', 'collection name, id or file')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-e, --environment <nameOrFile>', 'environment name, or a Postman environment file')
    .option('-d, --iteration-data <file>', 'CSV or JSON data file: one row per iteration (pm.iterationData, {{column}})')
    .option('-n, --iteration-count <n>', 'number of iterations (default: data rows, or 1)')
    .option('--delay-request <ms>', 'pause between requests')
    .option('--folder <nameOrId...>', 'only run these folders or requests (repeatable)')
    .option('--bail', 'stop after the first failure')
    .option('--timeout <ms>', 'per-request timeout in ms')
    .option('--cookie-jar <file>', 'start with the cookies in this JSON file (TestPion or Newman cookie jar)')
    .option('--export-cookie-jar <file>', 'write the cookie jar to this JSON file after the run')
    .addOption(new Option('-r, --reporter <formats...>', 'reporters: console, junit, json, html, markdown').default(['console', 'junit', 'json', 'html', 'markdown']))
    .option('-o, --out <dir>', 'output directory for results and reports')
    .option('--var <key=value>', 'runtime variable (repeatable)', collectVar)
    .option('--baseline <name>', 'compare results against a saved baseline')
    .option('--save-baseline <name>', 'save this run as a baseline')
    .option('--fail-on-regression', 'exit 1 when the baseline comparison finds regressions')
    .addOption(new Option('--trace <mode>', 'persist traces').choices(['all', 'failures', 'none']).default('failures'))
    .option('-v, --verbose', 'show passing checks')
    .option('-q, --quiet', 'only print the summary exit code')
    .option('--log-level <level>', 'ERROR | WARN | INFO | DEBUG | TRACE (secrets are always redacted)')
    .action(async (ref: string, o: CollectionCliOptions) => {
      process.exitCode = await executeCollectionRun(ref, o);
    });

  program
    .command('mcp-server')
    .description('serve a workspace to AI agents over MCP (stdio): list and read collections, send requests, run collections')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('--read-only', 'only the browsing tools: no requests are sent')
    .option('--allow-production', 'allow sending to environments marked as production')
    .action(async (o: { workspace?: string; readOnly?: boolean; allowProduction?: boolean }) => {
      // stdout carries the MCP protocol: everything else goes to stderr
      const mgr = new WorkspaceManager();
      const { store, ephemeral } = openWorkspace(o.workspace, undefined, mgr);
      if (ephemeral) {
        store.close();
        rmSync(ephemeral, { recursive: true, force: true });
        throw new CliError('No workspace found: run inside a workspace folder or pass -w <name|path>', EXIT.CONFIG_ERROR);
      }
      console.error(dim(`TestPion MCP server for "${store.workspace.name}"${o.readOnly ? ' (read-only)' : ''} on stdio`));
      try {
        await serveTestPionMcp({ store, secrets: new ChainSecretStore([new EnvSecretStore()]), settings: mgr.loadSettings(), readOnly: o.readOnly, allowProduction: o.allowProduction, version: ENGINE_VERSION });
      } finally {
        store.close();
      }
    });

  program
    .command('export')
    .description('export a collection as a Postman v2.1 collection (default) or TestPion JSON\n<collection> is a collection name or id in the workspace, or a collection file to convert')
    .argument('<collection>', 'collection name, id or file')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .addOption(new Option('-f, --format <format>', 'output format').choices(['postman', 'testpion']).default('postman'))
    .option('-o, --out <file>', 'write to this file instead of stdout')
    .action((ref: string, o: { workspace?: string; format: 'postman' | 'testpion'; out?: string }) => {
      const c = loadCollectionRef(ref, o.workspace);
      const { collection, notes } = o.format === 'postman' ? exportPostmanCollection(c) : { collection: c, notes: [] as string[] };
      const json = JSON.stringify(collection, null, 2) + '\n';
      for (const n of notes) console.error(yellow(`not exported: ${n}`));
      if (o.out) {
        writeFileSync(resolve(o.out), json);
        console.error(dim(`Collection written to ${resolve(o.out)}`));
      } else process.stdout.write(json);
    });

  program
    .command('export-environment')
    .description("export a workspace environment in Postman's environment format (secret values are never included)")
    .argument('<environment>', 'environment name or id')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-o, --out <file>', 'write to this file instead of stdout')
    .action((ref: string, o: { workspace?: string; out?: string }) => {
      const { store, ephemeral } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const env = store.getEnvironment(ref);
        if (!env) throw new CliError(`Environment "${ref}" not found. Available: ${store.listEnvironments().map((e) => e.name).join(', ') || 'none'}`, EXIT.CONFIG_ERROR);
        const json = JSON.stringify(exportPostmanEnvironment(env), null, 2) + '\n';
        if (o.out) {
          writeFileSync(resolve(o.out), json);
          console.error(dim(`Environment written to ${resolve(o.out)}`));
        } else process.stdout.write(json);
      } finally {
        store.close();
        if (ephemeral) rmSync(ephemeral, { recursive: true, force: true });
      }
    });

  program
    .command('docs')
    .description('write Markdown documentation for a collection (descriptions, requests, parameters, examples; secrets masked)\n<collection> is a collection name or id in the workspace, or a TestPion / Postman v2.1 collection file')
    .argument('<collection>', 'collection name, id or file')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-o, --out <file>', 'write to this file instead of stdout')
    .option('--no-examples', 'leave out saved examples')
    .action((ref: string, o: { workspace?: string; out?: string; examples?: boolean }) => {
      const md = collectionMarkdown(loadCollectionRef(ref, o.workspace), { examples: o.examples });
      if (o.out) {
        writeFileSync(resolve(o.out), md);
        console.error(dim(`Documentation written to ${resolve(o.out)}`));
      } else process.stdout.write(md);
    });

  program
    .command('mock')
    .description("serve a collection's saved examples on localhost (like a Postman mock server) until Ctrl+C\n<collection> is a collection name or id in the workspace, or a TestPion / Postman v2.1 collection file")
    .argument('<collection>', 'collection name, id or file')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-p, --port <port>', 'port to listen on (default: any free port)')
    .option('--delay <ms>', 'delay every response by this many ms')
    .option('-q, --quiet', 'do not log requests')
    .action(async (ref: string, o: { workspace?: string; port?: string; delay?: string; quiet?: boolean }) => {
      process.exitCode = await executeMock(ref, o);
    });

  program
    .command('load')
    .description('run a load test against a URL (safeguarded: local hosts only unless --allow-remote)')
    .argument('<url>', 'target URL')
    .option('-X, --method <method>', 'HTTP method', 'GET')
    .option('-H, --header <header...>', 'headers "Name: value"')
    .option('-d, --data <body>', 'request body')
    .option('-u, --vus <n>', 'virtual users', '10')
    .option('--duration <sec>', 'duration in seconds', '10')
    .option('--rps <n>', 'max requests per second')
    .option('--ramp-up <sec>', 'ramp-up seconds', '0')
    .option('--ramp-down <sec>', 'ramp-down seconds', '0')
    .option('--allow-remote', 'allow non-local hosts (only systems you are authorised to test)')
    .option('--json <file>', 'write final metrics as JSON')
    .action(async (url: string, o) => {
      const headers = ((o.header as string[]) ?? []).map((h) => {
        const i = h.indexOf(':');
        return { key: h.slice(0, i).trim(), value: h.slice(i + 1).trim() };
      });
      const settings = new WorkspaceManager().loadSettings();
      let last = 0;
      const snap = await runLoadTest(
        {
          target: { kind: 'http', request: { method: o.method, url, headers, body: o.data ? { type: /^\s*[{[]/.test(o.data) ? 'json' : 'text', content: o.data } : undefined } },
          virtualUsers: Number(o.vus),
          durationSec: Number(o.duration),
          rampUpSec: Number(o.rampUp),
          rampDownSec: Number(o.rampDown),
          requestsPerSecond: o.rps ? Number(o.rps) : undefined,
          allowRemoteHosts: !!o.allowRemote,
          maxVirtualUsers: settings.loadTesting.maxVirtualUsers,
        },
        {
          onSnapshot: (s) => {
            if (s.done || Date.now() - last < 1000) return;
            last = Date.now();
            console.log(dim(`[${s.elapsedSec}s] vus=${s.activeVUs} rps=${s.currentRps} total=${s.requests} errors=${s.errors} p95=${s.latency.p95}ms`));
          },
        },
      );
      printLoad(snap);
      if (o.json) writeFileSync(o.json, JSON.stringify(snap, null, 2));
      process.exitCode = snap.errorRate > 0.05 ? EXIT.TEST_FAILURE : EXIT.SUCCESS;
    });

  program
    .command('import')
    .description('import OpenAPI/Swagger, Postman, HAR or collection files, or a copied cURL / fetch / PowerShell request, into a workspace')
    .argument('<file>', 'file to import, or - to read stdin (e.g. a cURL command from the clipboard)')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--collection <name>', 'for a cURL / fetch / PowerShell request: the collection to add it to (created if needed)', 'Imported')
    .option('--folder <path>', 'for a request: folder path inside the collection, e.g. "Auth / Tokens"')
    .option('--name <name>', 'for a request: its name (default: method and path)')
    .option('--json', 'print the result as JSON (for scripts and AI agents)')
    .action(async (file: string, o) => {
      const mgr = new WorkspaceManager();
      const { store } = openWorkspace(o.workspace, undefined, mgr);
      try {
        const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
        if (isRequestSnippet(text)) {
          // secrets in the command (tokens, keys, cookies) become {{variables}}; they are never written to disk
          const r = importRequestSnippet(store.listCollections().filter((c) => !c.problem), text, new Redactor(mgr.loadSettings().redactFields), { collection: o.collection, folder: o.folder, name: o.name });
          const saved = store.saveCollection(r.collection);
          const out = { format: r.format, collection: saved.name, collectionId: saved.id, createdCollection: r.created, request: r.node.name, requestId: r.node.id, method: r.node.request.method, url: r.node.request.url, placeholders: r.placeholders };
          if (o.json) console.log(JSON.stringify(out, null, 2));
          else {
            console.log(green(`Imported ${r.format} request "${r.node.name}" into collection "${saved.name}"`));
            if (r.placeholders.length) console.log(yellow(`Secrets were replaced by variables; set them as secret environment variables: ${r.placeholders.map((p) => `${p.variable} (${p.where})`).join(', ')}`));
          }
          return;
        }
        const r = importAny(text);
        if (r.collection) store.saveCollection(r.collection);
        if (r.environment) store.saveEnvironment(r.environment);
        if (o.json) console.log(JSON.stringify({ format: r.format, collection: r.collection?.name, collectionId: r.collection?.id, environment: r.environment?.name }, null, 2));
        else console.log(green(`Imported ${r.format}: ${r.collection ? `collection "${r.collection.name}"` : ''}${r.environment ? ` environment "${r.environment.name}"` : ''}`));
      } finally {
        store.close();
      }
    });

  const envCmd = program.command('env').description('list environments and set their order');
  envCmd
    .command('list')
    .description('list environments in display order, with variable names (never values)')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print as JSON')
    .action((o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const envs = store.listEnvironments().map((e) => ({ id: e.id, name: e.name, production: !!e.isProduction, variables: e.variables.filter((v) => v.enabled !== false).map((v) => (v.secret ? `${v.key} (secret)` : v.key)) }));
        if (o.json) console.log(JSON.stringify(envs, null, 2));
        else for (const e of envs) console.log(`${e.name}${e.production ? red(' (production)') : ''}\t${dim(e.variables.join(', '))}`);
      } finally {
        store.close();
      }
    });
  envCmd
    .command('order')
    .description('set the display order of environments (names or ids, first to last; others follow)')
    .argument('<environments...>')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print the new order as JSON')
    .action((refs: string[], o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const envs = store.listEnvironments();
        const ids = refs.map((r) => {
          const e = envs.find((x) => x.id === r) ?? envs.find((x) => x.name.toLowerCase() === r.toLowerCase());
          if (!e) throw new CliError(`No environment "${r}". Available: ${envs.map((x) => x.name).join(', ') || 'none'}`, EXIT.CONFIG_ERROR);
          return e.id;
        });
        const names = store.reorderEnvironments(ids).map((e) => e.name);
        console.log(o.json ? JSON.stringify(names) : names.join('\n'));
      } finally {
        store.close();
      }
    });

  const ws = program.command('workspace').description('manage workspaces');
  ws.command('list')
    .option('--json', 'print as JSON')
    .action((o) => {
      const list = new WorkspaceManager().list();
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else for (const w of list) console.log(`${w.name}\t${dim(w.path)}`);
    });
  ws.command('rename')
    .description('rename a workspace')
    .argument('<nameOrPath>')
    .argument('<newName>')
    .option('--json', 'print the renamed workspace as JSON')
    .action((ref: string, name: string, o) => {
      const w = new WorkspaceManager().rename(ref, name);
      console.log(o.json ? JSON.stringify(w, null, 2) : green(`Renamed to "${w.name}"`));
    });
  ws.command('delete')
    .description('delete a workspace the app created (its folder is removed), or unregister a folder you opened (its files stay)')
    .argument('<nameOrPath>')
    .option('--yes', 'confirm; required, because deleting cannot be undone')
    .option('--json', 'print the result as JSON')
    .action((ref: string, o) => {
      const mgr = new WorkspaceManager();
      const d = mgr.details(ref);
      if (!o.yes)
        throw new CliError(
          `Refusing to ${d.managed ? 'delete' : 'unregister'} "${d.name}" (${d.collections} collections, ${d.environments} environments, ${d.tests} test files at ${d.path}) without --yes`,
          EXIT.CONFIG_ERROR,
        );
      const r = mgr.delete(d.path);
      console.log(o.json ? JSON.stringify({ name: d.name, path: d.path, ...r }, null, 2) : green(r.deletedFiles ? `Deleted "${d.name}"` : `Removed "${d.name}" from the list (folder kept: ${d.path})`));
    });
  ws.command('create')
    .argument('<name>')
    .option('--path <dir>', 'create in this directory (e.g. inside a git repo)')
    .action((name: string, o) => {
      const s = new WorkspaceManager().create(name, o.path ? resolve(o.path) : undefined);
      console.log(green(`Created workspace "${name}" at ${s.root}`));
      s.close();
    });
  ws.command('export')
    .argument('<nameOrPath>')
    .requiredOption('-o, --output <file>')
    .action((ref: string, o) => {
      const { store } = openWorkspace(ref, undefined, new WorkspaceManager());
      writeFileSync(o.output, JSON.stringify(store.exportBundle(), null, 2));
      console.log(green(`Exported to ${o.output} (secret values are never exported)`));
      store.close();
    });

  program
    .command('mcp')
    .description('connect to an MCP server and print its tools, resources and prompts')
    .option('--url <url>', 'Streamable HTTP endpoint')
    .option('--sse <url>', 'legacy SSE endpoint')
    .argument('[command...]', 'stdio command, e.g. -- node server.js')
    .action(async (command: string[], o) => {
      const cfg: McpServerConfig = o.url
        ? { id: 'cli', name: o.url, transport: 'streamable-http', url: o.url }
        : o.sse
          ? { id: 'cli', name: o.sse, transport: 'sse', url: o.sse }
          : command.length
            ? { id: 'cli', name: command.join(' '), transport: 'stdio', command: command[0]!, args: command.slice(1) }
            : (() => {
                throw new CliError('Provide --url, --sse or a stdio command', EXIT.CONFIG_ERROR);
              })();
      const s = new McpSession(cfg);
      await s.connect();
      const d = await s.discover();
      console.log(bold(`${d.serverInfo?.name ?? 'server'} ${d.serverInfo?.version ?? ''}`), dim(JSON.stringify(d.capabilities)));
      if (d.instructions) console.log(dim(d.instructions));
      console.log(cyan(`\nTools (${d.tools.length})`));
      for (const t of d.tools) console.log(`  ${t.name} ${dim(t.description ?? '')}\n    ${dim(JSON.stringify(t.inputSchema))}`);
      console.log(cyan(`\nResources (${d.resources.length})`));
      for (const r of d.resources) console.log(`  ${r.uri} ${dim(r.name)}`);
      for (const r of d.resourceTemplates) console.log(`  ${r.uriTemplate} ${dim(`${r.name} (template)`)}`);
      console.log(cyan(`\nPrompts (${d.prompts.length})`));
      for (const p of d.prompts) console.log(`  ${p.name} ${dim(p.description ?? '')}`);
      await s.close();
    });

  program
    .command('report')
    .description('generate reports from a results.jsonl file')
    .argument('<results>', 'results.jsonl')
    .addOption(new Option('-f, --format <formats...>').default(['html', 'junit', 'markdown', 'json']))
    .option('-o, --out <dir>', 'output directory')
    .action(async (file: string, o) => {
      const summaryPath = join(dirname(file), 'summary.json');
      if (!existsSync(summaryPath)) throw new CliError(`summary.json not found next to ${file}`, EXIT.CONFIG_ERROR);
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
      const out = await writeReports(o.out ?? dirname(file), summary, () => readResults(file), o.format);
      for (const [f, p] of Object.entries(out)) console.log(`${f}: ${p}`);
    });

  return program;
}

function printLoad(s: LoadSnapshot): void {
  console.log(bold('\nLoad test results'));
  console.log(`  requests      ${s.requests} (${s.throughput}/s)`);
  console.log(`  errors        ${s.errors} (${(s.errorRate * 100).toFixed(2)}%) · connection failures ${s.connectionFailures}`);
  console.log(`  latency       p50 ${s.latency.p50}ms · p90 ${s.latency.p90}ms · p95 ${s.latency.p95}ms · p99 ${s.latency.p99}ms · max ${s.latency.max}ms`);
  console.log(`  status codes  ${Object.entries(s.statusCodes).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`  transferred   ${formatBytes(s.bytes)}`);
}

export async function main(argv = process.argv): Promise<number> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return Number(process.exitCode ?? 0);
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.code === 'commander.helpDisplayed' || e.code === 'commander.version' || e.code === 'commander.help') return EXIT.SUCCESS;
      return EXIT.CONFIG_ERROR;
    }
    if (e instanceof CliError) {
      console.error(red(e.message));
      return e.exitCode;
    }
    const err = normalizeError(e);
    console.error(red(`${err.kind}: ${err.message}`));
    for (const s of err.suggestions) console.error(dim(`  → ${s}`));
    return e instanceof ApsError && (err.kind === 'ConfigurationError' || err.kind === 'ValidationError' || err.kind === 'SchemaError') ? EXIT.CONFIG_ERROR : EXIT.EXECUTION_ERROR;
  }
}
