import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySecretStore, WorkspaceStore, detectFormat, environmentToDotenv, importIntoWorkspace, isDotenv, parseDotenv, secretKeys } from '../../packages/core/src/index.js';

const ENV = [
  '# local settings',
  'BASE_URL=https://api.example.com',
  'export TIMEOUT_MS=5000',
  "GREETING='hello world'",
  'MULTI="line one\\nline two"',
  'QUOTED="has # hash"',
  'PLAIN=value # a comment',
  'API_KEY=sk-live-123',
  'DB_PASSWORD="p@ss word"',
  '',
].join('\n');

describe('.env files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tp-dotenv-'));
  const store = WorkspaceStore.create(join(dir, 'ws'), 'W');
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses KEY=value lines with export, quotes, escapes and comments', () => {
    expect(isDotenv(ENV)).toBe(true);
    expect(isDotenv('{"a":1}')).toBe(false);
    expect(isDotenv('openapi: 3.0.0\ninfo: {}')).toBe(false);
    expect(detectFormat(ENV)).toBe('dotenv');
    expect(Object.fromEntries(parseDotenv(ENV).map((v) => [v.key, v.value]))).toEqual({
      BASE_URL: 'https://api.example.com',
      TIMEOUT_MS: '5000',
      GREETING: 'hello world',
      MULTI: 'line one\nline two',
      QUOTED: 'has # hash',
      PLAIN: 'value',
      API_KEY: 'sk-live-123',
      DB_PASSWORD: 'p@ss word',
    });
  });

  it('imports as an environment; secret-looking values go to the secret store, never to the file', () => {
    const secrets = new MemorySecretStore();
    const r = importIntoWorkspace(store, ENV, { name: 'staging', secrets });
    expect(r.format).toBe('dotenv');
    const env = store.getEnvironment('staging')!;
    expect(env.variables.find((v) => v.key === 'API_KEY')).toMatchObject({ secret: true, value: '' });
    expect(secrets.get(secretKeys.envVar(env.id, 'API_KEY'))).toBe('sk-live-123');
    expect(secrets.get(secretKeys.envVar(env.id, 'DB_PASSWORD'))).toBe('p@ss word');
    expect(readFileSync(store.path('environments', `${env.id}.json`), 'utf8')).not.toMatch(/sk-live-123|p@ss word/);
    // without a secret store (CLI) the values are reported, not written
    const cli = importIntoWorkspace(store, ENV, { name: 'ci' });
    expect(cli.secretsToSet).toEqual(['ci › API_KEY', 'ci › DB_PASSWORD']);
  });

  it('exports an environment as .env without secret values', () => {
    const text = environmentToDotenv(store.getEnvironment('staging')!);
    expect(text).toContain('BASE_URL=https://api.example.com');
    expect(text).toContain('GREETING="hello world"');
    expect(text).toContain('MULTI="line one\\nline two"');
    expect(text).toContain('API_KEY=\n');
    expect(text).not.toContain('sk-live-123');
    expect(Object.fromEntries(parseDotenv(text).map((v) => [v.key, v.value])).MULTI).toBe('line one\nline two');
  });
});
