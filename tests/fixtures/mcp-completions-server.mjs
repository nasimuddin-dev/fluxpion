// An MCP server (stdio) with argument completions (a prompt and a resource template) and a resource
// clients can subscribe to. For the tests of TestPion's MCP completions and subscriptions.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const SPECIES = ['cat', 'cattle', 'dog', 'donkey', 'horse'];
const PATIENTS = { 7: 'Rex', 8: 'Whiskers', 70: 'Bella' };
let visits = 0;

const server = new McpServer({ name: 'completions', version: '1.0.0' }, { capabilities: { resources: { subscribe: true } } });

server.registerPrompt(
  'triage',
  { description: 'Triage a patient', argsSchema: { species: completable(z.string(), (value) => SPECIES.filter((s) => s.startsWith(value))), symptom: z.string() } },
  ({ species, symptom }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Triage a ${species} with ${symptom}.` } }] }),
);

server.registerResource(
  'patient',
  new ResourceTemplate('patient://{id}', { list: undefined, complete: { id: (value) => Object.keys(PATIENTS).filter((id) => id.startsWith(value)) } }),
  { description: 'A patient by id' },
  async (uri, { id }) => ({ contents: [{ uri: uri.href, text: JSON.stringify({ id, name: PATIENTS[id] ?? null }) }] }),
);

server.registerResource('visits', 'clinic://visits', { description: 'Visits today' }, async (uri) => ({ contents: [{ uri: uri.href, text: String(visits) }] }));

const subscribed = new Set();
server.server.setRequestHandler(SubscribeRequestSchema, async (req) => (subscribed.add(req.params.uri), {}));
server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => (subscribed.delete(req.params.uri), {}));

server.registerTool('add_visit', { description: 'Adds a visit (clinic://visits changes)' }, async () => {
  visits++;
  if (subscribed.has('clinic://visits')) await server.server.sendResourceUpdated({ uri: 'clinic://visits' });
  return { content: [{ type: 'text', text: `visits: ${visits}` }] };
});

await server.connect(new StdioServerTransport());
