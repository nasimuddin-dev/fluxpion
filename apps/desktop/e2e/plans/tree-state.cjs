// What the user folded stays folded: closing or switching tabs does not expand the collections again.
// Test files show what they test, in the same badge as the explorer's rows.
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { withExpect } = require('../lib.cjs');

const shown = `[...document.querySelectorAll('aside [data-tree-row]')].filter((b) => b.offsetParent).map((b) => b.textContent.trim())`;
const tabs = `[...document.querySelectorAll('[role=tablist][aria-label="Open requests"] [role=tab]')]`;
const requestRows = `${shown}.filter((t) => /^(GET|POST|PUT|PATCH|DELETE)/.test(t)).length`;

const steps = [
  [
    'open-two',
    `(async () => {
      await __t.requests();
      for (const t of ['HTTP basics', 'REST17', 'Requests & responses10']) { await __t.expand(t); await __t.sleep(250); }
      await __t.open('Custom headers'); await __t.open('Expect a 404');
      return 'tabs: ' + ${tabs}.length + ' | request rows shown: ' + ${requestRows};
    })()`,
  ],
  [
    'collapse-close-switch',
    `(async () => {
      document.querySelector('aside [aria-label="Collapse all"]').click(); await __t.sleep(500);
      const afterCollapse = ${requestRows};
      // close the active tab: the next one becomes active
      const active = ${tabs}.find((t) => t.getAttribute('aria-selected') === 'true');
      (active.querySelector('[aria-label^="Close"]') || active.parentElement.querySelector('[aria-label^="Close"]')).click(); await __t.sleep(900);
      const afterClose = ${requestRows};
      // and switch to another tab
      ${tabs}.find((t) => t.getAttribute('aria-selected') !== 'true')?.click(); await __t.sleep(900);
      return 'after collapse: ' + afterCollapse + ' | after close: ' + afterClose + ' | after switch: ' + ${requestRows};
    })()`,
  ],
  [
    'test-file-badges',
    `(async () => {
      await __t.view('Tests'); await __t.sleep(1000);
      const rows = [...document.querySelectorAll('main [data-tree-row], aside [data-tree-row], [data-tree-row]')].filter((b) => b.offsetParent && /\\.(ya?ml|json)$/.test(b.textContent.trim()));
      return rows.map((b) => b.textContent.trim()).filter((t) => /^(HTTP|GQL|gRPC|WS|MCP|AI|AGT|SUITE|YAML)/.test(t)).length + ' of ' + rows.length + ' files have a badge | ' + rows.slice(0, 4).map((b) => b.textContent.trim()).join(' / ');
    })()`,
  ],
];

module.exports = withExpect(steps, {
  'open-two': /^tabs: [2-9] \| request rows shown: (1\d|[2-9]\d)$/,
  'collapse-close-switch': /^after collapse: 0 \| after close: 0 \| after switch: 0$/,
  'test-file-badges': (r) => {
    const m = /^(\d+) of (\d+) files have a badge \| /.exec(r);
    return (m && +m[1] === +m[2] && +m[2] > 10) || 'every test file should have a badge';
  },
});
