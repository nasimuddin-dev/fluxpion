import { useState, type ReactNode } from 'react';
import { cx, Tooltip } from './ui';

export interface SidebarPane {
  id: string;
  label: string;
  icon: ReactNode;
  /** Rendered only while the pane is shown. */
  render(): ReactNode;
}

const key = (id: string) => `aps.sidebar.${id}`;

/**
 * The left sidebar every view shares (the REST layout): a segmented switch of panes, e.g. the view's
 * saved items (collections, saved connections, test files …), Environments and History or Runs, and the
 * active pane below it. The chosen pane is remembered per view.
 */
export function SidebarShell({ id, panes, value, onChange }: { id: string; panes: SidebarPane[]; value?: string; onChange?(id: string): void }) {
  const [own, setOwn] = useState<string>(() => {
    try {
      const v = localStorage.getItem(key(id));
      return v && panes.some((p) => p.id === v) ? v : panes[0]!.id;
    } catch {
      return panes[0]!.id;
    }
  });
  const active = value ?? own;
  const pick = (p: string) => {
    setOwn(p);
    try {
      localStorage.setItem(key(id), p);
    } catch {
      /* private mode */
    }
    onChange?.(p);
  };
  const pane = panes.find((p) => p.id === active) ?? panes[0]!;
  return (
    <div className="h-full flex flex-col bg-panel/50 border-r border-line min-w-0">
      {/* labels show only when the sidebar itself is wide enough (a container query), otherwise icons with tooltips */}
      <div role="tablist" aria-label="Sidebar" className="@container flex items-center gap-0.5 px-2 pt-2 pb-2 shrink-0">
        {panes.map((p) => (
          <Tooltip key={p.id} content={p.label}>
            <button
              role="tab"
              aria-selected={pane.id === p.id}
              aria-label={p.label}
              onClick={() => pick(p.id)}
              className={cx(
                'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-7 rounded-md text-xs font-medium transition-colors',
                pane.id === p.id ? 'bg-bg shadow-sm border border-line text-fg' : 'text-muted hover:text-fg hover:bg-hover',
              )}
            >
              {p.icon}
              <span className={cx('truncate hidden', panes.length > 3 ? '@[26rem]:inline' : '@[20rem]:inline')}>{p.label}</span>
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="flex-1 flex flex-col min-h-0">{pane.render()}</div>
    </div>
  );
}
