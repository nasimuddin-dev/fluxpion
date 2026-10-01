import { describe, expect, it } from 'vitest';
import { checkLoadSafeguards, type LoadTestConfig } from '@testpion/core';

const cfg = { virtualUsers: 2, durationSec: 1 } as unknown as LoadTestConfig;

describe('load test safeguards', () => {
  it('names an unset variable in the URL instead of calling it a remote host', () => {
    expect(() => checkLoadSafeguards(cfg, 'http://{{baseUrl}}/health')).toThrow(/uses \{\{baseUrl\}\}, which is not set/);
  });
  it('still asks for opt-in before a remote host', () => {
    expect(() => checkLoadSafeguards(cfg, 'https://example.com/')).toThrow(/requires explicit opt-in/);
    expect(() => checkLoadSafeguards(cfg, 'http://127.0.0.1:8080/')).not.toThrow();
  });
});
