/**
 * Helpers for e2e plans (files in e2e/plans). A plan is an array of steps [name, code, shot?, expect?, options?];
 * `withExpect` adds the expectations by step name, and `prepare` / `env` / `settings` (merged into the app's settings,
 * e.g. the AI assistant's provider) / `allowErrors` (steps whose console errors are expected, e.g. a step that throws on purpose).
 */
function withExpect(steps, expect = {}, extra = {}) {
  const names = new Set(steps.map((s) => s[0]));
  for (const k of Object.keys(expect)) if (!names.has(k)) throw new Error(`expectation for unknown step "${k}"`);
  const out = steps.map(([name, code, shot = true]) => [name, code, shot, expect[name], { allowErrors: (extra.allowErrors ?? []).includes(name) }]);
  if (extra.prepare) out.prepare = extra.prepare;
  if (extra.env) out.env = extra.env;
  if (extra.settings) out.settings = extra.settings;
  return out;
}

/** All numbers in a result such as "per keystroke ms: 29,44,49": each must be under `max`. */
const allUnder = (label, max) => (r) => {
  const m = new RegExp(`${label}[^\\d]*([\\d,]+)`).exec(r);
  if (!m) return `no "${label}" in the result`;
  const bad = m[1]
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter((n) => n >= max);
  return bad.length ? `${label} ${bad.join(', ')} ≥ ${max}` : true;
};

module.exports = { withExpect, allUnder };
