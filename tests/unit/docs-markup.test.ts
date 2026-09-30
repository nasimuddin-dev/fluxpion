import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The docs site is VitePress: Markdown pages are compiled as Vue templates. Two mistakes break the build
// (or silently blank text) and only show up in the docs deploy: a raw <placeholder> outside code, which
// Vue reads as an unclosed element, and {{ … }} outside a v-pre block, which Vue evaluates.

const root = join(__dirname, '../../docs');
const pages = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n.startsWith('.')) return [];
    return statSync(p).isDirectory() ? pages(p) : n.endsWith('.md') ? [p] : [];
  });

const HTML = new Set('a abbr b blockquote br code dd details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img kbd li ol p pre s small span strong sub summary sup table tbody td th thead tr u ul svg g rect text line path circle ellipse polygon polyline tspan defs marker title desc style script template badge video source iframe picture image lineargradient radialgradient stop clippath mask pattern use foreignobject'.split(' '));

/** Page text without fenced code (escaped by Markdown) and comments; without v-pre blocks too when `mustache` (v-pre only stops interpolation). */
function vueText(file: string, mustache = false): string {
  // <!--@include: path--> pages (the changelog) are checked with the included file
  const md = readFileSync(file, 'utf8').replace(/<!--@include:\s*(.+?)\s*-->/g, (_, p: string) => readFileSync(join(dirname(file), p), 'utf8'));
  const t = md.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  return mustache ? t.replace(/^::: v-pre[ \t]*$[\s\S]*?^:::[ \t]*$/gm, '') : t;
}

describe('docs markup', () => {
  const files = pages(root);

  it('finds the docs pages', () => expect(files.length).toBeGreaterThan(20));

  it('has no raw <placeholder> tags outside code', () => {
    const bad: string[] = [];
    for (const f of files) {
      // inline code is escaped by Markdown, so drop it for this check
      const text = vueText(f).replace(/`[^`\n]*`/g, '');
      for (const m of text.matchAll(/<([a-zA-Z][\w-]*)[\s>/]/g)) {
        const tag = m[1]!;
        if (!HTML.has(tag.toLowerCase()) && !/^[A-Z]/.test(tag)) bad.push(`${relative(root, f)}: <${tag}>`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no {{ … }} outside v-pre except the release placeholders', () => {
    const bad: string[] = [];
    for (const f of files) {
      // inline code is NOT protected from Vue interpolation
      for (const m of vueText(f, true).matchAll(/\{\{([^}]*)\}\}/g)) {
        if (!/^\s*release\.\w+\s*$/.test(m[1]!)) bad.push(`${relative(root, f)}: {{${m[1]}}}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
