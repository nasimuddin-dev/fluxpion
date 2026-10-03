import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApsError } from '../errors.js';
import type { Collection } from '../model/types.js';
import type { WorkspaceStore } from '../storage/workspace.js';
import { gitLog, gitStage, gitStatus } from '../git/git.js';
import { changesMarkdown, describeGitChanges, describeRevChanges } from '../git/semantic.js';
import { findCommittableSecrets } from '../storage/git-guard.js';
import { str, type Tool } from './tool.js';

/** MCP tools for the workspace's git repository (GIT-402): status, the changes by meaning, history, a proposed commit. */
export function gitTools(d: { store: WorkspaceStore; findCollection(ref: unknown): Collection }): Tool[] {
  const { store, findCollection } = d;
  return [
    {
      name: 'git_status',
      description:
        'Git state of the workspace: whether it is in a repository, the branch, commits ahead / behind the remote, and each changed file (modified, added, deleted, renamed, untracked, conflicted; staged or not).',
      inputSchema: { type: 'object', properties: {} },
      run: () => gitStatus(store.root),
    },
    {
      name: 'git_diff',
      description:
        'What changed in the workspace, by meaning rather than JSON lines: requests and folders added, changed (which parts: URL, headers, body, auth, scripts, checks …) or removed, environment variables added / changed / removed, test files. Without `from`: the uncommitted changes. With `from` (and optionally `to`): between two commits, branches or tags (e.g. from "main" to "HEAD"). `markdown: true` also returns a Markdown list for a pull-request comment.',
      inputSchema: {
        type: 'object',
        properties: {
          from: str('Commit, branch or tag to compare from (default: the uncommitted changes)'),
          to: str('Compare to this commit (default: the working folder)'),
          markdown: { type: 'boolean', description: 'Also return the changes as Markdown' },
        },
      },
      run: async (a) => {
        const changes = a.from ? await describeRevChanges(store.root, String(a.from), a.to ? String(a.to) : undefined) : await describeGitChanges(store.root, (await gitStatus(store.root)).files);
        return a.markdown ? { changes, markdown: changesMarkdown(changes) } : changes;
      },
    },
    {
      name: 'git_log',
      description: 'Commits of the workspace, newest first (hash, author, date, subject); with `file` or `collection`, only those that changed it (following renames).',
      inputSchema: {
        type: 'object',
        properties: {
          file: str('A path inside the workspace, e.g. collections/payments.json'),
          collection: str('Collection name or id'),
          limit: { type: 'number', description: 'How many (default 20, max 200)' },
        },
      },
      run: (a) =>
        gitLog(store.root, {
          path: a.file ? String(a.file) : a.collection ? store.collectionFileOf(findCollection(a.collection).id) : undefined,
          limit: Math.min(Math.max(Number(a.limit) || 20, 1), 200),
        }),
    },
    {
      name: 'git_propose_commit',
      write: true,
      description:
        'Propose a commit of the workspace changes: stages them, checks that no secret is typed in (the findings are returned and nothing is proposed when there are any), and saves your commit message as the proposal. It does NOT commit: a person commits it in the TestPion Git view (the message is filled in), or CI runs `testpion git commit -m … --json`. Write the message from git_diff: an imperative subject under 72 characters, then the main changes.',
      inputSchema: { type: 'object', properties: { message: str('The commit message you propose') }, required: ['message'] },
      run: async (a) => {
        const st = await gitStatus(store.root);
        if (!st.repository)
          throw new ApsError('ConfigurationError', 'The workspace is not in a git repository', { suggestions: ['Initialize it in TestPion (Git view) or run git init in the workspace folder.'] });
        const secrets = findCommittableSecrets(store);
        if (secrets.length) return { proposed: false, secrets, why: 'Secrets are typed into the workspace: make them secret variables (or {{variables}}) first.' };
        if (!st.files.length) return { proposed: false, why: 'Nothing changed since the last commit.' };
        await gitStage(store.root, ['.']);
        const proposal = { message: String(a.message).trim(), at: new Date().toISOString(), files: st.files.map((f) => f.path) };
        mkdirSync(join(store.root, '.local'), { recursive: true });
        writeFileSync(join(store.root, '.local', 'git-proposal.json'), JSON.stringify(proposal, null, 2));
        return {
          proposed: true,
          ...proposal,
          changes: await describeGitChanges(store.root, (await gitStatus(store.root)).files),
          next: 'Ask the user to review and commit it in TestPion (Git view).',
        };
      },
    },
  ];
}
