import type { Collection, CollectionNode } from '../model/types.js';

/** Modules scripts can require (see prelude.ts). */
export const SCRIPT_MODULES = ['crypto-js', 'uuid', 'tv4', 'lodash', 'moment'];

const UNSUPPORTED: Array<{ re: RegExp; api: string; hint: string }> = [
  { re: /\bcheerio\b/, api: 'cheerio', hint: 'parse HTML with regular expressions or xml2Json() for XHTML' },
  { re: /\bpm\.vault\b/, api: 'pm.vault', hint: 'use a secret environment variable (pm.environment.get)' },
  { re: /\bpm\.require\s*\(/, api: 'pm.require (package library)', hint: 'paste the package code into a collection-level script' },
  { re: /\bpm\.execution\.location\b/, api: 'pm.execution.location', hint: 'use pm.info.requestName' },
];

export interface ScriptWarning {
  /** Request or folder path, or "(collection)". */
  where: string;
  /** "pre-request" or "test". */
  script: 'pre-request' | 'test';
  api: string;
  hint: string;
}

function check(code: string | undefined, where: string, script: ScriptWarning['script'], out: ScriptWarning[]): void {
  if (!code?.trim()) return;
  for (const u of UNSUPPORTED) if (u.api && u.re.test(code)) out.push({ where, script, api: u.api, hint: u.hint });
  for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const name = m[1]!;
    if (!SCRIPT_MODULES.includes(name) && name !== 'cheerio') out.push({ where, script, api: `require('${name}')`, hint: `available modules: ${SCRIPT_MODULES.join(', ')}` });
  }
}

/**
 * Script APIs in a collection that TestPion's sandbox doesn't provide, so an import can say which
 * requests need a change before they are run. Everything else in Postman's `pm.*` API is supported.
 */
export function scriptCompatibility(collection: Collection): ScriptWarning[] {
  const out: ScriptWarning[] = [];
  check(collection.preRequestScript, '(collection)', 'pre-request', out);
  check(collection.testScript, '(collection)', 'test', out);
  const walk = (nodes: CollectionNode[], path: string[]) => {
    for (const n of nodes) {
      const where = [...path, n.name].join(' / ');
      if ('preRequestScript' in n) check(n.preRequestScript, where, 'pre-request', out);
      if ('testScript' in n) check(n.testScript, where, 'test', out);
      if (n.kind === 'folder') walk(n.items, [...path, n.name]);
    }
  };
  walk(collection.items, []);
  // one line per request and API
  const seen = new Set<string>();
  return out.filter((w) => {
    const k = `${w.where}|${w.script}|${w.api}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
