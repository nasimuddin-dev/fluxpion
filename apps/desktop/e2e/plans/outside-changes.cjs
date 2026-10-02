// Git, phase 1 (GIT-103): files changed outside the app (git pull, a branch switch, another editor) show up in the
// app by themselves, with a message; the app's own saves don't trigger it.
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { withExpect } = require('../lib.cjs');

const toasts = `[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent.trim()).filter((t) => /outside TestPion/.test(t))`;
const steps = [
  ['before', `(async () => { await __t.requests(); await __t.sleep(800); return 'collections: ' + [...document.querySelectorAll('aside [data-tree-row]')].filter((b) => b.offsetParent && b.getAttribute('aria-expanded') !== null && !/\\d$/.test(b.textContent.trim())).length + ' | messages: ' + ${toasts}.length; })()`, false],
  // another program renames a collection and adds a test file
  [
    'change-files-outside',
    `main:
      const { readFileSync, writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      const ws = join(home, 'ws');
      const p = join(ws, 'collections', 'httpbin.json');
      const c = JSON.parse(readFileSync(p, 'utf8'));
      c.name = 'HTTP basics (renamed in git)';
      writeFileSync(p, JSON.stringify(c, null, 2));
      writeFileSync(join(ws, 'tests', 'from-git.yaml'), 'tests:\\n  - name: added by a pull\\n    type: http\\n    method: GET\\n    url: https://example.com\\n');
      return 'written';`,
    false,
  ],
  [
    'app-shows-it',
    `(async () => {
      const seen = await __t.waitFor(() => [...document.querySelectorAll('aside [data-tree-row]')].some((b) => b.offsetParent && b.textContent.includes('renamed in git')), 5000);
      const msg = await __t.waitFor(() => ${toasts}[0], 3000);
      await __t.view('Tests'); await __t.sleep(800);
      const test = [...document.querySelectorAll('[data-tree-row]')].some((b) => b.offsetParent && b.textContent.trim().endsWith('from-git.yaml'));
      return 'tree updated: ' + !!seen + ' | test file listed: ' + test + ' | message: ' + (msg ?? 'none');
    })()`,
  ],
  // the app's own save is not "outside"
  [
    'own-save-is-quiet',
    `(async () => {
      await __t.sleep(5000); // the first message has gone
      const before = ${toasts}.length;
      const c = (await window.aps.invoke('col.list')).find((x) => x.id === 'httpbin');
      await window.aps.invoke('col.save', { ...c, name: 'HTTP basics (httpbin)' }); await __t.sleep(2500);
      return 'new messages after own save: ' + (${toasts}.length - before);
    })()`,
  ],
];

module.exports = withExpect(steps, {
  'change-files-outside': /^written$/,
  'app-shows-it': /^tree updated: true \| test file listed: true \| message: .*1 collection, 1 test file changed outside TestPion/,
  'own-save-is-quiet': /^new messages after own save: 0$/,
});
