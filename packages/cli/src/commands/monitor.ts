/** Monitors: collections run on a schedule (list, add, remove, run now or when due, results, a long-running scheduler). */
import { Command } from 'commander';
import {
  ChainSecretStore,
  EnvSecretStore,
  MonitorScheduler,
  WorkspaceManager,
  createEngineContext,
  deleteMonitor,
  executeMonitor,
  findMonitor,
  formatDuration,
  formatEvery,
  isDue,
  lastMonitorResult,
  listMonitors,
  monitorResults,
  monitorStatus,
  parseEvery,
  saveMonitor,
  shortId,
  type Monitor,
  type MonitorResult,
  type WorkspaceStore,
} from '@testpion/core';
import { EXIT, green, red, yellow, dim, bold, CliError, openWorkspace } from '../shared.js';
import { resolveSelection } from '../run.js';

const collect = (v: string, prev: string[] = []) => [...prev, v];

function withStore<T>(workspace: string, fn: (store: WorkspaceStore) => T): T {
  const { store } = openWorkspace(workspace, undefined, new WorkspaceManager());
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

const statusText = (r?: MonitorResult) =>
  !r ? dim('never ran') : r.status === 'passed' ? green(`passed ${r.passed}/${r.total}`) : r.status === 'failed' ? red(`failed ${r.failed + r.errors}/${r.total}`) : red(`error: ${r.error}`);

function runner(store: WorkspaceStore) {
  const mgr = new WorkspaceManager();
  const settings = mgr.loadSettings();
  // the CLI has no OS keychain: secret variables come from TESTPION_SECRET_* environment variables
  const secrets = new ChainSecretStore([new EnvSecretStore()]);
  return (m: Monitor, trigger: MonitorResult['trigger']) =>
    executeMonitor({ store, monitor: m, trigger, context: (o) => createEngineContext({ store, secrets, settings, environment: o.environment, collectionId: o.collectionId }) });
}

export function registerMonitorCommands(program: Command): void {
  const mon = program.command('monitor').description('collections that run on a schedule (monitors): list, add, remove, run, results, start the scheduler');

  mon
    .command('list')
    .description('monitors with their schedule, last result and next run')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print as JSON')
    .action((o) =>
      withStore(o.workspace, (store) => {
        const rows = listMonitors(store).map((m) => monitorStatus(store, m));
        if (o.json) return console.log(JSON.stringify(rows, null, 2));
        if (!rows.length) return console.log(dim('No monitors. Add one with: testpion monitor add <name> --collection <name> --every 15m -w <workspace>'));
        for (const r of rows) console.log(`${bold(r.name)}  ${dim(r.enabled ? r.schedule : 'paused')}  ${statusText(r.lastResult)}${r.nextRunAt ? dim(`  next ${r.nextRunAt}`) : ''}`);
      }),
    );

  mon
    .command('add')
    .description('add a monitor (or replace one with the same name)')
    .argument('<name>')
    .requiredOption('-w, --workspace <nameOrPath>')
    .requiredOption('--collection <nameOrId>', 'collection to run')
    .requiredOption('--every <interval>', 'how often: minutes, or e.g. 15m, 1h, 1d (1 minute to 7 days)')
    .option('--folder <nameOrId>', 'run only this folder or request (repeatable)', collect)
    .option('-e, --environment <name>', 'environment to run with')
    .option('-n, --iteration-count <n>', 'iterations per run')
    .option('--bail', 'stop a run at the first failure')
    .option('--paused', 'save it paused')
    .option('--json', 'print the monitor as JSON')
    .action((name: string, o) =>
      withStore(o.workspace, (store) => {
        const cols = store.listCollections().filter((c) => !c.problem);
        const collection = cols.find((c) => c.id === o.collection) ?? cols.find((c) => c.name.toLowerCase() === String(o.collection).toLowerCase());
        if (!collection) throw new CliError(`Collection "${o.collection}" not found. Available: ${cols.map((c) => c.name).join(', ') || 'none'}`, EXIT.CONFIG_ERROR);
        const existing = listMonitors(store).find((m) => m.name.toLowerCase() === name.toLowerCase());
        const m = saveMonitor(store, {
          id: existing?.id ?? shortId('mon-'),
          name,
          collectionId: collection.id,
          selection: resolveSelection(collection, o.folder),
          environment: o.environment,
          everyMinutes: parseEvery(o.every),
          enabled: !o.paused,
          iterations: o.iterationCount ? Number(o.iterationCount) : undefined,
          bail: o.bail || undefined,
        });
        console.log(o.json ? JSON.stringify(m, null, 2) : green(`${existing ? 'Updated' : 'Added'} monitor "${m.name}": ${collection.name}, ${m.enabled ? formatEvery(m.everyMinutes) : 'paused'}`));
      }),
    );

  mon
    .command('remove')
    .description('remove a monitor (its past results stay in runs/)')
    .argument('<nameOrId>')
    .requiredOption('-w, --workspace <nameOrPath>')
    .action((ref: string, o) =>
      withStore(o.workspace, (store) => {
        const m = findMonitor(store, ref);
        deleteMonitor(store, m.id);
        console.log(green(`Removed monitor "${m.name}"`));
      }),
    );

  mon
    .command('run')
    .description('run monitors now: one by name, --all, or --due (the ones whose time has come; for cron). Exit code 1 if any failed')
    .argument('[nameOrId]')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--all', 'every enabled monitor')
    .option('--due', 'only enabled monitors that are due')
    .option('--json', 'print the results as JSON')
    .action(async (ref: string | undefined, o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const all = listMonitors(store);
        const chosen = ref ? [findMonitor(store, ref)] : o.all ? all.filter((m) => m.enabled) : o.due ? all.filter((m) => isDue(m, lastMonitorResult(store, m.id))) : undefined;
        if (!chosen) throw new CliError('Name a monitor, or pass --all or --due', EXIT.CONFIG_ERROR);
        const run = runner(store);
        const results: Array<MonitorResult & { name: string }> = [];
        for (const m of chosen) {
          if (!o.json) process.stdout.write(`${m.name} … `);
          const r = await run(m, ref || o.all ? 'manual' : 'schedule');
          results.push({ ...r, name: m.name });
          if (!o.json) console.log(`${statusText(r)} ${dim(`${formatDuration(r.durationMs)} · run ${r.runId}`)}`);
        }
        if (o.json) console.log(JSON.stringify(results, null, 2));
        else if (!chosen.length) console.log(dim(o.due ? 'No monitors are due.' : 'No enabled monitors.'));
        process.exitCode = results.some((r) => r.status === 'error') ? EXIT.EXECUTION_ERROR : results.some((r) => r.status === 'failed') ? EXIT.TEST_FAILURE : EXIT.SUCCESS;
      } finally {
        store.close();
      }
    });

  mon
    .command('results')
    .description("a monitor's recent results, newest first")
    .argument('<nameOrId>')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('-n, --limit <n>', 'how many', '20')
    .option('--json', 'print as JSON')
    .action((ref: string, o) =>
      withStore(o.workspace, (store) => {
        const m = findMonitor(store, ref);
        const rows = monitorResults(store, m.id, Math.min(Number(o.limit) || 20, 500));
        if (o.json) return console.log(JSON.stringify(rows, null, 2));
        if (!rows.length) return console.log(dim('No results yet.'));
        const ok = rows.filter((r) => r.status === 'passed').length;
        console.log(`${bold(m.name)}  ${dim(`${ok}/${rows.length} passed`)}`);
        for (const r of rows) console.log(`  ${r.startedAt}  ${statusText(r)}  ${dim(`${formatDuration(r.durationMs)} · ${r.trigger} · ${r.runId}`)}`);
      }),
    );

  mon
    .command('start')
    .description('run the scheduler until stopped (Ctrl+C): every monitor runs when it is due. For a server or a machine without the app open')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print each result as a JSON line')
    .action(async (o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      const run = runner(store);
      const scheduler = new MonitorScheduler({
        list: () => listMonitors(store),
        last: (id) => lastMonitorResult(store, id),
        run: (m) => run(m, 'schedule'),
        onResult: (m, r, prev) => {
          if (o.json) return console.log(JSON.stringify({ ...r, name: m.name }));
          const changed = prev && prev.status !== r.status ? yellow(` (was ${prev.status})`) : '';
          console.log(`${dim(new Date().toISOString())}  ${m.name}  ${statusText(r)}${changed}`);
        },
        onError: (m, e) => console.error(red(`${m.name}: ${(e as Error).message}`)),
      });
      const count = listMonitors(store).filter((m) => m.enabled).length;
      if (!o.json) console.log(dim(`Scheduler started: ${count} enabled monitor${count === 1 ? '' : 's'} in ${store.root}. Press Ctrl+C to stop.`));
      scheduler.start();
      await new Promise<void>((resolve) => {
        const keep = setInterval(() => undefined, 60_000);
        process.once('SIGINT', () => {
          clearInterval(keep);
          scheduler.stop();
          resolve();
        });
      });
      store.close();
    });
}
