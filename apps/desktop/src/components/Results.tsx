import { AlertTriangle, Bot, CheckCircle2, CircleSlash, Lightbulb, Sparkles, XCircle } from 'lucide-react';
import type { NormalizedError } from '../api';
import type { CheckResult } from '../types';
import { useApp } from '../store';
import { Badge, Button, cx } from './ui';

/** Normalised error display: what happened, why, and how to fix it (spec §45). */
export function ErrorPanel({ error, context }: { error: NormalizedError; context?: unknown }) {
  const ask = () =>
    useApp.getState().set({ assistant: { task: 'explain-error', title: `Explain ${error.kind}`, context: { error, ...((context as object) ?? {}) } } });
  return (
    <div className="m-3 rounded-lg border border-bad/40 bg-bad/5 p-4 text-sm">
      <div className="flex items-start gap-2">
        <XCircle size={18} className="text-bad shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone="bad">{error.kind}</Badge>
            <span className="font-semibold break-all">{error.what || error.message}</span>
          </div>
          {error.why && error.why !== error.message && (
            <p className="mt-2">
              <span className="text-muted">Why: </span>
              {error.why}
            </p>
          )}
          {error.suggestions.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-1 text-muted text-xs font-semibold uppercase tracking-wider mb-1">
                <Lightbulb size={12} /> Troubleshooting
              </div>
              <ul className="list-disc ml-5 space-y-0.5">
                {error.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {error.details && <pre className="mt-3 mono text-xs bg-panel p-2 rounded overflow-auto max-h-40">{JSON.stringify(error.details, null, 2)}</pre>}
          <Button size="sm" variant="ghost" className="mt-3 -ml-2" icon={<Sparkles size={12} />} onClick={ask}>
            Explain with AI assistant
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SourceBadge({ source }: { source: CheckResult['source'] }) {
  if (source === 'deterministic') return null;
  if (source === 'ai-judge')
    return (
      <Badge tone="judge" title="Model-generated judgement — not deterministic. Verify before relying on it.">
        <Bot size={10} /> AI judge
      </Badge>
    );
  return <Badge title={source === 'heuristic' ? 'Approximate heuristic metric' : 'Embedding-based semantic metric'}>{source}</Badge>;
}

export function CheckList({ checks, compact }: { checks: CheckResult[]; compact?: boolean }) {
  if (!checks.length) return <div className="p-4 text-sm text-muted">No assertions. Add some in the Tests tab.</div>;
  const passed = checks.filter((c) => c.passed).length;
  return (
    <div className="text-sm">
      {!compact && (
        <div className={cx('px-3 py-2 font-medium flex items-center gap-2 border-b border-line', passed === checks.length ? 'text-ok' : 'text-bad')}>
          {passed === checks.length ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {passed}/{checks.length} passed
        </div>
      )}
      {checks.map((c, i) => (
        <div key={i} className="px-3 py-1.5 border-b border-line last:border-0 flex items-start gap-2">
          {c.passed ? <CheckCircle2 size={14} className="text-ok mt-0.5 shrink-0" /> : <XCircle size={14} className="text-bad mt-0.5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">{c.name}</span>
              <SourceBadge source={c.source} />
              {c.score !== undefined && <Badge tone={c.passed ? 'ok' : 'bad'}>score {c.score}</Badge>}
            </div>
            <div className="text-muted break-words">{c.message}</div>
            {c.explanation && (
              <div className="mt-1 text-xs border-l-2 border-judge/50 pl-2 text-muted">
                <span className="text-judge font-medium">Judge reasoning (AI-generated): </span>
                {c.explanation}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatusIcon({ status }: { status: string }) {
  if (status === 'passed') return <CheckCircle2 size={14} className="text-ok" />;
  if (status === 'skipped') return <CircleSlash size={14} className="text-warn" />;
  if (status === 'error') return <AlertTriangle size={14} className="text-bad" />;
  return <XCircle size={14} className="text-bad" />;
}

/** Banner that marks content as AI-generated (spec §34, rule 17). */
export function AiGeneratedNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs px-3 py-1.5 bg-judge/10 text-judge border-b border-judge/30">
      <Sparkles size={12} /> {children ?? 'AI-generated suggestion — verify before use. This is not a test result.'}
    </div>
  );
}
