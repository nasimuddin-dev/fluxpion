import { Plus, Trash2 } from 'lucide-react';
import type { CheckConfig } from '../types';
import { Button, cx, IconButton } from './ui';

interface CheckDef {
  type: string;
  label: string;
  group: string;
  fields: Array<'path' | 'expected' | 'max' | 'min' | 'threshold' | 'header' | 'tool' | 'schema' | 'criteria' | 'judge' | 'method' | 'values'>;
  hint?: string;
}

export const CHECK_DEFS: CheckDef[] = [
  { type: 'status', label: 'Status code', group: 'Response', fields: ['expected'], hint: '200, 2xx, [200,201], success, error' },
  { type: 'latency', label: 'Latency ≤ (ms)', group: 'Response', fields: ['max'] },
  { type: 'header', label: 'Header', group: 'Response', fields: ['header', 'expected'] },
  { type: 'exists', label: 'Exists', group: 'Body', fields: ['path'] },
  { type: 'not-exists', label: 'Does not exist', group: 'Body', fields: ['path'] },
  { type: 'equals', label: 'Equals', group: 'Body', fields: ['path', 'expected'] },
  { type: 'not-equals', label: 'Not equals', group: 'Body', fields: ['path', 'expected'] },
  { type: 'contains', label: 'Contains', group: 'Body', fields: ['path', 'expected'] },
  { type: 'not-contains', label: 'Does not contain', group: 'Body', fields: ['path', 'expected'] },
  { type: 'regex', label: 'Matches regex', group: 'Body', fields: ['path', 'expected'] },
  { type: 'type', label: 'Type is', group: 'Body', fields: ['path', 'expected'], hint: 'string, number, integer, boolean, object, array, null' },
  { type: 'length', label: 'Length', group: 'Body', fields: ['path', 'expected'] },
  { type: 'threshold', label: 'Number within', group: 'Body', fields: ['path', 'min', 'max'] },
  { type: 'json-schema', label: 'JSON Schema', group: 'Body', fields: ['path', 'schema'] },
  { type: 'is-json', label: 'Is valid JSON', group: 'Body', fields: [] },
  { type: 'graphql-no-errors', label: 'No GraphQL errors', group: 'GraphQL', fields: [] },
  { type: 'graphql-errors', label: 'GraphQL error contains', group: 'GraphQL', fields: ['expected'] },
  { type: 'exact-match', label: 'Exact match', group: 'AI', fields: ['path', 'expected'] },
  { type: 'tokens', label: 'Tokens ≤', group: 'AI', fields: ['max'] },
  { type: 'cost', label: 'Cost ≤ (USD)', group: 'AI', fields: ['max'] },
  { type: 'similarity', label: 'Similarity ≥', group: 'AI', fields: ['expected', 'threshold', 'method'], hint: 'method: lexical | f1 | embedding' },
  { type: 'llm-judge', label: 'LLM-as-judge', group: 'AI', fields: ['criteria', 'judge', 'threshold'] },
  { type: 'refusal', label: 'Refuses', group: 'Safety', fields: [] },
  { type: 'not-refusal', label: 'Does not refuse', group: 'Safety', fields: [] },
  { type: 'no-leak', label: 'No sensitive data leak', group: 'Safety', fields: ['values'] },
  { type: 'tool-called', label: 'Tool called', group: 'Agent', fields: ['tool'] },
  { type: 'tool-not-called', label: 'Tool not called', group: 'Agent', fields: ['tool'] },
  { type: 'max-tool-calls', label: 'Max tool calls', group: 'Agent', fields: ['max'] },
  { type: 'tool-args-valid', label: 'Tool args match schema', group: 'Agent', fields: [] },
  { type: 'context-precision', label: 'Context precision', group: 'RAG', fields: ['threshold'] },
  { type: 'context-recall', label: 'Context recall', group: 'RAG', fields: ['threshold'] },
  { type: 'groundedness', label: 'Groundedness', group: 'RAG', fields: ['threshold'] },
  { type: 'answer-relevance', label: 'Answer relevance', group: 'RAG', fields: ['threshold'] },
  { type: 'citation', label: 'Citations valid', group: 'RAG', fields: [] },
];

function parseExpected(s: string): unknown {
  const t = s.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    return s;
  }
}

