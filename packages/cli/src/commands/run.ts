/** Commands that run things: test files, suites, collections and load tests; re-generating reports. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Command, Option } from 'commander';
import {
  ChainSecretStore,
  EnvSecretStore,
  WorkspaceManager,
  collectionLoadTarget,
  createEngineContext,
  runLoadTest,
  writeReports,
  type LoadTarget,
} from '@testpion/core';
import { EXIT, dim, yellow, CliError, collectVar, openWorkspace, readResults, printLoad } from '../shared.js';
import { runWatching, watchTargets } from '../watch.js';
import { type RunCliOptions, executeRun, type CollectionCliOptions, executeCollectionRun, executeSend, resolveSelection, runOptions } from '../run.js';

export function registerRunCommands(program: Command): void {

  runOptions(program.command('test').description('run tests from files, directories, globs or a *.suite.yaml').argument('[paths...]', 'test files/dirs/globs')).action(async (paths: string[], o: RunCliOptions & { watch?: boolean }) => {
    process.exitCode = o.watch ? await runWatching(watchTargets(o.workspace, paths), () => executeRun(paths, o)) : await executeRun(paths, o);
  });
  runOptions(program.command('run').description('run a named suite from a workspace').requiredOption('-s, --suite <name>', 'suite name (tests/<name>.suite.yaml)')).action(async (o: RunCliOptions & { watch?: boolean }) => {
    process.exitCode = o.watch ? await runWatching(watchTargets(o.workspace), () => executeRun([], o)) : await executeRun([], o);
  });
  program
    .command('run-collection')
    .description(
      'run a collection like Postman\'s Collection Runner / Newman: requests in order, pm.* scripts, iterations and data files\n' +
        '<collection> is a collection name or id in the workspace, or a TestPion / Postman v2.1 collection or OpenAPI file or link',
    )
    .argument('<collection>', 'collection name or id, a file, or an http(s) link')
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
    .option('-g, --globals <file>', 'Postman globals file')
    .option('--env-var <key=value>', 'set an environment variable (repeatable)', collectVar)
    .option('--global-var <key=value>', 'set a global variable (repeatable)', collectVar)
    .option('--export-environment <file>', 'write the environment after the run, with values scripts set (secret values left empty)')
    .option('--export-globals <file>', 'write the globals after the run')
    .option('-k, --insecure', 'do not verify TLS certificates (development servers only)')
    .option('--suppress-exit-code', 'exit 0 even when tests fail')
    .addOption(new Option('--timeout-request <ms>', 'same as --timeout (Newman)').hideHelp())
    .addOption(new Option('--reporters <formats...>', 'same as --reporter (Newman)').hideHelp())
    .option('--reporter-junit-export <file>', 'also write the JUnit report to this file')
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
    .option('--watch', 'run again whenever the collection, an environment or the data file changes (until Ctrl+C)')
    .action(async (ref: string, o: CollectionCliOptions & { watch?: boolean }) => {
      const dataFile = o.iterationData && !/^https?:/i.test(o.iterationData) ? [o.iterationData] : [];
      process.exitCode = o.watch ? await runWatching(watchTargets(o.workspace, [ref, ...dataFile]), () => executeCollectionRun(ref, o)) : await executeCollectionRun(ref, o);
    });
  program
    .command('load')
    .description('run a load test against a URL or a collection (safeguarded: local hosts only unless --allow-remote)')
    .argument('[url]', 'target URL (or use --collection)')
    .option('--collection <nameOrId>', 'load-test a collection: every virtual user sends its requests in order, again and again')
    .option('-w, --workspace <nameOrPath>', 'with --collection: workspace name or directory')
    .option('-e, --environment <name>', 'with --collection: environment')
    .option('--folder <nameOrId...>', 'with --collection: only these folders or requests')
    .option('--warm-up', 'with --collection: run it once first with scripts (e.g. to log in), then use the variables they set')
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
    .action(async (url: string | undefined, o) => {
      if (!url && !o.collection) throw new CliError('Give a URL or --collection', EXIT.CONFIG_ERROR);
      const headers = ((o.header as string[]) ?? []).map((h) => {
        const i = h.indexOf(':');
        return { key: h.slice(0, i).trim(), value: h.slice(i + 1).trim() };
      });
      const mgr = new WorkspaceManager();
      const settings = mgr.loadSettings();
      let target: LoadTarget = { kind: 'http', request: { method: o.method, url: url ?? '', headers, body: o.data ? { type: /^\s*[{[]/.test(o.data) ? 'json' : 'text', content: o.data } : undefined } };
      let isProduction = false;
      if (o.collection) {
        const { store } = openWorkspace(o.workspace, undefined, mgr);
        const ctx = createEngineContext({ store, secrets: new ChainSecretStore([new EnvSecretStore()]), settings, environment: o.environment });
        try {
          const cols = store.listCollections().filter((c) => !c.problem);
          const col = cols.find((c) => c.id === o.collection) ?? cols.find((c) => c.name.toLowerCase() === String(o.collection).toLowerCase());
          if (!col) throw new CliError(`Collection "${o.collection}" not found. Available: ${cols.map((c) => c.name).join(', ') || 'none'}`, EXIT.CONFIG_ERROR);
          const t = await collectionLoadTarget({ collection: col, selection: resolveSelection(col, o.folder), services: ctx.services, warmUp: !!o.warmUp });
          if (t.warmUp) console.log(dim(`Warm-up: ${t.warmUp.passed} passed, ${t.warmUp.failed + t.warmUp.errors} failed`));
          if (t.unresolved.length) console.log(yellow(`Unresolved variables: ${t.unresolved.join(', ')} (set them in the environment, or use --warm-up when scripts set them)`));
          target = t.target;
          isProduction = !!ctx.environment?.isProduction;
          console.log(dim(`${t.target.requests.length} requests per pass: ${t.target.requests.map((r) => r.name).join(' → ')}`));
        } finally {
          await ctx.dispose();
          store.close();
        }
      }
      let last = 0;
      const snap = await runLoadTest(
        {
          target,
          environmentIsProduction: isProduction,
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
    .command('send')
    .description('send one request, like curl: a saved request by name ("Collection/Request" or just "Request", with its scripts, auth and checks) or a URL; {{variables}} resolve from the environment')
    .argument('<request>', 'saved request ("Collection/Folder/Request", "Request") or a URL (may use {{variables}})')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-e, --environment <name>', 'environment')
    .option('-X, --method <method>', 'HTTP method for a URL', 'GET')
    .option('-H, --header <header...>', 'headers "Name: value" for a URL')
    .option('-d, --data <body>', 'request body for a URL (JSON is detected)')
    .option('-i, --include', 'print the status line and response headers')
    .option('--fail', 'exit 1 on an HTTP error status (400+) or a failed check')
    .option('--json', 'print { status, headers, body, durationMs, checks } as JSON')
    .action(async (target: string, o: { workspace?: string; environment?: string; method: string; header?: string[]; data?: string; include?: boolean; fail?: boolean; json?: boolean }) => {
      process.exitCode = await executeSend(target, o);
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
}
