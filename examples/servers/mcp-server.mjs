#!/usr/bin/env node
/**
 * Example "Customer MCP" server (stdio transport) used by the example workspace,
 * integration tests and documentation. Exposes tools, resources, a resource template and a prompt.
 *
 *   node examples/servers/mcp-server.mjs
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const customers = {
  123: { id: '123', name: 'Ada Lovelace', pets: ['Byron (cat)'], tier: 'gold' },
  456: { id: '456', name: 'Alan Turing', pets: ['Enigma (dog)'], tier: 'silver' },
};

const server = new McpServer({ name: 'customer-mcp', version: '1.0.0' }, { instructions: 'Customer lookup and appointment booking for a veterinary clinic.' });

server.registerTool(
  'search_customer',
  {
    title: 'Search customer',
    description: 'Look up a customer by id.',
    inputSchema: { customer_id: z.string().describe('Customer id, e.g. "123"') },
    outputSchema: { customer: z.object({ id: z.string(), name: z.string(), pets: z.array(z.string()), tier: z.string() }).nullable() },
  },
  async ({ customer_id }) => {
    const customer = customers[customer_id] ?? null;
    return {
      content: [{ type: 'text', text: JSON.stringify({ customer }) }],
      structuredContent: { customer },
      isError: !customer,
    };
  },
);

server.registerTool(
  'create_appointment',
  {
    title: 'Create appointment',
    description: 'Book an appointment for a customer.',
    inputSchema: { customer_id: z.string(), date: z.string().describe('ISO date'), reason: z.string().optional() },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async ({ customer_id, date, reason }) => {
    if (!customers[customer_id]) return { content: [{ type: 'text', text: `Unknown customer ${customer_id}` }], isError: true };
    const appt = { id: `appt-${Date.now().toString(36)}`, customer_id, date, reason: reason ?? 'checkup', status: 'booked' };
    return { content: [{ type: 'text', text: JSON.stringify(appt) }] };
  },
);

server.registerTool(
  'delete_customer',
  { title: 'Delete customer', description: 'Permanently delete a customer (dangerous — agents should not call this).', inputSchema: { customer_id: z.string() }, annotations: { destructiveHint: true } },
  async ({ customer_id }) => ({ content: [{ type: 'text', text: `Customer ${customer_id} deleted` }] }),
);

server.registerTool('slow_echo', { description: 'Echo after a delay (for timeout tests).', inputSchema: { text: z.string(), delay_ms: z.number().default(500) } }, async ({ text, delay_ms }) => {
  await new Promise((r) => setTimeout(r, delay_ms));
  return { content: [{ type: 'text', text }] };
});

server.registerResource('clinic-info', 'clinic://info', { title: 'Clinic info', mimeType: 'application/json' }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ name: 'Happy Paws Clinic', hours: '08:00-18:00', phone: '+1-555-0100' }) }],
}));

server.registerResource(
  'customer',
  new ResourceTemplate('customer://{id}', { list: async () => ({ resources: Object.keys(customers).map((id) => ({ uri: `customer://${id}`, name: `Customer ${id}` })) }) }),
  { title: 'Customer record', mimeType: 'application/json' },
  async (uri, { id }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(customers[id] ?? null) }] }),
);

server.registerPrompt(
  'summarize_customer',
  { title: 'Summarize customer', description: 'Prompt to summarise a customer record.', argsSchema: { customer_id: z.string() } },
  ({ customer_id }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Summarise this customer for a vet receptionist:\n${JSON.stringify(customers[customer_id] ?? {})}` } }],
  }),
);

await server.connect(new StdioServerTransport());
console.error('customer-mcp ready on stdio');
