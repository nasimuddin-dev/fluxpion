// The AI assistant drawer: a free question carries the open request as context (removable), follow-ups remember the
// conversation, answers render as Markdown and stream, Stop keeps what arrived; New conversation starts over.
// Uses the examples' offline demo model (no network, no key).
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { withExpect } = require('../lib.cjs');

/** The offline model answers after 1.5 s (so Stop can be pressed while it works) and knows one GraphQL answer. */
const slowModel = (ws) => {
  const p = join(ws, 'providers.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  for (const h of c.providers.find((x) => x.id === 'demo').headers) if (h.key === 'x-mock-latency-ms') h.value = '1500';
  // "Generate GraphQL query" gets an operation in a code block (the request carries the current query)
  const rules = c.providers.find((x) => x.id === 'demo').headers.find((h) => h.key === 'x-mock-rules');
  // and "Suggest assertions" for the demo server's /health gets two checks as YAML
  rules.value = JSON.stringify([
    { match: 'currentQuery', response: 'Here it is:\n\n```graphql\nquery Generated { countries { code name } }\n```' },
    { match: '"gaps"', response: 'Tests for the most important gaps:\n\n```yaml\ntests:\n  - id: pet-not-found\n    type: http\n    request: { method: GET, url: "{{baseUrl}}/pet/0" }\n    checks:\n      - { type: status, expected: 404 }\n```' },
    { match: '127.0.0.1:4010/health', response: '```yaml\n- type: status\n  expected: 200\n- type: equals\n  path: $.status\n  expected: ok\n```' },
    ...JSON.parse(rules.value),
  ]);
  writeFileSync(p, JSON.stringify(c, null, 2));
};

const panel = `document.querySelector('aside[aria-label="AI assistant"]')`;
/** The drawer: how many questions and answers, the context chip, the last answer's text and model, the field's hint. */
const state = `(() => {
  const p = ${panel}; if (!p) return 'NO PANEL';
  const answers = [...p.querySelectorAll('[data-turn=assistant]')];
  const last = answers.at(-1);
  return 'questions: ' + p.querySelectorAll('[data-turn=user]').length + ' | answers: ' + answers.length
    + ' | context: ' + (p.querySelector('[data-assistant-context]')?.textContent.trim() ?? 'none')
    + ' | last: ' + (last?.querySelector('.markdown')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160) ?? '-')
    + ' | model: ' + (last?.querySelector('[data-answer-model]')?.textContent.trim() ?? '-')
    + ' | placeholder: ' + p.querySelector('input[aria-label="Question for the assistant"]').placeholder;
})()`;
/** Type a question (React reads the native value setter), press Enter. */
const send = (q) => `{
  const p = ${panel}; if (!p) return 'NO PANEL';
  const inp = p.querySelector('input[aria-label="Question for the assistant"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(q)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await __t.sleep(100);
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await __t.sleep(300);
}`;
const stopButton = `[...${panel}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Stop')`;
/** Ask and wait for the answer (while it is being written the Stop button shows). */
const ask = (q) => `(async () => {
  ${send(q)}
  for (let i = 0; i < 60 && ${stopButton}; i++) await __t.sleep(150);
  await __t.sleep(300);
  return ${state};
})()`;

/** Open a saved item through the explorer's filter, open the assistant and read its context chip; close it again. */
const contextOf = (item) => `(async () => {
  await __t.requests();
  const f = document.querySelector('aside input[placeholder^="Filter"]');
  const setF = (v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, v); f.dispatchEvent(new Event('input', { bubbles: true })); };
  setF(${JSON.stringify(item)}); await __t.sleep(900);
  const r = [...document.querySelectorAll('aside button[data-tree-row], aside [data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes(${JSON.stringify(item)}) && b.getAttribute('aria-expanded') === null);
  if (!r) { setF(''); return 'NO ROW'; }
  r.click(); await __t.sleep(2000); setF(''); await __t.sleep(300);
  document.querySelector('[aria-label="AI assistant"]:not(aside)').click(); await __t.sleep(800);
  const chip = ${panel}?.querySelector('[data-assistant-context]')?.textContent.trim() ?? 'none';
  ${panel}?.querySelector('[aria-label="Close assistant"]').click(); await __t.sleep(400);
  return 'view: ' + document.querySelector('nav [aria-current="page"]')?.getAttribute('aria-label') + ' | ' + chip;
})()`;

const steps = [
  ['open-with-request', `(async () => { await __t.requests(); await __t.expand('HTTP basics'); await __t.expand('Requests & responses'); await __t.open('Custom headers'); const b = document.querySelector('[aria-label="AI assistant"]:not(aside)'); if (!b) return 'NO BUTTON'; b.click(); await __t.sleep(800); return ${state}; })()`],
  ['first-question', ask('Why does this request fail?')],
  ['follow-up', ask('And how do I fix it?')],
  ['new-conversation', `(async () => { ${panel}.querySelector('[aria-label="New conversation"]').click(); await __t.sleep(600); return ${state}; })()`],
  ['without-context', `(async () => { ${panel}.querySelector('[aria-label="Leave out the context"]').click(); await __t.sleep(300); return await ${ask('What is a 404?')}; })()`],
  ['stop', `(async () => { ${send('A long question')} const stop = ${stopButton}; if (!stop) return 'NO BUTTON Stop'; stop.click(); await __t.sleep(1800); return 'error shown: ' + !!${panel}.querySelector('[role=alert]') + ' | ' + ${state}; })()`],
  ['close', `(async () => { ${panel}.querySelector('[aria-label="Close assistant"]').click(); await __t.sleep(500); return 'panel open: ' + !!${panel}; })()`],
  ['context-graphql', contextOf('Country by code')],
  ['context-grpc', contextOf('Add two numbers')],
  ['context-websocket', contextOf('Postman echo')],
  ['context-mcp', contextOf('Weather (offline mock)')],
  ['shortcut-and-suggestions', `(async () => {
    const ctrlJ = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));
    ctrlJ(); await __t.sleep(700);
    const chips = [...(${panel}?.querySelectorAll('[data-suggestion]') ?? [])].map((b) => b.textContent.trim());
    if (!chips.length) return 'NO BUTTON suggestion';
    ${panel}.querySelector('[data-suggestion]').click(); await __t.sleep(300);
    for (let i = 0; i < 60 && ${stopButton}; i++) await __t.sleep(150);
    await __t.sleep(300);
    const s = ${state};
    ctrlJ(); await __t.sleep(500);
    return 'chips: ' + chips.join(' / ') + ' | ' + s + ' | open after Ctrl+J: ' + !!${panel};
  })()`],
  ['apply-checks', `(async () => {
    await __t.requests();
    const plus = document.querySelector('[aria-label="New tab"]'); plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); await __t.sleep(500);
    [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.trim().startsWith('HTTP request'))?.click(); await __t.sleep(1200);
    const url = [...document.querySelectorAll('main input[aria-label="Request URL"]')].find((x) => x.offsetParent); if (!url) return 'NO INPUT url';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(url, 'http://127.0.0.1:4010/health'); url.dispatchEvent(new Event('input', { bubbles: true })); await __t.sleep(300);
    const tests = () => [...document.querySelectorAll('main [role=tab]')].find((t) => t.offsetParent && t.textContent.trim().startsWith('Tests'))?.textContent.trim();
    const before = tests();
    [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Send')?.click(); await __t.sleep(2000);
    const sug = [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Suggest assertions'); if (!sug) return 'NO BUTTON Suggest assertions';
    sug.click(); await __t.sleep(400);
    for (let i = 0; i < 60 && !${panel}?.querySelector('[data-answer-apply]'); i++) await __t.sleep(150);
    const apply = ${panel}?.querySelector('[data-answer-apply]'); if (!apply) return 'NO BUTTON apply';
    const label = apply.textContent.trim(); apply.click(); await __t.sleep(800);
    ${panel}?.querySelector('[aria-label="Close assistant"]').click(); await __t.sleep(400);
    return 'button: ' + label + ' | tests tab: ' + before + ' -> ' + tests();
  })()`],
  ['apply-coverage', `(async () => {
    await __t.requests();
    const r = [...document.querySelectorAll('aside [data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes('petstore.json')); if (!r) return 'NO ROW petstore.json';
    r.click(); await __t.sleep(1500);
    [...document.querySelectorAll('main [role=tab]')].find((t) => t.offsetParent && t.textContent.trim() === 'Coverage')?.click(); await __t.sleep(600);
    [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Analyse')?.click();
    let sug; for (let i = 0; i < 60 && !(sug = [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Suggest tests with AI' && !b.disabled)); i++) await __t.sleep(150);
    if (!sug) return 'NO BUTTON Suggest tests with AI';
    sug.click(); await __t.sleep(400);
    for (let i = 0; i < 60 && !${panel}?.querySelector('[data-answer-apply]'); i++) await __t.sleep(150);
    const apply = ${panel}?.querySelector('[data-answer-apply]'); if (!apply) return 'NO BUTTON apply';
    const label = apply.textContent.trim(); apply.click(); await __t.sleep(1200);
    const toast = [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent.trim()).find((t) => t.includes('Saved tests/')) ?? 'no toast';
    const path = /tests\\/(\\S+?\\.yaml)/.exec(toast)?.[1];
    const content = path ? await window.aps.invoke('tests.read', { path }).catch((e) => 'ERR ' + e.message) : '';
    ${panel}?.querySelector('[aria-label="Close assistant"]').click(); await __t.sleep(400);
    return 'button: ' + label + ' | toast: ' + toast + ' | file: ' + String(typeof content === 'string' ? content : JSON.stringify(content)).replace(/\\s+/g, ' ').slice(0, 120);
  })()`],
  ['apply-graphql', `(async () => {
    await __t.requests();
    const f = document.querySelector('aside input[placeholder^="Filter"]');
    const setF = (v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, v); f.dispatchEvent(new Event('input', { bubbles: true })); };
    setF('Country by code'); await __t.sleep(900);
    [...document.querySelectorAll('aside [data-tree-row]')].find((b) => b.offsetParent && b.textContent.includes('Country by code'))?.click(); await __t.sleep(1500); setF(''); await __t.sleep(300);
    const gen = [...document.querySelectorAll('main button')].find((b) => b.offsetParent && b.textContent.trim() === 'Generate'); if (!gen) return 'NO BUTTON Generate';
    gen.click(); await __t.sleep(400);
    for (let i = 0; i < 60 && !${panel}?.querySelector('[data-answer-apply]'); i++) await __t.sleep(150);
    const apply = ${panel}?.querySelector('[data-answer-apply]'); if (!apply) return 'NO BUTTON apply';
    const label = apply.textContent.trim(); apply.click(); await __t.sleep(800);
    const editor = [...document.querySelectorAll('main .monaco-editor')].find((e) => e.offsetParent);
    const text = editor?.querySelector('.view-lines')?.innerText.replace(/\\s+/g, ' ').trim();
    const toast = [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent.trim()).join(' / ');
    return 'button: ' + label + ' | editor: ' + text + ' | toast: ' + toast;
  })()`],
];

module.exports = withExpect(
  steps,
  {
    'open-with-request': /^questions: 0 \| answers: 0 \| context: Context: GET \S*headers \| last: - \| model: - \| placeholder: Ask a question…$/,
    // the mock model echoes the last message: the first carries the question and the request
    'first-question': /^questions: 1 \| answers: 1 \| context: none \| last: Mock response: Question: Why does this request fail\? Context: .*Custom headers.* \| model: Offline demo model · demo \| placeholder: Ask a follow-up…$/,
    // a follow-up is just the question (the conversation goes with it)
    'follow-up': /^questions: 2 \| answers: 2 \| context: none \| last: Mock response: And how do I fix it\? \| model: Offline demo model · demo \|/,
    'new-conversation': /^questions: 0 \| answers: 0 \| context: Context: GET .* \| placeholder: Ask a question…$/,
    'without-context': /^questions: 1 \| answers: 1 \| context: none \| last: Mock response: Question: What is a 404\? \| model: Offline demo model · demo \|/,
    // stopped before any text: no error, the answer says it was stopped
    stop: /^error shown: false \| questions: 2 \| answers: 2 \| context: none \| last: \(stopped\) \|/,
    close: /^panel open: false$/,
    // every request editor offers what it shows
    'context-graphql': /\| Context: GraphQL Country by code · \{\{countriesGraphql\}\}$/,
    'context-grpc': /\| Context: gRPC Sum · \{\{grpcHost\}\}$/,
    'context-websocket': /\| Context: WebSocket \{\{wsEcho\}\} · closed$/,
    'context-mcp': /\| Context: MCP Weather \(offline mock\)$/,
    // Ctrl+J opens the assistant with questions that fit the open MCP server; a click asks one; Ctrl+J closes it
    'shortcut-and-suggestions': /^chips: What can this server do\? \/ .* \| questions: 1 \| answers: 1 \| context: none \| last: Mock response: Question: What can this server do\? Context: .*Weather.* \| open after Ctrl\+J: false$/,
    // an answer can be put to use where it was asked for
    'apply-coverage': /^button: Save as a test file \| toast: Saved tests\/coverage\/[\w-]+-gaps\.yaml.*Open \| file: tests: - id: pet-not-found/,
    'apply-checks': (r) => {
      const m = /^button: Add to the checks \| tests tab: Tests(\d*) -> Tests(\d+)$/.exec(r);
      return (m && +m[2] === (+m[1] || 0) + 2) || 'the two suggested checks should be added to the Tests tab';
    },
    'apply-graphql': /^button: Use this query \| editor: query Generated \{ countries \{ code name \} \} \| toast: .*Use this query: done/,
  },
  { settings: { assistantProvider: 'demo', assistantModel: 'demo' }, prepare: slowModel },
);
