import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectMockRoutes, matchMockRoute, mockPathOf, startMockServer, type Collection, type MockServer } from '../../packages/core/src/index.js';

const collection: Collection = {
  schemaVersion: '1.0',
  id: 'c',
  name: 'Pets',
  version: 1,
  variables: [],
  updatedAt: '',
  items: [
    {
      kind: 'folder',
      id: 'f',
      name: 'Pets',
      items: [
        {
          kind: 'http',
          id: 'get',
          name: 'Get pet',
          request: { method: 'GET', url: '{{baseUrl}}/pets/:id' },
          examples: [
            { id: 'e1', name: 'Found', status: 200, statusText: 'OK', headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Content-Length', value: '999' }], body: '{"id":1}' },
            { id: 'e2', name: 'Missing', status: 404, headers: [], body: '{"error":"not_found"}', request: { method: 'GET', url: '{{baseUrl}}/pets/999' } },
          ],
        },
        {
          kind: 'http',
          id: 'list',
          name: 'List pets',
          request: { method: 'GET', url: 'https://api.example.com/v1/pets?species=cat' },
          examples: [
            { id: 'e3', name: 'Cats', status: 200, headers: [], body: '["cat"]' },
            { id: 'e4', name: 'Dogs', status: 200, headers: [], body: '["dog"]', request: { method: 'GET', url: 'https://api.example.com/v1/pets?species=dog' } },
          ],
        },
        { kind: 'http', id: 'create', name: 'Create pet', request: { method: 'POST', url: '{{baseUrl}}/pets' } },
      ],
    },
  ],
};

describe('mock routes', () => {
  it('turns saved URLs into paths', () => {
    expect(mockPathOf('{{baseUrl}}/pets/:id?x=1&y=a+b')).toEqual({ path: '/pets/:id', query: { x: '1', y: 'a b' } });
    expect(mockPathOf('https://api.example.com/v1/pets/')).toEqual({ path: '/v1/pets', query: {} });
    expect(mockPathOf('api.example.com/v1')).toEqual({ path: '/v1', query: {} });
  });

  it('collects one route per example, skipping requests without examples', () => {
    const routes = collectMockRoutes(collection);
    expect(routes.map((r) => `${r.method} ${r.path} ${r.example.name}`)).toEqual(['GET /pets/:id Found', 'GET /pets/999 Missing', 'GET /v1/pets Cats', 'GET /v1/pets Dogs']);
  });

  it('prefers literal paths, then query matches, then 2xx; headers pick an example', () => {
    const routes = collectMockRoutes(collection);
    const m = (path: string, query?: Record<string, string>, headers?: Record<string, string>) => matchMockRoute(routes, { method: 'GET', path, query, headers })?.example.name;
    expect(m('/pets/1')).toBe('Found');
    expect(m('/pets/999')).toBe('Missing');
    expect(m('/v1/pets', { species: 'dog' })).toBe('Dogs');
    expect(m('/v1/pets', { species: 'cat' })).toBe('Cats');
    expect(m('/pets/1', {}, { 'x-mock-response-code': '404' })).toBe('Missing');
    expect(m('/pets/1', {}, { 'x-mock-response-name': 'missing' })).toBe('Missing');
    expect(m('/nope')).toBeUndefined();
    expect(matchMockRoute(routes, { method: 'POST', path: '/pets/1' })).toBeUndefined();
  });

  it('lets a saved id answer other ids when nothing matches exactly', () => {
    const routes = collectMockRoutes({ ...collection, items: [{ kind: 'http', id: 'x', name: 'x', request: { method: 'GET', url: '/patients/1' }, examples: [{ id: 'a', name: 'one', status: 200, headers: [], body: '1' }] }] });
    expect(matchMockRoute(routes, { method: 'GET', path: '/patients/7' })?.example.name).toBe('one');
    expect(matchMockRoute(routes, { method: 'GET', path: '/owners/7' })).toBeUndefined();
  });
});

describe('mock server', () => {
  let mock: MockServer;
  const seen: string[] = [];
  beforeAll(async () => {
    mock = await startMockServer(collection, { onRequest: (e) => seen.push(`${e.status} ${e.example ?? '-'}`) });
  });
  afterAll(() => mock.close());

  it('serves examples with their status, headers and body', async () => {
    const r = await fetch(`${mock.url}/pets/7`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.headers.get('x-mock-example')).toBe('Found');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(await r.json()).toEqual({ id: 1 });
    const missing = await fetch(`${mock.url}/pets/7`, { headers: { 'x-mock-response-code': '404' } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });

  it('answers unknown routes with 404 and the list of routes, and picks up changes', async () => {
    const r = await fetch(`${mock.url}/owners`);
    expect(r.status).toBe(404);
    expect((await r.json()).available).toContain('GET /pets/:id → 200 Found');
    mock.update({ ...collection, items: [] });
    expect((await fetch(`${mock.url}/pets/1`)).status).toBe(404);
    expect(seen).toEqual(['200 Found', '404 Missing', '404 -', '404 -']);
  });

  it('only listens on localhost', async () => {
    await expect(startMockServer(collection, { host: '0.0.0.0' })).rejects.toThrow(/localhost/);
  });
});
