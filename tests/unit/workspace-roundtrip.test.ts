import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-roundtrip-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('workspace export and import', () => {
  it("keeps exactly the export's environments (no extra default one)", () => {
    const mgr = new WorkspaceManager(join(dir, 'app'));
    const src = mgr.create('Source');
    src.deleteEnvironment('development');
    src.saveEnvironment({ id: 'public', name: 'Public APIs', variables: [{ key: 'httpbin', value: 'https://httpbin.org', enabled: true }] } as never);
    const bundle = src.exportBundle();
    src.close();
    const copy = mgr.importBundle(bundle);
    expect(copy.workspace.name).toBe('Source (imported)');
    expect(copy.listEnvironments().map((e) => e.name)).toEqual(['Public APIs']);
    copy.close();
    // imported again: a numbered name
    const again = mgr.importBundle(bundle);
    expect(again.workspace.name).toBe('Source (imported) 2');
    again.close();

    // an export that has its own Development environment keeps it as exported
    const src2 = mgr.create('With dev');
    src2.saveEnvironment({ id: 'development', name: 'Development', variables: [{ key: 'baseUrl', value: 'http://localhost:8080', enabled: true }] } as never);
    const b2 = src2.exportBundle();
    src2.close();
    const copy2 = mgr.importBundle(b2);
    expect(copy2.listEnvironments().map((e) => e.name)).toEqual(['Development']);
    expect(copy2.getEnvironment('development')!.variables[0]!.value).toBe('http://localhost:8080');
    copy2.close();
  });
});
