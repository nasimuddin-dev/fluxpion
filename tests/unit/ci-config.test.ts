import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ENGINE_VERSION, WorkspaceStore, ciCommand, ciConfig, ciSecrets, type CiProvider } from '../../packages/core/src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'tp-ci-'));
const store = WorkspaceStore.create(join(dir, 'ws'), 'CI');
store.saveEnvironment({ id: 'staging', name: 'Staging', variables: [{ key: 'baseUrl', value: 'https://x', enabled: true }, { key: 'apiKey', value: '', enabled: true, secret: true } as never] });
store.saveProviders([{ id: 'openai', name: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '{{$secret.provider.openai.apiKey}}' }]);
store.saveCollection({ schemaVersion: '1.0', id: 'api', name: 'My API', version: 0, variables: [], items: [], updatedAt: '' } as never);
store.writeTestFile('regression.suite.yaml', 'name: Regression\ntests: [rest]\n');
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('CI pipeline generation', () => {
  it('writes valid YAML for each provider, pinned to this version, with secrets by name only', () => {
    for (const provider of ['github', 'gitlab', 'azure'] as CiProvider[]) {
      const c = ciConfig(store, { provider, suite: 'regression', environment: 'Staging', workspaceDir: 'api tests' });
      expect(() => parseYaml(c.content)).not.toThrow();
      expect(c.content).toContain(`--branch v${ENGINE_VERSION}`);
      expect(c.content).toContain('--suite regression -e Staging');
      expect(c.content).toContain('-w "api tests"');
      expect(c.content).toContain('TESTPION_SECRET_ENV_STAGING_APIKEY');
    }
    expect(ciConfig(store, { provider: 'github', suite: 'regression' }).path).toBe('.github/workflows/testpion.yml');
    const jenkins = ciConfig(store, { provider: 'jenkins', collection: 'My API' });
    expect(jenkins.path).toBe('Jenkinsfile');
    expect(jenkins.content).toContain("junit 'test-results/junit.xml'");
  });

  it('names the secrets: environment secrets, and provider keys only for test runs', () => {
    expect(ciSecrets(store, 'Staging').map((s) => s.name)).toEqual(['TESTPION_SECRET_ENV_STAGING_APIKEY', 'TESTPION_SECRET_PROVIDER_OPENAI_APIKEY']);
    expect(ciConfig(store, { provider: 'github', collection: 'My API', environment: 'Staging' }).secrets.map((s) => s.name)).toEqual(['TESTPION_SECRET_ENV_STAGING_APIKEY']);
  });

  it('builds the CLI command for a suite, a collection with folders, or test paths', () => {
    expect(ciCommand({ provider: 'github', suite: 'smoke' })).toBe('testpion run -w . --suite smoke -r console junit html -o test-results');
    expect(ciCommand({ provider: 'github', collection: 'My API', folders: ['Auth flow'], environment: 'Staging' })).toBe('testpion run-collection "My API" -w . -e Staging --folder "Auth flow" -r console junit html -o test-results');
    expect(ciCommand({ provider: 'github', tests: ['rest', 'mcp/x.yaml'], workspaceDir: 'qa' })).toBe('testpion test qa/tests/rest qa/tests/mcp/x.yaml -w qa -r console junit html -o test-results');
    expect(ciCommand({ provider: 'github' })).toBe('testpion test tests -w . -r console junit html -o test-results');
  });

  it('rejects unknown providers, suites, collections and environments', () => {
    expect(() => ciConfig(store, { provider: 'travis' as CiProvider })).toThrow(/github, gitlab, azure, jenkins/);
    expect(() => ciConfig(store, { provider: 'github', suite: 'nope' })).toThrow(/No suite "nope"/);
    expect(() => ciConfig(store, { provider: 'github', collection: 'Nope' })).toThrow(/No collection/);
    expect(() => ciConfig(store, { provider: 'github', environment: 'Nope' })).toThrow(/No environment/);
    expect(() => ciConfig(store, { provider: 'github', suite: 'regression', collection: 'My API' })).toThrow(/one of/);
  });
});
