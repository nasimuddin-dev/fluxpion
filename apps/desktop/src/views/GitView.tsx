import { ArrowDown, ArrowUp, Check, ExternalLink, FolderGit2, GitBranch, GitCommitHorizontal, GitPullRequest, Minus, Plus, RefreshCw, RotateCcw, ShieldAlert, Sparkles, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { asError, call, on } from '../api';
import { confirmAction, promptText, useApp } from '../store';
import { Badge, Button, cx, Empty, Menu, PageHeader, SectionTitle, Spinner } from '../components/ui';
import { ChangeMark } from '../components/ChangeMark';

export interface GitFile {
  path: string;
  state: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
  from?: string;
}

export interface GitStatusInfo {
  available: boolean;
  version?: string;
  repository: boolean;
  root?: string;
  branch?: string;
  upstream?: string;
  remote?: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  conflicted: boolean;
}

export interface SemanticChange {
  file: string;
  kind: string;
  change: 'added' | 'removed' | 'changed' | 'renamed' | 'conflicted';
  title: string;
  details: string[];
  collectionId?: string;
  itemId?: string;
  itemKind?: string;
}

interface SecretFinding {
  file: string;
  where: string;
  message: string;
}

const fail = (e: unknown) => useApp.getState().toast(asError(e).message, 'error');

/** Open a changed request in its editor. */
function openItem(c: SemanticChange) {
  if (!c.collectionId || !c.itemId) return;
  const view = c.itemKind === 'graphql' ? 'graphql' : c.itemKind === 'http' ? 'rest' : undefined;
  if (view) useApp.getState().openIntent(view, { collectionId: c.collectionId, requestId: c.itemId });
}

/**
 * Git for the workspace (GIT-204 … GIT-209, GIT-304): what changed by meaning, commit (secrets checked first, an AI
 * written message on request), branches, pull and push, and a link to open a pull request.
 */
export function GitView() {
  const [status, setStatus] = useState<GitStatusInfo>();
  const [changes, setChanges] = useState<SemanticChange[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string>();
  const [secrets, setSecrets] = useState<SecretFinding[]>();
  const [branches, setBranches] = useState<{ current?: string; local: string[]; remote: string[] }>();
  const [log, setLog] = useState<Array<{ hash: string; short: string; author: string; date: string; subject: string }>>([]);
  const [diff, setDiff] = useState<{ path: string; text: string }>();
  const [prUrl, setPrUrl] = useState<string>();

  const load = useCallback(async () => {
    try {
      const st = await call<GitStatusInfo>('git.status');
      setStatus(st);
      if (!st.repository) return;
      const [ch, br, lg, pr] = await Promise.all([
        call<{ changes: SemanticChange[] }>('git.changes'),
        call<typeof branches>('git.branches'),
        call<typeof log>('git.log', { limit: 30 }),
        call<{ url?: string }>('git.pullRequestUrl').catch(() => ({ url: undefined })),
      ]);
      setChanges(ch.changes);
      // a commit an AI agent proposed: its message, for the user to review
      const proposal = await call<{ message: string } | null>('git.proposal').catch(() => null);
      if (proposal?.message) setMessage((m) => m || proposal.message);
      setBranches(br);
      setLog(lg);
      setPrUrl(pr.url);
    } catch (e) {
      fail(e);
    }
  }, []);

  useEffect(() => {
    void load();
    const offs = [on('git.changed', () => void load()), on('data.changed', () => void load())];
    return () => offs.forEach((o) => o());
  }, [load]);

  const run = async (label: string, op: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      await op();
      if (done) useApp.getState().toast(done, 'success');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
      void load();
    }
  };

  const files = status?.files ?? [];
  const byFile = useMemo(() => {
    const m = new Map<string, SemanticChange[]>();
    for (const c of changes) m.set(c.file, [...(m.get(c.file) ?? []), c]);
    return m;
  }, [changes]);

  const commit = async (force = false) => {
    if (!message.trim()) return useApp.getState().toast('Write a commit message first (or let the assistant write one).', 'warning');
    setBusy('commit');
    try {
      // with nothing staged, commit every change of the workspace
      const paths = files.some((f) => f.staged) ? undefined : ['.'];
      const r = await call<{ committed: boolean; secrets: SecretFinding[]; commit?: { short: string } }>('git.commit', { message, paths, force });
      if (!r.committed) return setSecrets(r.secrets);
      setSecrets(undefined);
      setMessage('');
      useApp.getState().toast(`Committed ${r.commit?.short ?? ''}`, 'success');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
      void load();
    }
  };

  if (!status) return <Empty icon={<Spinner size={20} />} title="Reading git…" />;
  if (!status.available)
    return (
      <Empty icon={<FolderGit2 size={26} />} title="Git is not installed">
        TestPion uses the git installed on this computer (with your SSH keys and sign-in). Install it from git-scm.com, then restart TestPion.
      </Empty>
    );
  if (!status.repository)
    return (
      <Empty
        icon={<FolderGit2 size={26} />}
        title="This workspace is not in git yet"
        action={
          <div className="flex gap-2 justify-center">
            <Button variant="primary" loading={busy === 'init'} onClick={() => void run('init', () => call('git.init', {}), 'The workspace is now a git repository')}>
              Initialize repository
            </Button>
            <Button
              loading={busy === 'remote'}
              onClick={async () => {
                const remote = await promptText('Connect to a git repository', { message: 'The URL of an empty repository (GitHub, GitLab, Bitbucket, Azure DevOps …). Push sends the workspace there.', placeholder: 'https://github.com/team/api-tests.git' });
                if (remote) await run('remote', () => call('git.init', { remote }), 'Connected: commit, then Push');
              }}
            >
              Connect to a remote…
            </Button>
          </div>
        }
      >
        Keep the collections, environments and tests in a git repository to review changes, share them with your team and run them in CI. Results, history and secrets stay on this computer.
      </Empty>
    );

  const staged = files.filter((f) => f.staged);
  const branchItems = [
    ...(branches?.local ?? []).filter((b) => b !== branches?.current).map((b) => ({ label: b, icon: <GitBranch size={14} />, onSelect: () => void run('switch', () => call('git.switch', { branch: b }), `Switched to ${b}`) })),
    ...(branches?.remote ?? [])
      .filter((r) => !(branches?.local ?? []).includes(r.replace(/^[^/]+\//, '')))
      .map((r) => ({ label: r, icon: <GitBranch size={14} />, onSelect: () => void run('switch', () => call('git.switch', { branch: r }), `Switched to ${r.replace(/^[^/]+\//, '')}`) })),
    {
      label: 'New branch…',
      icon: <Plus size={14} />,
      onSelect: async () => {
        const name = await promptText('New branch', { message: 'Your changes come along to the new branch.', placeholder: 'feature/payments-tests' });
        if (name) await run('switch', () => call('git.switch', { branch: name.trim(), create: true }), `On the new branch ${name.trim()}`);
      },
    },
  ];

  return (
    <div className="h-full flex flex-col min-h-0">
      <PageHeader
        icon={<FolderGit2 size={18} />}
        title="Git"
        subtitle={status.remote ?? 'No remote yet'}
        actions={
          <>
            <Menu trigger={<Button icon={<GitBranch size={13} />}>{status.branch ?? 'detached'}</Button>} items={branchItems} />
            <Button icon={<RefreshCw size={13} />} loading={busy === 'fetch'} onClick={() => void run('fetch', () => call('git.fetch'))} title="Fetch: see what the remote has">
              Fetch
            </Button>
            <Button
              icon={<ArrowDown size={13} />}
              loading={busy === 'pull'}
              onClick={() =>
                void run('pull', async () => {
                  const r = await call<{ conflicted: boolean }>('git.pull', {});
                  useApp.getState().toast(r.conflicted ? 'Pulled with conflicts: resolve them below' : 'Up to date with the remote', r.conflicted ? 'warning' : 'success');
                })
              }
              title="Pull: bring in your team's commits"
            >
              Pull{status.behind ? ` ${status.behind}` : ''}
            </Button>
            <Button icon={<ArrowUp size={13} />} loading={busy === 'push'} disabled={!status.remote} onClick={() => void run('push', () => call('git.push'), 'Pushed')} title={status.remote ? 'Push: send your commits' : 'Connect a remote first'}>
              Push{status.ahead ? ` ${status.ahead}` : ''}
            </Button>
            {prUrl && (
              <Button icon={<GitPullRequest size={13} />} onClick={() => void call('app.openExternal', { url: prUrl }).catch(() => window.open(prUrl))} title="Open a pull request for this branch on the remote's website">
                Pull request
              </Button>
            )}
          </>
        }
        menu={[
          {
            label: status.remote ? 'Change remote…' : 'Connect to a remote…',
            icon: <ExternalLink size={14} />,
            onSelect: async () => {
              const remote = await promptText('Remote repository', { value: status.remote, placeholder: 'https://github.com/team/api-tests.git' });
              if (remote) await run('remote', () => call('git.init', { remote }), 'Remote saved');
            },
          },
          { label: 'Make ready for git', icon: <Check size={14} />, onSelect: () => void run('ready', () => call('ws.gitReady'), 'Git files are in place') },
        ]}
      />
      <div className="flex-1 min-h-0 overflow-auto p-4 grid gap-5 content-start max-w-5xl w-full">
        {status.conflicted && <ConflictPanel files={files.filter((f) => f.state === 'conflicted')} onDone={() => void load()} />}

        <section>
          <SectionTitle
            right={
              files.length > 0 && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => void run('stage', () => call('git.stage', { paths: files.map((f) => f.path) }))}>
                    Stage all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Undo2 size={12} />}
                    onClick={async () => {
                      if (await confirmAction({ title: 'Discard all changes', message: `Throw away ${files.length} changed file${files.length === 1 ? '' : 's'}?`, detail: 'Files go back to the last commit; new files are deleted.', confirmLabel: 'Discard', danger: true }))
                        await run('discard', () => call('git.discard', { files }), 'Changes discarded');
                    }}
                  >
                    Discard all
                  </Button>
                </div>
              )
            }
          >
            Changes {files.length ? <Badge>{files.length}</Badge> : null}
          </SectionTitle>
          {!files.length ? (
            <div className="text-sm text-muted py-3">Nothing changed since the last commit.</div>
          ) : (
            <ul className="grid gap-1" aria-label="Changes">
              {files.map((f) => (
                <li key={f.path} className="rounded-md border border-line bg-panel">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <ChangeMark change={f.state} />
                    <button className="font-mono text-xs truncate text-left hover:underline" title="Show the line diff" onClick={() => void call<string>('git.diff', { path: f.path, staged: f.staged }).then((text) => setDiff(diff?.path === f.path ? undefined : { path: f.path, text }), fail)}>
                      {f.path}
                    </button>
                    {f.staged && <Badge tone="accent">staged</Badge>}
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" icon={f.staged ? <Minus size={12} /> : <Plus size={12} />} onClick={() => void run('stage', () => call(f.staged ? 'git.unstage' : 'git.stage', { paths: [f.path] }))}>
                        {f.staged ? 'Unstage' : 'Stage'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw size={12} />}
                        onClick={async () => {
                          if (await confirmAction({ title: 'Discard changes', message: `Throw away the changes to ${f.path}?`, confirmLabel: 'Discard', danger: true })) await run('discard', () => call('git.discard', { files: [f] }));
                        }}
                      >
                        Discard
                      </Button>
                    </span>
                  </div>
                  {(byFile.get(f.path) ?? []).filter((c) => c.title !== f.path).length > 0 && (
                    <ul className="border-t border-line px-3 py-1.5 grid gap-0.5">
                      {(byFile.get(f.path) ?? []).map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <ChangeMark change={c.change} />
                          <button className={cx('truncate text-left', c.itemKind === 'http' || c.itemKind === 'graphql' ? 'hover:underline' : 'cursor-default')} onClick={() => openItem(c)}>
                            {c.title}
                          </button>
                          {c.details.length > 0 && <span className="text-muted truncate">{c.details.join(', ')}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {diff?.path === f.path && <pre className="border-t border-line max-h-80 overflow-auto p-2 text-[0.72rem] font-mono whitespace-pre">{diff.text || '(no line changes: a new or binary file)'}</pre>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-2">
          <SectionTitle>Commit {staged.length ? <span className="text-muted font-normal">· {staged.length} staged</span> : files.length ? <span className="text-muted font-normal">· all changes</span> : null}</SectionTitle>
          <textarea className="field min-h-20 font-mono text-xs" aria-label="Commit message" placeholder="What changed and why (e.g. Add payment tests)" value={message} onChange={(e) => setMessage(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="primary" icon={<GitCommitHorizontal size={13} />} loading={busy === 'commit'} disabled={!files.length} onClick={() => void commit()}>
              Commit
            </Button>
            <Button
              icon={<Sparkles size={13} />}
              loading={busy === 'suggest'}
              disabled={!files.length}
              title="The AI assistant writes a message from what changed (no secret values are sent)"
              onClick={() => void run('suggest', async () => setMessage((await call<{ message: string }>('git.suggestMessage')).message))}
            >
              Write message
            </Button>
          </div>
          {secrets && secrets.length > 0 && (
            <div role="alert" className="rounded-md border border-bad/40 bg-bad/5 p-3 text-sm grid gap-2">
              <div className="flex items-center gap-2 font-medium">
                <ShieldAlert size={15} className="text-bad" /> Not committed: {secrets.length} secret{secrets.length === 1 ? ' is' : 's are'} typed into the workspace
              </div>
              <ul className="text-xs grid gap-0.5">
                {secrets.slice(0, 12).map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.where}</span> <span className="text-muted">({s.file}) {s.message}</span>
                  </li>
                ))}
              </ul>
              <div className="text-xs text-muted">Make them secret variables (their values stay on this computer), or use {'{{variables}}'}, then commit again.</div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setSecrets(undefined)}>
                  Fix them first
                </Button>
                <Button size="sm" variant="danger" onClick={() => void commit(true)}>
                  Commit anyway
                </Button>
              </div>
            </div>
          )}
        </section>

        <section>
          <SectionTitle>History</SectionTitle>
          {!log.length ? (
            <div className="text-sm text-muted py-2">No commits yet.</div>
          ) : (
            <ul className="grid gap-0.5 text-sm" aria-label="Commits">
              {log.map((c) => (
                <li key={c.hash} className="flex items-center gap-2 py-0.5">
                  <span className="font-mono text-xs text-muted">{c.short}</span>
                  <span className="truncate">{c.subject}</span>
                  <span className="ml-auto text-xs text-muted whitespace-nowrap">
                    {c.author} · {new Date(c.date).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="text-xs text-muted">git {status.version} · sign-in uses your git setup (SSH keys or the credential manager)</div>
      </div>
    </div>
  );
}

/** Files changed on both sides after a pull (GIT-302): keep yours, take theirs, or open the file to merge by hand. */
function ConflictPanel({ files, onDone }: { files: GitFile[]; onDone(): void }) {
  const [busy, setBusy] = useState<string>();
  const pick = async (path: string, side: 'ours' | 'theirs') => {
    setBusy(path);
    try {
      await call('git.resolve', { path, side });
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section role="alert" className="rounded-md border border-warn/50 bg-warn/5 p-3 grid gap-2">
      <SectionTitle>Conflicts · changed by you and by someone else</SectionTitle>
      <ul className="grid gap-1">
        {files.map((f) => (
          <li key={f.path} className="flex items-center gap-2 text-sm">
            <ChangeMark change="conflicted" />
            <span className="font-mono text-xs truncate">{f.path}</span>
            <span className="ml-auto flex gap-1">
              <Button size="sm" loading={busy === f.path} onClick={() => void pick(f.path, 'ours')}>
                Keep mine
              </Button>
              <Button size="sm" loading={busy === f.path} onClick={() => void pick(f.path, 'theirs')}>
                Take theirs
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 items-center">
        <Button size="sm" variant="ghost" onClick={() => void call('git.abortMerge').then(onDone, fail)}>
          Cancel the pull
        </Button>
        <span className="text-xs text-muted">In a collection, only the requests changed on both sides take the side you choose; every other change of both sides stays. When every file is resolved, commit to finish the pull.</span>
      </div>
    </section>
  );
}
