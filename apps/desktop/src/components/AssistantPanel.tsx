import { BookOpen, Bot, Copy, Paperclip, RotateCcw, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { asError, call, on } from '../api';
import { currentViewContext, type ViewContext } from '../lib/assistant-context';
import { useApp } from '../store';
import { Markdown } from './Markdown';
import { AiGeneratedNotice, ErrorPanel } from './Results';
import { Badge, Button, cx, IconButton, Input, Spinner } from './ui';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** The first turn of a task (Explain this response, …): sent, but shown as the task's title. */
  task?: boolean;
  provider?: string;
  model?: string;
}

/**
 * The AI assistant drawer: a conversation about the task it was opened for (or a free question with the context of the
 * current view). Follow-ups remember the conversation; answers stream and can be stopped. Output is always labelled
 * as an AI-generated suggestion.
 */
export function AssistantPanel() {
  const req = useApp((s) => s.assistant)!;
  const set = useApp((s) => s.set);
  const env = useApp((s) => s.environment);
  const free = req.task === 'free';
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState(req.question ?? '');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<ReturnType<typeof asError>>();
  // a free question carries what the current view shows (the open request, …) unless the user leaves it out
  const [viewCtx, setViewCtx] = useState<ViewContext | undefined>(() => (free ? currentViewContext() : undefined));
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => on<Array<{ id: string; delta: string }>>('assistant.deltas', (items) => setStreaming((s) => s + items.filter((d) => d.id === busyRef.current).map((d) => d.delta).join(''))), []);
  const busyRef = useRef<string | undefined>(undefined);
  busyRef.current = busy;

  const ask = async (q?: string) => {
    const text = q?.trim();
    if (busy || (!text && turns.length)) return;
    const id = `as-${Date.now().toString(36)}`;
    const userTurn: Turn = text ? { role: 'user', content: text } : { role: 'user', content: `Task: ${req.title}`, task: true };
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, userTurn]);
    setQuestion('');
    setError(undefined);
    setStreaming('');
    setBusy(id);
    try {
      const context = free ? (viewCtx?.context ?? {}) : req.context;
      const r = await call<{ text: string; provider: string; model: string }>('assistant.ask', { task: req.task, context, question: text, environment: env, history, requestId: id });
      setTurns((t) => [...t, { role: 'assistant', content: r.text, provider: r.provider, model: r.model }]);
    } catch (e) {
      const err = asError(e);
      // stopped: keep what had arrived
      if (err.kind === 'CancelledError' || /abort|cancel/i.test(err.message)) setTurns((t) => [...t, { role: 'assistant', content: `${streamingRef.current}\n\n*(stopped)*`.trim() }]);
      else {
        setError(err);
        setTurns((t) => (t[t.length - 1] === userTurn ? t.slice(0, -1) : t));
        if (text) setQuestion(text);
      }
    } finally {
      setBusy(undefined);
      setStreaming('');
      input.current?.focus();
    }
  };
  const streamingRef = useRef('');
  streamingRef.current = streaming;

  useEffect(() => {
    if (!free || req.question) void ask(req.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, streaming]);

  const stop = () => busy && void call('ai.cancel', { id: busy });
  const restart = () => {
    stop();
    setTurns([]);
    setError(undefined);
    setStreaming('');
    if (free) setViewCtx(currentViewContext());
    else void Promise.resolve().then(() => ask());
  };
  const notSetUp = error && /AI assistant is off|No Claude API key|No AI provider/.test(error.message);

  return (
    <aside className="w-[420px] shrink-0 border-l border-line bg-bg flex flex-col" aria-label="AI assistant">
      <div className="h-10 flex items-center gap-1 px-3 border-b border-line">
        <Bot size={16} className="text-judge shrink-0" />
        <span className="font-medium text-sm truncate ml-1">{req.title}</span>
        <IconButton label="New conversation" className="ml-auto" onClick={restart} disabled={!turns.length && !error}>
          <RotateCcw size={14} />
        </IconButton>
        <IconButton label="Close assistant" onClick={() => (stop(), set({ assistant: undefined }))}>
          <X size={15} />
        </IconButton>
      </div>
      <AiGeneratedNotice />
      <div className="flex-1 overflow-auto p-3 text-sm flex flex-col gap-3" aria-live="polite">
        {turns.map((t, i) =>
          t.role === 'user' ? (
            t.task ? null : (
              <div key={i} className="self-end max-w-[85%] rounded-xl rounded-br-sm bg-accent-soft px-3 py-2 whitespace-pre-wrap" data-turn="user">
                {t.content}
              </div>
            )
          ) : (
            <Answer key={i} turn={t} />
          ),
        )}
        {busy && (streaming ? <Answer turn={{ role: 'assistant', content: streaming }} live /> : (
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> Thinking…
          </div>
        ))}
        {notSetUp ? (
          <div className="rounded-xl border border-line bg-panel p-4 flex flex-col gap-2">
            <div className="font-medium">Set up the AI assistant</div>
            <p className="text-sm text-muted">Save your Claude (Anthropic) API key in Settings, or choose a provider of this workspace such as a local model. The key is kept in the OS secret store.</p>
            <div>
              <Button variant="primary" size="sm" onClick={() => (useApp.getState().set({ assistant: undefined }), useApp.getState().openIntent('settings', { tab: 'assistant' }))}>
                Open Settings ▸ AI assistant
              </Button>
            </div>
          </div>
        ) : (
          error && <ErrorPanel error={error} />
        )}
        {free && !turns.length && !busy && !error && <p className="text-muted">Ask about an API error, a GraphQL schema, an MCP tool, or how to write a test. Follow-up questions remember the conversation.</p>}
        <div ref={end} />
      </div>
      <div className="p-3 border-t border-line flex flex-col gap-2">
        {free && viewCtx && !turns.length && (
          <div className="flex items-center gap-1.5 text-xs text-muted min-w-0" data-assistant-context>
            <Paperclip size={12} className="shrink-0" />
            <span className="truncate" title="Sent with your question (secrets are hidden)">
              Context: {viewCtx.label}
            </span>
            <button className="shrink-0 rounded hover:text-fg hover:bg-hover p-0.5" aria-label="Leave out the context" title="Leave out the context" onClick={() => setViewCtx(undefined)}>
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            ref={input}
            className="flex-1"
            placeholder={turns.length ? 'Ask a follow-up…' : 'Ask a question…'}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void ask(question)}
            aria-label="Question for the assistant"
          />
          {busy ? (
            <Button icon={<Square size={12} />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void ask(question)} disabled={!question.trim() && (!!turns.length || free)}>
              Ask
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

/** One answer: Markdown, each code block with its own Copy button, the model that wrote it. */
function Answer({ turn, live }: { turn: Turn; live?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live || !box.current) return;
    for (const pre of box.current.querySelectorAll('pre')) {
      if (pre.querySelector('[data-copy-code]')) continue;
      const b = document.createElement('button');
      b.dataset.copyCode = '';
      b.textContent = 'Copy';
      b.setAttribute('aria-label', 'Copy this code');
      b.className = 'absolute top-1 right-1 text-xs rounded px-1.5 py-0.5 bg-panel border border-line text-muted hover:text-fg';
      b.onclick = () => {
        void navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? pre.textContent ?? '');
        b.textContent = 'Copied';
        setTimeout(() => (b.textContent = 'Copy'), 1200);
      };
      pre.classList.add('relative');
      pre.appendChild(b);
    }
  }, [turn.content, live]);
  return (
    <div className="flex flex-col gap-1.5" data-turn="assistant">
      <div ref={box}>
        <Markdown source={turn.content} className={cx('leading-relaxed', live && 'opacity-90')} />
      </div>
      {!live && turn.model && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span data-answer-model>
            <Badge tone="judge">
              <BookOpen size={10} /> {turn.provider} · {turn.model}
            </Badge>
          </span>
          <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => void navigator.clipboard.writeText(turn.content)}>
            <Copy size={11} /> Copy
          </button>
        </div>
      )}
    </div>
  );
}
