import { describe, expect, it } from 'vitest';
import { importOpenApi, startMockServer, type CollectionNode, type SavedHttpRequest } from '../../packages/core/src/index.js';

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1' },
  servers: [{ url: 'https://pets.example.test/v1' }],
  paths: {
    '/pets': {
      get: {
        summary: 'List pets',
        responses: {
          '200': { description: 'A list of pets', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } },
          '500': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        summary: 'Get a pet',
        responses: {
          '404': { description: 'Not found', content: { 'application/json': { example: { error: 'no such pet' } } } },
          '200': { description: 'The pet', content: { 'application/json': { examples: { rex: { value: { id: 7, name: 'Rex', tag: 'dog' } } } } } },
          default: { description: 'Unexpected error' },
        },
      },
    },
  },
  components: {
    schemas: { Pet: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer', example: 1 }, name: { type: 'string', example: 'Tom' }, tag: { type: 'string' } } } },
    responses: { Error: { description: 'Server error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } } },
  },
};

const requests = (nodes: CollectionNode[]): SavedHttpRequest[] => nodes.flatMap((n) => (n.kind === 'folder' ? requests(n.items) : n.kind === 'http' ? [n] : []));

describe('OpenAPI import: examples from documented responses', () => {
  it('adds an example per response code (success first), from example, named examples or the schema', () => {
    const [list, get] = requests(importOpenApi(JSON.stringify(SPEC)).collection.items);
    expect(list!.examples!.map((e) => [e.name, e.status])).toEqual([
      ['200 A list of pets', 200],
      ['500 Server error', 500],
    ]);
    expect(JSON.parse(list!.examples![0]!.body)).toEqual([{ id: 1, name: 'Tom', tag: 'string' }]);
    expect(list!.examples![0]!.headers).toEqual([{ key: 'Content-Type', value: 'application/json', enabled: true }]);
    expect(get!.examples!.map((e) => e.status)).toEqual([200, 404]);
    expect(JSON.parse(get!.examples![0]!.body)).toEqual({ id: 7, name: 'Rex', tag: 'dog' });
    expect(JSON.parse(get!.examples![1]!.body)).toEqual({ error: 'no such pet' });
  });

  it('so the imported collection can be mocked at once', async () => {
    const mock = await startMockServer(importOpenApi(JSON.stringify(SPEC)).collection);
    try {
      const pets = await fetch(`${mock.url}/pets`);
      expect(pets.status).toBe(200);
      expect(await pets.json()).toEqual([{ id: 1, name: 'Tom', tag: 'string' }]);
      const one = await fetch(`${mock.url}/pets/42`);
      expect(one.status).toBe(200);
      expect(await one.json()).toMatchObject({ name: 'Rex' });
      // Postman's x-mock-response-code picks another documented response
      const missing = await fetch(`${mock.url}/pets/42`, { headers: { 'x-mock-response-code': '404' } });
      expect(missing.status).toBe(404);
    } finally {
      await mock.close();
    }
  });

  it('Swagger 2 responses too', () => {
    const v2 = {
      swagger: '2.0',
      info: { title: 'Old', version: '1' },
      produces: ['application/json'],
      paths: { '/ping': { get: { responses: { '200': { description: 'pong', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } } } },
    };
    const [ping] = requests(importOpenApi(JSON.stringify(v2)).collection.items);
    expect(ping!.examples).toEqual([expect.objectContaining({ status: 200, body: JSON.stringify({ ok: false }, null, 2) })]);
  });
});
