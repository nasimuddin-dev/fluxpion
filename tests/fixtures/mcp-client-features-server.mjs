// An MCP server (stdio) whose tools ask the client for things: user input (elicitation), an LLM
// completion (sampling) and its roots. For the tests of TestPion's MCP client features.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'client-features', version: '1.0.0' });
const text = (t) => ({ content: [{ type: 'text', text: t }] });

server.registerTool('book_visit', { description: 'Books a visit, asking the user for the date' }, async () => {
  const r = await server.server.elicitInput({
    message: 'When should Rex come in?',
    requestedSchema: {
      type: 'object',
      properties: { date: { type: 'string', title: 'Date', format: 'date' }, urgent: { type: 'boolean', title: 'Urgent' } },
      required: ['date'],
    },
  });
  if (r.action !== 'accept') return text(`booking ${r.action}d`);
  return { content: [{ type: 'text', text: `booked for ${r.content.date}` }], structuredContent: { booked: true, date: r.content.date, urgent: !!r.content.urgent } };
});

server.registerTool('summarize_notes', { description: 'Summarises notes with the client’s model' }, async () => {
  const r = await server.server.createMessage({ messages: [{ role: 'user', content: { type: 'text', text: 'Summarise: Rex, 7, limping on the left hind leg.' } }], systemPrompt: 'You are a vet assistant.', maxTokens: 100 });
  return text(`summary (${r.model}): ${r.content.type === 'text' ? r.content.text : ''}`);
});

server.registerTool('list_roots', { description: 'Lists the client’s roots' }, async () => {
  const r = await server.server.listRoots();
  return text(r.roots.map((x) => x.uri).join(', ') || '(none)');
});

await server.connect(new StdioServerTransport());
