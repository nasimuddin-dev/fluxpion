// The AI assistant drawer: a free question carries the open request as context (removable), follow-ups remember the
// conversation, answers render as Markdown and stream, Stop keeps what arrived; New conversation starts over.
// Uses the examples' offline demo model (no network, no key).
// Part of the end-to-end UI regression suite (see e2e/run-e2e.mjs and .claude/skills/ui-regression).
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { withExpect } = require('../lib.cjs');

/** The offline model answers after 1.5 s, so Stop can be pressed while it works. */
const slowModel = (ws) => {
  const p = join(ws, 'providers.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  for (const h of c.providers.find((x) => x.id === 'demo').headers) if (h.key === 'x-mock-latency-ms') h.value = '1500';
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

const steps = [
  ['open-with-request', `(async () => { await __t.requests(); await __t.expand('HTTP basics'); await __t.expand('Requests & responses'); await __t.open('Custom headers'); const b = document.querySelector('[aria-label="AI assistant"]:not(aside)'); if (!b) return 'NO BUTTON'; b.click(); await __t.sleep(800); return ${state}; })()`],
  ['first-question', ask('Why does this request fail?')],
  ['follow-up', ask('And how do I fix it?')],
  ['new-conversation', `(async () => { ${panel}.querySelector('[aria-label="New conversation"]').click(); await __t.sleep(600); return ${state}; })()`],
  ['without-context', `(async () => { ${panel}.querySelector('[aria-label="Leave out the context"]').click(); await __t.sleep(300); return await ${ask('What is a 404?')}; })()`],
  ['stop', `(async () => { ${send('A long question')} const stop = ${stopButton}; if (!stop) return 'NO BUTTON Stop'; stop.click(); await __t.sleep(1800); return 'error shown: ' + !!${panel}.querySelector('[role=alert]') + ' | ' + ${state}; })()`],
  ['close', `(async () => { ${panel}.querySelector('[aria-label="Close assistant"]').click(); await __t.sleep(500); return 'panel open: ' + !!${panel}; })()`],
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
  },
  { settings: { assistantProvider: 'demo', assistantModel: 'demo' }, prepare: slowModel },
);
