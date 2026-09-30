import { describe, it, expect } from 'vitest';
import { findLiteralSecrets, Redactor } from '../../packages/core/src/index.js';

describe('findLiteralSecrets (saving connections and requests)', () => {
  const r = new Redactor();
  it('finds typed-in credentials in header rows, properties and JSON text, but not {{variables}}', () => {
    const data = {
      url: 'wss://x',
      headers: [
        { key: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc' },
        { key: 'X-Api-Key', value: '{{apiKey}}' },
        { key: 'Accept', value: 'application/json' },
        { key: 'Authorization', value: 'Bearer abcdef123', enabled: false },
      ],
      auth: '{ "token": "s3cr3t-value", "user": "ada" }',
      password: 'hunter22',
    };
    expect(findLiteralSecrets(data, r)).toEqual(['headers.Authorization', 'auth.token', 'password']);
    expect(findLiteralSecrets({ metadata: [{ key: 'authorization', value: 'Bearer {{accessToken}}' }] }, r)).toEqual([]);
  });
});
