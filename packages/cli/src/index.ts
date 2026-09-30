import { Command, CommanderError } from 'commander';
import {
  ApsError,
  normalizeError,
  ENGINE_VERSION,
} from '@testpion/core';
import { EXIT, red, dim, CliError } from './shared.js';
import { registerRunCommands } from './commands/run.js';
import { registerServeCommands } from './commands/serve.js';
import { registerDataCommands } from './commands/data.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerMonitorCommands } from './commands/monitor.js';

/** The testpion command line: one module per area of commands (commands/*.ts). */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('testpion')
    .description('TestPion CLI — run REST, GraphQL, MCP and AI tests locally and in CI/CD.\n\nExit codes: 0 success · 1 test failure · 2 configuration error · 3 execution error')
    .version(ENGINE_VERSION);

  registerRunCommands(program);
  registerServeCommands(program);
  registerDataCommands(program);
  registerWorkspaceCommands(program);
  registerMonitorCommands(program);

  return program;
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
