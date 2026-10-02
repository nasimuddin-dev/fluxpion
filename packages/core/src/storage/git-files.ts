import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './fsutil.js';

/** The files that make a workspace folder git-ready (GIT-102); see git-ready.ts and planning/git-integration.md. */

/** What stays on this computer: results, traces, the local database and state. Everything else is shared. */
export const GITIGNORE_LINES = [
  '# TestPion: results and this computer\'s state stay out of git',
  'runs/',
  'traces/',
  'payloads/',
  'reports/',
  'baselines/',
  'trash/',
  '.local/',
  'database.sqlite*',
  'metadata.jsonl',
  '.template-offered.json',
];

export const GITATTRIBUTES_LINES = ['# TestPion: the same line endings on Windows, macOS and Linux', '* text=auto eol=lf', '*.png binary', '*.jpg binary', '*.sqlite binary'];

export interface GitReadyResult {
  /** Files created or extended (.gitignore, .gitattributes). */
  files: string[];
  /** Collection files rewritten in the git-friendly form. */
  collections: string[];
  /** Whether the folder is already a git repository (or inside one). */
  inRepository: boolean;
}

/** Append the lines a file is missing (keeping what the user wrote); returns whether it changed. */
function ensureLines(file: string, lines: string[]): boolean {
  const had = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const present = new Set(had.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !present.has(l.trim()));
  if (!missing.some((l) => !l.startsWith('#'))) return false;
  atomicWrite(file, `${had}${had && !had.endsWith('\n') ? '\n' : ''}${had ? '\n' : ''}${missing.join('\n')}\n`);
  return true;
}

/** The ignore and attribute files only (new workspaces get them when created). */
export function writeGitFiles(root: string): string[] {
  const out: string[] = [];
  if (ensureLines(join(root, '.gitignore'), GITIGNORE_LINES)) out.push('.gitignore');
  if (ensureLines(join(root, '.gitattributes'), GITATTRIBUTES_LINES)) out.push('.gitattributes');
  return out;
}

/** Whether `root` is inside a git repository (a `.git` here or in a parent folder). */
export function isInGitRepository(root: string): boolean {
  let dir = root;
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, '.git'))) return true;
    const up = join(dir, '..');
    if (up === dir) return false;
    dir = up;
  }
  return false;
}
