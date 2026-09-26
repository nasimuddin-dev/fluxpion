import { Eye, EyeOff, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { KeyValue } from '../types';
import { cx } from './ui';

/**
 * Table editor for headers, params, variables and form fields.
 * A trailing empty row is always present so typing into it appends a new entry.
 */
export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  allowSecret,
  allowFile,
  suggestions,
  secretStatus,
}: {
  rows: KeyValue[];
  onChange(rows: KeyValue[]): void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  allowSecret?: boolean;
  allowFile?: boolean;
  suggestions?: string[];
  secretStatus?: Record<string, boolean>;
}) {
  const [reveal, setReveal] = useState<Record<number, boolean>>({});
  const all = [...rows, { key: '', value: '', enabled: true }];
  const update = (i: number, patch: Partial<KeyValue>) => {
    const next = all.map((r, j) => (j === i ? { ...r, ...patch } : r)).filter((r, j) => j < rows.length || r.key || r.value);
    onChange(next);
  };
  const listId = suggestions ? `kv-suggest-${suggestions.length}` : undefined;
  return (
    <div className="text-sm">
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr className="text-[0.72rem] text-muted text-left">
            <th className="w-7" />
            <th className="font-medium px-1.5 py-1 w-[35%]">{keyPlaceholder}</th>
            <th className="font-medium px-1.5 py-1">{valuePlaceholder}</th>
            {allowFile && <th className="w-16 font-medium">Type</th>}
            {allowSecret && <th className="w-16 font-medium">Secret</th>}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {all.map((r, i) => {
            const isNew = i === rows.length;
            const masked = r.secret && !reveal[i];
            return (
              <tr key={i} className={cx('border-t border-line group', r.enabled === false && 'opacity-50')}>
                <td className="text-center">
                  {!isNew && <input type="checkbox" aria-label="Enabled" checked={r.enabled !== false} onChange={(e) => update(i, { enabled: e.target.checked })} />}
                </td>
                <td className="border-l border-line">
                  <input className="cell-input mono" list={listId} placeholder={isNew ? keyPlaceholder : ''} value={r.key} onChange={(e) => update(i, { key: e.target.value })} />
                </td>
                <td className="border-l border-line">
                  <div className="flex items-center">
                    <input
                      className="cell-input mono"
                      type={masked ? 'password' : 'text'}
                      placeholder={r.secret && secretStatus?.[r.key] ? '•••••• stored in OS keychain (type to replace)' : isNew ? valuePlaceholder : r.kind === 'file' ? 'File path' : ''}
                      value={r.value}
                      onChange={(e) => update(i, { value: e.target.value })}
                    />
                    {r.secret && (
                      <button className="px-1 text-muted hover:text-fg" aria-label={masked ? 'Reveal' : 'Hide'} onClick={() => setReveal({ ...reveal, [i]: !reveal[i] })}>
                        {masked ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                    )}
                  </div>
                </td>
                {allowFile && (
                  <td className="border-l border-line">
                    {!isNew && (
                      <select className="cell-input text-xs" value={r.kind ?? 'text'} onChange={(e) => update(i, { kind: e.target.value as 'text' | 'file' })}>
                        <option value="text">Text</option>
                        <option value="file">File</option>
                      </select>
                    )}
                  </td>
                )}
                {allowSecret && (
                  <td className="border-l border-line text-center">
                    {!isNew && (
                      <button
                        className={cx('p-1 rounded', r.secret ? 'text-warn' : 'text-muted opacity-40 hover:opacity-100')}
                        aria-label="Toggle secret"
                        title={r.secret ? 'Secret: stored encrypted in the OS credential store, never in workspace files' : 'Mark as secret'}
                        onClick={() => update(i, { secret: !r.secret })}
                      >
                        <Lock size={13} />
                      </button>
                    )}
                  </td>
                )}
                <td className="text-center">
                  {!isNew && (
                    <button className="p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-bad" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const COMMON_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'If-None-Match',
  'Origin',
  'User-Agent',
  'X-Request-Id',
  'X-Api-Key',
  'X-Correlation-Id',
];
