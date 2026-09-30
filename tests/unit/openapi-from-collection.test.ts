import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { collectionToOpenApi, collectionToOpenApiText, diffOpenApi, importOpenApi, type Collection, type SavedHttpRequest } from '../../packages/core/src/index.js';

const collection: Collection = {
  schemaVersion: '1.0',
  id: 'pets',
  name: 'Pets API',
  description: 'Pet store',
  version: 2,
  variables: [{ key: 'baseUrl', value: 'https://pets.example.test/v1', enabled: true }],
  updatedAt: new Date(0).toISOString(),
  auth: { type: 'bearer', token: '{{token}}' },
  items: [
    {
      kind: 'folder',
      id: 'f',
      name: 'Pets',
      items: [
        {
          kind: 'http',
          id: 'list',
          name: 'List pets',
          description: 'All pets, paged.',
          request: { method: 'GET', url: '{{baseUrl}}/pets', params: [{ key: 'limit', value: '10', enabled: true }, { key: 'cursor', value: '{{next}}', enabled: false }], headers: [{ key: 'X-Tenant', value: 'north', enabled: true }, { key: 'Authorization', value: 'Bearer x', enabled: true }] },
          examples: [{ id: 'e1', name: 'Two pets', status: 200, headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }], body: '[{"id":1,"name":"Rex","born":"2020-01-02T00:00:00Z"}]' }],
        },
        {
          kind: 'http',
          id: 'get',
          name: 'Get a pet',
          request: { method: 'GET', url: '{{baseUrl}}/pets/:petId' },
          examples: [
            { id: 'e2', name: 'Found', status: 200, headers: [], body: '{"id":1,"name":"Rex"}' },
            { id: 'e3', name: 'Not found', status: 404, headers: [], body: '{"error":"no pet"}' },
          ],
        },
        {
          kind: 'http',
          id: 'create',
          name: 'Create pet',
          request: { method: 'POST', url: '{{baseUrl}}/pets', body: { type: 'json', content: '{"name":"Rex","age":3,"vaccinated":true}' }, auth: { type: 'apiKey', key: 'X-Api-Key', value: '{{apiKey}}', in: 'header' } },
          assertions: [{ type: 'status', expected: 201 }],
        },
      ],
    },
    { kind: 'graphql', id: 'g', name: 'GraphQL', request: { endpoint: '{{baseUrl}}/graphql', query: '{ a }' } },
  ],
};

describe('OpenAPI from a collection', () => {
  it('describes paths, parameters, bodies, responses, tags and security', () => {
    const d = collectionToOpenApi(collection);
    expect(d).toMatchObject({ openapi: '3.1.0', info: { title: 'Pets API', version: '2.0.0', description: 'Pet store' }, servers: [{ url: 'https://pets.example.test/v1' }], tags: [{ name: 'Pets' }] });
    const list = d.paths['/pets'].get;
    expect(list).toMatchObject({ operationId: 'listPets', summary: 'List pets', description: 'All pets, paged.', tags: ['Pets'], security: [{ bearerAuth: [] }] });
    expect(list.parameters).toEqual([
      { name: 'limit', in: 'query', required: true, schema: { type: 'string' }, example: '10' },
      { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' }, example: 'north' },
    ]);
    expect(list.responses['200'].content['application/json'].schema).toEqual({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, born: { type: 'string', format: 'date-time' } }, required: ['id', 'name', 'born'] },
    });
    const get = d.paths['/pets/{petId}'].get;
    expect(get.parameters).toEqual([{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }]);
    expect(Object.keys(get.responses)).toEqual(['200', '404']);
    const create = d.paths['/pets'].post;
    expect(create.requestBody.content['application/json'].example).toEqual({ name: 'Rex', age: 3, vaccinated: true });
    expect(create.security).toEqual([{ 'apiKey_XApiKey': [] }]);
    expect(create.responses).toEqual({ '201': { description: 'Success' } });
    expect(d.components.securitySchemes).toEqual({ bearerAuth: { type: 'http', scheme: 'bearer' }, 'apiKey_XApiKey': { type: 'apiKey', in: 'header', name: 'X-Api-Key' } });
    expect(d['x-testpion-note']).toMatch(/1 GraphQL/);
  });

  it('is a valid document for the importer and the diff (YAML and JSON)', () => {
    const yaml = collectionToOpenApiText(collection);
    expect(parseYaml(yaml).openapi).toBe('3.1.0');
    const back = importOpenApi(yaml).collection;
    const reqs = (back.items as Array<{ items?: SavedHttpRequest[] }>).flatMap((x) => x.items ?? [x as unknown as SavedHttpRequest]);
    expect(reqs.map((r) => `${r.request.method} ${r.request.url}`).sort()).toEqual(['GET {{baseUrl}}/pets', 'GET {{baseUrl}}/pets/{{petId}}', 'POST {{baseUrl}}/pets']);
    const json = collectionToOpenApiText(collection, { format: 'json' });
    expect(diffOpenApi(json, yaml)).toMatchObject({ breaking: [], nonBreaking: [] });
  });
});
