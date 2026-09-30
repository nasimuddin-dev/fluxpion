import type { Environment, EnvironmentVariable } from '../model/types.js';
import { Redactor } from '../util/redact.js';
import { slugify } from '../util/ids.js';

/**
 * `.env` files (KEY=value lines) as environments: import turns every line into a variable, and keys that
 * look like secrets (tokens, passwords, keys) into secret variables whose values go to the secret store,
 * never into workspace files. Export writes an environment back as `.env` (secret values left out).
 */

const LINE = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)?$/;

/** A `.env` file: every non-empty, non-comment line is KEY=value (at least one). */
export function isDotenv(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  return lines.length > 0 && lines.every((l) => LINE.test(l));
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"');
    const inner = end > 0 ? v.slice(1, end) : v.slice(1);
    return inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'");
    return end > 0 ? v.slice(1, end) : v.slice(1);
  }
  // unquoted: a " #" starts a comment
  return v.replace(/\s+#.*$/, '');
}

/** KEY=value pairs, in order; a later duplicate wins. Supports `export`, quotes, escapes and comments. */
export function parseDotenv(text: string): Array<{ key: string; value: string }> {
  const out = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]!);
    if (!m) continue;
    let raw = m[2] ?? '';
    // a double-quoted value may span lines
    if (raw.trim().startsWith('"') && !/"\s*(#.*)?$/.test(raw.trim().slice(1))) {
      while (i + 1 < lines.length && !raw.includes('"', raw.indexOf('"') + 1)) raw += `\n${lines[++i]}`;
    }
    out.set(m[1]!, unquote(raw));
  }
  return [...out].map(([key, value]) => ({ key, value }));
}

/**
 * An environment from a `.env` file. Secret-looking keys become secret variables: their values are
 * returned separately (`secretValues`) for the secret store and are left out of the environment itself.
 */
export function importDotenv(text: string, name = 'Imported .env', redactor = new Redactor()): { environment: Environment; secretValues: Record<string, string> } {
  const secretValues: Record<string, string> = {};
  const variables: EnvironmentVariable[] = parseDotenv(text).map(({ key, value }) => {
    if (redactor.isSensitiveKey(key) && value) {
      secretValues[key] = value;
      return { key, value: '', secret: true, enabled: true };
    }
    return { key, value, enabled: true };
  });
  return { environment: { id: slugify(name) || 'env', name, variables }, secretValues };
}

/** An environment as `.env` text. Secret values are never written: those keys are left empty with a note. */
export function environmentToDotenv(env: Environment): string {
  const quote = (v: string) => (/^[\w./:@+-]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  const lines = [`# ${env.name} (exported from TestPion)`];
  for (const v of env.variables) {
    if (!v.key) continue;
    const key = /^[A-Za-z_][\w.-]*$/.test(v.key) ? v.key : v.key.replace(/[^\w.-]/g, '_');
    if (v.secret) lines.push(`# ${key} is a secret: set it here yourself`, `${key}=`);
    else lines.push(`${v.enabled === false ? '# ' : ''}${key}=${quote(v.value ?? '')}`);
  }
  return lines.join('\n') + '\n';
}
