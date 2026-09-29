/** Moving data in and out: import, export, docs, script conversion, response history and environments. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command, Option } from 'commander';
import {
  WorkspaceManager,
  formatDuration,
  importRequestSnippet,
  compareHistory,
  convertCollectionScripts,
  redactDiff,
  isRequestSnippet,
  Redactor,
  collectionMarkdown,
  exportPostmanCollection,
  exportPostmanEnvironment,
  type CollectionNode,
  importIntoWorkspace,
} from '@testpion/core';
import { EXIT, green, red, yellow, dim, CliError, openWorkspace, loadCollectionRef } from '../shared.js';

export function registerDataCommands(program: Command): void {
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
    .command('import')
    .description('import OpenAPI/Swagger, Postman, HAR or collection files, or a copied cURL / fetch / PowerShell request, into a workspace')
    .argument('<file>', 'file to import, or - to read stdin (e.g. a cURL command from the clipboard)')
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
        const r = importIntoWorkspace(store, text, { contractChecks: o.contractChecks !== false });
        if (o.json) console.log(JSON.stringify({ format: r.format, collection: r.collection?.name, collectionId: r.collection?.id, environment: r.environment?.name, specPath: r.specPath, contractChecks: r.contractChecks }, null, 2));
        else {
          console.log(green(`Imported ${r.format}: ${r.collection ? `collection "${r.collection.name}"` : ''}${r.environment ? ` environment "${r.environment.name}"` : ''}`));
          if (r.specPath) console.log(dim(`Kept the document as ${r.specPath}${r.contractChecks ? `; ${r.contractChecks} requests check the OpenAPI contract` : ''}`));
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
        let requestId: string | undefined;
        if (o.request) {
          const want = String(o.request).toLowerCase();
          const cols = store.listCollections().filter((c) => !c.problem && (!o.collection || c.id === o.collection || c.name.toLowerCase() === String(o.collection).toLowerCase()));
          const flat = (nodes: CollectionNode[]): CollectionNode[] => nodes.flatMap((n) => (n.kind === 'folder' ? flat(n.items) : [n]));
          const hit = cols.flatMap((c) => flat(c.items)).find((n) => n.id.toLowerCase() === want || n.name.toLowerCase() === want);
          if (!hit) throw new CliError(`No saved request "${o.request}"`, EXIT.CONFIG_ERROR);
          requestId = hit.id;
        }
        const items = store.meta.listHistory({ requestId, kind: requestId ? 'http' : undefined, limit: Math.min(Number(o.limit) || 20, 500) }).items;
        const rows = items.map((h) => ({ id: h.id, timestamp: h.timestamp, kind: h.kind, name: h.name, method: h.method, status: h.status, durationMs: h.durationMs, size: h.size }));
        if (o.json) console.log(JSON.stringify(rows, null, 2));
        else for (const r of rows) console.log(`${dim(r.id)}  ${r.timestamp}  ${String(r.status ?? '').padEnd(4)} ${r.method ?? r.kind} ${r.name}  ${dim(formatDuration(r.durationMs ?? 0))}`);
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
}
