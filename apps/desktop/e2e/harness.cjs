/**
 * Runs an end-to-end plan inside the app's main process (TESTPION_CAPTURE_SCRIPT points here; see run-e2e.mjs).
 * Each step's code runs in the window; its result, a screenshot and the window's console errors go to
 * E2E_OUT/report.json. The runner (run-e2e.mjs) checks the results against the plan's expectations.
 *
 * Env: E2E_PLAN (plan file), E2E_OUT (output folder), E2E_STUB_OPEN / E2E_STUB_SAVE (answer the next native
 * open / save dialogs with this path; E2E_STUB_SAVE=CANCEL cancels).
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run(win) {
  const OUT = process.env.E2E_OUT;
  const { dialog } = require('electron');
  if (process.env.E2E_STUB_OPEN) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.E2E_STUB_OPEN] });
  if (process.env.E2E_STUB_SAVE)
    dialog.showSaveDialog = async () => (process.env.E2E_STUB_SAVE === 'CANCEL' ? { canceled: true, filePath: '' } : { canceled: false, filePath: process.env.E2E_STUB_SAVE });
  const errors = [];
  const steps = [];
  win.webContents.on('console-message', (e, level, message) => {
    const lvl = typeof level === 'number' ? level : e?.level;
    const msg = typeof message === 'string' ? message : e?.message;
    if (lvl === 3 || lvl === 'error') errors.push(String(msg).slice(0, 400));
  });
  win.setContentSize(1440, 900);
  win.show();
  await sleep(6000);
  const js = (code) => win.webContents.executeJavaScript(code).catch((e) => `ERR ${e.message}`);
  await js(readFileSync(join(__dirname, 'helpers.js'), 'utf8'));
  const plan = require(process.env.E2E_PLAN);
  let n = 0;
  for (const step of plan) {
    const [name, code, shot = true] = step;
    const errorsBefore = errors.length;
    const started = Date.now();
    const result = await js(`(async () => ${code})()`);
    const entry = { name, result: typeof result === 'string' ? result : JSON.stringify(result), ms: Date.now() - started, errors: errors.slice(errorsBefore) };
    if (shot !== false) {
      await sleep(700);
      entry.screenshot = `${String(++n).padStart(2, '0')}-${name}.png`;
      writeFileSync(join(OUT, entry.screenshot), (await win.webContents.capturePage()).toPNG());
    }
    steps.push(entry);
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ steps, errors }, null, 2));
};
