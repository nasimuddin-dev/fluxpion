/** Save-to-collection and Import dialogs of the REST view. */
import { Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { asError, call } from '../../api';
import { useApp } from '../../store';
import type { Collection, CollectionNode } from '../../types';
import { uid } from '../../lib/format';

import { pickTextFile } from '../../lib/files';
import { Button, Field, Input, Modal, Select } from '../../components/ui';

export function SaveModal({ collections, defaultName, onClose, onSave, onCreate }: { collections: Collection[]; defaultName: string; onClose(): void; onSave(collectionId: string, name: string, folderId?: string): void; onCreate(c: Collection): Promise<void> }) {
  const [name, setName] = useState(defaultName);
  const [cid, setCid] = useState(collections[0]?.id ?? '');
  const [folder, setFolder] = useState('');
  // a name here means "create this collection and save into it" (the default when there are none yet)
  const [newCollection, setNewCollection] = useState<string | null>(collections.length ? null : 'My collection');
  const [busy, setBusy] = useState(false);
  const creating = newCollection !== null;
  const canSave = !!name.trim() && (creating ? !!newCollection.trim() : !!cid);
  const submit = async () => {
    if (!canSave || busy) return;
    if (!creating) return onSave(cid, name.trim(), folder || undefined);
    setBusy(true);
    try {
      const id = uid('col-');
      await onCreate({ schemaVersion: '1.0', id, name: newCollection.trim(), version: 0, variables: [], items: [], updatedAt: '' });
      onSave(id, name.trim());
    } finally {
      setBusy(false);
    }
  };
  const c = collections.find((x) => x.id === cid);
  const folders = useMemo(() => {
    const out: Array<{ id: string; name: string }> = [];
    const walk = (nodes: CollectionNode[], prefix: string) => {
      for (const n of nodes) if (n.kind === 'folder') (out.push({ id: n.id, name: prefix + n.name }), walk(n.items, `${prefix}${n.name} / `));
    };
    if (c) walk(c.items, '');
    return out;
  }, [c]);
  return (
    <Modal
      title="Save request"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSave} loading={busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        </Field>
        <Field label={creating ? 'New collection' : 'Collection'} hint={creating && !collections.length ? 'You have no collections yet — this one will be created.' : undefined}>
          <div className="flex gap-2">
            {creating ? (
              <Input className="flex-1" value={newCollection} placeholder="Collection name" onChange={(e) => setNewCollection(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
            ) : (
              <Select className="flex-1" value={cid} onChange={(e) => (setCid(e.target.value), setFolder(''))}>
                {collections.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
            {creating ? (
              collections.length > 0 && <Button onClick={() => setNewCollection(null)}>Choose existing</Button>
            ) : (
              <Button onClick={() => setNewCollection('')}>New</Button>
            )}
          </div>
        </Field>
        {!creating && folders.length > 0 && (
          <Field label="Folder">
            <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">(collection root)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function ImportModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ format: string; collection?: string; environment?: string; request?: string; placeholders?: Array<{ variable: string }>; specPath?: string; contractChecks?: number } | null>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) {
        if (r.request)
          useApp.getState().toast(
            `Imported ${r.format} request "${r.request}" into "${r.collection}"${r.placeholders?.length ? `. Secrets were replaced by variables: set ${r.placeholders.map((p) => p.variable).join(', ')} as secret environment variables` : ''}`,
            'success',
          );
        else
          useApp.getState().toast(
            `Imported ${r.format}${r.collection ? `: ${r.collection}` : ''}${r.environment ? ` (${r.environment.includes(', ') ? 'environments' : 'environment'} ${r.environment})` : ''}${r.contractChecks ? `. Each request checks the OpenAPI contract (${r.specPath})` : ''}`,
            'success',
          );
        onDone();
        await useApp.getState().refreshWorkspace();
        onClose();
      }
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Import"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button
            icon={<Upload size={13} />}
            onClick={() =>
              run(async () => {
                // the browser picker works in the desktop app and in the browser / cloud alike
                const f = await pickTextFile('.json,.yaml,.yml,.har,.txt,.sh,.ps1');
                return f ? call('col.import', { text: f.text }) : null;
              })
            }
          >
            Choose file…
          </Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => run(() => call('col.import', { text }))}>
            Import pasted content
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted mb-2">OpenAPI 3 / Swagger 2 (JSON or YAML), Postman v2.1 collections and environments, Insomnia exports (v4 JSON, v5 YAML), Bruno collection exports, Hoppscotch collections, HAR files, TestPion collections, or a request copied as cURL, fetch or PowerShell (saved to the <b>Imported</b> collection, with secrets replaced by variables).</p>
      <textarea className="field mono w-full h-64 text-xs" placeholder="Paste a document here…" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}
