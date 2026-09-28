import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { call, on } from './api';
import { useApp, type ViewId } from './store';
import { AssistantPanel, CommandPalette, DialogHost, LogsPanel, ProgressHost, SearchDialog, Sidebar, StatusBar, Toaster, TopBar, NAV, type PaletteCommand } from './components/Shell';
import { checkForUpdates, scheduleUpdateCheck } from './updates';
import { Spinner, TooltipProvider } from './components/ui';

/**
 * Each tool is a separate product surface. Loading it only when selected keeps
 * startup fast and, importantly, defers Monaco and protocol-specific code until
 * it is useful. Named exports keep view modules simple.
 */
const view = (load: () => Promise<any>, name: string) => lazy(async () => ({ default: (await load())[name] as ComponentType }));
const VIEWS: Record<ViewId, LazyExoticComponent<ComponentType>> = {
  home: view(() => import('./views/HomeView'), 'HomeView'),
  rest: view(() => import('./views/RestView'), 'RestView'),
  graphql: view(() => import('./views/GraphQLView'), 'GraphQLView'),
  websocket: view(() => import('./views/WebSocketView'), 'WebSocketView'),
  mcp: view(() => import('./views/McpView'), 'McpView'),
  ai: view(() => import('./views/AiLabView'), 'AiLabView'),
  evaluations: view(() => import('./views/EvaluationsView'), 'EvaluationsView'),
  tests: view(() => import('./views/TestsView'), 'TestsView'),
  load: view(() => import('./views/LoadView'), 'LoadView'),
  traces: view(() => import('./views/TracesView'), 'TracesView'),
  collections: view(() => import('./views/CollectionsView'), 'CollectionsView'),
  history: view(() => import('./views/HistoryView'), 'HistoryView'),
  environments: view(() => import('./views/EnvironmentsView'), 'EnvironmentsView'),
  settings: view(() => import('./views/SettingsView'), 'SettingsView'),
};

// Keeping a few recently used screens mounted preserves short-lived work (such
// as a stream or an unsaved request), without letting every editor and listener
// in a long session consume memory and CPU indefinitely.
const MAX_CACHED_VIEWS = 4;

function useThemeEffect() {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    const apply = () => {
      const t = settings?.theme ?? 'system';
      const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.reducedMotion = String(!!settings?.reducedMotion);
      document.documentElement.style.setProperty('--font-size', `${settings?.fontSize ?? 14}px`);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings]);
}

