// A stdio MCP server is a program the workspace asks the computer to run (workspaces come from git, imports,
// teammates): the first Connect shows the exact command line and asks; "Always" is remembered for this workspace on
// this computer (.local/trust.json); the mock transport never asks.
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { withExpect } = require('../lib.cjs');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/** A stdio server whose command just exits: what matters is the question before it runs. */
function addStdioServer(ws) {
  const p = join(ws, 'mcp-servers.json');
  const list = JSON.parse(readFileSync(p, 'utf8'));
  list.servers.push({ id: 'trust-probe', name: 'Trust probe (stdio)', transport: 'stdio', command: 'node', args: ['-e', 'process.exit(0)'] });
  writeFileSync(p, JSON.stringify(list, null, 2));
}

const dialog = () => `[...document.querySelectorAll('[role=dialog], [role=alertdialog]')].find((d) => d.getClientRects().length && /Run this program/.test(d.textContent))`;
const steps = [
  [
    'first-connect-asks',
    `(async () => {
      await __t.requests();
      const f = document.querySelector('aside input[aria-label^="Filter"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, 'Trust probe'); f.dispatchEvent(new Event('input', { bubbles: true })); await __t.sleep(800);
      const r = [...document.querySelectorAll('aside [data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes('Trust probe')); if (!r) return 'NO ROW';
      r.click(); await __t.sleep(1200);
      [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Connect')?.click();
      const d = await __t.waitFor(() => ${dialog()}, 5000); if (!d) return 'NO DIALOG';
      const text = d.textContent.replace(/\\s+/g, ' ');
      const cancel = [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel'); cancel?.click(); await __t.sleep(600);
      return 'asked: ' + /node -e/.test(text) + ' | choices: ' + [...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).join(', ') + ' | cancelled: ' + !${dialog()};
    })()`,
  ],
  [
    'always-is-remembered',
    `(async () => {
      [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Connect')?.click();
      const d = await __t.waitFor(() => ${dialog()}, 5000); if (!d) return 'NO DIALOG';
      [...d.querySelectorAll('button')].find((b) => /Always/.test(b.textContent))?.click(); await __t.sleep(2500);
      const trusted = await window.aps.invoke('mcp.trusted');
      // the second connect does not ask (the program itself exits at once, so the connection fails: that is fine here)
      [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Connect')?.click(); await __t.sleep(1500);
      return 'remembered: ' + trusted.map((t) => t.command + ' ' + t.args.join(' ')).join('; ') + ' | asked again: ' + !!${dialog()};
    })()`,
  ],
];

module.exports = withExpect(
  steps,
  {
    'first-connect-asks': /^asked: true \| choices: Cancel, Run once, Always for this workspace \| cancelled: true$/,
    'always-is-remembered': /^remembered: node -e process.exit\(0\) \| asked again: false$/,
  },
  { prepare: addStdioServer, allowErrors: ['always-is-remembered'] },
);
