import { BookOpen, Bot, FolderPlus, FolderTree, GitBranch, History, KeyRound, Network, Play, Plug, Sparkles, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { call, modKey } from '../api';
import { promptText, useApp } from '../store';
import type { Collection, CollectionNode, HttpRequestSpec } from '../types';
import { timeAgo, uid } from '../lib/format';
import { Badge, cx, Empty, Kbd, statusTone } from '../components/ui';

interface HistoryItem {
  id: string;
  timestamp: string;
  kind: string;
  name: string;
  method?: string;
  url?: string;
  status?: number | string;
  request?: unknown;
}

const DOCS = 'https://nasimuddin-dev.github.io/protolens/';

function Action({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick(): void }) {
  return (
    <button onClick={onClick} className="group text-left rounded-xl border border-line bg-bg p-4 shadow-sm transition-colors hover:border-accent/50 hover:bg-accent/5">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center h-8 w-8 rounded-lg bg-accent/10 text-accent">{icon}</span>
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted mt-2 leading-relaxed">{text}</p>
    </button>
  );
}

function Card({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-bg shadow-sm flex flex-col min-h-0">
      <header className="flex items-center gap-2 px-4 h-11 border-b border-line text-sm font-medium">
        <span className="text-muted">{icon}</span>
        {title}
        <span className="ml-auto">{action}</span>
      </header>
      <div className="p-2 overflow-auto">{children}</div>
    </section>
  );
}

const count = (nodes: CollectionNode[]): number => nodes.reduce((a, n) => a + (n.kind === 'folder' ? count(n.items) : 1), 0);

/** Postman-style home: quick actions, recent requests, collections and environments of the workspace. */
export function HomeView() {
  const ws = useApp((s) => s.workspace);
  const env = useApp((s) => s.environment);
  const [cols, setCols] = useState<Collection[]>([]);
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const open = useApp((s) => s.openIntent);
  const setView = useApp((s) => s.setView);

  const load = () => {
    void call<Collection[]>('col.list').then(setCols);
    void call<{ items: HistoryItem[] }>('history.list', { limit: 8 }).then((r) => setRecent(r.items));
  };
  useEffect(() => {
    load();
    return useApp.subscribe((s, p) => s.view === 'home' && p.view !== 'home' && load());
  }, []);

  const newCollection = async () => {
    const name = await promptText('New collection', { message: 'Collection name', placeholder: 'My API', okLabel: 'Create' });
    if (!name) return;
    const id = uid('col-');
    await call('col.save', { schemaVersion: '1.0', id, name, version: 0, variables: [], items: [], updatedAt: '' });
    open('collections', { collectionId: id });
  };

  return (
    <div className="h-full overflow-auto bg-panel/40">
      <div className="max-w-6xl mx-auto px-8 py-8 flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ws ? ws.name : 'Welcome to Protolens'}</h1>
          <p className="text-sm text-muted mt-1">Build, test and debug REST, GraphQL, MCP and AI APIs. Everything stays on this computer.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Action icon={<Network size={16} />} title="New HTTP request" text="Send a request, paste a cURL command, write pm.* scripts." onClick={() => open('rest', { newTab: true })} />
          <Action icon={<GitBranch size={16} />} title="New GraphQL query" text="Explore a schema with autocomplete and run queries." onClick={() => open('graphql', { reset: true })} />
          <Action icon={<Upload size={16} />} title="Import" text="Postman collections and environments, OpenAPI, HAR or cURL." onClick={() => open('collections', { import: true })} />
          <Action icon={<FolderPlus size={16} />} title="New collection" text="Group requests, share auth and scripts, run and mock them." onClick={() => void newCollection()} />
          <Action icon={<Plug size={16} />} title="Test an MCP server" text="Connect over stdio or HTTP and call tools with generated forms." onClick={() => setView('mcp')} />
          <Action icon={<Sparkles size={16} />} title="Try an AI prompt" text="Compare models, check structured output, track tokens and cost." onClick={() => open('ai', { reset: true })} />
          <Action icon={<Bot size={16} />} title="Ask the assistant" text="Explain an error, draft tests or ask how to do something." onClick={() => useApp.getState().set({ assistant: { task: 'free', title: 'Ask the assistant', context: {} } })} />
          <Action icon={<BookOpen size={16} />} title="Read the docs" text="Guides for requests, scripts, the runner, mocks and the CLI." onClick={() => window.open(DOCS, '_blank', 'noopener')} />
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <Card title="Recent requests" icon={<History size={15} />} action={<button className="text-xs text-accent hover:underline" onClick={() => setView('history')}>All history</button>}>
            {recent.length ? (
              recent.map((h) => (
                <button
                  key={h.id}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-hover"
                  onClick={() => (h.kind === 'http' && h.request ? open('rest', { request: h.request as HttpRequestSpec, name: h.name }) : open('history', { historyId: h.id }))}
                >
                  <span className={cx('mono text-[0.68rem] font-bold w-12 shrink-0', h.method && `method-${h.method}`)}>{h.method ?? h.kind}</span>
                  <span className="truncate flex-1">{h.url ?? h.name}</span>
                  {h.status !== undefined && <Badge tone={statusTone(h.status)}>{h.status}</Badge>}
                  <span className="text-xs text-muted shrink-0 w-16 text-right">{timeAgo(h.timestamp)}</span>
                </button>
              ))
            ) : (
              <Empty title="Nothing sent yet">Requests you send appear here.</Empty>
            )}
          </Card>
          <Card title="Collections" icon={<FolderTree size={15} />} action={<button className="text-xs text-accent hover:underline" onClick={() => void newCollection()}>New</button>}>
            {cols.length ? (
              cols.map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-hover group">
                  <button className="flex-1 text-left truncate" onClick={() => open('collections', { collectionId: c.id })}>
                    {c.name}
                    <span className="text-xs text-muted ml-2">{count(c.items)} requests</span>
                  </button>
                  <button className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent" title="Run collection" aria-label={`Run ${c.name}`} onClick={() => open('collections', { collectionId: c.id, run: true })}>
                    <Play size={13} />
                  </button>
                </div>
              ))
            ) : (
              <Empty title="No collections yet">Create one, or import from Postman or OpenAPI.</Empty>
            )}
          </Card>
          <Card title="Environments" icon={<KeyRound size={15} />} action={<button className="text-xs text-accent hover:underline" onClick={() => setView('environments')}>Manage</button>}>
            {ws?.environments.length ? (
              ws.environments.map((e) => (
                <button key={e.id} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-hover" onClick={() => useApp.getState().setEnvironment(e.name)} title="Make this the active environment">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color ?? (e.isProduction ? 'var(--bad)' : 'var(--ok)') }} />
                  <span className="truncate flex-1">{e.name}</span>
                  {e.isProduction && <Badge tone="bad">prod</Badge>}
                  {e.name === env && <Badge tone="accent">active</Badge>}
                </button>
              ))
            ) : (
              <Empty title="No environments">Environments hold variables like baseUrl and tokens.</Empty>
            )}
          </Card>
        </div>

        <div className="text-xs text-muted flex flex-wrap gap-x-5 gap-y-1">
          <span>
            <Kbd>{modKey}+K</Kbd> commands
          </span>
          <span>
            <Kbd>{modKey}+Shift+F</Kbd> search
          </span>
          <span>
            <Kbd>{modKey}+Enter</Kbd> send
          </span>
          <span>
            <Kbd>{modKey}+S</Kbd> save
          </span>
          <span>
            <Kbd>{modKey}+Alt+C</Kbd> console
          </span>
        </div>
      </div>
    </div>
  );
}
