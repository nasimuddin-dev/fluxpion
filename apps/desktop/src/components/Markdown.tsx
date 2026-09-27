import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo, type MouseEvent } from 'react';
import { cx } from './ui';

// links open in the system browser (Electron routes window.open to shell.openExternal)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')?.match(/^https?:/i)) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Render Markdown (GitHub flavoured) as sanitised HTML. In-page `#anchor` links scroll within the view. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { gfm: true, async: false }) as string, { ADD_ATTR: ['target'] }), [source]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href?.startsWith('#')) return;
    e.preventDefault();
    e.currentTarget.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return <div className={cx('markdown', className)} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
