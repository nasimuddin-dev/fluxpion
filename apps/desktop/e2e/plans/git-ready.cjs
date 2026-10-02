// Git, phase 1: the open workspace is made ready for git from the workspace switcher's menu (.gitignore,
// .gitattributes, collection files without save counters); a second time there is nothing to do.
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { withExpect } = require('../lib.cjs');

const steps = [
  [
    'make-ready-from-workspace-menu',
    `(async () => {
      const switcher = [...document.querySelectorAll('header button, button')].find((b) => b.offsetParent && b.textContent.trim() === 'TestPion Examples');
      if (!switcher) return 'NO BUTTON switcher';
      switcher.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); switcher.click(); await __t.sleep(800);
      const more = await __t.waitFor(() => [...document.querySelectorAll('[aria-label^="More actions for TestPion Examples"]')].find((b) => b.offsetParent), 2000); if (!more) return 'NO BUTTON';
      more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      const item = await __t.waitFor(() => [...document.querySelectorAll('[role=menuitem]')].find((m) => m.textContent.trim() === 'Make ready for git'), 2000); if (!item) return 'NO MENU';
      item.click();
      const toast = await __t.waitFor(() => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent.trim()).find((t) => /git/i.test(t)), 4000);
      const again = await window.aps.invoke('ws.gitReady');
      return (toast ?? 'no toast') + ' | again: ' + again.files.length + ' files, ' + again.collections.length + ' collections';
    })()`,
  ],
];

module.exports = withExpect(steps, {
  // the bundled examples are already git-ready, so the action says so; a second run has nothing to do either
  'make-ready-from-workspace-menu': /(Ready for git|already ready for git).*not a git repository yet.* \| again: 0 files, 0 collections$/,
});
