import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error - plain JS build config
import { nodeBundleOptions } from '../../apps/desktop/scripts/esbuild-options.mjs';

/**
 * The desktop main process bundles the ESM engine into CommonJS. This guards against regressions
 * where ESM-only features (import.meta.url, WASM loaders) break inside that bundle.
 */
describe('desktop CJS bundle', () => {
  it('runs sandboxed scripts and SQLite metadata inside the bundled engine', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aps-bundle-'));
    try {
      const entry = join(dir, 'entry.ts');
      writeFileSync(
        entry,
        `import { runScript, WorkspaceManager } from ${JSON.stringify(resolve('packages/core/src/index.ts'))};
         (async () => {
           const out = await runScript("aps.variables.set('x', 40 + 2)", { variables: {} });
           const ws = new WorkspaceManager(${JSON.stringify(join(dir, 'home'))}).create('bundle');
           console.log(JSON.stringify({ x: out.vars.x, error: out.error ?? null, meta: ws.meta.backend }));
           ws.close();
         })();`,
      );
      await build({ ...nodeBundleOptions, sourcemap: false, entryPoints: [entry], outfile: join(dir, 'out.cjs') });
      const r = spawnSync(process.execPath, [join(dir, 'out.cjs')], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(JSON.parse(r.stdout.trim())).toEqual({ x: 42, error: null, meta: 'sqlite' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
