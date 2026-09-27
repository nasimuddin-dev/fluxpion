import { Download, FilePlus2, FolderPlus, FolderTree, Play, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import { promptText, useApp } from '../store';
import { useIntent } from '../hooks';
import type { Collection, CollectionNode } from '../types';
import { download, timeAgo, uid } from '../lib/format';
import { AuthEditor } from '../components/AuthEditor';
import { ScriptsPanel } from '../components/ScriptsPanel';
import { CollectionRunner } from '../components/CollectionRunner';
import { MockPanel } from '../components/MockPanel';
import { CollectionDocs } from '../components/CollectionDocs';
import { addToFolder, CollectionTree } from '../components/CollectionTree';
import { KeyValueEditor } from '../components/KeyValueEditor';
import { Badge, Button, cx, Empty, Input, SectionTitle, Split, Tabs } from '../components/ui';
import { ImportModal } from './RestView';

export function CollectionsView() {
  const [cols, setCols] = useState<Collection[]>([]);
  const [sel, setSel] = useState<string>();
  const [draft, setDraft] = useState<Collection>();
  const [tab, setTab] = useState<'requests' | 'variables' | 'auth' | 'scripts' | 'docs' | 'run' | 'mock'>('requests');
  const [runFolder, setRunFolder] = useState<string>();
  const [importing, setImporting] = useState(false);
  const load = useCallback(async () => {
    const c = await call<Collection[]>('col.list');
    setCols(c);
    setSel((s) => s ?? c[0]?.id);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setDraft(cols.find((c) => c.id === sel)), [sel, cols]);
  useIntent('collections', (p) => {
    if (p?.collectionId) setSel(p.collectionId);
    if (p?.run) {
      setTab('run');
      setRunFolder(p.folderId);
    }
    if (p?.mock) setTab('mock');
  });
  const save = async (c: Collection) => {
    await call('col.save', c);
    await load();
    useApp.getState().toast('Collection saved', 'success');
  };
  const open = (c: Collection, n: CollectionNode) => useApp.getState().openIntent(n.kind === 'graphql' ? 'graphql' : 'rest', { collectionId: c.id, requestId: n.id });
  const count = (nodes: CollectionNode[]): number => nodes.reduce((a, n) => a + (n.kind === 'folder' ? count(n.items) : 1), 0);
  return (
    <>
    <Split id="collections" initial={24}>
      <div className="h-full flex flex-col bg-panel/50">
        <SectionTitle
          right={
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Upload size={12} />} onClick={() => setImporting(true)}>
                Import
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<FolderPlus size={12} />}
                onClick={async () => {
                  const name = await promptText('New collection', { message: 'Collection name', placeholder: 'My API', okLabel: 'Create' });
                  if (name) {
                    const id = uid('col-');
                    await save({ schemaVersion: '1.0', id, name, version: 0, variables: [], items: [], updatedAt: '' });
                    setSel(id);
                  }
                }}
              >
                New
              </Button>
            </div>
          }
        >
          Collections
        </SectionTitle>
        <div className="flex-1 overflow-auto">
          {cols.map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className={cx('w-full text-left px-3 py-2 border-b border-line/60', sel === c.id ? 'bg-accent/10' : 'hover:bg-hover')}>
              <div className={cx('text-sm font-medium', c.problem && 'text-bad')}>{c.name}</div>
              <div className="text-xs text-muted">
                {c.problem ? c.problem : `${count(c.items)} requests · v${c.version} · ${c.updatedAt ? timeAgo(c.updatedAt) : ''}`}
              </div>
            </button>
          ))}
          {!cols.length && <Empty icon={<FolderTree size={24} />} title="No collections">Create one or import OpenAPI, Postman or HAR.</Empty>}
        </div>
      </div>
      <div className="h-full flex flex-col min-w-0">
        {draft ? (
          <>
            <div className="flex items-center gap-2 px-3 h-11 border-b border-line">
              <Input className="font-semibold w-72" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Badge>v{draft.version}</Badge>
              <div className="ml-auto flex gap-2">
                <Button size="sm" icon={<FilePlus2 size={12} />} onClick={() => useApp.getState().openIntent('rest', { newTab: true })}>
                  New request
                </Button>
                <Button
                  size="sm"
                  icon={<Play size={12} />}
                  onClick={() => {
                    setRunFolder(undefined);
                    setTab('run');
                  }}
                >
                  Run
                </Button>
                <Button size="sm" icon={<Download size={12} />} onClick={() => call('col.export', { id: draft.id }).then((r) => (r.collection ? download(`${draft.name}.collection.json`, JSON.stringify(r.collection, null, 2)) : useApp.getState().toast(`Exported to ${r.path}`, 'success')))}>
                  Export
                </Button>
                <Button size="sm" variant="primary" onClick={() => save(draft)}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-bad"
                  icon={<Trash2 size={12} />}
                  onClick={async () => {
                    if (!confirm(`Delete collection "${draft.name}"? This cannot be undone.`)) return;
                    await call('col.delete', { id: draft.id });
                    setSel(undefined);
                    await load();
                  }}
                />
              </div>
            </div>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'requests', label: 'Requests', badge: count(draft.items) },
                { id: 'variables', label: 'Variables', badge: draft.variables.length },
                { id: 'auth', label: 'Authorization' },
                { id: 'scripts', label: 'Scripts' },
                { id: 'docs', label: 'Docs' },
                { id: 'run', label: 'Run' },
                { id: 'mock', label: 'Mock' },
              ]}
            />
            <div className={cx('flex-1 min-h-0', tab !== 'run' && tab !== 'docs' && 'overflow-auto')}>
              {tab === 'mock' && <MockPanel collectionId={draft.id} onOpenRequest={(requestId) => useApp.getState().openIntent('rest', { collectionId: draft.id, requestId })} />}
              {tab === 'run' && <CollectionRunner collection={draft} folderId={runFolder} onFolderChange={setRunFolder} />}
              {tab === 'requests' && (
                <div className="p-2">
                  <CollectionTree
                    collections={[draft]}
                    onOpen={open}
                    onChange={save}
                    onRun={(_, folderId) => {
                      setRunFolder(folderId);
                      setTab('run');
                    }}
                    onNewRequest={async (c, folderId) => {
                      const node = { kind: 'http' as const, id: uid('req-'), name: 'New request', request: { method: 'GET', url: '{{baseUrl}}/' }, assertions: [{ type: 'status', expected: 200 }] };
                      await save({ ...c, items: addToFolder(c.items, folderId, node) });
                      open(c, node);
                    }}
                  />
                </div>
              )}
              {tab === 'variables' && (
                <div className="p-2">
                  <p className="text-xs text-muted px-1 pb-2">Collection variables override environment variables and are overridden by request and runtime variables.</p>
                  <KeyValueEditor rows={draft.variables} onChange={(variables) => setDraft({ ...draft, variables })} keyPlaceholder="Variable" />
                </div>
              )}
              {tab === 'auth' && (
                <>
                  <p className="text-xs text-muted px-3 pt-3">Requests with “Inherit” use this auth (folders can override it).</p>
                  <AuthEditor auth={draft.auth ?? { type: 'none' }} onChange={(auth) => setDraft({ ...draft, auth })} allowInherit={false} />
                </>
              )}
              {tab === 'scripts' && (
                <div className="h-full">
                  <ScriptsPanel pre={draft.preRequestScript ?? ''} post={draft.testScript ?? ''} onPre={(preRequestScript) => setDraft({ ...draft, preRequestScript })} onPost={(testScript) => setDraft({ ...draft, testScript })} />
                </div>
              )}
              {tab === 'docs' && <CollectionDocs collection={draft} onDescription={(description) => setDraft({ ...draft, description })} />}
            </div>
          </>
        ) : (
          <Empty title="Select a collection" />
        )}
      </div>
    </Split>
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={load} />}
    </>
  );
}
