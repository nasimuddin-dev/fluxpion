import { describe, expect, it } from 'vitest';
import { apiCoverage, apiCoverageMarkdown, loadOpenApi, observationsFromHistory, observationsFromResults, type HistoryEntry, type TestResult } from '../../packages/core/src/index.js';

const spec = loadOpenApi(`
openapi: 3.0.3
info: { title: Pets, version: 1.2.0 }
servers: [{ url: https://api.example.com/v1 }]
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      tags: [pets]
      responses: { '200': { description: ok }, '4XX': { description: client error } }
    post:
      operationId: createPet
      responses: { '201': { description: created }, '400': { description: bad } }
  /pets/mine:
    get:
      responses: { '200': { description: ok } }
  /pets/{id}:
    get:
      operationId: getPet
      responses: { '200': { description: ok }, default: { description: error } }
  /old:
    get:
      deprecated: true
      responses: { '200': { description: ok } }
`);

describe('API coverage', () => {
  it('matches requests to operations and documented responses', () => {
    const r = apiCoverage(spec, [
      { method: 'GET', url: 'https://api.example.com/v1/pets', status: 200, name: 'list' },
      { method: 'get', url: 'https://api.example.com/v1/pets?limit=2', status: 422, name: 'list bad limit' },
      { method: 'GET', url: 'https://api.example.com/v1/pets/mine', status: 200 },
      { method: 'GET', url: 'https://api.example.com/v1/pets/7', status: 500 },
      { method: 'POST', url: 'https://api.example.com/v1/pets', status: 201 },
      { method: 'POST', url: 'https://api.example.com/v1/pets', status: 409 },
      { method: 'DELETE', url: 'https://api.example.com/v1/pets/7', status: 204 },
    ]);
    const op = (k: string) => r.operations.find((o) => `${o.method} ${o.path}` === k)!;

    expect(op('GET /pets')).toMatchObject({ calls: 2, testedStatuses: ['200', '4XX'], untestedStatuses: [], undocumentedStatuses: [], examples: ['list', 'list bad limit'], tags: ['pets'] });
    // the literal path wins over the template
    expect(op('GET /pets/mine').calls).toBe(1);
    // `default` documents every other code
    expect(op('GET /pets/{id}')).toMatchObject({ calls: 1, testedStatuses: [], untestedStatuses: ['200'], undocumentedStatuses: [] });
    expect(op('POST /pets')).toMatchObject({ testedStatuses: ['201'], untestedStatuses: ['400'], undocumentedStatuses: ['409'] });
    expect(op('GET /old')).toMatchObject({ covered: false, deprecated: true });

    expect(r.summary).toMatchObject({ operations: 5, covered: 4, operationPct: 80, documentedStatuses: 7, testedStatuses: 4, statusPct: 57.1, observations: 7, unmatched: 1 });
    expect(r.unmatched).toEqual([{ method: 'DELETE', path: '/v1/pets/7', count: 1, statuses: [204] }]);
    expect(r).toMatchObject({ title: 'Pets', version: '1.2.0', schemaVersion: '1' });

    const md = apiCoverageMarkdown(r);
    expect(md).toContain('4 of 5 covered (80%)');
    expect(md).toContain('| ◐ | `POST /pets` |');
    expect(md).toContain('409 ⚠ ×1');
    expect(md).toContain('`DELETE /v1/pets/7` ×1 (204)');
  });

  it('can leave out deprecated operations and restrict to a base URL', () => {
    const r = apiCoverage(
      spec,
      [
        { method: 'GET', url: 'http://localhost:4010/v1/pets', status: 200 },
        { method: 'GET', url: 'https://other.example.com/anything', status: 200 },
      ],
      { baseUrl: 'http://localhost:4010/', excludeDeprecated: true },
    );
    expect(r.summary).toMatchObject({ operations: 4, covered: 1, observations: 1, unmatched: 0 });
  });

  it('reads observations from test results and history', () => {
    const results = [
      { type: 'http', name: 'a', metadata: { method: 'GET', url: 'https://api.example.com/v1/pets', status: 200 } },
      { type: 'llm', name: 'b', metadata: {} },
      { type: 'http', name: 'c' },
    ] as unknown as TestResult[];
    expect([...observationsFromResults(results)]).toEqual([{ method: 'GET', url: 'https://api.example.com/v1/pets', status: 200, name: 'a', source: 'test' }]);
    const history = [
      { kind: 'http', name: 'h', method: 'POST', url: 'https://api.example.com/v1/pets', status: 201 },
      { kind: 'http', name: 'failed', method: 'GET', url: 'https://x', status: 'NetworkError' },
      { kind: 'mcp', name: 'm' },
    ] as unknown as HistoryEntry[];
    expect([...observationsFromHistory(history)].map((o) => [o.name, o.status])).toEqual([
      ['h', 201],
      ['failed', undefined],
    ]);
  });
});
