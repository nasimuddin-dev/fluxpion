import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // test against the engine's source, not its last build (the desktop backend imports it by package name)
  resolve: { alias: { '@testpion/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
