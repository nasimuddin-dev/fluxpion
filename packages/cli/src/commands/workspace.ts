/** Managing workspaces. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  WorkspaceManager,
} from '@testpion/core';
import { EXIT, green, dim, CliError, openWorkspace } from '../shared.js';

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
}
