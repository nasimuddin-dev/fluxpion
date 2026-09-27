import { describe, expect, it } from 'vitest';
import { Redactor, exampleFromResponse, findHttpRequest, importPostman, withRequestExamples, type Collection } from '../../packages/core/src/index.js';

const res = (over: Partial<Parameters<typeof exampleFromResponse>[0]> = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [
    ['content-type', 'application/json'],
    ['set-cookie', 'sid=abc; HttpOnly'],
    ['date', 'Sun, 27 Sep 2026 10:00:00 GMT'],
    ['x-request-id', 'r-1'],
  ] as Array<[string, string]>,
  bodyPreview: '{"id":"1","access_token":"tok-123","name":"Rex"}',
  json: { id: '1', access_token: 'tok-123', name: 'Rex' },
  ...over,
});

describe('exampleFromResponse', () => {
  it('masks sensitive headers and JSON fields and drops transfer headers', () => {
    const ex = exampleFromResponse(res(), { name: 'Found', redactor: new Redactor() });
    expect(ex.name).toBe('Found');
    expect(ex.status).toBe(200);
    expect(ex.headers).toEqual([
      { key: 'content-type', value: 'application/json' },
      { key: 'set-cookie', value: 'REDACTED' },
      { key: 'x-request-id', value: 'r-1' },
    ]);
    expect(ex.body).not.toContain('tok-123');
    expect(JSON.parse(ex.body)).toMatchObject({ id: '1', name: 'Rex' });
  });

  it('keeps a body unchanged when nothing is sensitive, and masks known secret values in text', () => {
    const plain = exampleFromResponse(res({ bodyPreview: '{"id":"1"}', json: { id: '1' } }), { name: '', redactor: new Redactor() });
    expect(plain.body).toBe('{"id":"1"}');
    expect(plain.name).toBe('200 OK');
    const r = new Redactor();
    r.addSecret('s3cr3t-value');
    const text = exampleFromResponse(res({ bodyPreview: 'key is s3cr3t-value', json: undefined, headers: [] }), { name: 'x', redactor: r, request: { method: 'GET', url: 'https://x.io/a?api_key=k1' } });
    expect(text.body).not.toContain('s3cr3t-value');
    expect(text.request?.url).not.toContain('k1');
  });

  it('refuses truncated bodies', () => {
    expect(() => exampleFromResponse(res({ truncated: true }), { name: 'big' })).toThrow(/truncated/);
  });
});

describe('request examples in collections', () => {
  const collection = (): Collection => ({
    schemaVersion: '1.0',
    id: 'c',
    name: 'C',
    version: 1,
    variables: [],
    updatedAt: '',
    items: [{ kind: 'folder', id: 'f1', name: 'F', items: [{ kind: 'http', id: 'r1', name: 'R', request: { method: 'GET', url: 'https://x.io' } }] }],
  });

  it('adds, replaces and removes examples of a nested request', () => {
    const ex = exampleFromResponse(res(), { name: 'one' });
    let c = withRequestExamples(collection(), 'r1', (l) => [...l, ex]);
    expect(findHttpRequest(c.items, 'r1')?.examples?.map((e) => e.name)).toEqual(['one']);
    c = withRequestExamples(c, 'r1', () => []);
    expect(findHttpRequest(c.items, 'r1')).not.toHaveProperty('examples');
    expect(() => withRequestExamples(c, 'nope', (l) => l)).toThrow(/not saved/);
  });

  it('imports Postman saved responses as examples, and request descriptions', () => {
    const { collection: c } = importPostman(
      JSON.stringify({
        info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Get pet',
            request: { method: 'GET', url: { raw: '{{baseUrl}}/pets/1' }, description: { content: 'Returns **one** pet.', type: 'text/markdown' } },
            response: [
              { name: 'Found', code: 200, status: 'OK', header: [{ key: 'Content-Type', value: 'application/json' }], body: '{"id":1}', originalRequest: { method: 'GET', url: { raw: '{{baseUrl}}/pets/1' } } },
              { name: 'Missing', code: 404, status: 'Not Found', body: '' },
            ],
          },
        ],
      }),
    );
    const r = c.items[0]!;
    expect(r.kind).toBe('http');
    if (r.kind !== 'http') return;
    expect(r.description).toBe('Returns **one** pet.');
    expect(r.examples?.map((e) => [e.name, e.status])).toEqual([
      ['Found', 200],
      ['Missing', 404],
    ]);
    expect(r.examples?.[0]).toMatchObject({ statusText: 'OK', body: '{"id":1}', headers: [{ key: 'Content-Type', value: 'application/json' }] });
    // an original request identical to the saved request is not repeated on the example
    expect(r.examples?.[0]?.request).toBeUndefined();
  });
});
