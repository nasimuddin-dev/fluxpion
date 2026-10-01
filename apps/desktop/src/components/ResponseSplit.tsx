import { Columns2, Rows2, SquareSplitHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../store';
import type { AppSettings } from '../types';
import { Menu, Split, type MenuItem } from './ui';

export type ResponseLayout = 'auto' | 'below' | 'side';

/** Auto: side by side from this width of the editor area (and back below a little under it, so it doesn't flicker). */
const SIDE_FROM = 960;
const BELOW_UNDER = 880;

/**
 * The request and its response, the same in every editor (HTTP, GraphQL, gRPC, MCP tools): side by side or the
 * response below, from the Response layout setting; Auto picks by the room there is. Each layout keeps its own size.
 */
export function ResponseSplit({ id, initialBelow = 45, initialSide = 50, min, children }: { id: string; initialBelow?: number; initialSide?: number; min?: number; children: [ReactNode, ReactNode] }) {
  const pref = useApp((s) => s.settings?.responseLayout ?? 'auto');
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (pref !== 'auto' || !ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e!.contentRect.width;
      setWide((was) => (was ? w >= BELOW_UNDER : w >= SIDE_FROM));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [pref]);
  const side = pref === 'side' || (pref === 'auto' && wide);
  return (
    <div ref={ref} className="h-full w-full min-h-0 min-w-0 flex flex-col">
      <Split id={`${id}:${side ? 'side' : 'below'}`} direction={side ? 'horizontal' : 'vertical'} initial={side ? initialSide : initialBelow} min={min}>
        {children}
      </Split>
    </div>
  );
}

const LABELS: Record<ResponseLayout, string> = { auto: 'Auto (side by side when there is room)', below: 'Response below', side: 'Side by side' };

export const setResponseLayout = (layout: ResponseLayout) => {
  const s = useApp.getState();
  if (s.settings) void s.saveSettings({ ...s.settings, responseLayout: layout } as AppSettings);
};

/** The button in the tab strip: where responses go, for every editor. */
export function ResponseLayoutButton() {
  const pref = useApp((s) => s.settings?.responseLayout ?? 'auto') as ResponseLayout;
  const items: MenuItem[] = (['auto', 'below', 'side'] as const).map((l) => ({ label: `${pref === l ? '✓ ' : ''}${LABELS[l]}`, icon: l === 'side' ? <Columns2 size={14} /> : l === 'below' ? <Rows2 size={14} /> : <SquareSplitHorizontal size={14} />, onSelect: () => setResponseLayout(l) }));
  return (
    <Menu
      align="end"
      width={280}
      items={items}
      trigger={
        <button aria-label={`Response layout: ${LABELS[pref]}`} title={`Response layout: ${LABELS[pref]}`} className="mr-1 mb-1 shrink-0 grid place-items-center h-7 w-7 rounded-md text-muted hover:text-fg hover:bg-hover data-[state=open]:text-fg data-[state=open]:bg-hover">
          {pref === 'side' ? <Columns2 size={15} /> : pref === 'below' ? <Rows2 size={15} /> : <SquareSplitHorizontal size={15} />}
        </button>
      }
    />
  );
}