function showExpected(v: unknown): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function AssertionEditor({ checks, onChange, groups }: { checks: CheckConfig[]; onChange(c: CheckConfig[]): void; groups?: string[] }) {
  const defs = CHECK_DEFS.filter((d) => !groups || groups.includes(d.group));
  const set = (i: number, patch: Partial<CheckConfig>) => onChange(checks.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const byGroup = defs.reduce<Record<string, CheckDef[]>>((a, d) => ((a[d.group] ??= []).push(d), a), {});
  return (
    <div className="p-3 flex flex-col gap-2 text-sm">
      {checks.map((c, i) => {
        const def = CHECK_DEFS.find((d) => d.type === c.type) ?? { type: c.type, label: c.type, group: '', fields: ['path', 'expected'] as CheckDef['fields'] };
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5">
            <select className="field h-7 min-h-7 py-0" value={c.type} onChange={(e) => set(i, { type: e.target.value })} aria-label="Check type">
              {Object.entries(byGroup).map(([g, ds]) => (
                <optgroup key={g} label={g}>
                  {ds.map((d) => (
                    <option key={d.type} value={d.type}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {def.fields.includes('path') && <input className="field h-7 min-h-7 mono w-44" placeholder="$.path (optional)" value={c.path ?? ''} onChange={(e) => set(i, { path: e.target.value || undefined })} />}
            {def.fields.includes('header') && <input className="field h-7 min-h-7 mono w-40" placeholder="header name" value={String(c.header ?? '')} onChange={(e) => set(i, { header: e.target.value })} />}
            {def.fields.includes('tool') && <input className="field h-7 min-h-7 mono w-40" placeholder="tool name" value={String(c.tool ?? '')} onChange={(e) => set(i, { tool: e.target.value })} />}
            {def.fields.includes('expected') && (
              <input className="field h-7 min-h-7 mono flex-1 min-w-32" placeholder={def.hint ?? 'expected (JSON or text)'} value={showExpected(c.expected)} onChange={(e) => set(i, { expected: parseExpected(e.target.value) })} />
            )}
            {def.fields.includes('min') && <input className="field h-7 min-h-7 w-20" type="number" placeholder="min" value={String(c.min ?? '')} onChange={(e) => set(i, { min: e.target.value === '' ? undefined : Number(e.target.value) })} />}
            {def.fields.includes('max') && <input className="field h-7 min-h-7 w-24" type="number" placeholder="max" value={String(c.max ?? '')} onChange={(e) => set(i, { max: e.target.value === '' ? undefined : Number(e.target.value) })} />}
            {def.fields.includes('threshold') && (
              <input className="field h-7 min-h-7 w-24" type="number" step="0.05" placeholder="threshold" value={String(c.threshold ?? '')} onChange={(e) => set(i, { threshold: e.target.value === '' ? undefined : Number(e.target.value) })} />
            )}
            {def.fields.includes('method') && (
              <select className="field h-7 min-h-7 py-0" value={String(c.method ?? 'lexical')} onChange={(e) => set(i, { method: e.target.value })}>
                <option value="lexical">lexical</option>
                <option value="f1">token F1</option>
                <option value="embedding">embedding</option>
              </select>
            )}
            {def.fields.includes('values') && (
              <input
                className="field h-7 min-h-7 mono flex-1 min-w-32"
                placeholder="canary values, comma separated (built-in detectors always on)"
                value={((c.values as string[]) ?? []).join(', ')}
                onChange={(e) => set(i, { values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              />
            )}
            {def.fields.includes('criteria') && (
              <input className="field h-7 min-h-7 flex-1 min-w-48" placeholder="Criteria, e.g. The answer is polite and correct" value={String(c.criteria ?? '')} onChange={(e) => set(i, { criteria: e.target.value })} />
            )}
            {def.fields.includes('judge') && (
              <input
                className="field h-7 min-h-7 mono w-48"
                placeholder="judge provider/model"
                value={c.judge ? `${(c.judge as { provider: string }).provider}/${(c.judge as { name?: string }).name ?? ''}` : ''}
                onChange={(e) => {
                  const [provider, ...rest] = e.target.value.split('/');
                  set(i, { judge: { provider, name: rest.join('/') || undefined, temperature: 0 } });
                }}
              />
            )}
            {def.fields.includes('schema') && (
              <input
                className="field h-7 min-h-7 mono flex-1 min-w-48"
                placeholder='{"type":"object","required":["id"]} (blank = infer from expected)'
                value={c.schema ? JSON.stringify(c.schema) : ''}
                onChange={(e) => {
                  try {
                    set(i, { schema: e.target.value ? JSON.parse(e.target.value) : undefined });
                  } catch {
                    /* keep typing */
                  }
                }}
              />
            )}
            <IconButton label="Remove check" className={cx('ml-auto')} onClick={() => onChange(checks.filter((_, j) => j !== i))}>
              <Trash2 size={13} />
            </IconButton>
          </div>
        );
      })}
      <div>
        <Button size="sm" icon={<Plus size={12} />} onClick={() => onChange([...checks, { type: defs[0]?.type ?? 'status', ...(defs[0]?.type === 'status' ? { expected: 200 } : {}) }])}>
          Add check
        </Button>
      </div>
    </div>
  );
}
