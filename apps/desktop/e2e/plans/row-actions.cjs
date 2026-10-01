// One ⋯ per row: its menu starts with what + did.
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { withExpect, allUnder } = require('../lib.cjs');
const menu = `[...document.querySelectorAll('[role=menuitem]')].map((x) => x.textContent.trim()).slice(0, 6).join(' | ')`;
const steps = [
  ['explorer', `(async () => { await __t.requests(); await __t.sleep(800); const aside = document.querySelector('aside'); return 'plus buttons in rows: ' + [...aside.querySelectorAll('button[aria-label^="New HTTP request in"], button[aria-label^="Add an MCP"], button[aria-label^="Import an OpenAPI"]')].length + ' | ⋯ buttons: ' + aside.querySelectorAll('[aria-label^="More actions for"]').length; })()`],
  ['collection-menu', `(async () => { const r = [...document.querySelectorAll('button[data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes('HTTP basics')); r.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); await __t.sleep(600); return ${menu}; })()`],
  ['mcp-menu', `(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await __t.sleep(400); const b = [...document.querySelectorAll('[aria-label="More actions for MCP servers"]')].find((x) => x.offsetParent); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await __t.sleep(600); return ${menu}; })()`],
  ['new-from-menu', `(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await __t.sleep(400); const before = document.querySelectorAll('[role=tablist][aria-label="Open requests"] [role=tab]').length; const r = [...document.querySelectorAll('button[data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes('HTTP basics')); r.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); await __t.sleep(600); [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.trim() === 'New HTTP request').click(); await __t.sleep(1200); return 'tabs ' + before + ' -> ' + document.querySelectorAll('[role=tablist][aria-label="Open requests"] [role=tab]').length; })()`],
  ['monitors-header', `(async () => { await __t.view('Monitors'); await __t.sleep(700); const b = [...document.querySelectorAll('[aria-label^="More actions for Monitors"]')].find((x) => x.offsetParent); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await __t.sleep(600); return ${menu}; })()`],
];

module.exports = withExpect(steps, {
  explorer: /plus buttons in rows: 0/,
  'collection-menu': /^New HTTP request \| New folder/,
  'mcp-menu': /^Add an MCP server \| New folder/,
  'new-from-menu': (r) => { const m = /tabs (\d+) -> (\d+)/.exec(r); return (m && +m[2] === +m[1] + 1) || 'a new tab should open'; },
  'monitors-header': /^New monitor \| New folder/,
});
