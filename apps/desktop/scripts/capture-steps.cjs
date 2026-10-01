// Screenshot steps for the documentation website. Loaded by the main process in capture mode.
// Drives the real UI (demo servers + example workspace) and writes JPEGs to docs/public/images/.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = process.env.TESTPION_CAPTURE_DIR;
const W = 1440;
const H = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helpers injected into the page: find elements by visible text/title and drive React inputs. */
const HELPERS = `
window.__cap = {
  byText(text, tag = 'button') {
    return [...document.querySelectorAll(tag)].find((e) => e.textContent.trim() === text || e.textContent.trim().startsWith(text));
  },
  click(text, tag) {
    const el = this.byText(text, tag);
    if (!el) throw new Error('not found: ' + text + ' (page: ' + document.body.innerText.slice(0, 400).replace(/\\s+/g, ' ') + ')');
    el.click();
  },
  nav(label) {
    const el = document.querySelector('nav [aria-label="' + label + '"]');
    // the request editors aren't on the rail (they open from Collections): use their Ctrl+Alt+n shortcut
    const keys = { REST: '2', GraphQL: '3', gRPC: '4', WebSocket: '5', MCP: '6' };
    if (!el && keys[label]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: keys[label], ctrlKey: true, altKey: true, bubbles: true }));
      return;
    }
    if (!el) throw new Error('nav not found: ' + label);
    el.click();
  },
  setInput(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  fieldInput(label) {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes(label));
    return l && l.querySelector('input');
  },
};
true;`;

