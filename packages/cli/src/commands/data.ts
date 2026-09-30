/** Moving data in and out: import, export, docs, script conversion, response history and environments. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command, Option } from 'commander';
import {
  WorkspaceManager,
  formatDuration,
  importRequestSnippet,
  compareHistory,
  responseTimeStats,
  ciConfig,
  compareEnvironments,
  compareRequestAcrossEnvironments,
  collectionRequests,
  createEngineContext,
  ChainSecretStore,
  EnvSecretStore,
  type CiProvider,
  type WorkspaceStore,
  convertCollectionScripts,
  redactDiff,
  isRequestSnippet,
  Redactor,
  collectionMarkdown,
  collectionHtml,
  exportPostmanCollection,
  exportPostmanEnvironment,
  type CollectionNode,
  fetchImportText,
  importIntoWorkspace,
  diffOpenApi,
  securityLint,
  variableFlow,
  collectionToOpenApiText,
  variableUsages,
  renameVariable,
  historyToHar,
} from '@testpion/core';
import { EXIT, green, red, yellow, dim, bold, CliError, openWorkspace, loadCollectionRef } from '../shared.js';

export function registerDataCommands(program: Command): void {
  program
    .command('lint')
    .description("review a collection's requests: secrets typed in instead of secret variables, secrets in query strings, plain http to other hosts, turned-off TLS checks, and {{variables}} nothing defines")
    .argument('<collection>', 'collection name or id, a file, or an http(s) link')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-e, --environment <name>', 'environment whose variables count as defined (for the variables check)')
    .addOption(new Option('--fail-on <severity>', 'exit 1 when a finding is at least this severe').choices(['high', 'medium', 'low']))
    .option('--json', 'print the findings as JSON')
    .action(async (ref: string, o: { workspace?: string; environment?: string; failOn?: 'high' | 'medium' | 'low'; json?: boolean }) => {
      const c = await loadCollectionRef(ref, o.workspace);
      const settings = new WorkspaceManager().loadSettings();
      // variables: those of the environment, collection, workspace and globals count as defined
      let known: string[] = [];
      try {
        const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
        const ctx = createEngineContext({ store, secrets: new ChainSecretStore([new EnvSecretStore()]), settings, environment: o.environment });
        known = Object.keys(ctx.vars.toObject());
        await ctx.dispose();
        store.close();
      } catch {
        /* a collection file outside a workspace: only its own variables */
      }
      const findings = [...securityLint(c, settings.redactFields), ...variableFlow(c, known)];
      if (o.json) console.log(JSON.stringify(findings, null, 2));
      else if (!findings.length) console.log(green(`No findings in "${c.name}".`));
      else {
        for (const f of findings) console.log(`${f.severity === 'high' ? red('high  ') : f.severity === 'medium' ? yellow('medium') : dim('low   ')} ${f.message}\n       ${dim(f.where)}`);
        console.log(bold(`\n${findings.length} finding${findings.length > 1 ? 's' : ''}`));
      }
      const rank = { high: 3, medium: 2, low: 1 };
      if (o.failOn && findings.some((f) => rank[f.severity] >= rank[o.failOn!])) process.exitCode = EXIT.TEST_FAILURE;
    });
  const varsCmd = program.command('vars').description('where a variable is used, and renaming it everywhere in a workspace');
  varsCmd
    .command('usages')
    .description('list where a variable is used or defined (requests, scripts, environments, collection/folder/workspace variables, test files)')
    .argument('<name>', 'variable name, without {{ }}')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print as JSON')
    .action((name: string, o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const uses = variableUsages(store, name);
        if (o.json) console.log(JSON.stringify(uses, null, 2));
        else if (!uses.length) console.log(yellow(`{{${name}}} isn't used or defined in this workspace.`));
        else for (const u of uses) console.log(`${u.where}  ${dim(u.field)}`);
      } finally {
        store.close();
      }
    });
  varsCmd
    .command('rename')
    .description('rename a variable everywhere in the workspace (secret values stored by the app move with it)')
    .argument('<from>', 'current name')
    .argument('<to>', 'new name')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print as JSON')
    .action(async (from: string, to: string, o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const r = await renameVariable(store, from, to, { secrets: new ChainSecretStore([new EnvSecretStore()]) });
        if (o.json) console.log(JSON.stringify({ from, to, files: r.files, changed: r.changed }, null, 2));
        else console.log(green(`Renamed {{${from}}} to {{${to}}} in ${r.changed.length} places (${r.files} files).`));
      } catch (e) {
        throw new CliError((e as Error).message, EXIT.CONFIG_ERROR);
      } finally {
        store.close();
      }
    });
  program
    .command('openapi-diff')
    .description('compare two versions of an OpenAPI / Swagger document and list breaking changes (for CI: --fail-on-breaking)')
    .argument('<old>', 'the previous document: a file or an http(s) link')
    .argument('<new>', 'the new document: a file or an http(s) link')
    .option('--fail-on-breaking', 'exit 1 when there are breaking changes')
    .option('--breaking-only', 'leave out the non-breaking changes')
    .option('--json', 'print the result as JSON (for scripts and AI agents)')
    .action(async (oldRef: string, newRef: string, o: { failOnBreaking?: boolean; breakingOnly?: boolean; json?: boolean }) => {
      const read = async (ref: string) => (/^https?:\/\//i.test(ref) ? (await fetchImportText(ref)).text : readFileSync(ref, 'utf8'));
      let d: ReturnType<typeof diffOpenApi>;
      try {
        d = diffOpenApi(await read(oldRef), await read(newRef));
      } catch (e) {
        throw new CliError((e as Error).message, EXIT.CONFIG_ERROR);
      }
      if (o.breakingOnly) d = { ...d, nonBreaking: [] };
      if (o.json) console.log(JSON.stringify(d, null, 2));
      else {
        const ops = d.operations;
        console.log(bold(`${ops.old} → ${ops.new} operations (${ops.added} added, ${ops.removed} removed)`));
        if (d.breaking.length) {
          console.log(red(bold(`\n${d.breaking.length} breaking change${d.breaking.length > 1 ? 's' : ''}:`)));
          for (const c of d.breaking) console.log(red(`  ✗ ${c.where}: ${c.message}`));
        } else console.log(green('\nNo breaking changes.'));
        if (d.nonBreaking.length) {
          console.log(dim(`\n${d.nonBreaking.length} other change${d.nonBreaking.length > 1 ? 's' : ''}:`));
          for (const c of d.nonBreaking) console.log(dim(`  · ${c.where}: ${c.message}`));
        }
      }
      if (o.failOnBreaking && d.breaking.length) process.exitCode = EXIT.TEST_FAILURE;
    });
  program
    .command('export')
    .description('export a collection as a Postman v2.1 collection (default), TestPion JSON, or an OpenAPI 3.1 document (--format openapi)\n<collection> is a collection name or id in the workspace, or a collection file to convert')
    .argument('<collection>', 'collection name or id, a file, or an http(s) link')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .addOption(new Option('-f, --format <format>', 'output format').choices(['postman', 'testpion', 'openapi']).default('postman'))
    .option('--json', 'with --format openapi: JSON instead of YAML')
    .option('-o, --out <file>', 'write to this file instead of stdout')
    .action(async (ref: string, o: { workspace?: string; format: 'postman' | 'testpion' | 'openapi'; json?: boolean; out?: string }) => {
      const c = await loadCollectionRef(ref, o.workspace);
      if (o.format === 'openapi') {
        const text = collectionToOpenApiText(c, { format: o.json ? 'json' : 'yaml' });
        if (o.out) {
          writeFileSync(resolve(o.out), text);
          console.error(dim(`OpenAPI document written to ${resolve(o.out)}`));
        } else process.stdout.write(text);
        return;
      }
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
    .description('write Markdown or HTML (--html) documentation for a collection (descriptions, requests, parameters, examples; secrets masked)\n<collection> is a collection name or id in the workspace, or a TestPion / Postman v2.1 collection or OpenAPI file or link')
    .argument('<collection>', 'collection name or id, a file, or an http(s) link')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('-o, --out <file>', 'write to this file instead of stdout')
    .option('--no-examples', 'leave out saved examples')
    .option('--html', 'a self-contained HTML page (sidebar, search, copy buttons) to publish or share')
    .action(async (ref: string, o: { workspace?: string; out?: string; examples?: boolean; html?: boolean }) => {
      const c = await loadCollectionRef(ref, o.workspace);
      const md = o.html ? collectionHtml(c, { examples: o.examples }) : collectionMarkdown(c, { examples: o.examples });
      if (o.out) {
        writeFileSync(resolve(o.out), md);
        console.error(dim(`Documentation written to ${resolve(o.out)}`));
      } else process.stdout.write(md);
    });
  program
    .command('import')
    .description('import OpenAPI/Swagger, Postman, Insomnia, Bruno, Hoppscotch, HAR, .env or collection files, or a copied cURL / fetch / PowerShell request, into a workspace')
    .argument('<file>', 'file to import, an http(s) link to download (OpenAPI URL, GitHub file, Postman API link), or - to read stdin (e.g. a cURL command from the clipboard)')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--collection <name>', 'for a cURL / fetch / PowerShell request: the collection to add it to (created if needed)', 'Imported')
    .option('--folder <path>', 'for a request: folder path inside the collection, e.g. "Auth / Tokens"')
    .option('--name <name>', 'for a request: its name (default: method and path)')
    .option('--no-contract-checks', 'for an OpenAPI document: do not add openapi contract checks to the requests')
    .option('--json', 'print the result as JSON (for scripts and AI agents)')
    .action(async (file: string, o) => {
      const mgr = new WorkspaceManager();
      const { store } = openWorkspace(o.workspace, undefined, mgr);
      try {
        const link = /^https?:\/\//i.test(file) ? await fetchImportText(file) : undefined;
        const text = link ? link.text : file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
        const source = link?.fileName ?? file;
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
        const r = importIntoWorkspace(store, text, { contractChecks: o.contractChecks !== false, name: dotenvName(source) });
        if (o.json) console.log(JSON.stringify({ format: r.format, collection: r.collection?.name, collectionId: r.collection?.id, environment: r.environment?.name, environments: r.environments?.map((e) => e.name), secretsToSet: r.secretsToSet, specPath: r.specPath, contractChecks: r.contractChecks, scriptWarnings: r.scriptWarnings }, null, 2));
        else {
          console.log(green(`Imported ${r.format}: ${r.collection ? `collection "${r.collection.name}"` : ''}${r.environments?.length ? ` ${r.environments.length > 1 ? 'environments' : 'environment'} ${r.environments.map((e) => `"${e.name}"`).join(', ')}` : ''}`));
          if (r.specPath) console.log(dim(`Kept the document as ${r.specPath}${r.contractChecks ? `; ${r.contractChecks} requests check the OpenAPI contract` : ''}`));
          if (r.scriptWarnings?.length) {
            console.log(yellow(`${r.scriptWarnings.length} script${r.scriptWarnings.length > 1 ? 's use' : ' uses'} something TestPion's sandbox doesn't have:`));
            for (const w of r.scriptWarnings) console.log(yellow(`  ${w.where} (${w.script} script): ${w.api}; ${w.hint}`));
          }
          if (r.secretsToSet?.length) console.log(yellow(`Secret values were not saved (set them in the app, or as TESTPION_SECRET_* variables): ${r.secretsToSet.join(', ')}`));
        }
      } finally {
        store.close();
      }
    });
  program
    .command('scripts')
    .description('script tools')
    .command('convert')
    .description("rewrite collection scripts between Postman's pm.* and TestPion's tp.* (both always work)")
    .requiredOption('-w, --workspace <nameOrPath>')
    .requiredOption('--to <tp|pm>', 'the name to use')
    .option('--collection <nameOrId>', 'only this collection (default: all)')
    .option('--dry-run', 'only report what would change')
    .option('--json', 'print the result as JSON')
    .action((o) => {
      if (o.to !== 'tp' && o.to !== 'pm') throw new CliError('--to must be tp or pm', EXIT.CONFIG_ERROR);
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const want = o.collection ? String(o.collection).toLowerCase() : undefined;
        const cols = store.listCollections().filter((c) => !c.problem && (!want || c.id.toLowerCase() === want || c.name.toLowerCase() === want));
        if (want && !cols.length) throw new CliError(`No collection "${o.collection}"`, EXIT.CONFIG_ERROR);
        const results = cols.map((c) => {
          const r = convertCollectionScripts(c, o.to === 'tp' ? 'pm' : 'tp', o.to);
          if (!o.dryRun && r.changed) store.saveCollection(r.collection);
          return { collection: c.name, changed: r.changed, replacements: r.replacements, skipped: r.skipped };
        });
        if (o.json) console.log(JSON.stringify({ to: o.to, dryRun: !!o.dryRun, results }, null, 2));
        else
          for (const r of results)
            console.log(`${r.changed ? green(`${o.dryRun ? 'Would convert' : 'Converted'} ${r.changed} script(s)`) : dim('No change')} in "${r.collection}"${r.skipped.length ? yellow(` (${r.skipped.length} skipped: ${r.skipped.map((s) => s.where).join(', ')})`) : ''}`);
      } finally {
        store.close();
      }
    });
  const histCmd = program.command('history').description('response history of requests sent in the app, and comparing two responses');
  histCmd
    .command('export-har')
    .description('write HTTP and GraphQL history as a HAR file (browser devtools and other tools open it; secrets masked)')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('-q, --query <text>', 'only entries matching this text (name, URL, method, status)')
    .option('-n, --limit <n>', 'how many, newest first', '500')
    .option('-o, --out <file>', 'write here (default: print it)')
    .action((o) => {
      const mgr = new WorkspaceManager();
      const { store } = openWorkspace(o.workspace, undefined, mgr);
      try {
        const items = store.meta.listHistory({ query: o.query, limit: Math.min(Number(o.limit) || 500, 2000) }).items;
        const har = historyToHar(store, items, new Redactor(mgr.loadSettings().redactFields));
        const text = JSON.stringify(har, null, 2) + '\n';
        if (o.out) {
          writeFileSync(resolve(o.out), text);
          console.log(green(`Wrote ${(har.log as { entries: unknown[] }).entries.length} entries to ${resolve(o.out)}`));
        } else process.stdout.write(text);
      } finally {
        store.close();
      }
    });
  histCmd
    .command('list')
    .description('recent responses, newest first (optionally of one saved request)')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--collection <nameOrId>', 'collection of --request')
    .option('--request <nameOrId>', 'only responses of this saved request')
    .option('-n, --limit <n>', 'how many', '20')
    .option('--json', 'print as JSON')
    .action((o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const requestId = o.request ? savedRequestId(store, o.request, o.collection) : undefined;
        const items = store.meta.listHistory({ requestId, kind: requestId ? 'http' : undefined, limit: Math.min(Number(o.limit) || 20, 500) }).items;
        const rows = items.map((h) => ({ id: h.id, timestamp: h.timestamp, kind: h.kind, name: h.name, method: h.method, status: h.status, durationMs: h.durationMs, size: h.size }));
        if (o.json) console.log(JSON.stringify(rows, null, 2));
        else for (const r of rows) console.log(`${dim(r.id)}  ${r.timestamp}  ${String(r.status ?? '').padEnd(4)} ${r.method ?? r.kind} ${r.name}  ${dim(formatDuration(r.durationMs ?? 0))}`);
      } finally {
        store.close();
      }
    });
  histCmd
    .command('stats')
    .description("response-time summary of a saved request's recent responses: median, p95, slowest, failed")
    .requiredOption('-w, --workspace <nameOrPath>')
    .requiredOption('--request <nameOrId>', 'saved request')
    .option('--collection <nameOrId>', 'collection of --request')
    .option('-n, --limit <n>', 'how many recent responses', '50')
    .option('--json', 'print as JSON')
    .action((o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const requestId = savedRequestId(store, o.request, o.collection);
        const s = responseTimeStats(store.meta.listHistory({ requestId, kind: 'http', limit: Math.min(Number(o.limit) || 50, 500) }).items);
        if (o.json) console.log(JSON.stringify(s, null, 2));
        else if (!s.count) console.log('No responses yet. Send the request from the app first.');
        else {
          const f = (v?: number) => formatDuration(v ?? 0);
          console.log(`${s.count} responses: median ${f(s.p50Ms)}, p95 ${f(s.p95Ms)}, fastest ${f(s.minMs)}, slowest ${f(s.maxMs)}, mean ${f(s.meanMs)}`);
          console.log(s.failed ? red(`${s.failed} failed`) : green('none failed'));
        }
      } finally {
        store.close();
      }
    });
  histCmd
    .command('diff')
    .description('compare two responses from the history (older first): status, timing, headers and a field-by-field body diff')
    .argument('<before>', 'history id of the older response')
    .argument('<after>', 'history id of the newer response')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print the diff as JSON')
    .action((before: string, after: string, o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        // values of sensitive fields and headers are masked (agents read this output too)
        const r = redactDiff(compareHistory(store, before, after), new Redactor(new WorkspaceManager().loadSettings().redactFields));
        if (o.json) console.log(JSON.stringify(r, null, 2));
        else {
          console.log(`${r.diff.different ? yellow('Changed') : green('Same')}: ${r.diff.summary}`);
          for (const c of r.diff.body.changes) console.log(`  ${c.kind === 'added' ? green('+') : c.kind === 'removed' ? red('-') : yellow('~')} ${c.path}  ${c.kind === 'added' ? JSON.stringify(c.after) : c.kind === 'removed' ? JSON.stringify(c.before) : `${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`}`);
          for (const l of r.diff.body.lines ?? []) if (l.op !== ' ') console.log(`  ${l.op === '+' ? green('+') : red('-')} ${l.text}`);
          for (const h of r.diff.headers.filter((x) => !x.volatile)) console.log(`  header ${h.name}: ${h.before ?? '(none)'} -> ${h.after ?? '(none)'}`);
        }
        process.exitCode = 0;
      } finally {
        store.close();
      }
    });
  program
    .command('ci')
    .description('write a CI pipeline that runs a suite, a collection or test files: GitHub Actions, GitLab CI, Azure Pipelines or Jenkins')
    .argument('<provider>', 'github, gitlab, azure or jenkins')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--suite <name>', 'run tests/<name>.suite.yaml')
    .option('--collection <nameOrId>', 'run a collection')
    .option('--folder <nameOrId>', 'with --collection: only this folder or request (repeatable)', (v: string, prev: string[] = []) => [...prev, v])
    .option('--tests <paths...>', 'test files or folders under tests/ (default: all)')
    .option('-e, --environment <name>', 'environment to run with')
    .option('--workspace-dir <path>', 'the workspace folder relative to the repository root', '.')
    .option('--openapi <file>', 'OpenAPI document in the repository: pull requests fail on breaking changes against the target branch')
    .option('-o, --out <file>', 'write the file here (default: print it)')
    .option('--json', 'print { path, content, secrets, command } as JSON')
    .action((provider: string, o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const c = ciConfig(store, { provider: provider as CiProvider, suite: o.suite, collection: o.collection, folders: o.folder, tests: o.tests, environment: o.environment, workspaceDir: o.workspaceDir, openapi: o.openapi });
        if (o.json) return console.log(JSON.stringify(c, null, 2));
        if (o.out) {
          writeFileSync(resolve(o.out), c.content);
          console.error(green(`Wrote ${o.out}`) + dim(` (usually ${c.path})`));
        } else process.stdout.write(c.content);
        if (c.secrets.length) console.error(dim(`CI secrets to create: ${c.secrets.map((x) => `${x.name} (${x.description})`).join(', ')}`));
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
  envCmd
    .command('diff')
    .description('compare two environments: variables missing on one side, different, disabled, or secrets set on one side only (exit 1 when they differ)')
    .argument('<left>', 'environment name or id')
    .argument('<right>', 'environment name or id')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--values', 'show values (secrets and sensitive-looking keys stay masked)')
    .option('--all', 'also list variables that are the same')
    .option('--request <nameOrId>', 'instead: send this saved request with both environments and diff the responses')
    .option('--collection <nameOrId>', 'collection of --request')
    .option('--json', 'print as JSON')
    .action(async (left: string, right: string, o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        if (o.request) {
          const cols = store.listCollections().filter((c) => !c.problem && (!o.collection || c.id === o.collection || c.name.toLowerCase() === String(o.collection).toLowerCase()));
          const want = String(o.request).toLowerCase();
          const collection = cols.find((c) => collectionRequests(c).some((r) => r.id === o.request || r.name.toLowerCase() === want));
          if (!collection) throw new CliError(`No saved request "${o.request}"`, EXIT.CONFIG_ERROR);
          for (const e of [left, right]) if (!store.getEnvironment(e)) throw new CliError(`No environment "${e}"`, EXIT.CONFIG_ERROR);
          const settings = new WorkspaceManager().loadSettings();
          const secrets = new ChainSecretStore([new EnvSecretStore()]);
          const r = await compareRequestAcrossEnvironments({ collection, request: o.request, left, right, context: (environment) => createEngineContext({ store, secrets, settings, environment, collectionId: collection.id }) });
          if (o.json) console.log(JSON.stringify(r, null, 2));
          else {
            const side = (x: typeof r.left) => `${bold(x.environment)} ${x.error ? red(x.error) : `${x.status} ${dim(formatDuration(x.durationMs ?? 0))}`}`;
            console.log(`${r.request}: ${side(r.left)} vs ${side(r.right)}`);
            console.log(`${r.diff.different ? yellow('Different') : green('Same')}: ${r.diff.summary}`);
            for (const c of r.diff.body.changes) console.log(`  ${c.kind === 'added' ? green('+') : c.kind === 'removed' ? red('-') : yellow('~')} ${c.path}  ${c.kind === 'added' ? JSON.stringify(c.after) : c.kind === 'removed' ? JSON.stringify(c.before) : `${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`}`);
            for (const h of r.diff.headers.filter((x) => !x.volatile)) console.log(`  header ${h.name}: ${h.before ?? '(none)'} -> ${h.after ?? '(none)'}`);
          }
          process.exitCode = r.diff.different ? EXIT.TEST_FAILURE : EXIT.SUCCESS;
          return;
        }
        const get = (ref: string) => {
          const e = store.getEnvironment(ref);
          if (!e) throw new CliError(`No environment "${ref}". Available: ${store.listEnvironments().map((x) => x.name).join(', ') || 'none'}`, EXIT.CONFIG_ERROR);
          return e;
        };
        const d = compareEnvironments(get(left), get(right), { values: !!o.values, secrets: new EnvSecretStore(), redactor: new Redactor(new WorkspaceManager().loadSettings().redactFields) });
        if (!o.all) d.rows = d.rows.filter((r) => r.status !== 'same');
        if (o.json) console.log(JSON.stringify(d, null, 2));
        else {
          const { summary: s } = d;
          console.log(`${bold(d.left)} vs ${bold(d.right)}: ${s.different} different, ${s.onlyLeft} only in ${d.left}, ${s.onlyRight} only in ${d.right}, ${s.same} same`);
          for (const r of d.rows) {
            const mark = r.status === 'same' ? dim('=') : r.status === 'different' ? yellow('~') : r.status === 'only-left' ? red('<') : green('>');
            const extra = [r.secret ? 'secret' : '', r.disabledLeft ? `disabled in ${d.left}` : '', r.disabledRight ? `disabled in ${d.right}` : ''].filter(Boolean).join(', ');
            const vals = o.values ? `  ${r.left ?? dim('(none)')} ${dim('→')} ${r.right ?? dim('(none)')}` : '';
            console.log(`  ${mark} ${r.key}${vals}${extra ? dim(`  (${extra})`) : ''}`);
          }
        }
        process.exitCode = d.summary.different + d.summary.onlyLeft + d.summary.onlyRight ? EXIT.TEST_FAILURE : EXIT.SUCCESS;
      } finally {
        store.close();
      }
    });
}

/** Id of a saved request by name or id (optionally within one collection). */
function savedRequestId(store: WorkspaceStore, request: string, collection?: string): string {
  const want = String(request).toLowerCase();
  const cols = store.listCollections().filter((c) => !c.problem && (!collection || c.id === collection || c.name.toLowerCase() === String(collection).toLowerCase()));
  const flat = (nodes: CollectionNode[]): CollectionNode[] => nodes.flatMap((n) => (n.kind === 'folder' ? flat(n.items) : [n]));
  const hit = cols.flatMap((c) => flat(c.items)).find((n) => n.id.toLowerCase() === want || n.name.toLowerCase() === want);
  if (!hit) throw new CliError(`No saved request "${request}"`, EXIT.CONFIG_ERROR);
  return hit.id;
}

/** The environment name for an imported .env file: ".env.staging" / "staging.env" → "staging" (else the default). */
function dotenvName(file: string): string | undefined {
  const base = file.split(/[\\/]/).pop() ?? '';
  if (!/(^\.env|\.env$)/.test(base)) return undefined;
  return base.replace(/^\.env\.?/, '').replace(/\.env$/, '') || undefined;
}