export default function App() {
  const view = useApp((s) => s.view);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const searchOpen = useApp((s) => s.searchOpen);
  const assistant = useApp((s) => s.assistant);
  const logsOpen = useApp((s) => s.logsOpen);
  const workspace = useApp((s) => s.workspace);
  const [ready, setReady] = useState(false);
  // keep visited views mounted so drafts, live sessions and streams survive navigation
  const [visited, setVisited] = useState<ViewId[]>([view]);
  useThemeEffect();

  useEffect(() => {
    void (async () => {
      try {
        const [info, settings] = await Promise.all([call('app.info'), call('settings.get')]);
        useApp.getState().set({ info, settings });
        await useApp.getState().refreshWorkspace();
        scheduleUpdateCheck();
      } catch (error) {
        useApp.getState().toast(`Could not finish starting ProtoPion: ${error instanceof Error ? error.message : String(error)}`, 'error');
      } finally {
        // The shell remains usable if a workspace service is temporarily down.
        setReady(true);
      }
    })();
    const off = on('run.error', (p: { error: { message: string } }) => useApp.getState().toast(`Run failed: ${p.error.message}`, 'error'));
    const offUpdate = on('update.checkManual', () => void checkForUpdates({ manual: true }));
    return () => {
      off();
      offUpdate();
    };
  }, []);

  useEffect(() => {
    setVisited((cached) => {
      const next = [...cached.filter((id) => id !== view), view];
      return next.length > MAX_CACHED_VIEWS ? next.slice(-MAX_CACHED_VIEWS) : next;
    });
  }, [view]);
  // re-mount views when the workspace changes
  useEffect(() => setVisited([useApp.getState().view]), [workspace?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const { set } = useApp.getState();
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        set({ paletteOpen: true, searchOpen: false });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        set({ searchOpen: true, paletteOpen: false });
      } else if (mod && e.key === ',') {
        e.preventDefault();
        useApp.getState().setView('settings');
      } else if (mod && e.altKey && e.key.toLowerCase() === 'c') {
        // Postman's shortcut for the console
        e.preventDefault();
        const st = useApp.getState();
        set(st.logsOpen && st.bottomTab === 'console' ? { logsOpen: false } : { logsOpen: true, bottomTab: 'console' });
      } else if (mod && e.altKey && /^[1-9]$/.test(e.key)) {
        const n = NAV[Number(e.key) - 1];
        if (n) useApp.getState().setView(n.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands = useMemo<PaletteCommand[]>(() => {
    const s = useApp.getState();
    const cmds: PaletteCommand[] = [
      { id: 'new-request', label: 'New Request', hint: 'REST', run: () => s.openIntent('rest', { newTab: true }) },
      { id: 'new-graphql', label: 'New GraphQL Query', hint: 'GraphQL', run: () => s.openIntent('graphql', { reset: true }) },
      { id: 'new-mcp', label: 'New MCP Test', hint: 'MCP', run: () => s.setView('mcp') },
      { id: 'new-ai', label: 'New AI Test', hint: 'AI Lab', run: () => s.openIntent('ai', { reset: true }) },
      { id: 'run-test', label: 'Run Test', hint: 'Tests', run: () => s.openIntent('tests', { runCurrent: true }) },
      { id: 'run-suite', label: 'Run Suite', hint: 'Tests', run: () => s.openIntent('tests', { runAll: true }) },
      { id: 'open-collection', label: 'Open Collection', hint: 'Collections', run: () => s.setView('collections') },
      { id: 'search-history', label: 'Search History', hint: 'History', run: () => s.setView('history') },
      { id: 'open-settings', label: 'Open Settings', hint: `${'Ctrl'}+,`, run: () => s.setView('settings') },
      { id: 'export-results', label: 'Export Results', hint: 'Tests', run: () => s.openIntent('tests', { exportLatest: true }) },
      { id: 'search', label: 'Search Workspace', hint: 'Ctrl+Shift+F', run: () => s.set({ searchOpen: true }) },
      { id: 'toggle-console', label: 'Show Console', hint: 'Ctrl+Alt+C', run: () => s.set({ logsOpen: true, bottomTab: 'console' }) },
      { id: 'toggle-logs', label: 'Show Application Logs', run: () => s.set({ logsOpen: true, bottomTab: 'logs' }) },
      { id: 'assistant', label: 'Ask AI Assistant', run: () => s.set({ assistant: { task: 'free', title: 'Ask the assistant', context: {} } }) },
      { id: 'new-ws', label: 'New WebSocket Connection', run: () => s.setView('websocket') },
      { id: 'load', label: 'New Load Test', run: () => s.setView('load') },
      { id: 'compare', label: 'Compare Models', hint: 'AI Lab', run: () => s.openIntent('ai', { tab: 'compare' }) },
      { id: 'eval', label: 'New Evaluation Run', hint: 'Evaluations', run: () => s.setView('evaluations') },
      { id: 'update', label: 'Check for Updates', hint: 'Help', run: () => void checkForUpdates({ manual: true }) },
    ];
    for (const n of NAV) cmds.push({ id: `go-${n.id}`, label: `Go to ${n.label}`, run: () => s.setView(n.id) });
    for (const e of workspace?.environments ?? []) cmds.push({ id: `env-${e.id}`, label: `Switch Environment: ${e.name}`, run: () => s.setEnvironment(e.name) });
    return cmds;
  }, [workspace]);

  if (!ready)
    return (
      <div className="h-full grid place-items-center">
        <Spinner size={22} />
      </div>
    );

  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            {visited.map((id) => {
              const V = VIEWS[id];
              return (
                <div key={`${workspace?.id}-${id}`} className="absolute inset-0 flex flex-col" style={{ display: id === view ? 'flex' : 'none' }}>
                  <Suspense fallback={<div className="h-full grid place-items-center"><Spinner size={20} /></div>}>
                    <V />
                  </Suspense>
                </div>
              );
            })}
          </div>
          {logsOpen && <LogsPanel />}
        </main>
        {assistant && <AssistantPanel key={JSON.stringify(assistant).slice(0, 200)} />}
      </div>
      <StatusBar />
      {paletteOpen && <CommandPalette commands={commands} />}
      {searchOpen && <SearchDialog />}
      <Toaster />
      <DialogHost />
      <ProgressHost />
    </div>
    </TooltipProvider>
  );
}
