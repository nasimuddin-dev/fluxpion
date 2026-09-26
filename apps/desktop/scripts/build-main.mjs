// Bundles the Electron main + preload scripts (and the dev web bridge) with esbuild.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeBundleOptions, preloadBundleOptions } from './esbuild-options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({ ...nodeBundleOptions, entryPoints: [join(root, 'electron/main.ts')], outfile: join(root, 'dist-electron/main.cjs') });
await build({ ...preloadBundleOptions, entryPoints: [join(root, 'electron/preload.ts')], outfile: join(root, 'dist-electron/preload.cjs') });
await build({ ...nodeBundleOptions, entryPoints: [join(root, 'backend/web-server.ts')], outfile: join(root, 'dist-electron/web-server.cjs') });
console.log('built electron main, preload and web bridge');
