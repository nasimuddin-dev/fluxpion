/** Managing workspaces. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  WorkspaceManager,
  listTrash,
  purgeTrash,
  restoreFromTrash,
  makeGitReady,
  findCommittableSecrets,
  installPreCommitHook,
  gitSetupMergeDriver,
  isInGitRepository,
} from '@testpion/core';
import { EXIT, green, dim, bold, CliError, openWorkspace } from '../shared.js';
import { registerGitCommands } from './git.js';

/** This very CLI as a command line (forward slashes: git runs it with sh), for git hooks and the merge driver. */
const cliSelf = () => `"${process.execPath.split('\\').join('/')}" "${process.argv[1]!.split('\\').join('/')}"`;

export function registerWorkspaceCommands(program: Command): void {
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

  const git = program.command('git').description('keep a workspace in git (see the docs: Keep your workspace in git)');
  git
    .command('setup')
    .description('make a workspace git-ready: a .gitignore for results and local state, a .gitattributes for line endings, collection files in their git-friendly form; safe to run again')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest)')
    .option('--json', 'print what changed as JSON')
    .action(async (o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const r = makeGitReady(store);
        // in a repository: collection files merge request by request (this CLI is the merge driver)
        const mergeDriver = isInGitRepository(store.root) ? await gitSetupMergeDriver(store.root, `${cliSelf()} merge-driver`).then(() => true, () => false) : false;
        if (o.json) return console.log(JSON.stringify({ ...r, mergeDriver }, null, 2));
        if (mergeDriver) console.log(`${green('set up')} merging collections request by request ${dim('(git config merge.testpion)')}`);
        if (!r.files.length && !r.collections.length) console.log(green('Already git-ready.'));
        for (const f of r.files) console.log(`${green('wrote')} ${f}`);
        for (const c of r.collections) console.log(`${green('tidied')} ${c} ${dim('(no save counter / time in the file)')}`);
        if (!r.inRepository) console.log(dim(`Not a git repository yet: run  git init  in ${store.root}`));
      } finally {
        store.close();
      }
    });

  git
    .command('check')
    .description('before a commit: list secrets typed into the workspace (headers, auth, body fields, plain-text variables, MCP servers, providers) that a commit would publish; exit 1 if any')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest)')
    .option('--json', 'print the findings as JSON')
    .action((o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const found = findCommittableSecrets(store);
        if (o.json) console.log(JSON.stringify(found, null, 2));
        else if (!found.length) console.log(green('No secrets typed in: safe to commit.'));
        else {
          console.log(bold(`${found.length} secret${found.length === 1 ? '' : 's'} would be committed:`));
          for (const f of found) console.log(`  ${f.where} ${dim(`(${f.file})`)}\n    ${f.message}`);
        }
        if (found.length) process.exitCode = EXIT.TEST_FAILURE;
      } finally {
        store.close();
      }
    });
  git
    .command('hook')
    .description('git hooks for a workspace')
    .command('install')
    .description('install a pre-commit hook that runs `testpion git check` and refuses a commit that would publish a secret (an existing hook of yours is never overwritten)')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest)')
    .action((o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        // the hook can call this very CLI when `testpion` is not on the PATH (e.g. run from a checkout)
        const r = installPreCommitHook(store.root, cliSelf());
        console.log(r.installed ? `${green('installed')} ${r.path}` : r.message);
        if (!r.installed) process.exitCode = EXIT.TEST_FAILURE;
      } finally {
        store.close();
      }
    });

  registerGitCommands(git, program);

  const trash = program.command('trash').description('recently deleted collections and environments (kept 30 days): list, restore, empty');
  trash
    .command('list')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print as JSON')
    .action((o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const items = listTrash(store);
        if (o.json) return console.log(JSON.stringify(items, null, 2));
        if (!items.length) return console.log(dim('Nothing deleted in the last 30 days.'));
        for (const i of items) console.log(`${bold(i.name)}  ${dim(`${i.kind} · deleted ${i.deletedAt} · ${i.id}`)}`);
      } finally {
        store.close();
      }
    });
  trash
    .command('restore')
    .description('restore a deleted item (id from `trash list`); a name that is taken again gets "(restored)"')
    .argument('<id>')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--json', 'print the restored item as JSON')
    .action((id: string, o) => {
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        const r = restoreFromTrash(store, id);
        console.log(o.json ? JSON.stringify(r, null, 2) : green(`Restored ${r.kind} "${r.name}"`));
      } finally {
        store.close();
      }
    });
  trash
    .command('empty')
    .description('delete everything in the trash for good (or one item with --id)')
    .requiredOption('-w, --workspace <nameOrPath>')
    .option('--id <id>', 'only this item')
    .option('--yes', 'confirm; required, because this cannot be undone')
    .action((o) => {
      if (!o.yes) throw new CliError('Refusing to delete for good without --yes', EXIT.CONFIG_ERROR);
      const { store } = openWorkspace(o.workspace, undefined, new WorkspaceManager());
      try {
        console.log(green(`Deleted ${purgeTrash(store, o.id)} item(s) for good`));
      } finally {
        store.close();
      }
    });
}
