import { BookOpen, Bot, FolderPlus, FolderTree, GitBranch, History, KeyRound, Network, Play, Plug, Sparkles, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { call, modKey } from '../api';
import { promptText, useApp } from '../store';
import { runMenuCommand } from '../menu-commands';
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

const DOCS = 'https://nasimuddin-dev.github.io/testpion/';

/** Hue per quick action so the grid is easy to scan. */
const HUES = { blue: 'oklch(0.62 0.19 255)', violet: 'oklch(0.6 0.22 295)', teal: 'oklch(0.66 0.13 190)', green: 'oklch(0.64 0.16 150)', orange: 'oklch(0.7 0.16 55)', pink: 'oklch(0.64 0.21 350)', indigo: 'oklch(0.58 0.2 270)', slate: 'oklch(0.6 0.03 260)' };

function Action({ icon, title, text, onClick, hue }: { icon: ReactNode; title: string; text: string; onClick(): void; hue: keyof typeof HUES }) {
  const c = HUES[hue];
  return (
    <button
      onClick={onClick}
      style={{ '--hue': c } as React.CSSProperties}
      className="group text-left rounded-2xl border border-line bg-bg p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-[color-mix(in_oklch,var(--hue)_45%,var(--line))] active:translate-y-0"
    >
      <div className="flex items-center gap-3">
        <span className="grid place-items-center h-9 w-9 rounded-xl text-[var(--hue)] bg-[color-mix(in_oklch,var(--hue)_14%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--hue)_22%,transparent)] transition-transform duration-200 group-hover:scale-105">{icon}</span>
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted mt-2.5 leading-relaxed">{text}</p>
    </button>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function Card({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-bg shadow-sm flex flex-col min-h-0">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-line text-sm font-semibold">
        <span className="grid place-items-center h-7 w-7 rounded-lg bg-panel2 text-muted">{icon}</span>
        {title}
        <span className="ml-auto">{action}</span>
      </header>
      <div className="p-2 overflow-auto">{children}</div>
    </section>
  );
}

const count = (nodes: CollectionNode[]): number => nodes.reduce((a, n) => a + (n.kind === 'folder' ? count(n.items) : 1), 0);

/** Postman-style home: quick actions, recent requests, collections and environments of the workspace. */
/** Id of the examples workspace that ships with the app (examples/public-workspace). */
const EXAMPLES_ID = 'ws-testpion-examples';

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
    <div className="h-full overflow-auto">
      <div className="max-w-[1400px] mx-auto px-8 py-8 flex flex-col gap-6">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-panel px-7 py-6 shadow-sm">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-[image:var(--brand-gradient)] opacity-20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-[var(--brand-from)] opacity-10 blur-3xl" />
          <p className="relative text-sm font-medium text-accent">{greeting()} 👋</p>
          <h1 className="relative text-[1.75rem] font-semibold tracking-tight mt-1">{ws ? ws.name : 'Welcome to TestPion'}</h1>
          <p className="relative text-sm text-muted mt-1.5 max-w-2xl">Build, test and debug REST, GraphQL, gRPC, WebSocket, MCP and AI APIs. Everything stays on this computer.</p>
          {ws?.id === EXAMPLES_ID ? (
            <p className="relative text-sm mt-3 max-w-3xl">
              These examples use free public APIs. Open a collection and press <b>Send</b>, run a whole collection, or run the <b>All examples</b> and <b>Offline</b> suites in{' '}
              <button className="text-accent hover:underline" onClick={() => setView('tests')}>
                Tests
              </button>
              . MCP has public servers, WebSocket and gRPC have saved connections, and AI Lab has prompts that run on an offline demo model.
            </p>
          ) : (
            <button className="relative block mt-3 text-sm text-accent hover:underline" onClick={() => void runMenuCommand('open-examples')}>
              Explore the examples workspace: REST, GraphQL, gRPC, WebSocket, MCP and AI against public APIs →
            </button>
          )}
          {env && (
            <p className="relative mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-bg/70 px-3 py-1 text-xs text-muted">
              <span className="w-2 h-2 rounded-full" style={{ background: ws?.environments.find((e) => e.name === env)?.color ?? 'var(--ok)' }} />
              Active environment: <span className="text-fg font-medium">{env}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Action icon={<Network size={16} />} hue="blue" title="New HTTP request" text="Send a request, paste cURL or fetch from the browser, write pm.* scripts." onClick={() => open('rest', { newTab: true })} />
          <Action icon={<GitBranch size={16} />} hue="pink" title="New GraphQL query" text="Explore a schema with autocomplete and run queries." onClick={() => open('graphql', { reset: true })} />
          <Action icon={<Upload size={16} />} hue="teal" title="Import" text="Postman, Insomnia, Bruno or Hoppscotch collections, OpenAPI, HAR or cURL." onClick={() => open('collections', { import: true })} />
          <Action icon={<FolderPlus size={16} />} hue="orange" title="New collection" text="Group requests, share auth and scripts, run and mock them." onClick={() => void newCollection()} />
          <Action icon={<Plug size={16} />} hue="green" title="Test an MCP server" text="Connect over stdio or HTTP and call tools with generated forms." onClick={() => setView('mcp')} />
          <Action icon={<Sparkles size={16} />} hue="violet" title="Try an AI prompt" text="Compare models, check structured output, track tokens and cost." onClick={() => open('ai', { reset: true })} />
          <Action icon={<Bot size={16} />} hue="indigo" title="Ask the assistant" text="Explain an error, draft tests or ask how to do something." onClick={() => useApp.getState().set({ assistant: { task: 'free', title: 'Ask the assistant', context: {} } })} />
          <Action icon={<BookOpen size={16} />} hue="slate" title="Read the docs" text="Guides for requests, scripts, the runner, mocks and the CLI." onClick={() => window.open(DOCS, '_blank', 'noopener')} />
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
                  <span className={cx('mono method-badge text-[0.64rem] font-bold w-14 shrink-0', h.method && `method-${h.method}`)}>{h.method ?? h.kind}</span>
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
