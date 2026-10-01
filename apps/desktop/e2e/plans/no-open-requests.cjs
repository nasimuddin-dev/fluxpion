// Closing tabs: the nearest tab is shown; with none, No open requests with the same buttons in every view.
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { withExpect, allUnder } = require('../lib.cjs');
const state = `'view tabs: ' + [...document.querySelectorAll('[role=tablist][aria-label="Open requests"] [role=tab]')].map((t) => t.textContent.trim()).join(' / ') + ' || buttons: ' + [...document.querySelectorAll('main button')].filter((b) => b.offsetParent && ['Add MCP server', 'New request', 'Describe with AI', 'New GraphQL request'].includes(b.textContent.trim())).map((b) => b.textContent.trim()).join(' | ')`;
const steps = [
  ['open-mcp', `(async () => { await __t.requests(); await __t.sleep(500); await __t.expand('MCP servers'); const r = [...document.querySelectorAll('button[data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes('Weather')); r?.click(); await __t.sleep(1500); return ${state}; })()`],
  ['close-mcp-tab', `(async () => { const t = [...document.querySelectorAll('[role=tablist][aria-label="Open requests"] [role=tab]')].find((x) => x.textContent.includes('Weather')); if (!t) return 'NO TAB'; const x = t.querySelector('[aria-label^="Close"]') || t.parentElement.querySelector('[aria-label^="Close"]'); if (!x) return 'NO CLOSE BUTTON: ' + t.outerHTML.slice(0, 300); x.click(); await __t.sleep(1200); return ${state}; })()`],
];
steps.push(
  ['close-rest-then-mcp', `(async () => {
    const tabs = () => [...document.querySelectorAll('[role=tablist][aria-label="Open requests"] [role=tab]')];
    const close = async (txt) => { const t = tabs().find((x) => x.textContent.includes(txt)); const x = t && (t.querySelector('[aria-label^="Close"]') || t.parentElement.querySelector('[aria-label^="Close"]')); x?.click(); await __t.sleep(1200); };
    await close('Untitled');
    await __t.requests(); await __t.sleep(400);
    const r = [...document.querySelectorAll('button[data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes('Weather')); r?.click(); await __t.sleep(1500);
    await close('Weather');
    return 'tabs: ' + tabs().length + ' || buttons: ' + [...document.querySelectorAll('main button')].filter((b) => b.offsetParent && ['Add MCP server', 'New request', 'Describe with AI', 'New GraphQL request'].includes(b.textContent.trim())).map((b) => b.textContent.trim()).join(' | ');
  })()`],
);
steps.push(
  ['close-every-tab', `(async () => {
    const tabs = () => [...document.querySelectorAll('[role=tablist][aria-label="Open requests"] [role=tab]')];
    for (let i = 0; i < 8 && tabs().length; i++) { const t = tabs()[0]; const x = t.querySelector('[aria-label^="Close"]') || t.parentElement.querySelector('[aria-label^="Close"]'); x?.click(); await __t.sleep(900); }
    return 'view: ' + document.querySelector('nav [aria-current="page"]')?.getAttribute('aria-label') + ' | tabs: ' + tabs().length + ' || buttons: ' + [...document.querySelectorAll('main button')].filter((b) => b.offsetParent && ['Add MCP server', 'New request', 'Describe with AI', 'New GraphQL request'].includes(b.textContent.trim())).map((b) => b.textContent.trim()).join(' | ');
  })()`],
);

module.exports = withExpect(steps, {
  'close-every-tab': /tabs: 0 \|\| buttons: New request \| Describe with AI$/,
});
