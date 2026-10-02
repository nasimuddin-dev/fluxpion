// A copy of the examples from an older version gets what the bundled examples gained (and keeps the user's changes);
// the app says so once, with Open.
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { withExpect } = require('../lib.cjs');

/** The workspace as an older version installed it: no playground collection, no Context7 server, and a user's rename. */
const olderCopy = (ws) => {
  rmSync(join(ws, 'collections', 'public-rest.json'));
  const mcp = JSON.parse(readFileSync(join(ws, 'mcp-servers.json'), 'utf8'));
  mcp.servers = mcp.servers.filter((s) => s.id !== 'context7');
  mcp.servers.find((s) => s.id === 'deepwiki').name = 'My DeepWiki';
  writeFileSync(join(ws, 'mcp-servers.json'), JSON.stringify(mcp, null, 2));
};

const steps = [
  [
    'told-once',
    `(async () => {
      let toast = '';
      for (let i = 0; i < 40 && !toast; i++) { toast = [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent.trim()).find((t) => t.includes('New in the TestPion Examples')) ?? ''; if (!toast) await __t.sleep(150); }
      const again = await window.aps.invoke('ws.examplesAdded');
      return 'toast: ' + (toast || 'none') + ' | asked again: ' + again.length;
    })()`,
  ],
  [
    'added-and-kept',
    `(async () => {
      await __t.requests(); await __t.sleep(600);
      const rows = [...document.querySelectorAll('aside [data-tree-row]')].map((b) => b.textContent.trim());
      return 'playground: ' + rows.some((t) => t.startsWith('Public REST APIs (playground)')) + ' | context7: ' + rows.some((t) => t.startsWith('Context7')) + ' | renamed kept: ' + rows.some((t) => t.startsWith('My DeepWiki')) + ' | old name back: ' + rows.some((t) => /^DeepWiki/.test(t));
    })()`,
  ],
];

module.exports = withExpect(
  steps,
  {
    'told-once': /^toast: New in the TestPion Examples workspace: collection "Public REST APIs \(playground\)", MCP server "Context7 \(library docs\)".*Open \| asked again: 0$/,
    'added-and-kept': /^playground: true \| context7: true \| renamed kept: true \| old name back: false$/,
  },
  { prepare: olderCopy },
);
