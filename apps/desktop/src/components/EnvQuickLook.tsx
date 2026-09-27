import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Eye, Lock } from 'lucide-react';
import { useState } from 'react';
import { call } from '../api';
import { useApp } from '../store';
import { Badge, Button, cx, Tooltip } from './ui';

interface Row {
  key: string;
  initial?: string;
  current?: string;
  secret: boolean;
  enabled: boolean;
}
interface QuickLook {
  environment?: { id: string; name: string; isProduction: boolean; variables: Row[] };
  globals: Row[];
}

function Table({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <p className="text-xs text-muted px-1 py-1">{empty}</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted">
          <th className="font-medium py-1 pr-2 w-1/3">Variable</th>
          <th className="font-medium py-1 pr-2">Initial value</th>
          <th className="font-medium py-1">Current value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={cx('border-t border-line align-top', !r.enabled && 'opacity-50')}>
            <td className="py-1 pr-2 mono break-all">
              {r.secret && <Lock size={10} className="inline mr-1 text-muted" aria-label="Secret" />}
              {r.key}
            </td>
            <td className="py-1 pr-2 mono break-all">{r.initial ?? <span className="text-muted">—</span>}</td>
            <td className="py-1 mono break-all">{r.current ?? <span className="text-muted">{r.initial === undefined ? '—' : 'same'}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Postman's environment quick look: the active environment's and the globals' initial and current
 * values at a glance, next to the environment picker. Secret and sensitive values are masked.
 */
export function EnvQuickLook() {
  const env = useApp((s) => s.environment);
  const [data, setData] = useState<QuickLook>();
  const [open, setOpen] = useState(false);
  const load = () => void call<QuickLook>('env.quickLook', { environment: env }).then(setData);
  const go = (payload?: Record<string, unknown>) => {
    setOpen(false);
    useApp.getState().openIntent('environments', payload ?? {});
  };
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <Tooltip content="Environment quick look">
        <PopoverPrimitive.Trigger asChild>
          <button aria-label="Environment quick look" className={cx('inline-flex items-center justify-center rounded-md h-8 w-8 text-muted hover:text-fg hover:bg-hover transition-colors', open && 'bg-hover text-fg')}>
            <Eye size={16} />
          </button>
        </PopoverPrimitive.Trigger>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-[70] w-[520px] max-w-[92vw] max-h-[70vh] overflow-auto rounded-xl border border-line bg-bg p-3 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150 flex flex-col gap-3"
        >
          <section>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold">{data?.environment?.name ?? 'No environment selected'}</h3>
              {data?.environment?.isProduction && <Badge tone="bad">PRODUCTION</Badge>}
              {data?.environment && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => go({ environmentId: data.environment!.id })}>
                  Edit
                </Button>
              )}
            </div>
            {data?.environment ? (
              <Table rows={data.environment.variables} empty="This environment has no variables." />
            ) : (
              <p className="text-xs text-muted">Pick an environment in the selector to use its variables.</p>
            )}
          </section>
          <section>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold">Globals</h3>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => go({ tab: 'globals' })}>
                Edit
              </Button>
            </div>
            <Table rows={data?.globals ?? []} empty="No global variables." />
          </section>
          <p className="text-[0.7rem] text-muted">Current values are set by scripts and kept on this machine only. Secret values are never shown here.</p>
          <PopoverPrimitive.Arrow className="fill-[var(--line)]" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
