/** Servers and inspectors: the workspace MCP server, mock servers (REST, MCP, GraphQL) and the MCP inspector. */
import { readFileSync, rmSync } from 'node:fs';
import { Command } from 'commander';
import {
  ChainSecretStore,
  EnvSecretStore,
  McpSession,
  WorkspaceManager,
  loadMcpMock,
  serveMcpMockStdio,
  startMcpMockHttp,
  startGraphQLMockServer,
  schemaFromText,
  introspect,
  setNetworkPolicy,
  serveTestPionMcp,
  ENGINE_VERSION,
  type McpServerConfig,
} from '@testpion/core';
import { EXIT, dim, bold, cyan, CliError, openWorkspace } from '../shared.js';
import { executeMock } from '../run.js';

export function registerServeCommands(program: Command): void {
  program
    .command('mcp-server')
    .description('serve a workspace to AI agents over MCP (stdio): list and read collections, send requests, run collections')
    .option('-w, --workspace <nameOrPath>', 'workspace name or directory (default: nearest workspace.json)')
    .option('--read-only', 'only the browsing tools: no requests are sent')
    .option('--allow-production', 'allow sending to environments marked as production')
    .option('--block-private-networks', 'refuse requests to localhost, private and cloud-metadata addresses (for shared or hosted use)')
    .option('--allow-host <host...>', 'with --block-private-networks: hosts that stay reachable')
    .action(async (o: { workspace?: string; readOnly?: boolean; allowProduction?: boolean; blockPrivateNetworks?: boolean; allowHost?: string[] }) => {
      if (o.blockPrivateNetworks) setNetworkPolicy({ blockPrivateNetworks: true, allowHosts: o.allowHost ?? [] });
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
    .command('mock-mcp')
    .description('serve a fake MCP server from a mock definition (*.mcp-mock.yaml): over stdio for AI agents, or --http on localhost')
    .argument('<file>', 'mock definition (YAML or JSON)')
    .option('--http', 'serve Streamable HTTP on localhost instead of stdio')
    .option('-p, --port <port>', 'port for --http (default: any free port)')
    .action(async (file: string, o: { http?: boolean; port?: string }) => {
      const def = loadMcpMock(readFileSync(file, 'utf8'));
      if (!o.http) {
        // stdout carries the MCP protocol: messages go to stderr
        console.error(dim(`MCP mock "${def.name}" on stdio: ${(def.tools ?? []).length} tools`));
        await serveMcpMockStdio(def);
        return;
      }
      const server = await startMcpMockHttp(def, { port: o.port ? Number(o.port) : 0 });
      console.log(bold(`MCP mock "${def.name}": ${server.url}`));
      console.log(dim(`Tools: ${(def.tools ?? []).map((t) => t.name).join(', ') || 'none'}. Press Ctrl+C to stop.`));
      await new Promise<void>((done) => {
        const stop = () => {
          process.off('SIGINT', stop);
          void server.close().then(done);
        };
        process.on('SIGINT', stop);
      });
    });
  program
    .command('mock-graphql')
    .description('serve fake, correctly typed data for any query against a GraphQL schema, on localhost until Ctrl+C')
    .option('--schema <file>', 'schema file: SDL (.graphql) or an introspection result (.json)')
    .option('--endpoint <url>', 'or: introspect this GraphQL endpoint')
    .option('-p, --port <port>', 'port to listen on (default: any free port)')
    .option('--overrides <file>', 'JSON file with fixed values per type, e.g. {"Patient": {"name": "Rex"}}')
    .option('--list-length <n>', 'items in every list', '2')
    .option('--delay <ms>', 'delay every response by this many ms')
    .action(async (o: { schema?: string; endpoint?: string; port?: string; overrides?: string; listLength?: string; delay?: string }) => {
      if (!o.schema === !o.endpoint) throw new CliError('Give --schema <file> or --endpoint <url>', EXIT.CONFIG_ERROR);
      const schema = o.schema ? schemaFromText(readFileSync(o.schema, 'utf8')) : (await introspect({ endpoint: o.endpoint! })).schema;
      const overrides = o.overrides ? (JSON.parse(readFileSync(o.overrides, 'utf8')) as Record<string, Record<string, unknown>>) : undefined;
      const server = await startGraphQLMockServer(schema, { port: o.port ? Number(o.port) : 0, overrides, listLength: Number(o.listLength) || 2, delayMs: o.delay ? Number(o.delay) : undefined });
      console.log(bold(`GraphQL mock: ${server.url}`));
      console.log(dim(`Queries: ${Object.keys(schema.getQueryType()?.getFields() ?? {}).join(', ') || 'none'}. Press Ctrl+C to stop.`));
      await new Promise<void>((done) => {
        const stop = () => {
          process.off('SIGINT', stop);
          void server.close().then(done);
        };
        process.on('SIGINT', stop);
      });
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
}
