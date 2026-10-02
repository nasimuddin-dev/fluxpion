import { cx } from './ui';

/** The one-letter mark used for a change everywhere (Git view, explorer rows, status bar). */
export const CHANGE_MARK: Record<string, { letter: string; tone: 'ok' | 'bad' | 'warn' | 'accent'; label: string }> = {
  added: { letter: 'A', tone: 'ok', label: 'Added' },
  untracked: { letter: 'A', tone: 'ok', label: 'Added' },
  removed: { letter: 'D', tone: 'bad', label: 'Deleted' },
  deleted: { letter: 'D', tone: 'bad', label: 'Deleted' },
  changed: { letter: 'M', tone: 'warn', label: 'Changed' },
  modified: { letter: 'M', tone: 'warn', label: 'Changed' },
  renamed: { letter: 'R', tone: 'accent', label: 'Renamed' },
  conflicted: { letter: '!', tone: 'bad', label: 'Conflict' },
};

/** A git change mark (A / M / D / R / !), the same in the Git view, the explorer and anywhere else. */
export function ChangeMark({ change, className }: { change: string; className?: string }) {
  const m = CHANGE_MARK[change] ?? CHANGE_MARK.changed!;
  return (
    <span title={m.label} className={cx('inline-grid place-items-center w-4 h-4 rounded text-[0.65rem] font-bold shrink-0', className)} style={{ color: `var(--${m.tone})` }}>
      {m.letter}
    </span>
  );
}

