/** A request tab in the tab strip. */
import { Pin, X } from 'lucide-react';
import { useState } from 'react';

import { cx, Menu, type MenuItem } from '../../components/ui';
import { TAB_WIDTH, PINNED_TAB_WIDTH, RestTab } from './types';

/** One tab of the request tab strip: right-click (or ⋯) for pin, duplicate and close actions. */
export function RequestTabItem({ tab: t, active, menu, onSelect, onClose }: { tab: RestTab; active: boolean; menu: MenuItem[]; onSelect(): void; onClose(): void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      role="tab"
      aria-selected={active}
      title={t.dirty ? `${t.name} (unsaved changes)` : t.name}
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && !t.pinned && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      style={{ width: t.pinned ? PINNED_TAB_WIDTH : TAB_WIDTH }}
      className={cx(
        'group relative flex items-center gap-1.5 h-9 px-3 border-r border-line text-sm cursor-pointer shrink-0',
        active ? 'bg-bg text-fg after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-[image:var(--brand-gradient)]' : 'text-muted hover:bg-hover hover:text-fg',
        t.pinned && 'pr-2',
      )}
    >
      {t.pinned && <Pin size={11} className="shrink-0 text-muted" aria-label="Pinned" />}
      <span className={cx('mono method-badge text-[0.62rem] font-bold', `method-${t.request.method}`)}>{t.request.method}</span>
      <span className="truncate flex-1 min-w-0">{t.name}</span>
      {t.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unsaved changes" />}
      {!t.pinned && (
        <button aria-label="Close tab" className={cx('shrink-0 rounded p-0.5 hover:text-fg hover:bg-hover focus:opacity-100', active ? 'opacity-60' : 'opacity-0 group-hover:opacity-100')} onClick={(e) => (e.stopPropagation(), onClose())}>
          <X size={12} />
        </button>
      )}
      <Menu open={menuOpen} onOpenChange={setMenuOpen} align="start" width={210} items={menu} trigger={<span aria-hidden className="absolute left-2 bottom-0 w-0 h-0" />} />
    </div>
  );
}
