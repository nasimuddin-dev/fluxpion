import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backend } from '../../apps/desktop/backend/backend.js';

// Paths and method names that reach the backend come from the UI (and, on a server, from the network):
// none of them may point outside the workspace or at something that isn't an RPC method.
const home = mkdtempSync(join(tmpdir(), 'tp-security-'));
const opened: string[] = [];
const be = new Backend({ appDir: home, emit: () => undefined, openPath: (p) => void opened.push(p) });
const call = (method: string, params: unknown = {}) => be.invoke(method, params);

afterAll(async () => {
  await be.dispose();
  rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});

describe('security hardening', () => {
  it('only own RPC methods can be invoked', async () => {
    for (const m of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) await expect(call(m)).rejects.toMatchObject({ message: expect.stringMatching(/Unknown backend method/) });
  });

  it('a run id cannot leave the runs folder', async () => {
    for (const id of ['../..', '..', '../collections', 'a/b', '']) expect(() => be.ws.runDir(id), id).toThrow();
    expect(be.ws.runDir('run-123')).toBe(join(be.ws.root, 'runs', 'run-123'));
    await expect(call('runs.summary', { runId: '../..' })).rejects.toBeTruthy();
  });

  it('http.saveBody only serves files inside payloads/', async () => {
    const payloads = join(be.ws.root, 'payloads');
    for (const p of [join(payloads, '..', 'workspace.json'), `${payloads}-other${'/'}x.bin`, join(be.ws.root, 'workspace.json'), '']) {
      await expect(call('http.saveBody', { payloadPath: p }), p).rejects.toMatchObject({ message: 'Unknown payload' });
    }
  });

  it('an MCP mock file must be inside the workspace (not a sibling folder)', () => {
    const sibling = `${be.ws.root}-other`;
    expect(() => be.ws.resolveMcpServer({ id: 'm', name: 'm', transport: 'mock', mockFile: join(sibling, 'x.mcp-mock.yaml') })).toThrow(/inside the workspace/);
    expect(() => be.ws.resolveMcpServer({ id: 'm', name: 'm', transport: 'mock', mockFile: '../x.mcp-mock.yaml' })).toThrow(/inside the workspace/);
    expect(be.ws.resolveMcpServer({ id: 'm', name: 'm', transport: 'mock', mockFile: 'mocks/x.mcp-mock.yaml' })).toMatchObject({ mockFile: join(be.ws.root, 'mocks', 'x.mcp-mock.yaml') });
  });

  it('app.openPath opens workspace folders only', async () => {
    const exe = join(home, 'tool.exe');
    writeFileSync(exe, '');
    await expect(call('app.openPath', { path: exe })).rejects.toMatchObject({ message: expect.stringMatching(/workspace folders/) });
    await expect(call('app.openPath', { path: home })).rejects.toBeTruthy();
    await call('app.openPath', { path: be.ws.root });
    expect(opened).toEqual([be.ws.root]);
  });

  it('deleting and clearing history removes the saved response bodies', async () => {
    const dir = join(be.ws.root, 'payloads');
    mkdirSync(dir, { recursive: true });
    const entry = (id: string, payloadPath: string) => ({ id, timestamp: new Date().toISOString(), kind: 'http' as const, name: id, method: 'GET', url: 'http://x', status: 200, payloadPath, request: {} });
    const files = ['a', 'b', 'c'].map((n) => join(dir, `${n}.bin`));
    for (const f of files) writeFileSync(f, 'body');
    // a stored path outside payloads/ is never deleted, whatever the database says
    const outside = join(be.ws.root, 'workspace.json');
    be.ws.meta.addHistory(entry('h1', files[0]!) as never);
    be.ws.meta.addHistory(entry('h2', files[1]!) as never);
    be.ws.meta.addHistory(entry('h3', files[2]!) as never);
    be.ws.meta.addHistory(entry('h4', outside) as never);
    await call('history.delete', { id: 'h1' });
    expect(files.map((f) => existsSync(f))).toEqual([false, true, true]);
    await call('history.clear');
    expect(files.map((f) => existsSync(f))).toEqual([false, false, false]);
    expect(existsSync(outside)).toBe(true);
  });
});
