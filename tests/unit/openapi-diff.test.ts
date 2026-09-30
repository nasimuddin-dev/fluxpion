import { describe, expect, it } from 'vitest';
import { diffOpenApi } from '../../packages/core/src/index.js';

const v1 = {
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1' },
  paths: {
    '/pets': {
      get: {
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['available', 'sold', 'pending'] } },
        ],
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } } },
      },
      post: {
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, tag: { type: 'string' } } } } } },
        responses: { '201': { description: 'created' } },
      },
    },
    '/pets/{petId}': {
      get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } }, '404': { description: 'nope' } } },
      delete: { responses: { '204': { description: 'gone' } } },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name', 'owner'],
        properties: { id: { type: 'integer' }, name: { type: 'string' }, owner: { $ref: '#/components/schemas/Owner' }, tag: { type: 'string' } },
      },
      // recursive: must not loop
      Owner: { type: 'object', properties: { name: { type: 'string' }, friend: { $ref: '#/components/schemas/Owner' } } },
    },
  },
};

const v2 = structuredClone(v1) as any;
// breaking
delete v2.paths['/pets/{petId}'].delete; // operation removed
v2.paths['/pets'].get.parameters[0].required = true; // optional → required
v2.paths['/pets'].get.parameters[1].schema.enum = ['available', 'sold']; // enum narrowed
v2.paths['/pets'].post.requestBody.content['application/json'].schema.required = ['name', 'tag']; // body field now required
v2.components.schemas.Pet.required = ['id', 'name']; // owner now optional in the response
v2.components.schemas.Pet.properties.id = { type: 'string' }; // type changed
delete v2.components.schemas.Pet.properties.tag; // response field removed
// non-breaking
v2.paths['/pets'].get.parameters.push({ name: 'sort', in: 'query', schema: { type: 'string' } });
v2.paths['/pets/{id}'] = v2.paths['/pets/{petId}']; // renamed path parameter: same operation
delete v2.paths['/pets/{petId}'];
v2.paths['/pets/{id}'].get.responses['429'] = { description: 'slow down' };
v2.paths['/owners'] = { get: { responses: { '200': { description: 'ok' } } } };
v2.components.schemas.Owner.properties.email = { type: 'string' };

describe('OpenAPI breaking-change diff', () => {
  it('finds breaking and non-breaking changes', () => {
    const d = diffOpenApi(JSON.stringify(v1), JSON.stringify(v2));
    expect(d.operations).toEqual({ old: 4, new: 4, added: 1, removed: 1 });
    const brief = (cs: typeof d.breaking) => cs.map((c) => `${c.kind} | ${c.where} | ${c.message}`).sort();
    expect(brief(d.breaking)).toEqual(
      [
        'operation-removed | DELETE /pets/{petId} | operation removed',
        'parameter-required | GET /pets | query parameter "limit" is now required',
        'parameter-enum-narrowed | GET /pets | query parameter "status" no longer accepts "pending"',
        'request-property-required | POST /pets request body tag | is now required',
        'response-type-changed | GET /pets response 200 [].id | type changed from integer to string',
        'response-property-optional | GET /pets response 200 [].owner | was always returned, now optional',
        'response-property-removed | GET /pets response 200 [].tag | removed from the response',
        'response-type-changed | GET /pets/{id} response 200 id | type changed from integer to string',
        'response-property-optional | GET /pets/{id} response 200 owner | was always returned, now optional',
        'response-property-removed | GET /pets/{id} response 200 tag | removed from the response',
      ].sort(),
    );
    expect(brief(d.nonBreaking)).toEqual(
      [
        'parameter-added | GET /pets | new optional query parameter "sort"',
        'response-property-added | GET /pets response 200 [].owner.email | new field',
        'response-property-added | GET /pets/{id} response 200 owner.email | new field',
        'response-added | GET /pets/{id} | new 429 response',
        'operation-added | GET /owners | new operation',
      ].sort(),
    );
  });

  it('an identical document has no changes; YAML works too', () => {
    const yaml = 'openapi: 3.0.0\ninfo: { title: A, version: "1" }\npaths:\n  /a:\n    get:\n      responses:\n        "200": { description: ok }\n';
    expect(diffOpenApi(yaml, yaml)).toMatchObject({ breaking: [], nonBreaking: [] });
    expect(() => diffOpenApi('{}', yaml)).toThrow(/Not an OpenAPI/);
  });
});
