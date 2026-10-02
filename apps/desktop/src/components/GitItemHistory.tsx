import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { asError, call } from '../api';
import { confirmAction, useApp } from '../store';
import { Button, cx, Empty, Modal, Spinner } from './ui';

interface Version {
  commit: { hash: string; short: string; author: string; date: string; subject: string };
  item: unknown;
}

/** A request's versions in git (GIT-209): the commits that changed it, what it was then, and Restore. */
export function GitItemHistory({ collectionId, itemId, name, onClose }: { collectionId: string; itemId: string; name: string; onClose(): void }) {
  const [versions, setVersions] = useState<Version[]>();
  const [sel, setSel] = useState(0);
  useEffect(() => {
    void call<Version[]>('git.itemHistory', { collectionId, itemId }).then(setVersions, (e) => {
      useApp.getState().toast(asError(e).message, 'error');
      setVersions([]);
    });
  }, [collectionId, itemId]);
  const v = versions?.[sel];
  const restore = async () => {
    if (!v) return;
    if (!(await confirmAction({ title: 'Restore this version', message: `Put "${name}" back as it was in ${v.commit.short} (${v.commit.subject})?`, detail: 'Only this request changes; commit to keep it. Your current version stays in git history.', confirmLabel: 'Restore' }))) return;
    try {
      await call('git.restoreItem', { collectionId, itemId, rev: v.commit.hash });
      useApp.getState().toast(`Restored "${name}" from ${v.commit.short}`, 'success');
      onClose();
    } catch (e) {
      useApp.getState().toast(asError(e).message, 'error');
    }
  };
  return (
    <Modal
      title={`History of ${name}`}
      onClose={onClose}
      width={860}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<RotateCcw size={13} />} disabled={!v || sel === 0} title={sel === 0 ? 'This is the latest committed version' : undefined} onClick={() => void restore()}>
            Restore this version
          </Button>
        </>
      }
    >
      {!versions ? (
        <div className="h-40 grid place-items-center">
          <Spinner />
        </div>
      ) : !versions.length ? (
        <Empty title="No commits changed this request yet">Commit the workspace (Git view) to start its history.</Empty>
      ) : (
        <div className="grid grid-cols-[260px_1fr] gap-3 h-[55vh]">
          <ul className="overflow-auto border border-line rounded-md" aria-label="Versions">
            {versions.map((x, i) => (
              <li key={x.commit.hash}>
                <button className={cx('w-full text-left px-2 py-1.5 text-sm border-b border-line', i === sel ? 'bg-accent-soft' : 'hover:bg-hover')} onClick={() => setSel(i)}>
                  <div className="truncate">{x.commit.subject}</div>
                  <div className="text-xs text-muted">
                    <span className="font-mono">{x.commit.short}</span> · {x.commit.author} · {new Date(x.commit.date).toLocaleDateString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <pre className="overflow-auto border border-line rounded-md p-2 text-[0.72rem] font-mono">{JSON.stringify(v?.item, null, 2)}</pre>
        </div>
      )}
    </Modal>
  );
}
