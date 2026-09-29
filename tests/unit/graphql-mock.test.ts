import { describe, it, expect } from 'vitest';
import { createGraphQLMock, schemaFromSdl, startGraphQLMockServer } from '../../packages/core/src/index.js';

const sdl = `
  enum Species { DOG CAT BIRD }
  interface Node { id: ID! }
  type Owner implements Node { id: ID! name: String! email: String phone: String }
  type Patient implements Node { id: ID! name: String! species: Species! age: Int owner: Owner visits: [Visit!]! }
  type Visit { at: String! price: Float! note: String }
  union SearchResult = Patient | Owner
  type Query {
    patient(id: ID!): Patient
    patients(species: Species): [Patient!]!
    search(text: String!): [SearchResult!]!
    node(id: ID!): Node
  }
  type Mutation { createPatient(name: String!): Patient! }
`;

describe('GraphQL mock', () => {
  const schema = schemaFromSdl(sdl);

  it('answers valid queries with typed, plausible, deterministic data', () => {
    const mock = createGraphQLMock(schema);
    const q = `{ patients { id name species age owner { email phone } visits { at price } } }`;
    const r = mock.run(q);
    expect(r.errors).toBeUndefined();
    const list = (r.data as { patients: Array<Record<string, unknown>> }).patients;
    expect(list).toHaveLength(2);
    const p = list[0]!;
    expect(typeof p.id).toBe('string');
    expect(['DOG', 'CAT', 'BIRD']).toContain(p.species);
    expect(typeof p.age).toBe('number');
    expect((p.owner as { email: string }).email).toMatch(/@example\.com$/);
    expect((p.visits as Array<{ at: string; price: number }>)[0]!.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(mock.run(q)).toEqual(r); // same query, same data
    // no half-generated values anywhere (e.g. "Ann undefined")
    expect(JSON.stringify(mock.run('{ patients { name owner { name } } }'))).not.toMatch(/undefined|NaN/);
  });

  it('uses overrides, lists and abstract types', () => {
    const mock = createGraphQLMock(schema, { listLength: 3, overrides: { Patient: { name: 'Rex', species: 'DOG' } } });
    const r = mock.run(`{ patient(id: "1") { name species owner { name } } search(text: "x") { __typename ... on Patient { name } ... on Owner { email } } node(id: "1") { id __typename } }`);
    expect(r.errors).toBeUndefined();
    const d = r.data as { patient: { name: string; species: string; owner: { name: string } }; search: Array<{ __typename: string }>; node: { __typename: string } };
    expect(d.patient).toMatchObject({ name: 'Rex', species: 'DOG' });
    expect(typeof d.patient.owner.name).toBe('string');
    expect(d.search).toHaveLength(3);
    for (const s of d.search) expect(['Patient', 'Owner']).toContain(s.__typename);
    expect(['Patient', 'Owner']).toContain(d.node.__typename);
    expect((mock.run(`mutation { createPatient(name: "Tom") { name } }`).data as { createPatient: { name: string } }).createPatient.name).toBe('Rex');
  });

  it('reports invalid queries like a real server, and supports introspection', () => {
    const mock = createGraphQLMock(schema);
    expect(mock.run('{ patients { nope } }').errors![0]!.message).toMatch(/Cannot query field "nope"/);
    expect(mock.run('{ patients {').errors![0]!.message).toMatch(/Syntax Error/);
    const intro = mock.run('{ __schema { queryType { name } } }');
    expect(intro.data).toEqual({ __schema: { queryType: { name: 'Query' } } });
  });

  it('serves over HTTP on localhost', async () => {
    const server = await startGraphQLMockServer(schema, { port: 0 });
    try {
      const r = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query P($id: ID!) { patient(id: $id) { name } }', variables: { id: '7' } }) });
      expect(r.status).toBe(200);
      expect(((await r.json()) as { data: { patient: { name: string } } }).data.patient.name).toEqual(expect.any(String));
      const bad = await fetch(server.url, { method: 'POST', body: '{"query":"{ nope }"}' });
      expect(bad.status).toBe(400);
      await expect(startGraphQLMockServer(schema, { host: '0.0.0.0' })).rejects.toThrow(/localhost/);
    } finally {
      await server.close();
    }
  });
});
