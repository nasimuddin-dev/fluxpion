import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { plural } from '../lib/format';
import { cx, Input } from './ui';

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The array of objects to show as a table: the body itself, or the largest array of objects inside it
 * up to three objects deep (`items`, `data.users`, GraphQL's `data.continent.countries`), with its path.
 * Undefined when there is none.
 */
export function tableRowsOf(json: unknown): { rows: Row[]; path: string } | undefined {
  const ok = (a: unknown): a is Row[] => Array.isArray(a) && a.length > 0 && a.slice(0, 20).filter(isRow).length >= Math.min(a.length, 20) * 0.8;
  if (ok(json)) return { rows: json.filter(isRow), path: '$' };
  if (!isRow(json)) return undefined;
  let best: { rows: Row[]; path: string } | undefined;
  // breadth first, so on equal sizes the shallower list wins
  let level: Array<[Row, string]> = [[json, '$']];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next: Array<[Row, string]> = [];
    for (const [obj, prefix] of level)
      for (const [k, v] of Object.entries(obj)) {
        if (ok(v)) {
          if (!best || v.length > best.rows.length) best = { rows: v.filter(isRow), path: `${prefix}.${k}` };
        } else if (isRow(v)) next.push([v, `${prefix}.${k}`]);
      }
    level = next.slice(0, 50);
  }
  return best;
}

const LIMIT = 500;
const cell = (v: unknown) => (v === null ? 'null' : v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** A JSON array of objects as a table: a column per key, click a header to sort, filter any cell. */
export function JsonTable({ rows, path }: { rows: Row[]; path: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>();
  const [filter, setFilter] = useState('');
  // columns in first-seen order across the first 200 rows
  const columns = useMemo(() => [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))], [rows]);
  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    let out = f ? rows.filter((r) => columns.some((c) => cell(r[c]).toLowerCase().includes(f))) : rows;
    if (sort) {
      const { key, dir } = sort;
      out = [...out].sort((a, b) => {
        const x = a[key];
        const y = b[key];
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return cell(x).localeCompare(cell(y), undefined, { numeric: true }) * dir;
      });
    }
    return out;
  }, [rows, columns, filter, sort]);
  const toggle = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : undefined));
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
        <Input className="h-7 min-h-7 text-sm max-w-64" placeholder="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-xs text-muted">
          {plural(shown.length, 'row')}
          {shown.length !== rows.length ? ` of ${rows.length}` : ''} · {plural(columns.length, 'column')} · <span className="mono">{path}</span>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="sticky top-0 bg-panel z-10">
            <tr>
              {columns.map((c) => (
                <th key={c} className="text-left font-medium text-muted border-b border-r border-line px-2 py-1 whitespace-nowrap">
                  <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggle(c)} aria-label={`Sort by ${c}`}>
                    {c}
                    {sort?.key === c && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="mono">
            {shown.slice(0, LIMIT).map((r, i) => (
              <tr key={i} className="hover:bg-hover/60">
                {columns.map((c) => {
                  const v = r[c];
                  return (
                    <td key={c} title={cell(v)} className={cx('border-b border-r border-line/60 px-2 py-1 max-w-80 truncate', typeof v === 'number' && 'text-right tabular-nums', v === null || v === undefined ? 'text-muted' : typeof v === 'boolean' && 'text-accent')}>
                      {cell(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > LIMIT && <p className="text-xs text-muted p-2">Showing the first {LIMIT} rows; filter to narrow them down.</p>}
      </div>
    </div>
  );
}
