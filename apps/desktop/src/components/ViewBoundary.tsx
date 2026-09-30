import { Component, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from './ui';

/** The saved draft (persisted state) of each view, which "Reset this view" clears. */
const DRAFT_KEYS: Record<string, string[]> = {
  rest: ['aps.draft.rest'],
  graphql: ['aps.draft.graphql'],
  grpc: ['aps.draft.grpc'],
  websocket: ['aps.draft.websocket'],
  ai: ['aps.draft.ai'],
  evaluations: ['aps.draft.eval'],
  load: ['aps.draft.load'],
};

interface State {
  error?: Error;
}

/**
 * Keeps one broken view from blanking the whole window: shows what went wrong with Try again and
 * Reset this view (which forgets the view's unsaved draft, the usual cause after an upgrade).
 */
export class ViewBoundary extends Component<{ view: string; children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`View "${this.props.view}" failed:`, error, info.componentStack);
  }

  private reset = (clearDraft: boolean) => {
    if (clearDraft)
      for (const k of DRAFT_KEYS[this.props.view] ?? []) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* storage unavailable */
        }
      }
    this.setState({ error: undefined });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="h-full w-full grid place-items-center p-8">
        <div className="max-w-lg w-full rounded-xl border border-line bg-panel p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <TriangleAlert size={18} className="text-warn" />
            This view ran into a problem
          </div>
          <p className="text-sm text-muted">The rest of TestPion still works. Try again, or reset this view to start from a clean draft (saved collections, requests and environments are not affected).</p>
          <pre className="text-xs mono bg-bg border border-line rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap">{error.message}</pre>
          <div className="flex gap-2 justify-end">
            <Button icon={<RotateCcw size={13} />} onClick={() => this.reset(false)}>
              Try again
            </Button>
            {DRAFT_KEYS[this.props.view] && (
              <Button variant="primary" onClick={() => this.reset(true)}>
                Reset this view
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
