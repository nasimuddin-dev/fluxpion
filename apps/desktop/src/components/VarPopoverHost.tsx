import { useEffect, useState } from 'react';
import { clearVariablesCache, inspectVariables, type VarInfo } from '../lib/vars-cache';
import { collectionOf, useVarPopover, variableAt, VARS_CHANGED } from '../lib/var-popover';
import { useApp } from '../store';
import { VarPopover } from './VarInput';

/**
 * Shows the {{variable}} popover wherever it was asked for, and opens it on a double-click on a variable in any text
 * field (inputs and text areas everywhere: auth, settings, tool arguments …). Code editors report their own
 * double-clicks; fields with variable highlighting open it on a single click.
 */
export function VarPopoverHost() {
  const open = useVarPopover((s) => s.open);
  const env = useApp((s) => s.environment);
  const [info, setInfo] = useState<{ name: string; info?: VarInfo }>();

  useEffect(() => {
    const onDouble = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      // a field with variable highlighting already opened it on the first click
      if (t.closest('[data-var-input]')) return;
      const name = variableAt(t.value, t.selectionStart ?? 0);
      if (!name) return;
      const r = t.getBoundingClientRect();
      useVarPopover.getState().show({ name, x: Math.max(r.left, e.clientX - 40), y: t instanceof HTMLTextAreaElement ? e.clientY + 8 : r.bottom, collectionId: collectionOf(t) });
    };
    document.addEventListener('dblclick', onDouble);
    return () => document.removeEventListener('dblclick', onDouble);
  }, []);

  useEffect(() => {
    if (!open) return setInfo(undefined);
    let live = true;
    const base = open.name.split('.')[0]!;
    void inspectVariables({ environment: env, collectionId: open.collectionId, template: `{{${base}}}` }).then((list) => live && setInfo({ name: open.name, info: list.find((v) => v.name === base) }));
    return () => {
      live = false;
    };
  }, [open, env]);

  if (!open || info?.name !== open.name) return null;
  return (
    <VarPopover
      key={`${open.name}@${open.x},${open.y}`}
      name={open.name}
      info={info.info}
      environment={env}
      collectionId={open.collectionId}
      x={open.x}
      y={open.y}
      onClose={() => useVarPopover.getState().hide()}
      onSaved={() => {
        clearVariablesCache();
        window.dispatchEvent(new Event(VARS_CHANGED));
      }}
    />
  );
}
