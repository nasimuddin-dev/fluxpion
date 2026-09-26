import { stringify, parse } from 'yaml';

export function stringifyYaml(v: unknown): string {
  return stringify(v, { lineWidth: 0 });
}

export function parseYaml(s: string): unknown {
  return parse(s);
}