module.exports = async function run(win) {
  mkdirSync(OUT, { recursive: true });
  win.setContentSize(W, H);
  // keep painting while the window is covered or the screen is locked, or capturePage returns stale frames
  win.webContents.setBackgroundThrottling(false);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    await sleep(700);
    // force a full repaint: a window that isn't visible on screen (covered, locked screen) otherwise keeps
    // stale regions; a one-pixel resize makes the compositor redraw everything
    win.setContentSize(W, H + 1);
    await sleep(150);
    win.setContentSize(W, H);
    win.webContents.invalidate();
    await sleep(600);
    const img = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    const out = img.resize({ width: W, quality: 'best' });
    writeFileSync(join(OUT, `${name}.jpg`), out.toJPEG(88));
    console.log(`[capture] ${name}.jpg ${JSON.stringify(out.getSize())}`);
  };

  // REST: a request from the collection, sent with a token
  await js(`localStorage.setItem('aps.view', 'rest');
    localStorage.setItem('aps.tree.open', JSON.stringify({ 'fld-patients': true, 'fld-auth': true }));
    localStorage.setItem('aps.draft.rest', JSON.stringify({ active: 't1', tabs: [{ id: 't1', name: 'List patients', collectionId: 'veterinary-api', requestId: 'req-list',
      request: { method: 'GET', url: '{{baseUrl}}/patients', params: [], headers: [], auth: { type: 'bearer', token: 'demo-token-3f9a1c' } },
      assertions: [{ type: 'status', expected: 200 }, { type: 'exists', path: '$.items[0].id' }, { type: 'latency', max: 1000 }] }] }));
    location.reload(); true`);
  await sleep(3000);
  await js(HELPERS);
  // a fresh profile opens on Home
  win.webContents.sendInputEvent({ type: 'mouseMove', x: W - 5, y: H - 5 });
  await js(`__cap.nav('Home'); true`);
  await sleep(1200);
  await shot('home');
  await js(`__cap.nav('REST'); true`);
  await sleep(1200);
  // keep the pointer off the navigation rail so no hover highlight ends up in the screenshots
  win.webContents.sendInputEvent({ type: 'mouseMove', x: W - 5, y: H - 5 });
  await js(`__cap.click('Send'); true`);
  // wait for the response panel (status badge + timing) rather than a fixed delay
  for (let i = 0; i < 40; i++) {
    if (await js(`!!document.querySelector('main') && /Time\\s+\\d/.test(document.querySelector('main').innerText)`)) break;
    await sleep(250);
  }
  await sleep(1500);
  await shot('rest');

  // GraphQL: introspect, run, show autocomplete-ready editor
  await js(`__cap.nav('GraphQL'); true`);
  await sleep(1500);
  await js(`__cap.click('Introspect'); true`);
  await sleep(1500);
  await js(`__cap.click('Run'); true`);
  await sleep(1500);
  await shot('graphql');

  // MCP: connect, run a tool, then the protocol trace
  await js(`__cap.nav('MCP'); true`);
  await sleep(1000);
  await js(`__cap.click('Connect'); true`);
  await sleep(3500);
  await js(`__cap.setInput(__cap.fieldInput('customer_id'), '123'); true`);
  await sleep(300);
  await js(`__cap.click('Execute'); true`);
  await sleep(1500);
  await shot('mcp');
  await js(`__cap.click('Protocol trace'); true`);
  await sleep(1000);
  await js(`document.querySelectorAll('.overflow-auto button')[6]?.click(); true`);
  await shot('mcp-trace');

  // AI Lab playground
  await js(`__cap.nav('AI Lab'); true`);
  await sleep(1500);
  await js(`document.querySelector('button[title^="Run"]').click(); true`);
  await sleep(2500);
  await shot('ai-lab');

  // Evaluations
  await js(`__cap.nav('Evaluations'); true`);
  await sleep(1500);
  await js(`[...document.querySelectorAll('button')].find((b) => /^Run \\d+ cases/.test(b.textContent.trim())).click(); true`);
  await sleep(4000);
  await shot('evaluations');

  // Tests: run everything, then open a result
  await js(`__cap.nav('Tests'); true`);
  await sleep(1500);
  await js(`__cap.click('Run all tests'); true`);
  await sleep(6000);
  await js(`__cap.click('Booking agent uses the right tools'); true`);
  await sleep(1000);
  await shot('tests');

  // Traces
  await js(`__cap.nav('Traces'); true`);
  await sleep(1500);
  await js(`__cap.click('Booking agent uses the right tools'); true`);
  await sleep(1500);
  await shot('traces');

  // Load test
  await js(`__cap.nav('Load'); true`);
  await sleep(1000);
  await js(`__cap.click('Start load test'); true`);
  await sleep(9000);
  await shot('load');

  // Monitors: one scheduled check with a few runs, one paused
  await js(`(async () => {
    const a = await window.aps.invoke('monitor.save', { monitor: { name: 'Diagnostics', collectionId: 'veterinary-api', selection: ['fld-diag'], environment: 'Development', everyMinutes: 15, enabled: true } });
    await window.aps.invoke('monitor.save', { monitor: { name: 'Whole API (nightly)', collectionId: 'veterinary-api', environment: 'Development', everyMinutes: 1440, enabled: false } });
    for (let i = 0; i < 5; i++) await window.aps.invoke('monitor.run', { id: a.id });
    return true;
  })()`);
  await js(`__cap.nav('Monitors'); true`);
  await sleep(1500);
  await shot('monitors');

  // Home again, now with the activity of all of the above: the dashboard
  await js(`__cap.nav('Home'); true`);
  await sleep(1500);
  await js(`document.querySelector('section[aria-label=Activity]')?.scrollIntoView({ block: 'start' }); true`);
  await sleep(800);
  await shot('home-activity');

  // a run's Charts tab (the test run from above)
  await js(`__cap.nav('Tests'); true`);
  await sleep(1200);
  await js(`(() => { const t = [...document.querySelectorAll('[role=tab]')].filter((x) => x.textContent.trim().startsWith('Runs')).pop(); t?.click(); return true; })()`);
  await sleep(1200);
  await js(`(() => { const r = [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('All tests') && b.querySelector('.bg-ok, .bg-bad')); r?.click(); return true; })()`);
  await sleep(1500);
  await js(`(() => { const c = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim() === 'Charts'); c?.click(); return true; })()`);
  await sleep(1500);
  await shot('run-charts');
};
